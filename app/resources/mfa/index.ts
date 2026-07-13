// Barrel for the mfa domain. Routes and tests import the service + the relocated
// Pass 1 routing/schema helpers through here.
export {
  resolveMfaPicker,
  chooseMfaMethod,
  offerableSetupRoutes,
  resolveMfaSetup,
  recordMfaSetupSkip,
  // Retained for a future passkey-in-chooser flow (no current through-barrel consumer).
  mfaMethodSchema,
} from './mfa.service';
export type { SecondFactorMethod } from './mfa.service';
