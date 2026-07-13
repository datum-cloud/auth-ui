# 005. Login org scoping

- **Status:** Accepted
- **Date:** 2026-07-01

## Context

Zitadel can scope a login ceremony to an organization. That scope does two very different jobs at once:

- **Display** — which branding, which login settings, which IdP buttons the login screen shows.
- **Lookup** — which organization `findUser` searches when resolving the identifier the user typed.

Org-first work conflated them. When an OIDC request carried no `urn:zitadel:iam:org:id:<id>` scope, the app fell back to the **instance default org**, threaded that default through the whole ceremony (`/authorize` → `/login` URL → form → action), and handed it to `findUser`. In the Zitadel adapter, `findUser` adds an organization filter whenever an org id is present and returns a user only when exactly one matches.

The result: any user who was not a member of the default org got `USER_NOT_FOUND` — a lockout, reproduced on staging with `admin@admin.auth-new.staging.env.datum.net`, and confirmed by the fact that loading `/id/login?organization=` (empty org) signed the same user in fine.

The previous login never did this: it passed the org from the request context straight through, and used the default org only for display reads.

## Decision

**The default org is display-only. It never reaches user lookup.**

Two distinct concepts, kept apart:

| Concept                  | Source                                                                | Used for                                            | Threaded through the ceremony? |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------ |
| **Explicit org**         | OIDC `urn:zitadel:iam:org:id:` scope, or an explicit `?organization=` | scopes `findUser` **and** display                   | **Yes**                        |
| **Display-fallback org** | the default org, resolved when no explicit org is present             | **only** branding, login settings, and the IdP list | **No** — local to the request  |

Concretely:

- `app/resources/authorize/authorize.service.ts` threads the **explicit** org (`deriveOrganizationFromScopes`) into the `/login` · `/signup` · `/accounts` redirect. `resolveOrg` survives only for local display reads at the authorize boundary.
- The `/login` loader (`app/routes/login/index.tsx`) resolves a local `displayOrg = await resolveOrg(provider, rawOrg)` and uses it for `getLoginSettings`, `getBranding`, and `getActiveIdPs` — and nothing else. It **never** redirects to inject `?organization=` into the URL. The ceremony org is exclusively whatever explicit `?organization=` the user arrived with.
- The action and `resolveIdentifier` (`app/resources/login/login.service.ts`) pass that explicit-or-`undefined` org straight to `provider.findUser`. Undefined means **no org filter — instance-wide lookup**, which is exactly what an unscoped login should do.
- Domain discovery is unaffected: when it is enabled and the identifier's email domain resolves to an org, that org is an _explicit_ signal derived from the identifier, not a silent default.

## Rationale

A default is a convenience. Applying a convenience to a _lookup_ silently narrows who is allowed to sign in — and the narrowing is invisible, because the user sees only "user not found". Display has no such failure mode: rendering the default org's branding when nobody asked for an org is a reasonable, and reversible, guess.

So the rule is drawn along the axis of consequence: fall back for what you _show_, never for who you _find_.

## Alternatives Considered

### Keep the default-org fallback and make the console send an explicit org scope

- **Pros:** Preserves org-scoped lookup everywhere; no app change.
- **Cons:** Every OIDC client, present and future, must remember to send the scope — and users still lock out silently when one forgets. It also fixes a producer bug in the consumers.
- **Why rejected:** It makes correct behaviour depend on every client getting it right forever, with lockout as the penalty.

### Drop the default-org resolution entirely

- **Pros:** Simplest possible rule — no fallback anywhere.
- **Cons:** A bare `/id/login` would render instance-level branding and instance IdPs instead of the Datum Cloud org's, which is the problem org-first existed to solve.
- **Why rejected:** Throws away the display behaviour that was actually wanted.

### Try the default org first, then retry instance-wide on miss

- **Pros:** Keeps org-scoped precision when it works, no lockout when it doesn't.
- **Cons:** Two lookups per identifier; ambiguous semantics; the retry quietly reintroduces instance-wide lookup anyway, but only on the slow path.
- **Why rejected:** All the cost of the fallback and none of its meaning. If instance-wide is acceptable as a fallback, it is the correct behaviour to begin with.

## Consequences

**Positive**

- **No user is ever locked out by a default-org fallback.** An unscoped login searches the instance and finds the user in whatever org they actually belong to.
- Org-scoped branding, settings, and IdP lists still work on a bare `/login` — the display fallback is intact.
- An explicit org (OIDC scope or `?organization=`) still scopes lookup exactly as before, so genuinely org-scoped logins are unchanged.

**Negative**

- Instance-wide lookup means a login name or email duplicated across two orgs matches more than one user; `findUser` returns a user only on an exact single match, so such an identifier resolves to `USER_NOT_FOUND`. This is an accepted edge — it fails closed and is anti-enumeration.
- Two org concepts now coexist in the login code, and the distinction is a _rule_, not a type. It must be read for what it is.

**Risks & Mitigations**

| Risk                                                                       | Mitigation                                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A future change re-threads the display org into the URL or into `findUser` | The `/login` loader carries the invariant as a comment at the site; component specs assert that a bare `/login` does not redirect-inject an org and that `resolveIdentifier` calls `findUser` with `undefined`. |
| Cross-org duplicate identifiers silently fail to resolve                   | Accepted and documented; the failure is `USER_NOT_FOUND`, which is safe.                                                                                                                                        |

## References

- `app/routes/login/index.tsx` — `displayOrg`, resolved locally, never injected
- `app/resources/login/login.service.ts` — `resolveIdentifier` → `findUser(loginName, explicitOrgOrUndefined)`
- `app/resources/authorize/authorize.service.ts`, `app/resources/shared/resolve-org.ts`
- `app/modules/auth/providers/zitadel/user.ts` — the org filter is applied only when an org id is present
