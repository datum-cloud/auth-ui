// Barrel for the mfa domain. Routes and tests import the service + the relocated
// Pass 1 routing/schema helpers through here.
export {
  resolveMfaPicker,
  chooseMfaMethod,
  offerableSetupRoutes,
  resolveMfaSetup,
  recordMfaSetupSkip,
  // Routing helpers + schemas re-exported by the service.
  SECOND_FACTOR_METHODS,
  USE_SCREEN,
  intersectWithPolicy,
  nextMfaStep,
  secondFactorMethodSchema,
  setupSkipSchema,
  otpCodeSchema,
  otpDeliveryCodeSchema,
  mfaMethodSchema,
  credentialSchema,
} from './mfa.service';
export type {
  MfaPickerInput,
  MfaPickerResult,
  MfaPickerRedirect,
  MfaPickerData,
  ChooseMfaMethodResult,
  ChooseMfaMethodError,
  MfaSetupInput,
  MfaSetupResult,
  MfaSetupRedirect,
  MfaSetupData,
  RecordMfaSetupSkipResult,
  RecordMfaSetupSkipError,
  SecondFactorMethod,
  MfaRoutingInput,
  MfaRoutingResult,
} from './mfa.service';
