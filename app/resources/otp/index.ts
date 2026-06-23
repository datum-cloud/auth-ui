// Barrel for the otp domain service. Routes and tests import from here.
export {
  dispatchEmailChallenge,
  dispatchSmsChallenge,
  submitOtpCode,
  enrollTotp,
  createOtpEnrollHandlers,
  otpEmailUrlTemplate,
} from './otp.service';
// OTP verify factory — beside the enroll factory; collapses the three login verify routes.
export { createOtpVerifyHandlers } from './otp-verify';
export type { OtpVerifyConfig, OtpVerifyLoaderData, OtpVerifyActionData } from './otp-verify';
// Server-free client validator — re-exported from the schema module (not the
// service) so importing it never pulls the server-only service into a bundle.
export { otpCodeClientSchema } from './otp.schema';
export type {
  OtpSessionEntry,
  OtpVerifyChannel,
  EmailChallengeInput,
  SubmitOtpError,
  SubmitOtpResult,
  EnrollTotpError,
  EnrollTotpResult,
  OtpEnrollConfig,
  OtpEnrollLoaderData,
  OtpEnrollActionData,
  OtpEmailUrlTemplateInput,
} from './otp.service';
