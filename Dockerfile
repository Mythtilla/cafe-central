# Café Central — public site + admin + API in one container.
# Data lives in Postgres and image uploads in an S3 bucket; the container
# itself is disposable and holds nothing that must survive a deploy.
FROM node:22-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

# Dependencies first so the layer is cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Application code. index.html is prebuilt from src/ by build.py.
COPY server ./server
COPY admin ./admin
COPY assets ./assets
COPY index.html ./index.html

# Session secret fallback directory for local runs; the platform sets
# SESSION_SECRET, so nothing here needs to persist.
RUN mkdir -p /data

EXPOSE 3000

# The platform provides $PORT; the server reads it from the environment.
CMD ["node", "--no-warnings", "server/index.js"]
