// app/resources/sso/sso.service.ts
//
// Thin re-export barrel for the SSO surface business logic.
//
// A refactor decomposed the former 707-line monolith into cohesive per-surface modules
// (see below). This file preserves the prior public surface byte-for-byte so the
// `@/resources/sso` barrel — and any `./sso.service` importer — is unchanged:
//   • sso-outcome.ts     — SsoOutcome + outcomeToResponse (shared outcome contract)
//   • sso-management.ts   — resolveSsoManagement + SsoManagementData/Result   (/sso loader)
//   • sso-action.ts       — runSsoAction + SsoActionDeps                       (/sso action)
//   • sso-link.ts         — resolveSsoLink + SsoLink*                          (/sso/link loader)
//   • sso-ldap.ts         — submitLdapCredentials + ldapServerSchema + LdapActionData (/sso/ldap action)
//   • sso-callback.ts     — processIdpCallback + CallbackQuery + CallbackLoaderDeps (/sso/:provider/callback loader)
//
// The seed flow modules (idp-buttons, idp-callback, idp-return-urls, idp-session,
// saml-binding) remain standalone and are re-exported through the domain barrel (index.ts).
export { outcomeToResponse } from './sso-outcome';
export type { SsoOutcome } from './sso-outcome';

export { resolveSsoManagement, joinLinkedIdps } from './sso-management';
export type { SsoManagementData, SsoManagementResult, LinkedIdpView } from './sso-management';

export { runSsoAction } from './sso-action';
export type { SsoActionDeps } from './sso-action';

export { resolveSsoLink, safeSameOriginReturnTo } from './sso-link';
export type { SsoLinkResult, SsoLinkSignInRequired } from './sso-link';

export { submitLdapCredentials, ldapServerSchema } from './sso-ldap';
export type { LdapActionData } from './sso-ldap';

export { processIdpCallback, CallbackQuery } from './sso-callback';
export type { CallbackLoaderDeps } from './sso-callback';
