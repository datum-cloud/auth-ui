// Barrel for the login domain service. Routes and tests import from here.
export {
  shouldBridgeToAuthorize,
  startIdpIntent,
  resolveIdentifier,
  verifyLoginPassword,
  decideAfterIdentifier,
} from './login.service';
export type {
  StartIdpInput,
  StartIdpError,
  StartIdpResult,
  ResolveIdentifierInput,
  ResolveIdentifierError,
  ResolveIdentifierRedirect,
  ResolveIdentifierResult,
  VerifyLoginPasswordInput,
  VerifyLoginPasswordError,
  VerifyLoginPasswordRedirect,
  VerifyLoginPasswordCredentialFailure,
  VerifyLoginPasswordResult,
} from './login.service';

// Server-free route schemas re-exported through the domain barrel.
export {
  loginIdentifierSchema,
  loginIdpSchema,
  loginIdentifierClientSchema,
  loginPasswordSchema,
  loginPasswordClientSchema,
} from './login.schema';

// Seed flow helpers (Pass 1) re-exported through the domain barrel.
export type { Decision } from './login-decision';
export {
  postLoginDestination,
  postLoginDestinationWithSource,
  type PostLoginDestinationInput,
  type PostLoginSource,
} from './post-login-destination';
