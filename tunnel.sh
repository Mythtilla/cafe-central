#!/usr/bin/env bash
# Keeps café-central (node server + cloudflared quick tunnel) alive.
# Usage: ./tunnel.sh start | stop | status | url
set -uo pipefail
cd "$(dirname "$0")"

CF_BIN=/tmp/cloudflared
CF_LOG=/tmp/cafe-tunnel.log
APP_LOG=/tmp/cafe-server.log
URL_FILE=/tmp/cafe-tunnel-url.txt
CF_PID=/tmp/cafe-tunnel.pid
APP_PID=/tmp/cafe-server.pid

start() {
  # --- node server (only if :3000 is free) ---
  if ! pgrep -f "server/index.js" >/dev/null; then
    nohup node --no-warnings server/index.js >"$APP_LOG" 2>&1 &
    echo $! >"$APP_PID"
    sleep 2
  fi

  # --- cloudflared ---
  if [ -f "$CF_PID" ] && kill -0 "$(cat "$CF_PID")" 2>/dev/null; then
    echo "cloudflared already running (pid $(cat "$CF_PID"))"
  else
    : >"$CF_LOG"
    setsid nohup "$CF_BIN" tunnel --url http://localhost:3000 \
      --no-autoupdate >"$CF_LOG" 2>&1 &
    echo $! >"$CF_PID"
    # wait up to 45s for the hostname to appear
    for _ in $(seq 1 45); do
      if grep -qoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null; then break; fi
      sleep 1
    done
  fi

  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | head -1)
  if [ -n "${URL:-}" ]; then
    echo "$URL" >"$URL_FILE"
    echo "public : $URL/"
    echo "admin  : $URL/admin"
  else
    echo "tunnel did not report a URL yet — check $CF_LOG"
    return 1
  fi
}

stop() {
  [ -f "$CF_PID" ] && kill "$(cat "$CF_PID")" 2>/dev/null
  [ -f "$APP_PID" ] && kill "$(cat "$APP_PID")" 2>/dev/null
  pkill -f "cloudflared tunnel --url http://localhost:3000" 2>/dev/null
  echo stopped
}

status() {
  pgrep -f "server/index.js" >/dev/null && echo "node     : UP" || echo "node     : DOWN"
  pgrep -f "cloudflared tunnel" >/dev/null && echo "tunnel   : UP" || echo "tunnel   : DOWN"
  [ -f "$URL_FILE" ] && echo "url      : $(cat "$URL_FILE")"
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  status) status ;;
  url)    [ -f "$URL_FILE" ] && cat "$URL_FILE" ;;
  *)      echo "usage: $0 start|stop|status|url"; exit 2 ;;
esac
