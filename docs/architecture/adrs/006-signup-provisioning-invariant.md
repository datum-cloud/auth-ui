# 006. Signup provisioning invariant

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

Creating a Zitadel user is not the end of a signup. Datum keeps its own `User` resource (`users.iam.miloapis.com`); the staff portal reads it, and fraud screening runs against it. A Zitadel user with no `User` resource holds **working credentials, is never fraud-screened, and is invisible to staff tooling**. That is the failure mode.

On 2026-07-02, signups through the rebuilt auth-ui succeeded in Zitadel and then vanished: no `User` resource, fraud check "pending" forever.

The cause was an event-generation mismatch. The event a signup emits depends on the _login implementation_, not the URL:

- Zitadel's v1 hosted login self-registration emits **`user.human.selfregistered`**.
- Any login-v2 app — including this one, which creates users via `AddHumanUser` — emits **`user.human.added`**.

Live Zitadel had only a `selfregistered` execution bound to the provisioning webhook. `user.human.added` was bound to nothing, so every rebuild signup emitted an event that no one was listening for. The infrastructure code _declared_ the missing binding; declared state and live state had silently diverged, and nothing could notice.

The second, deeper problem: Actions v2 event webhooks are **fire-and-forget**. A delivery lost to receiver downtime is not retried — it is gone. Even a correct binding cannot guarantee the invariant on its own.

Both of this app's signup paths converge on the same call, so both emit exactly one event: password signup (`app/resources/signup/signup.service.ts` → `addHumanUser`) and SSO auto-create (`app/resources/sso/sso-callback.ts` → `registerAndLinkIdp` → `addHumanUser`).

## Decision

**Bind both events to the same webhook target, and back the webhook with a create-only invariant sweeper.**

- **Both** `user.human.added` and `user.human.selfregistered` are bound, as infrastructure-managed executions, to the **same** provisioning target. The two events are mutually exclusive per signup, so there is no double-fire; provisioning becomes login-generation-agnostic, and a rollback between login generations is a provisioning no-op.
- An **invariant sweeper** runs in `zitadel-provider`: on a ticker (default 10 minutes), it pages through Zitadel's human users and creates a `User` resource for any that lack one. It is **create-only** — it never deletes or mutates an existing resource, so deletion authority stays entirely with the existing user controller and the sweeper can never resurrect a deliberately deleted user. `AlreadyExists` is treated as success on both the webhook and the sweeper path, which makes the race between them harmless.
- The invariant it enforces, stated once: **every human Zitadel user has a `User` resource.**

**Push for speed, pull for truth.** The webhook is the fast path — milliseconds. The sweeper is the guarantee — minutes. Metrics on the sweeper (`scanned`, `missing`, `created`, `errors`, `last_success`) make a degraded fast path visible: `missing > 0` on consecutive sweeps means the webhook is broken even though users are being healed.

**No auth-ui code changes.** This decision is recorded here because it is the invariant this app's signup flow depends on, and because the app is one half of the contract.

## Rationale

The incident had two independent faults — a missing binding and an undetectable drift between declared and live state — and a third latent one: even with the binding correct, a lost webhook delivery would have produced the same unscreened user, quietly. Fixing only the binding fixes only the instance that happened to break.

A state-based reconciler is the shape that survives all three. It does not care why a `User` resource is missing — a lost webhook, a missing binding, a user created by an admin through the console or the API — it just converges. And because it is create-only, running it can never be destructive.

## Alternatives Considered

### auth-ui creates the `User` resource itself after signup

- **Pros:** No event plumbing; the app knows exactly when a signup succeeded.
- **Cons:** Couples auth-ui to Datum platform credentials and the milo API — precisely the coupling [ADR 001](./001-provider-seam.md) exists to prevent. It also misses every user created outside the signup flow (admin console, invite, API), and adds a second creation code path to keep in sync with the webhook's.
- **Why rejected:** Wrong layer. The invariant is about Zitadel users, not about this app's signups.

### Poll the Zitadel event store instead of using webhooks

- **Pros:** No lost deliveries; a complete history to replay.
- **Cons:** Event-log tailing needs cursors, checkpoints, and replay semantics — strictly more complex than diffing state, and it replays rather than self-corrects.
- **Why rejected:** State diffing converges from _any_ starting point, including a state nobody has an event for.

### Have the staff portal and fraud service read Zitadel directly

- **Pros:** No provisioning gap by construction — there is nothing to provision.
- **Cons:** Rearchitects every consumer to work around a producer bug, and abandons the `User` resource as the platform's identity record.
- **Why rejected:** Fixes the symptom by moving it downstream.

### Detection only — alert on drift, remediate by hand

- **Pros:** Cheapest to build; no reconciler to operate.
- **Cons:** The next lost webhook is a repeat of this incident with a human in the loop, and a slow human at that. Unscreened users persist for as long as the alert goes unread.
- **Why rejected:** The invariant is security-relevant. It needs enforcement, not a notification.

## Consequences

**Positive**

- Provisioning is login-generation-agnostic: legacy hosted login, this app, and a rollback between them all provision correctly.
- A lost webhook self-heals within one sweep interval. No user permanently escapes fraud screening.
- The backfill needs no separate mechanism — the first sweep in each environment _is_ the backfill.
- Users created outside any signup flow (admin console, invite, API) are provisioned too. In production this is a deliberate behaviour change: such users are unscreened today and will start being screened.

**Negative**

- The sweeper adds a periodic Zitadel user listing — a recurring API cost proportional to the user count, paid whether or not anything is missing.
- Provisioning is now enforced in two places (webhook and sweeper), which must construct the `User` resource identically. They share one construction function precisely so they cannot drift.
- Self-healing can hide a broken fast path, so it must be observed rather than trusted.

**Risks & Mitigations**

| Risk                                               | Mitigation                                                                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The sweeper masks a permanently broken webhook     | Alert on `missing > 0` across consecutive sweeps — being healed is not the same as being fine.                                                                        |
| The sweeper races the webhook and double-creates   | `AlreadyExists` is success on both paths.                                                                                                                             |
| A mid-sweep Zitadel error leaves a partial pass    | Create-only makes partial sweeps safe: log, count the error, abort, retry on the next tick. Never crash-loop.                                                         |
| The sweeper resurrects a deliberately deleted user | Create-only; deletion authority remains solely with the existing user controller's finalizer flow.                                                                    |
| Declared and live binding state diverge again      | Bindings are re-asserted as idempotent writes by the infrastructure apply, which now fails loudly on non-2xx responses instead of reporting success from stale state. |

## References

- [User Provisioning](../user-provisioning.md) — the pipeline, end to end
- `app/resources/signup/signup.service.ts`, `app/resources/sso/sso-callback.ts` — where auth-ui enters
- [ADR 001](./001-provider-seam.md) — why auth-ui does not write the `User` resource itself
