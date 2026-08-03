// app/resources/login/method-options.ts
//
// "What can this identified account actually sign in with RIGHT NOW?" — the resolution behind
// the /login/method chooser, extracted from the route loader so that loader stays a thin
// request/response shell (session gate → reads → decide → render).
//
// Applies the SAME policy gates decideAfterIdentifier (login-decision.ts) applies, plus the one
// thing that function structurally cannot know: whether the account's enrolled 'idp' method
// resolves to any actually-usable linked provider. decideAfterIdentifier is pure over method
// KINDS, so it counts 'idp' from `methods.includes('idp') && settings.allowExternalIdp` alone;
// only this resolution sees that the links may all be missing, deactivated, or LDAP-only.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import type { AuthMethod, IdProvider, LoginSettings } from '@/modules/auth/types';
import { resolveOrg } from '@/resources/shared/resolve-org';
import { getActiveIdPs } from '@/resources/sso/idp-providers';
import { joinLinkedIdps, type LinkedIdpView } from '@/resources/sso/sso-management';

/** The four primary sign-in methods the chooser can offer. Closed set. */
export type ChooserMethod = 'passkey' | 'password' | 'otp_email' | 'idp';

/**
 * The enrolment the chooser SYNTHESIZES for a GHOST subject — an identifier that cleared
 * /login/method's session gate but resolves to no account.
 *
 * `ignoreUnknownUsernames` is a tenant-facing anti-enumeration setting: with it on, /login's
 * identifier step plants a real ceremony session for an UNKNOWN identifier and routes it to the
 * SAME target a known account gets, so the response reveals nothing. That protection is ENTIRELY
 * the indistinguishability, so the chooser must serve the ghost the very screen a real
 * PASSWORD-ONLY account gets.
 *
 * Password, and only password, because it is the one method an unknown identifier can plausibly
 * own end-to-end: the credential check at /login/password already fails generically for a ghost
 * session (that is the whole design of the flag), whereas a passkey or IdP button would be an
 * offer the ceremony cannot honour — and failing differently is exactly the leak we are closing.
 *
 * Fed through {@link resolveMethodOptions} like any other enrolment rather than short-circuiting
 * the render, so an org that forbids passwords dead-ends the ghost at the same place it dead-ends
 * a real password-only account instead of offering a button policy would refuse.
 */
export const GHOST_METHODS: readonly AuthMethod[] = Object.freeze<AuthMethod[]>(['password']);

/** Lowercased domain of an email-style identifier, or null when it is not an email. */
export function emailDomain(loginName: string): string | null {
  const at = loginName.lastIndexOf('@');
  if (at <= 0 || at === loginName.length - 1) return null;
  return loginName.slice(at + 1).toLowerCase();
}

/**
 * The POLICY org a GHOST subject is judged under — the counterpart to {@link resolvePolicyOrg}
 * for a subject that resolves to no account.
 *
 * WHY THIS EXISTS. A ghost has no `user.orgId`, so `resolvePolicyOrg`'s middle rung has nothing
 * to bite on and the read fell through to the DEFAULT org — while a real account at the same
 * address was judged by its OWN org. When those two policies disagreed the two branches took
 * different routes (known → /login/method, ghost → /error for a default org with
 * `allowPassword: false`), which is precisely the account-existence oracle
 * `ignoreUnknownUsernames` exists to prevent. Both hops read this — the identifier decision
 * (login.service.ts) and the chooser loader (routes/login/method.tsx) — so they cannot drift.
 *
 * Resolve from the identifier's DOMAIN instead: `nobody@acme.test` is then judged by the very
 * org `mia@acme.test` belongs to.
 *
 * DELIBERATELY NOT GATED on `allowDomainDiscovery`. That flag governs whether a domain may ROUTE
 * a ceremony (map an org and skip screens); this is a POLICY READ only — it never changes where
 * anyone lands, only which org's settings decide it. Gating it would leave the oracle open for
 * every tenant with discovery off, which is the default.
 *
 * ACCEPTED TRADE: an org whose domain is registered becomes distinguishable from one whose is
 * not. That is ORG-existence, not ACCOUNT-existence — it says nothing about whether any
 * particular person has an account, which is the property the flag protects.
 *
 * SIDE BENEFIT: the extra read balances the known branch's `listAuthMethods`, so the two
 * branches now spend the same number of provider calls for an email-style identifier — closing
 * the coarse timing channel they otherwise had. A NON-EMAIL ghost has no domain to look up and
 * still spends one call fewer; that residual is unavoidable without a wasted round-trip.
 *
 * NOT error-guarded, on purpose: the known branch's `listAuthMethods` is not either, so a
 * provider outage must surface identically on both paths rather than degrading one of them.
 */
