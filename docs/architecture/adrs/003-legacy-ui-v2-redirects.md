# 003. Legacy `/ui/v2/*` redirects

- **Status:** Accepted
- **Date:** 2026-06-18

## Context

The login this app replaces was Zitadel's hosted v2 UI, served at `/ui/v2/login/*`. The rebuild lives at `/id/*`.

Those legacy paths are not only in users' bookmarks and old emails — they are **hardcoded in other repositories**. An organisation-wide scan on 2026-06-18 found `/ui/v2/login/idp/link` in `cloud-portal` and `staff-portal`, `/ui/v2/login/loginname` and `/ui/v2/login/register` in `datum.net` (and `agents.datum.net`), and `/ui/v2/login/device` in `datumctl`. The gateway already routes `/ui/v2/` to this service, so at cutover every one of those links reached the app and 404'd.

Some of the route names also changed in the rebuild: `idp/link` became `sso/link`, `loginname` became `login`, `register` became `signup`. A pure prefix swap was not enough.

## Decision

**The BFF redirects legacy paths to their `/id/*` equivalents. No consumer repo changes.**

- `app/server/middleware/legacy-redirects.ts` exports a pure mapping function, `legacyRedirectTarget(pathname, search)`, returning the `/id/*` target or `null` when the path is not legacy (so the middleware falls through to the router).
- A thin Hono middleware, registered in `app/server.ts` before the React Router catch-all, issues a **301** to that target with the query string preserved verbatim.
- The mapping is, in order:
  1. match `^/ui/v2/login(/.*)?$` — no match, `null`;
  2. apply the explicit renames (`/idp/link → /sso/link`, `/loginname → /login`, `/register → /signup`);
  3. otherwise prefix-swap the tail as-is (`/ui/v2/login/device → /id/device`); bare `/ui/v2/login` maps to `/id/login`;
  4. **validate-or-index:** check the resulting first segment against an allowlist of real top-level `/id` routes (and, for one-segment tails, the known `/login` sub-routes). Anything not in the set collapses to the login index.

301 is correct because every legacy URL is a GET navigation; no method or body needs preserving.

## Rationale

The alternative to a redirect layer is a coordinated, cross-repo, cross-team link migration executed before cutover — with unknown external integrations that could never be migrated at all. A redirect is one file in one repo and it covers the links we do not know about.

The validate-or-index step is what makes it safe: we never 301 to an arbitrary `/id/<anything>`, only to a path whose top-level route actually exists, else to the login index. That rules out both open-redirect shapes and 301s into a 404 (which browsers cache).

## Alternatives Considered

### Change every consumer repo to point at `/id/*`

- **Pros:** No permanent redirect layer; links reflect reality.
- **Cons:** Multi-repo coordination gated on cutover; bookmarks, emails, and unknown external integrations still break; a rollback breaks the newly-updated links.
- **Why rejected:** It cannot cover the links we do not control, which is the majority of the risk.

### Handle the redirect at the gateway (`datum-cloud/infra` HTTPRoute)

- **Pros:** Keeps the app free of legacy knowledge.
- **Cons:** The rename table (`idp/link → sso/link`, etc.) and the known-route allowlist are _application_ facts; encoding them in gateway config puts app routing knowledge in infra, where it drifts silently from `app/routes.ts`.
- **Why rejected:** The infra layer already routes `/ui/v2/` here correctly. The mapping belongs where the routes are defined and can be unit-tested.

### Serve the app at `/ui/v2/*` as well as `/id/*`

- **Pros:** No redirect at all — the old URLs simply work.
- **Cons:** Two live URL spaces forever, duplicated in every absolute link, cookie scope, and CSP decision.
- **Why rejected:** Doubles the surface permanently to avoid a single mapping function.

## Consequences

**Positive**

- No broken links at cutover, from any consumer — known or unknown.
- Zero coordination cost across repos; the cutover became a single-repo event.
- The mapping is a pure function, so every row of the table is unit-tested, and an e2e spec asserts a real 301 with the expected `Location`.

**Negative**

- The redirect layer is **permanent debt**. It is removable only once the hardcoded links are gone from every consumer, and it is impossible to prove the external ones ever will be.
- The known-route allowlist in `legacy-redirects.ts` must be kept in sync with `app/routes.ts` when a top-level route is added — a one-line edit, but one that nothing forces.

**Risks & Mitigations**

| Risk                                                     | Mitigation                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Open redirect via a crafted `/ui/v2/login/...` path      | Targets are always same-origin `/id/*` and must pass the known-route allowlist; anything else collapses to `/id/login`. |
| A 301 (permanently cached by browsers) pointing at a 404 | Same allowlist — an unknown target can never be redirected to, only the login index.                                    |
| The allowlist drifts from `app/routes.ts`                | A missing entry degrades to the login index (safe, not broken); the file carries a keep-in-sync note.                   |

## References

- `app/server/middleware/legacy-redirects.ts`, `app/server.ts`
- `app/routes.ts` — the source of the known-route allowlist
