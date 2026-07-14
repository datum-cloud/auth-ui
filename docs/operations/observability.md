# Observability

Three signals: Sentry for errors and traces, Prometheus for metrics, and a Grafana dashboard on
top of them. All of it is optional at boot — unset the DSN and Sentry is a true no-op; metrics are
always on but cost nothing if nobody scrapes them.

## Sentry

Configured by two variables (see [Configuration](./configuration.md)):

| Variable | Default | Notes |
| --- | --- | --- |
| `SENTRY_DSN` | unset → disabled | Must be a valid `https://` DSN. An invalid value fails fast at startup. |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Fraction of requests sampled for performance tracing. |

Server init lives in `app/server/sentry.server.ts`.

### Scrubbing is an allowlist

`app/server/sentry-scrub.ts` is the egress neutrality boundary. It is wired into `beforeSend` on
both the server and the client. It is an **allowlist**, not a denylist: a fresh event is
constructed from only the fields known to be safe, and everything else is dropped. A denylist would
silently leak whatever field the SDK adds next.

No provider type, proto message, login name, identifier, token, cookie, or request body leaves the
process via Sentry.

The raw detail is not lost — it stays in the server log, keyed by `traceId`. The `traceId` tag
survives scrubbing, so the pivot is:

```
Sentry event (scrubbed, has traceId)
        |
        v
server log line for that traceId  ->  full provider/proto detail, never sent anywhere
```

## Metrics

`app/server/observability.ts` owns a private `prom-client` `Registry` (plus default Node process
metrics). Two application metrics:

| Metric | Type | Labels |
| --- | --- | --- |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` |
| `auth_events_total` | Counter | `event`, `outcome` |

`route` is the **matched Hono path pattern** (e.g. `/id/login/password`), never the raw URL — that
is what keeps label cardinality bounded when identifiers appear in query params. The `httpMetrics`
middleware is mounted first (`app.use('*', httpMetrics)`) so the timer captures total request
latency.

Histogram buckets span `0.005s` → `5s`: sub-millisecond static assets at one end, multi-second IdP
redirects at the other.

The registry is exposed at `/metrics`. That endpoint is intentionally unauthenticated — the
`HTTPRoute` never exposes it externally, so it is reachable cluster-internally only. Do not add
app-level auth there without a matching gateway-policy decision; scraping breaks otherwise.

## Scraping and alerts

```
auth-ui pod  --/metrics-->  ServiceMonitor (config/base/service-monitor.yaml)
                                  |
                                  v
                            Prometheus  --> PrometheusRule (config/base/prometheus-rules.yaml)
                                  |                 |
                                  v                 v
                              Grafana           alerts
```

Alert rules in `config/base/prometheus-rules.yaml`, group `auth-ui.slos`:

| Alert | Condition |
| --- | --- |
| `AuthUIHighErrorRate` | 5xx ratio over 2% for 10m (critical) |
| `AuthUIHighLatencyP95` | p95 request latency breach |
| `AuthUISignInFailureSpike` | Sign-in failure spike from `auth_events_total` |

## Dashboard

`config/observability/dashboard-auth-ui.json` — the `auth-ui` Grafana dashboard. Two rows:

- **HTTP SLOs** — request rate, 5xx error rate, latency p50 / p95 / p99
- **Auth Events** — sign-in events (password / LDAP / IdP) success vs failure, and all auth events
  by type

## Health

`/healthz` (liveness) and `/readyz` (readiness). The Deployment's `livenessProbe` uses `/healthz` and its `readinessProbe` uses `/readyz`.
