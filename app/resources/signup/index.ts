// Barrel for the signup domain service. Routes and tests import from here.
export {
  registerAndLinkIdp,
  passwordFirstHandoff,
  registerPasskeyFirst,
  registerWithPassword,
  registerEmailLinkSignup,
  completeEmailLinkSignup,
  postRegisterStep,
} from './signup.service';
export {
  registerSchema,
  registerClientSchema,
  signupPasswordSchema,
  signupIdentifierSchema,
  signupMethodSchema,
} from './signup.schema';
export { decideSignupIdpIntent, decideAfterSignupIdentifier } from './signup-decision';
export type { SignupIdpIntentResult, AfterSignupIdentifierInput } from './signup-decision';
export type {
  SignupRedirectResult,
  SignupSentWithSessionResult,
  SignupSentResult,
  SignupRedirectOnlyResult,
  SignupIdpLinkInput,
  PasswordFirstHandoffInput,
  PasskeyFirstRegisterInput,
  PasskeyFirstRegisterResult,
  RegisterWithPasswordInput,
  RegisterWithPasswordResult,
  EmailLinkSignupInput,
  CompleteEmailLinkInput,
  PostRegisterInput,
} from './signup.service';
