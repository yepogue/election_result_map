# syntax=docker/dockerfile:1

FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/dist/standalone ./dist/standalone

USER node
EXPOSE 8000

# AI Builder/Koyeb supplies PORT at runtime. HOST is the vinext bind address.
CMD sh -c "export HOST=0.0.0.0; export PORT=${PORT:-8000}; exec node dist/standalone/server.js"
