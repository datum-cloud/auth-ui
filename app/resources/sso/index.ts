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
} from './sso.service';
export type {
  SsoActionDeps,
  CallbackLoaderDeps,
  SsoLinkSignInRequired,
  LdapActionData,
} from './sso.service';

// Provider-read batching helper folded into the domain (used through the barrel by tests).
export { requestScopedProviderReads } from './idp-session';
