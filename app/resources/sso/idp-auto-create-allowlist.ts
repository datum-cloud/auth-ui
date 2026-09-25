// app/resources/sso/idp-auto-create-allowlist.ts
/**
 * TEMPORARY — staging dual-org interim. Delete this module, its two env flags
 * (`IDP_AUTO_CREATE_EMAIL_DOMAINS`, `IDP_AUTO_CREATE_ALIAS_TAG`), the single call site in
 * `sso-callback.ts`, and ADR 007 once staging runs one Zitadel org for humans like production
 * (design: docs/superpowers/specs/2026-09-21-staging-single-org-migration-design.md).
 *
 * WHY. Staging pins the staff portal to a Zitadel org whose login policy disallows
 * registration, so a new staff member's first Google sign-in dead-ends on `creation-disabled`
 * and an admin ends up creating a password user by hand. This lets an IdP-VERIFIED email from an
 * allow-listed domain auto-create a user in that org anyway. Password self-signup stays off and
 * the sign-up link stays hidden, because both key on the org's `allowRegister`, which is untouched.
 *
 * THE ALIAS. Zitadel usernames are unique instance-wide and auth-ui uses the email as the
 * username. When the same email already owns a user in ANOTHER org, the user is created as
 * `local+<tag>@domain` instead — the convention admins applied by hand until now. Google
 * Workspace delivers plus-addressed mail to the same mailbox, so the IdP's verification of the
 * base address is carried over to the alias.
 *
 * ADR BENDS, both deliberate and confined to this path:
 *   - ADR 005: the ownership lookup here is instance-wide even though the ceremony carries an
 *     explicit org, because the question is precisely "does another org own this email".
 *   - ADR 004: the flags gate WHETHER the door exists; the guards behind it (verified email,
 *     passwordless account for auto-link) are unchanged and still enforced by the decision.
 *
 * OFF STATE. With `IDP_AUTO_CREATE_EMAIL_DOMAINS` or `IDP_AUTO_CREATE_ORGS` unset (the default;
 * production sets neither) none of this runs: the call site requires the target org to be listed
 * in `IDP_AUTO_CREATE_ORGS` before consulting `isAllowlistedIdpEmail`.
 *
 * KNOWN FALLBACK. The Zitadel adapter's `findUser` returns null when an identifier matches MORE
 * than one user (ADR 005's fail-closed rule). Here that reads as "no owner", so the plain email is
 * attempted and Zitadel rejects it with ALREADY_EXISTS → `registration-conflict`. Fails closed;
 * the alias is simply not offered in that (rare) case.
 */
import type { AuthProvider } from '@/modules/auth/auth-provider';

/** True when the IdP asserted a VERIFIED email whose domain is on the allow-list. */
export function isAllowlistedIdpEmail(
  draft: { email?: string; emailVerified?: boolean } | null | undefined,
  domains: readonly string[]
): boolean {
  if (domains.length === 0 || !draft?.email || !draft.emailVerified) return false;
  const at = draft.email.lastIndexOf('@');
  if (at <= 0) return false;
  return domains.includes(draft.email.slice(at + 1).toLowerCase());
}

/** `local@domain` → `local+<tag>@domain`. */
export function aliasEmail(email: string, tag: string): string {
  const at = email.lastIndexOf('@');
  return `${email.slice(0, at)}+${tag}${email.slice(at)}`;
}

export type AllowlistedRegistration =
  /** A user in the TARGET org already owns the email (or its alias): take the existing-account path. */
  | { kind: 'existing'; userId: string }
  /** Register a new user in the target org under `email` (`aliased` when it is the alias form). */
  | { kind: 'create'; email: string; aliased: boolean };

/**
 * Decide how an allow-listed identity registers into `targetOrg`. An owner in another org means
 * the plain email is taken instance-wide, so the alias is used unless the alias itself already
 * exists in the target org. An owner whose org is unknown is treated as the target org's, which
 * fails closed into the existing-account rules rather than minting an alias.
 */
export async function resolveAllowlistedRegistration(
  provider: AuthProvider,
  input: { email: string; targetOrg: string | undefined; aliasTag: string }
): Promise<AllowlistedRegistration> {
  const { email, targetOrg, aliasTag } = input;
  const owner = await provider.findUser(email, undefined);
  if (!owner) return { kind: 'create', email, aliased: false };
  if (owner.orgId === undefined || owner.orgId === targetOrg) {
    return { kind: 'existing', userId: owner.id };
  }
  const alias = aliasEmail(email, aliasTag);
  const aliasOwner = await provider.findUser(alias, targetOrg);
  if (aliasOwner) return { kind: 'existing', userId: aliasOwner.id };
  return { kind: 'create', email: alias, aliased: true };
}
