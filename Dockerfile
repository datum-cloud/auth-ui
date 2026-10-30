# syntax = docker/dockerfile:1

# ==========================================
# BASE STAGE - Common dependencies and setup
# ==========================================
FROM node:26.13.0-alpine3.24@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS base

RUN apk add --no-cache --upgrade 'ca-certificates>=20261020-r0'
RUN ! grep -q MIICTjCCAdOgAwIBAgIKPPYHqWhwDtqLhDAKBggqhkjOPQQDAzBrMQswCQYDVQQG /etc/ssl/certs/ca-certificates.crt

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# ==========================================
# BUILD STAGE - Compile and prepare the app
# ==========================================
FROM base AS build

ARG SENTRY_AUTH_TOKEN
ARG VERSION=dev
ENV VERSION=${VERSION}
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}

COPY --link package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund

COPY --link . .

# @lingui/vite-plugin compiles message catalogs during the build — no separate
# i18n:compile step is needed (committed catalogs are kept fresh by the lefthook
# i18n hook and verified by the CI i18n-check job).
RUN npm run build && \
    npm prune --omit=dev --ignore-scripts --no-audit --no-fund && \
    touch .env

# ==========================================
# PRODUCTION STAGE - Final lightweight image
# ==========================================
FROM base

ARG VERSION=dev
ENV VERSION=${VERSION}

# Non-root runtime user. uid/gid 1001 MUST match runAsUser/runAsGroup in
# config/base/deployment.yaml.
RUN addgroup -g 1001 datum && \
    adduser -u 1001 -G datum -D -H datum && \
    chown datum:datum /app

COPY --from=build --chown=1001:1001 /app /app

EXPOSE ${PORT}

USER datum

CMD [ "node", "./build/server/index.js" ]
