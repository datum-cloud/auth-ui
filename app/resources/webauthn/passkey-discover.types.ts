// app/resources/webauthn/passkey-discover.types.ts
//
// Types-only module for the /login/passkey-discover contract, shared by the route
// action (server) and useConditionalPasskey (client). Kept separate from the route
// module so the client hook never imports the action's server-only dependencies.

/** Success payload: the resolved identity + the REAL user-bound challenge. */
export interface PasskeyDiscoverData {
  loginName: string;
  csrfToken: string;
  publicKeyCredentialRequestOptions: unknown;
}

export type PasskeyDiscoverError = { error: 'INVALID_INPUT' | 'DISCOVERY_FAILED' };
