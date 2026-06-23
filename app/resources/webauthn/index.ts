// Barrel for the webauthn domain. Routes and tests import the service, the verify
// factory, and the relocated Pass 1 browser-marshalling helpers through here.
export {
  requestWebAuthnChallenge,
  verifyWebAuthnAssertion,
  requestPasskeyAttestation,
  requestU2FAttestation,
  verifyPasskeyEnrollment,
  verifyU2FEnrollment,
} from './webauthn.service';
export type {
  WebAuthnChallengeConfig,
  WebAuthnChallengeInput as WebAuthnChallengeServiceInput,
  WebAuthnChallengeResult,
  WebAuthnChallengeRedirect,
  WebAuthnChallengeData,
  WebAuthnVerifyAuditConfig,
  WebAuthnVerifyInput,
  WebAuthnVerifyResult,
  WebAuthnVerifyError,
  AttestationLoaderInput,
  AttestationLoaderRedirect,
  PasskeyAttestationData,
  PasskeyAttestationResult,
  U2FAttestationData,
  U2FAttestationResult,
  EnrollError,
  EnrollResult,
  PasskeyEnrollInput,
  U2FEnrollInput,
} from './webauthn.service';

// Shared assertion-ceremony route handler factory (used by the login routes).
export { createWebAuthnVerifyHandlers, webauthnAssertionSchema } from './webauthn-verify';
export type {
  WebAuthnVerifyConfig,
  WebAuthnVerifyLoaderData,
  WebAuthnVerifyActionData,
} from './webauthn-verify';

// Shared enrollment-ceremony route handler factory (used by the setup routes).
export {
  createWebAuthnEnrollHandlers,
  unwrapPublicKey,
  PASSKEY_ENROLL_CONFIG,
  U2F_ENROLL_CONFIG,
} from './webauthn-enroll';
export type {
  WebAuthnEnrollConfig,
  WebAuthnEnrollLoaderData,
  WebAuthnEnrollActionData,
} from './webauthn-enroll';

// Browser-side WebAuthn marshalling helpers (relocated in Pass 1).
export {
  base64UrlToBuffer,
  bufferToBase64Url,
  marshalAssertion,
  createAttestation,
  isWebAuthnSupported,
  WebAuthnUnsupportedError,
  WebAuthnCeremonyCancelledError,
} from './webauthn';
export type { WebAuthnChallengeInput } from './webauthn';
