// Fixed P-256 passkey for the seeded fake user u5. Generated once (Node crypto); the private half
// is the PKCS#8 base64 the CDP WebAuthn.addCredential call takes, the public half is the COSE key
// the fake provider's seed stores. Test-only: this key protects nothing.
export const PASSKEY_U5 = {
  credentialId: 'Z77j9TdedloKCjYE5PyAIg',
  privateKeyPkcs8B64:
    'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg1/g5MniH0lhsY8cfXznEhq6m5BwuX29i2+fXFylwKV6hRANCAAQmg/WJe28DD5OLaGP1nVhAFJ3Y9GXR4fqS6qjQD7gtI5NI081ojfHHLv3GOB3+61j6YqY4Y17/XGmrVjbmnCF4',
  publicKeyCose:
    'pQECAyYgASFYICaD9Yl7bwMPk4toY_WdWEAUndj0ZdHh-pLqqNAPuC0jIlggk0jTzWiN8ccu_cY4Hf7rWPpipjhjXv9caatWNuacIXg',
  userId: 'u5',
  rpId: 'localhost',
} as const;

// Browser specs cannot import app modules; keep in sync with fake-webauthn.ts.
export const PREBAKED_CREDENTIAL_ID = 'fake-credential-id';
