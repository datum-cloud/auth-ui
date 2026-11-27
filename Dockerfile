# syntax = docker/dockerfile:1@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183

# ==========================================
# BASE STAGE - Common dependencies and setup
# ==========================================
FROM node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS base

RUN apk add --no-cache --upgrade 'ca-certificates>=20261020-r0'
RUN ! grep -q MIICTjCCAdOgAwIBAgIKPPYHqWhwDtqLhDAKBggqhkjOPQQDAzBrMQswCQYDVQQG /etc/ssl/certs/ca-certificates.crt

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# ==========================================
# BUILD STAGE - Compile and prepare the app
# ==========================================
FROM base AS build

ARG VERSION=dev
ENV VERSION=${VERSION}

# Install dependencies first so this layer stays cached until the lockfile
# changes. Node 26 ships no corepack, so install the pnpm that package.json's
# packageManager pins; it stays in this stage only. The split drops a
# `+sha512.` suffix, which npm can't parse.
COPY --link package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g "$(node -p 'require("./package.json").packageManager.split("+")[0]')" --no-audit --no-fund && \
    pnpm install --frozen-lockfile --prod=false --ignore-scripts

COPY --link . .

# @lingui/vite-plugin compiles message catalogs during the build — no separate
# i18n:compile step is needed (committed catalogs are kept fresh by the lefthook
# i18n hook and verified by the CI i18n-check job).
RUN pnpm build && \
    pnpm prune --prod --ignore-scripts && \
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
