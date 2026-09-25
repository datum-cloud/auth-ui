// app/resources/recovery/index.ts
//
// Barrel for the recovery resource, matching the repo's resource layout. Routes import from here;
// the `.server.ts` ticket module is imported directly by the routes that set its cookies, so the
// browser bundle boundary stays enforced by the filename.
export { requestRecovery } from './recovery.service';
export type {
  RecoveryOutcome,
  RequestRecoveryInput,
  RequestRecoveryResult,
  SuppressReason,
} from './recovery.service';
export { recoveryCodeSchema, recoveryRequestSchema } from './recovery.schema';
export type { RecoveryCodeInput, RecoveryRequestInput } from './recovery.schema';
