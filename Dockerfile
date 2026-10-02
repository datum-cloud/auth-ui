# syntax = docker/dockerfile:1

# ==========================================
# BASE STAGE - Common dependencies and setup
# ==========================================
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base

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
