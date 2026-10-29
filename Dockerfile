# Café Central — public site + admin + API in one container.
# Zero npm dependencies, so there is no install step and no lockfile.
FROM node:22-slim

ENV NODE_ENV=production \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# App code (node:sqlite is built into Node 22, nothing to install)
COPY server ./server
COPY admin ./admin
COPY assets ./assets
COPY index.html ./index.html
COPY package.json ./package.json

# Everything that must survive a redeploy lives here. Railway mounts the
# volume over this path, so it must exist and be writable.
RUN mkdir -p /data/uploads

EXPOSE 3000

# Railway provides $PORT; the server reads it from the environment.
CMD ["node", "--no-warnings", "server/index.js"]
