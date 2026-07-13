// Barrel for the webauthn domain. Routes import the shared enrollment-ceremony route
// handler factory + its configs through here.
export {
  createWebAuthnEnrollHandlers,
  PASSKEY_ENROLL_CONFIG,
  U2F_ENROLL_CONFIG,
} from './webauthn-enroll';
export type { WebAuthnEnrollActionData } from './webauthn-enroll';
