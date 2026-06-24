// Barrel for the sso domain. Routes and tests import from here.
export {
  resolveSsoManagement,
  joinLinkedIdps,
  runSsoAction,
  resolveSsoLink,
  safeSameOriginReturnTo,
  submitLdapCredentials,
  processIdpCallback,
  outcomeToResponse,
  ldapServerSchema,
  CallbackQuery,
} from './sso.service';

// Server-free client validators (safe for browser bundles). Route COMPONENTS must
// import these from '@/resources/sso/sso.schema' directly, not via this barrel,
// since the barrel above re-exports the server-only sso.service.
export { ldapClientSchema } from './sso.schema';
export type {
  SsoOutcome,
  SsoActionDeps,
  CallbackLoaderDeps,
  SsoManagementData,
  SsoManagementResult,
  LinkedIdpView,
  SsoLinkResult,
  SsoLinkSignInRequired,
  LdapActionData,
} from './sso.service';

// Seed flow modules folded into the domain (kept as standalone, pure units).
export { shouldShowIdpButtons, shouldAutoStartSingleIdp } from './idp-buttons';
export { decideIdpCallback } from './idp-callback';
export type { IdpCallbackInput, IdpDecision } from './idp-callback';
export { deriveIdpProfileName } from './derive-idp-name';
export type { DeriveIdpProfileNameInput, DeriveIdpProfileNameResult } from './derive-idp-name';
export { idpReturnUrls, APP_BASENAME } from './idp-return-urls';
export type { IdpReturnOpts } from './idp-return-urls';
export { signInWithIdpIntent, requestScopedProviderReads } from './idp-session';
export type { SignInWithIdpIntentOpts, SignInWithIdpIntentResult } from './idp-session';
export { resolveSamlBinding } from './saml-binding';
export type { SamlBindingResult } from './saml-binding';
