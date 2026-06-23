// Barrel for the device domain. Routes and tests import from here.
export {
  lookupDeviceCode,
  lookupOutcomeToResponse,
  loadDeviceConsent,
  deviceConsentErrorToResponse,
  resolveDeviceDecision,
  decisionOutcomeToResponse,
  decisionSchema,
} from './device.service';
export { codeSchema } from './device.schema';
export type {
  DeviceLookupOutcome,
  DeviceConsent,
  DeviceConsentError,
  LoadDeviceConsentOutcome,
  DeviceDecisionOutcome,
} from './device.service';
export { deviceDecision } from './device-decision';
export type { DeviceDecisionInput, DeviceDecisionResult, SessionRef } from './device-decision';
