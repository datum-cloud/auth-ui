# Deployment

The app ships as two OCI artifacts — a container image and a Kustomize bundle — both published by
CI to GHCR. Flux in the Datum infrastructure repository resolves them; there is no `kubectl apply`
step in this repo.

## The Kustomize base

`config/base/` is the deployable base. It is intentionally thin — environment-specific values live
in overlays in the infra repo, not here.

| File | What it declares |
| --- | --- |
| `deployment.yaml` | The `auth-ui` Deployment: image, port `3000`, probes on `/healthz`, non-schema-visible env (`ZITADEL_API_URL`, the `PUBLIC_ORIGIN` placeholder) and a `secretRef` to the `auth-ui` Secret for the rest |
| `service.yaml` | ClusterIP Service on port `3000`, port name `http` |
| `http-route.yaml` | Gateway API `HTTPRoute` — path prefix `/id` on the `external-gateway` |
| `pdb.yaml` | PodDisruptionBudget |
| `service-monitor.yaml` | Prometheus Operator `ServiceMonitor` scraping `/metrics` on the `http` port |
| `prometheus-rules.yaml` | Alert rules — see [Observability](./observability.md) |

`config/observability/dashboard-auth-ui.json` ships alongside them (the Grafana dashboard); it is
not part of the Kustomize `resources` list.

## Artifacts

`.github/workflows/ci.yml` publishes on every push to `main` and on every published GitHub
release. Pull requests build and test but never publish.

```
push to main / GitHub release
        |
        v
   status-check  (lint, typecheck, component + e2e + acceptance suites)
        |
        +--> release-gate  (release events only; `production` GitHub environment)
        |
        v
  publish-container-image   -> ghcr.io/datum-cloud/auth-ui
        |
        v
  publish-kustomize-bundle  -> ghcr.io/datum-cloud/auth-ui-kustomize
                               (bundle-path: config, image-overlays: config/base)
```

The kustomize bundle depends on the image job, so the bundle it publishes always references an
image that exists. Both call shared reusable workflows from `datum-cloud/actions` (pinned by SHA).
Release publishes additionally pass through the `production` GitHub environment and its protection
rules via the `release-gate` job.

The image tag in `config/base/deployment.yaml` is `ghcr.io/datum-cloud/auth-ui:0.0.1` — a
placeholder, overwritten per release by the publish job's image overlay.

## Environments

| Environment | Tracks | Promotion |
| --- | --- | --- |
| Staging | `main` branch builds (pre-release tags, `v0.0.0-main-*`) | Automatic — merging to `main` deploys staging |
| Production | Stable releases (`semver: '>= 1.0.0'`) | **Cutting a GitHub release deploys production** |

The version selectors themselves are Flux `OCIRepository` settings in the Datum infrastructure
repository, not in this repo — this table records the contract, not its implementation.

## Base path

The app is served at **`/id`**, not at the domain root. Three things must agree:

- `vite.config.ts` sets `base: '/id/'`, so every asset URL carries the prefix
- the Hono server mounts assets under `/id/assets/*`, `/id/images/*`, `/id/favicons/*`
- the `HTTPRoute` matches path prefix `/id`

Requests to the legacy `/ui/v2/login/*` paths (hardcoded in sibling repos before the rewrite) are
301'd to `/id/*` by the `legacyRedirects` middleware. See
[ADR 003](../architecture/adrs/003-legacy-ui-v2-redirects.md).

Zitadel must point at the same place: its login-v2 base URI is what appends
`/login?authRequest=…`. A base-path mismatch there produces a 404 at the start of every login —
see [Troubleshooting](./troubleshooting.md).

## Health endpoints

| Path | Purpose |
| --- | --- |
| `/healthz` | Liveness — `{"status":"ok"}` |
| `/readyz` | Readiness — `{"status":"ready"}` |
| `/metrics` | Prometheus scrape target. Unauthenticated, but the `HTTPRoute` does not expose it externally — it is cluster-internal only |
| `/security` | `security.txt`-style contact line |
