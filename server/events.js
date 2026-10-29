/**
 * Server-Sent Events hub.
 *
 * One process, one Set of open responses. Broadcasts are fire-and-forget: a
 * client that has gone away is dropped on the next write error.
 */

const clients = new Set();

export const PUBLIC_EVENTS = ['review', 'review:update', 'menu', 'gallery', 'settings'];

export function attachClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: do not buffer the stream
  });
  res.write(': connected\n\n');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const client = { res, ip: req.ip, since: Date.now() };
  clients.add(client);

  const drop = () => clients.delete(client);
  req.on('close', drop);
  req.on('error', drop);
  res.on('error', drop);

  return client;
}

export function broadcast(event, data) {
  if (!PUBLIC_EVENTS.includes(event)) return 0;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  let sent = 0;
  for (const client of clients) {
    try {
      client.res.write(payload);
      sent += 1;
    } catch {
      clients.delete(client);
    }
  }
  return sent;
}

export function ping() {
  for (const client of clients) {
    try {
      client.res.write(': keep-alive\n\n');
    } catch {
      clients.delete(client);
    }
  }
}

export function clientCount() {
  return clients.size;
}

export function closeAll() {
  for (const client of clients) {
    try {
      client.res.end();
    } catch {
      /* already gone */
    }
  }
  clients.clear();
}
