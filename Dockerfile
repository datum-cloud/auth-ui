# syntax = docker/dockerfile:1

# ==========================================
# BASE STAGE - Common dependencies and setup
# ==========================================
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base

# Install system dependencies and clean up in the same layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends unzip ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=/tmp/bun-transpiler-cache

# ==========================================
# BUILD STAGE - Compile and prepare the app
# ==========================================
FROM base AS build

ARG SENTRY_AUTH_TOKEN
ARG VERSION=dev
ENV VERSION=${VERSION}
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}

COPY --link package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY --link . .

# @lingui/vite-plugin compiles message catalogs during the build — no separate
# i18n:compile step is needed (committed catalogs are kept fresh by the lefthook
# i18n hook and verified by the CI i18n-check job).
RUN bun run build && \
    bun install --production --frozen-lockfile && \
    touch .env

# ==========================================
# PRODUCTION STAGE - Final lightweight image
# ==========================================
FROM base

ARG VERSION=dev
ENV VERSION=${VERSION}

COPY --from=build /app /app

EXPOSE ${PORT}

# Non-root runtime user. uid/gid 1001 MUST match runAsUser/runAsGroup in
# config/base/deployment.yaml.
RUN groupadd --gid 1001 datum && \
    useradd --uid 1001 --gid 1001 --no-create-home datum && \
    chown -R datum:datum /app

USER datum

CMD [ "bun", "run", "start" ]
