# 007. Staging IdP auto-create allow-list (temporary)

- **Status:** Accepted, with a sunset
- **Date:** 2026-09-22
- **Sunset:** delete when staging runs one Zitadel org for humans, as production does. Design for
  that migration: `docs/superpowers/specs/2026-09-21-staging-single-org-migration-design.md`.

## Context

Staging pins the staff portal to a second Zitadel org, "Datum Technology, Inc", whose login policy
disallows registration. Production uses one org. Two consequences drove this decision:

- A new staff member's first Google sign-in on staging ends on `creation-disabled`, because the
  SSO callback refuses creation before it looks at anything else. Admins responded by creating
  users in the Zitadel console by hand, which forces password sign-in, while the team wants Google.
- Zitadel usernames are unique across the instance and auth-ui uses the email as the username.
  An employee who already has a Datum Cloud user for `name@datum.net` cannot get a second user
  with that username in the staff org. The hand-made workaround is the alias `name+staff@datum.net`.

The staff portal's real access control is the milo `staff-users` group; the org pin adds none.
The proper fix is the single-org migration. This ADR covers the interim.

## Decision

Three env flags, all unset by default and never set in production, open a single door in the SSO
callback, implemented in `app/resources/sso/idp-auto-create-allowlist.ts` and wired at one call
site in `app/resources/sso/sso-callback.ts`:

| Flag                            | Meaning                                                                                                                                                                                                                                                                                        | Default            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `IDP_AUTO_CREATE_EMAIL_DOMAINS` | Comma-separated email domains. An IdP-**verified** email on one of them may auto-create a user in an org whose policy disallows registration.                                                                                                                                                  | unset, feature off |
| `IDP_AUTO_CREATE_ORGS`          | Comma-separated Zitadel org ids the door applies to. The callback's target org can fall back to the raw `?organization=` query param, so without this pin any registration-off org on the instance, including the per-project machine-account orgs, would be a valid self-provisioning target. | unset, feature off |
| `IDP_AUTO_CREATE_ALIAS_TAG`     | The `+<tag>` inserted into the local part when the plain email already owns a user in **another** org.                                                                                                                                                                                         | `staff`            |

Behaviour with the flag set:

1. `creationAllowed` becomes the org's `allowRegister` **or** "verified email on an allow-listed
   domain". The same value gates the same-email lookup, so a collision still resolves through the
   ADR 004 rules (`auto-link`, `link-needs-auth`, `account-exists`).
2. On the allow-list path the ownership lookup is instance-wide. A user in the target org, or in
   an unknown org, is treated as the existing account. A user in another org means the plain
   username is taken, so the alias is used unless the alias already exists in the target org, in
   which case that alias user is the existing account.
3. The `idp.register` success event carries `viaDomainAllowlist` and `aliased`, both `false`
   wherever the flag is unset.

Staging sets `IDP_AUTO_CREATE_EMAIL_DOMAINS=datum.net`,
`IDP_AUTO_CREATE_ORGS=325848471661779545` and `ALLOW_IDP_AUTO_LINK=true`, so a
staff member onboarded at the staff portal first gets one identity that the cloud portal later
auto-links (its un-pinned lookup finds the same-email user and the account is passwordless).

## Deliberate bends of earlier ADRs

- **ADR 005** says an explicit org scopes user lookup. The allow-list path looks instance-wide
  once, because its question is precisely whether another org owns the email.
- **ADR 004** keeps its guards. The flags decide whether the door exists; verified email and
  passwordless account are still required for any automatic link.
- Google Workspace delivers plus-addressed mail to the base mailbox, so the IdP's verification
  of `name@datum.net` is carried over to `name+staff@datum.net`. This assumption is why the
  feature is scoped to allow-listed company domains.

## Consequences

- Password self-signup stays off and the sign-up link stays hidden: both key on `allowRegister`.
- The staff-users group remains the only authorization gate.
- Every user created through the alias path adds to the set the migration must merge, by no more
  than the manual process did.
- The Zitadel adapter returns no user when an identifier matches more than one (ADR 005's
  fail-closed rule). On this path that reads as "no owner", so the plain email is attempted and
  Zitadel's `ALREADY_EXISTS` surfaces as `registration-conflict`. Rare, and it fails closed.
- Removal is mechanical: delete the module, the one call site, the three flag declarations and
  their parsed exports, the spec `cypress/component/resources/sso/idp-auto-create-allowlist.cy.ts`,
  the two configuration rows, and the staging env lines in infra. This ADR then moves to
  Superseded.

## References

- `app/resources/sso/idp-auto-create-allowlist.ts`
- `app/resources/sso/sso-callback.ts`
- `app/server/infra/env.server.ts`
- [ADR 004](./004-idp-linking-flags.md), [ADR 005](./005-login-org-scoping.md)
- auth-ui#140, datum-cloud/infra#5230
