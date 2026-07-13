// Barrel for the otp domain service. Routes and tests import from here.
export {
  dispatchEmailChallenge,
  submitOtpCode,
  enrollTotp,
  createOtpEnrollHandlers,
} from './otp.service';
// OTP verify factory — beside the enroll factory; collapses the three login verify routes.
export { createOtpVerifyHandlers } from './otp-verify';
export type { OtpVerifyLoaderData, OtpVerifyActionData } from './otp-verify';
export type { OtpSessionEntry, OtpEnrollActionData } from './otp.service';
