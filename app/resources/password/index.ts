// Barrel for the password domain service. Routes and tests import from here.
export {
  requestPasswordReset,
  submitNewPassword,
  changePassword,
  newPasswordSchema,
  resetRequestSchema,
  changePasswordSchema,
} from './password.service';
export type {
  RequestPasswordResetInput,
  SubmitNewPasswordResult,
  NewPasswordError,
  ChangePasswordResult,
  ChangePasswordError,
  ActiveSession,
} from './password.service';
export {
  resetRequestClientSchema,
  newPasswordClientSchema,
  changePasswordClientSchema,
} from './password.schema';
