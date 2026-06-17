FROM oven/bun:1.3.13 AS base
WORKDIR /app
ENV NODE_ENV=production PORT=3000

FROM base AS build
ARG VERSION=dev
ENV VERSION=${VERSION}
COPY --link package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY --link . .
RUN bun run build && bun install --production --frozen-lockfile

FROM base
ARG VERSION=dev
ENV VERSION=${VERSION}
COPY --from=build /app/build /app/build
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
# bun = UID/GID 1000 in oven/bun — must match runAsUser/runAsGroup in config/base/deployment.yaml
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
