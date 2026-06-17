// Barrel for the verify domain. Routes and tests import from here.
export {
  dispatchEmailCode,
  resendEmailCode,
  submitEmailCode,
  verifyCodeSchema,
  verifyUrlTemplate,
  emailVerificationGate,
} from './verify.service';
export { verifyCodeClientSchema } from './verify.schema';
export type {
  ActiveSession,
  DispatchEmailCodeInput,
  ResendEmailCodeInput,
  ResendNotice,
  ResendEmailError,
  ResendEmailResult,
  SubmitEmailError,
  SubmitEmailResult,
  EmailVerificationInput,
  GateResult,
  VerifyUrlTemplateInput,
} from './verify.service';
