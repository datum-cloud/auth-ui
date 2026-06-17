// Barrel for the device domain. Routes and tests import from here.
export {
  lookupDeviceCode,
  lookupOutcomeToResponse,
  loadDeviceConsent,
  resolveDeviceDecision,
  decisionOutcomeToResponse,
  decisionSchema,
} from './device.service';
export { codeSchema } from './device.schema';
export type { DeviceLookupOutcome, DeviceConsent, DeviceDecisionOutcome } from './device.service';
export { deviceDecision } from './device-decision';
export type { DeviceDecisionInput, DeviceDecisionResult, SessionRef } from './device-decision';
