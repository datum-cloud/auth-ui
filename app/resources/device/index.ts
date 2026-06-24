// Barrel for the device domain. Routes and tests import from here.
export {
  lookupDeviceCode,
  lookupOutcomeToResponse,
  loadDeviceConsent,
  deviceConsentErrorToResponse,
  resolveDeviceDecision,
  decisionOutcomeToResponse,
} from './device.service';
export { deviceDecision } from './device-decision';
