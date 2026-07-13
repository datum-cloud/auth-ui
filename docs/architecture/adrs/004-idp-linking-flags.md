# 004. IdP linking flags

- **Status:** Accepted
- **Date:** 2026-07-01

## Context

Attaching an external identity (Google, GitHub, an enterprise IdP) to an account that already exists is the most dangerous operation in this app. Get the scoping wrong and it is not a bug — it is account takeover.

Two concrete findings forced the current posture:

**Auto-link is not safe by default.** A spike against a live Zitadel (2026-06-18) confirmed that password login here is **not** gated on email verification: a user registered with an unverified email and a password could sign in with that password. So an attacker can pre-register `you@example.com` with a password they chose. If the app later sees a verified Google identity for `you@example.com` and blindly links it to that account, the victim signs in with Google — onto an account whose password the attacker still knows. Pre-account-takeover, delivered by our own convenience feature.

**Unlink can lock a user out.** Zitadel has no unlink policy at all — `RemoveIDPLink` is an API operation gated only by API auth, with no notion of "this is the last sign-in method". Nothing but this app stands between a user and removing the only credential they own. (Zitadel's IdP options — `isLinkingAllowed`, `isCreationAllowed`, `isAutoCreation`, `autoLinking` — govern linking and creation, never unlinking.)

## Decision

**Three capability flags, all fail-closed, all defaulting to `false`, each enabled deliberately per environment.**

Defined in `app/server/infra/env.server.ts`; each is a string coerced so that only the exact value `'true'` enables it (an unset, empty, misspelled, or `'True'` value is off).

| Flag                       | What it opens                                                                                                                                                                                                                             | Default |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `ALLOW_IDP_AUTO_LINK`      | On the login/register path, link an IdP identity into an **existing same-email account** with no ceremony. Off: a same-email collision is a hard `account-exists` error and the owner must link the IdP from the signed-in `/sso` screen. | `false` |
| `ALLOW_IDP_LINK_ANY_EMAIL` | Let the **explicit link ceremony** (signed-in user, `/sso`) attach an identity whose email differs from the account's. Off: the strict gate applies — the IdP-verified email must already be owned by the session user.                   | `false` |
| `ALLOW_IDP_UNLINK`         | Expose the Unlink control and permit `removeIdpLink`.                                                                                                                                                                                     | `false` |

Two further rules make the flags safe _when they are on_:

- With `ALLOW_IDP_AUTO_LINK` enabled, the decision (`app/resources/sso/idp-callback.ts`) still only auto-links when the IdP asserts a **verified** email **and** the existing account has **no password** — the only combination with nothing to take over. Anything else yields `link-needs-auth`: sign in first, then link.
- With `ALLOW_IDP_UNLINK` enabled, unlinking is gated by a **login-method-aware lockout guard**, `canUnlinkIdp` (`app/resources/sso/sso-management.ts`): the unlink is allowed only if the user retains at least one _primary_ sign-in method afterwards — another IdP link, a password, or a passkey. Second factors (TOTP, U2F, SMS/email OTP) do not count; they cannot sign anyone in alone. The guard runs twice: in the loader, to disable the control with a tooltip, and again in the action (`app/resources/sso/sso-action.ts`) **before** `removeIdpLink` — the client's disabled state is never trusted.

## Rationale

Fail-closed defaults mean a new environment, a fresh deploy, or a forgotten variable lands in the _safe_ state. Opening a capability is then an explicit, reviewable act tied to a specific environment, not an accident of omission. For a surface where the failure mode is account takeover, that asymmetry is worth the friction.

Separating the three flags matters too: they gate genuinely different risks (silent linking on an unauthenticated path; multi-identity linking on an authenticated path; destructive removal). Collapsing them into one switch would force an operator to accept all three to get any one.

## Alternatives Considered

### Auto-link on verified email, unconditionally

- **Pros:** The smoothest possible UX — an existing user who signs in with Google just gets in.
- **Cons:** Directly enables the pre-account-takeover above, because Zitadel does not gate password login on email verification.
- **Why rejected:** Empirically unsafe on this backend. It is only defensible with the "verified **and** passwordless" guard, which is what the flag actually enables.

### Rely on Zitadel's own IdP options (`autoLinking`, `isLinkingAllowed`)

- **Pros:** Configuration lives in the identity backend; no app flags.
- **Cons:** They govern linking and creation, not unlinking; they carry no notion of a last-remaining sign-in method; and depending on them re-couples the app to Zitadel policy semantics, against [ADR 001](./001-provider-seam.md).
- **Why rejected:** They do not cover the failure modes that actually bite, and they cannot express the lockout guard at all.

### One flag for all IdP linking behaviour

- **Pros:** Simpler configuration surface.
- **Cons:** Forces an all-or-nothing choice across three unrelated risks.
- **Why rejected:** Environments legitimately want unlink without auto-link, or the strict-email ceremony without any of the rest.

### Default the flags on, disable them where unsafe

- **Pros:** Nothing to remember for the common case.
- **Cons:** A missing variable becomes an _open_ capability. The failure mode of forgetfulness is takeover.
- **Why rejected:** The whole point is that the default must be the safe direction.

## Consequences

**Positive**

- Production opens dangerous capabilities deliberately, one at a time, with a review attached — never by default and never by omission.
- Every path has a server-side guard independent of the flag: auto-link still requires verified-and-passwordless; unlink still requires a surviving primary method. The flags gate _whether the door exists_, not _whether it is guarded_.
- Enablement can be staged: staging first, production later.

**Negative**

- **Environment drift.** Staging and production can behave differently on the most security-sensitive flows, which means a flow that works in staging may hard-error in production. This is the accepted cost.
- Three variables to document, set, and reason about, per environment.

**Risks & Mitigations**

| Risk                                                                                          | Mitigation                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A flag is enabled without the guard behind it being understood                                | The guards are unconditional and server-side; enabling a flag cannot bypass them.                                                                                                                                                                     |
| Concurrent unlink requests race the lockout guard (two links, no password/passkey, two POSTs) | Known TOCTOU window, accepted: `removeIdpLink` offers no atomic check-and-remove, the window is narrow and self-inflicted, and the flag ships default-off. Mitigation when enabling: re-check after removal and alert if zero primary methods remain. |
| Behaviour differs between environments and confuses debugging                                 | Every flag is read through the validated env schema and its effect is visible in the audit trail (`idp.link`, `idp.link.denied`, `idp.unlink`).                                                                                                       |

## References

- `app/server/infra/env.server.ts` — flag definitions and fail-closed coercion
- `app/resources/sso/idp-callback.ts` — the pure decision (`auto-link`, `link-needs-auth`, `account-exists`)
- `app/resources/sso/sso-management.ts` — `canUnlinkIdp`; `app/resources/sso/sso-action.ts` — server-side re-check
- [Session & Security](../session-and-security.md)
