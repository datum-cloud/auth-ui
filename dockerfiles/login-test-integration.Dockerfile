FROM login-pnpm AS login-test-integration-dependencies
COPY ./apps/login-test-integration/package.json ./apps/login-test-integration/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    CYPRESS_INSTALL_BINARY=0 pnpm install --frozen-lockfile --filter=login-test-integration
FROM cypress/included:14.3.2 AS login-test-integration
WORKDIR /opt/app
COPY --from=login-test-integration-dependencies /build/apps/login-test-integration .
COPY ./apps/login-test-integration .

# `cypress/included` has an ENTRYPOINT by default; override it so our CMD runs.
ENTRYPOINT []
CMD ["cypress", "run"]
