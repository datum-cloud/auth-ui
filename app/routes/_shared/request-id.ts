/**
 * Allowlist of Zitadel-issued protocol request prefixes a login ceremony may
 * thread (`?requestId=`). Must stay in sync with REQUEST_PREFIXES in
 * routes/authorize.tsx (the orchestrator's open-redirect guard).
 *
 * device_ carries the STABLE user code (device_<userCode>), not the device-auth
 * id — the Zitadel adapter returns a different opaque id per getDeviceAuth call,
 * so the user code is the only handle the consent screen can re-resolve.
 */
export const REQUEST_ID_PATTERN = /^(oidc|saml|device)_/;
