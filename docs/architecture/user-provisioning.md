# User Provisioning

Creating a Zitadel user is not the end of a signup. Datum keeps its own `User` resource (`users.iam.miloapis.com`) — that is what the staff portal reads and what fraud screening runs against. This page describes how one becomes the other.

> **Datum-specific.** Everything downstream of the Zitadel event belongs to Datum's platform (the `zitadel-provider` repo). An external deployment of auth-ui would replace this pipeline with its own, or drop it entirely — auth-ui itself needs no code change either way.

## The Pipeline

```text
auth-ui creates the Zitadel user (AddHumanUser)
        |
        v
Zitadel emits  user.human.added          (login-v2 apps — this app)
               user.human.selfregistered  (legacy hosted login)
        |
        v
Actions v2 Execution  ->  webhook target /v1/actions/create-user-account
        |
        v
zitadel-provider actions-receiver  ->  creates the User resource (users.iam.miloapis.com)
        |
        v
Staff portal + fraud screening work off that User resource
```

## Where auth-ui Enters

Both signup paths converge on the same Zitadel call:

- **Password signup** — `app/resources/signup/signup.service.ts` → `addHumanUser`
- **SSO auto-create on first login** — `app/resources/sso/sso-callback.ts` → `registerAndLinkIdp` → `addHumanUser`

Both emit exactly one event: `user.human.added`. auth-ui's responsibility ends there; it never talks to the provisioning webhook.

## The Invariant

**Every human Zitadel user must have a User resource.**

A user without one holds working credentials but is never fraud-screened and is invisible to staff tooling. That is the failure mode this pipeline exists to prevent.

## Why Two Events

The event a signup emits depends on the _login implementation_, not the URL:

| Login generation                                      | Event emitted               |
| ----------------------------------------------------- | --------------------------- |
| Zitadel v1 hosted login (self-registration)           | `user.human.selfregistered` |
| Any login-v2 app, including this one (`AddHumanUser`) | `user.human.added`          |

Both events are bound to the **same** webhook target, so provisioning is login-generation-agnostic: either UI provisions correctly, and a rollback between them does too.

## Why a Sweeper

Actions v2 event webhooks are fire-and-forget. A delivery lost to receiver downtime is gone forever — the event is never retried. So the webhook is not the only enforcement: an invariant sweeper in `zitadel-provider` periodically reconciles Zitadel's human users against existing User resources and creates whatever is missing. It is create-only; deletion authority stays with the existing user controller, so the sweeper can never resurrect a deliberately deleted user.

The webhook is the fast path. The sweeper is the guarantee.
