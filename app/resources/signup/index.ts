// Barrel for the signup domain service. Routes and tests import from here.
export {
  registerAndLinkIdp,
  passwordFirstHandoff,
  registerPasskeyFirst,
  registerWithPassword,
  postRegisterStep,
} from './signup.service';
export { registerSchema, registerClientSchema, signupPasswordSchema } from './signup.schema';
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
  PostRegisterInput,
} from './signup.service';