export async function resolveGhostPolicyOrg(
  provider: AuthProvider,
  urlOrg: string | undefined,
  loginName: string
): Promise<string | undefined> {
  // An explicit (or already domain-discovered) org wins outright — same precedence
  // resolvePolicyOrg gives it, and the caller's threaded settings already describe it.
  if (urlOrg !== undefined) return resolveOrg(provider, urlOrg);
  const domain = emailDomain(loginName);
  const hit = domain ? await provider.findOrgByDomain(domain) : null;
  return resolveOrg(provider, hit?.orgId);
}

export interface MethodOptions {
  /** Policy-permitted, actually-usable primary methods, in chooser display order. */
  available: ChooserMethod[];
  /** This user's linked, active, non-LDAP providers — the buttons behind `available: ['idp']`. */
  idps: IdProvider[];
}

export interface MethodOptionsInput {
  userId: string;
  /**
   * Enrolled methods (provider.listAuthMethods) — the caller already fetched them, or
   * {@link GHOST_METHODS} for a subject that resolves to no account.
   */
  methods: readonly AuthMethod[];
  /** Login settings read for the POLICY org (see resolvePolicyOrg). */
  settings: LoginSettings;
  /** The POLICY org — the same one `settings` was read for. */
  policyOrg?: string;
  /** env.AUTH_EMAIL_DELIVERY_ENABLED, threaded so this stays a pure-input decision. */
  emailDeliveryEnabled: boolean;
}

/**
 * Resolve the chooser's offer for one identified user. The only provider I/O is the linked-IdP
 * join, and only when 'idp' is both enrolled and policy-allowed — a password-only account costs
 * nothing extra.
 */
export async function resolveMethodOptions(
  provider: AuthProvider,
  { userId, methods, settings, policyOrg, emailDeliveryEnabled }: MethodOptionsInput
): Promise<MethodOptions> {
  const available: ChooserMethod[] = [];
  if (methods.includes('passkey') && settings.passkeysType !== 'not_allowed') {
    available.push('passkey');
  }

  // Resolve the user's linked (redirect-based) IdPs directly into IdpButtonList's IdProvider
  // shape — mirrors reauth.service.ts's loadReauth idp-resolution, including the LDAP exclusion
  // (LDAP needs its own credential form, not an OAuth round-trip). A link whose provider is no
  // longer active has no name/type to join — filtered out, since there is no sign-in button to
  // offer for a dead provider.
  let idps: IdProvider[] = [];
  if (methods.includes('idp') && settings.allowExternalIdp) {
    const [links, active] = await Promise.all([
      provider.listIdpLinks(userId),
      getActiveIdPs(provider, policyOrg),
    ]);
    idps = joinLinkedIdps(links, active)
      .filter(
        (l): l is LinkedIdpView & { name: string; type: string } =>
          l.name !== undefined && l.type !== undefined && l.type !== 'LDAP'
      )
      .map((l) => ({ id: l.idpId, name: l.name, type: l.type, logoUrl: l.logoUrl }));
    if (idps.length > 0) available.push('idp');
  }

  if (methods.includes('password') && settings.allowPassword) available.push('password');
  if (methods.includes('otp_email') && emailDeliveryEnabled) available.push('otp_email');

  return { available, idps };
}

/** True when the account's ONLY usable method is exactly one linked IdP (the auto-start case). */
export function isSoleLinkedIdp({ available, idps }: MethodOptions): boolean {
  return available.length === 1 && available[0] === 'idp' && idps.length === 1;
}
