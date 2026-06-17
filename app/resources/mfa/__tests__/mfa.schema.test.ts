import {
  otpCodeSchema,
  otpDeliveryCodeSchema,
  mfaMethodSchema,
  secondFactorMethodSchema,
} from '../mfa.schema';
import { describe, it, expect } from 'vitest';

describe('mfa schemas', () => {
  it('accepts a 6-digit OTP code and rejects others', () => {
    expect(otpCodeSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(otpCodeSchema.safeParse({ code: 'abc' }).success).toBe(false);
    expect(otpCodeSchema.safeParse({ code: '12' }).success).toBe(false);
  });
  it('keeps otpCodeSchema strictly 6 digits — rejects 8-digit codes (TOTP regression guard)', () => {
    // TOTP/authenticator codes MUST stay exactly 6 digits; widening here would weaken TOTP.
    expect(otpCodeSchema.safeParse({ code: '86230120' }).success).toBe(false);
    expect(otpCodeSchema.safeParse({ code: '1234567' }).success).toBe(false);
  });
  it('otpDeliveryCodeSchema accepts both 6- and 8-digit codes (email/SMS delivery)', () => {
    expect(otpDeliveryCodeSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(otpDeliveryCodeSchema.safeParse({ code: '86230120' }).success).toBe(true);
  });
  it('otpDeliveryCodeSchema rejects non-numeric and out-of-range lengths', () => {
    expect(otpDeliveryCodeSchema.safeParse({ code: 'abc' }).success).toBe(false);
    expect(otpDeliveryCodeSchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(otpDeliveryCodeSchema.safeParse({ code: '123456789' }).success).toBe(false);
  });
  it('accepts a known MFA method and rejects unknown', () => {
    expect(mfaMethodSchema.safeParse({ method: 'totp' }).success).toBe(true);
    expect(mfaMethodSchema.safeParse({ method: 'carrier-pigeon' }).success).toBe(false);
  });
  it('accepts a second-factor method and rejects passkey', () => {
    expect(secondFactorMethodSchema.safeParse({ method: 'totp' }).success).toBe(true);
    expect(secondFactorMethodSchema.safeParse({ method: 'passkey' }).success).toBe(false);
    expect(secondFactorMethodSchema.safeParse({ method: 'unknown' }).success).toBe(false);
  });
});
