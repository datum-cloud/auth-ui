// Fixed P-256 security key for the seeded fake user u6. Generated once (Node crypto); the private
// half is the PKCS#8 base64 the CDP WebAuthn.addCredential call takes, the public half is the COSE
// key the fake provider's seed stores. Test-only: this key protects nothing.
export const SECURITY_KEY_U6 = {
  credentialId: 'zw3ZJ8jLJZGpLRmmOUZFTA',
  privateKeyPkcs8B64:
    'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQghp1QnQWRDeVdL+muv0Ir7KLbG8tR3w7iFcOX2z7PnOmhRANCAASx1ajf+vklYnNVMhvZ9XzOpVUGoMy3+SNF12zbSw6/wv0quS8VZ28R4paS+lUQjhY5xw2Aiju5btAmLGZcC8H4',
  publicKeyCose:
    'pQECAyYgASFYILHVqN_6-SVic1UyG9n1fM6lVQagzLf5I0XXbNtLDr_CIlgg_Sq5LxVnbxHilpL6VRCOFjnHDYCKO7lu0CYsZlwLwfg',
  userId: 'u6',
  rpId: 'localhost',
} as const;
