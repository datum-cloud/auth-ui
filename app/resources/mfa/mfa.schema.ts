import { SECOND_FACTOR_METHODS } from './mfa-routing';
import { z } from 'zod';

export const otpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

// Codes DELIVERED by Zitadel (email / SMS) are 8 digits; TOTP/authenticator codes are 6.
// Keep `otpCodeSchema` strictly 6 (TOTP) and use this wider schema only for delivered codes —
// do NOT widen otpCodeSchema, or TOTP would start accepting 7–8 digit input.
export const otpDeliveryCodeSchema = z.object({
  code: z.string().regex(/^\d{6,8}$/, 'Enter the code from your email or SMS'),
});

export const secondFactorMethodSchema = z.object({
  method: z.enum([...SECOND_FACTOR_METHODS] as const),
});

export const mfaMethodSchema = z.object({
  method: z.enum([...SECOND_FACTOR_METHODS, 'passkey'] as const),
});

// JSON-stringified WebAuthn ceremony output from the browser
export const credentialSchema = z.object({ credential: z.string().min(1) });

// force=true: setup is mandatory (no skip button shown).
// checkAfter=true: after enrolling, immediately route into the matching verify screen.
export const setupSkipSchema = z.object({
  force: z.enum(['true', 'false']).optional(),
  checkAfter: z.enum(['true', 'false']).optional(),
});
