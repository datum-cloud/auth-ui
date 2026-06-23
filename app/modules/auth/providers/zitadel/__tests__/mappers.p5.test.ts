import {
  durationToMs,
  mapAuthMethod,
  mfaInitSkippedToIso,
  toChallengeRequest,
  toChecks,
  toLoginSettings,
  toPasswordComplexity,
  toSessionChallenges,
  toUser,
} from '../mappers';
import type { SessionChecks } from '@/modules/auth/auth-provider';
import { describe, it, expect } from 'vitest';

// ── durationToMs ─────────────────────────────────────────────────────────────

describe('durationToMs', () => {
  it('returns undefined for undefined input', () => {
    expect(durationToMs(undefined)).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(durationToMs(null)).toBeUndefined();
  });

  it('returns undefined for non-object input', () => {
    expect(durationToMs('300s')).toBeUndefined();
  });

  it('returns undefined for zero duration (0 seconds, 0 nanos)', () => {
    expect(durationToMs({ seconds: 0, nanos: 0 })).toBeUndefined();
  });

  it('converts whole seconds only', () => {
    expect(durationToMs({ seconds: 3600, nanos: 0 })).toBe(3_600_000);
  });

  it('converts nanos only', () => {
    expect(durationToMs({ seconds: 0, nanos: 500_000_000 })).toBe(500);
  });

  it('converts seconds + nanos together', () => {
    expect(durationToMs({ seconds: 1, nanos: 500_000_000 })).toBe(1_500);
  });

  it('handles BigInt seconds (proto uint64 field)', () => {
    // Proto Duration.seconds is int64 — generated code uses BigInt in JS
    expect(durationToMs({ seconds: BigInt(7200), nanos: 0 })).toBe(7_200_000);
  });

  it('handles BigInt seconds + nanos', () => {
    expect(durationToMs({ seconds: BigInt(1), nanos: 250_000_000 })).toBe(1_250);
  });
});

// ── mapAuthMethod ─────────────────────────────────────────────────────────────

describe('mapAuthMethod', () => {
  it('maps 1 → password', () => expect(mapAuthMethod(1)).toBe('password'));
  it('maps 2 → passkey', () => expect(mapAuthMethod(2)).toBe('passkey'));
  it('maps 3 → idp', () => expect(mapAuthMethod(3)).toBe('idp'));
  it('maps 4 → totp', () => expect(mapAuthMethod(4)).toBe('totp'));
  it('maps 5 → u2f', () => expect(mapAuthMethod(5)).toBe('u2f'));
  it('maps 6 → otp_sms', () => expect(mapAuthMethod(6)).toBe('otp_sms'));
  it('maps 7 → otp_email', () => expect(mapAuthMethod(7)).toBe('otp_email'));
  it('returns undefined for unknown enum value 0', () => expect(mapAuthMethod(0)).toBeUndefined());
  it('returns undefined for unknown enum value 99', () =>
    expect(mapAuthMethod(99)).toBeUndefined());
});

// ── mfaInitSkippedToIso ───────────────────────────────────────────────────────

describe('mfaInitSkippedToIso', () => {
  it('returns null for null', () => expect(mfaInitSkippedToIso(null)).toBeNull());
  it('returns null for undefined', () => expect(mfaInitSkippedToIso(undefined)).toBeNull());
  it('returns null for empty string', () => expect(mfaInitSkippedToIso('')).toBeNull());
  it('returns an ISO string unchanged', () => {
    expect(mfaInitSkippedToIso('2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z');
  });
  it('converts a proto Timestamp object to ISO string', () => {
    const ts = { $typeName: 'google.protobuf.Timestamp', seconds: BigInt(1700000000), nanos: 0 };
    const result = mfaInitSkippedToIso(ts);
    expect(typeof result).toBe('string');
    expect(result).toContain('2023-');
  });
  it('returns null on invalid/unparseable input', () => {
    expect(mfaInitSkippedToIso({ seconds: 'notanumber' })).toBeNull();
  });
});

// ── toUser wires mfaInitSkippedAt ─────────────────────────────────────────────
// Tests use the REAL proto oneof shape: { type: { case: 'human', value: HumanUser } }
// NOT the old flat `{ human: {...} }` shape which masked the bug on real responses.

describe('toUser mfaInitSkippedAt', () => {
  it('is null when type is absent (no oneof set)', () => {
    const u = toUser({ userId: 'u1', preferredLoginName: 'a@b.c' });
    expect(u.mfaInitSkippedAt).toBeNull();
  });

  it('is null when type.case is machine (non-human user)', () => {
    const u = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: 'machine', value: {} },
    });
    expect(u.mfaInitSkippedAt).toBeNull();
  });

  it('is null when type.case is undefined', () => {
    const u = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: undefined, value: undefined },
    });
    expect(u.mfaInitSkippedAt).toBeNull();
  });

  it('is set when type.case is human and mfaInitSkipped is an ISO string', () => {
    const u = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: 'human', value: { mfaInitSkipped: '2026-01-01T00:00:00.000Z' } },
    });
    expect(u.mfaInitSkippedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('is set when type.case is human and mfaInitSkipped is a proto Timestamp', () => {
    const ts = { $typeName: 'google.protobuf.Timestamp', seconds: BigInt(1700000000), nanos: 0 };
    const u = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: 'human', value: { mfaInitSkipped: ts } },
    });
    expect(typeof u.mfaInitSkippedAt).toBe('string');
    expect(u.mfaInitSkippedAt).not.toBeNull();
  });

  it('is null when type.case is human but mfaInitSkipped is absent', () => {
    const u = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: 'human', value: {} },
    });
    expect(u.mfaInitSkippedAt).toBeNull();
  });
});

// ── toLoginSettings wires mfaInitSkipLifetimeMs + all durations ──────────────

describe('toLoginSettings duration fields', () => {
  it('maps all duration fields to milliseconds', () => {
    const proto = {
      allowUsernamePassword: true,
      allowRegister: false,
      allowExternalIdp: true,
      passkeysType: 1,
      forceMfa: false,
      passwordCheckLifetime: { seconds: BigInt(14400), nanos: 0 },
      secondFactorCheckLifetime: { seconds: BigInt(3600), nanos: 0 },
      multiFactorCheckLifetime: { seconds: BigInt(7200), nanos: 0 },
      mfaInitSkipLifetime: { seconds: BigInt(86400), nanos: 0 },
    };
    const s = toLoginSettings(proto as Record<string, unknown>);
    expect(s.passwordCheckLifetimeMs).toBe(14_400_000);
    expect(s.secondFactorCheckLifetimeMs).toBe(3_600_000);
    expect(s.multiFactorCheckLifetimeMs).toBe(7_200_000);
    expect(s.mfaInitSkipLifetimeMs).toBe(86_400_000);
  });

  it('leaves duration fields undefined when absent', () => {
    const proto = {
      allowUsernamePassword: false,
      allowRegister: false,
      allowExternalIdp: false,
      passkeysType: 0,
      forceMfa: false,
    };
    const s = toLoginSettings(proto as Record<string, unknown>);
    expect(s.passwordCheckLifetimeMs).toBeUndefined();
    expect(s.secondFactorCheckLifetimeMs).toBeUndefined();
    expect(s.multiFactorCheckLifetimeMs).toBeUndefined();
    expect(s.mfaInitSkipLifetimeMs).toBeUndefined();
  });
});

// ── toChecks ──────────────────────────────────────────────────────────────────

describe('toChecks', () => {
  it('returns empty object when no MFA checks are present', () => {
    const checks: SessionChecks = {};
    expect(toChecks(checks)).toEqual({});
  });

  it('maps totp code', () => {
    const checks: SessionChecks = { totp: '123456' };
    expect(toChecks(checks)).toEqual({ totp: { code: '123456' } });
  });

  it('maps otpEmail code', () => {
    const checks: SessionChecks = { otpEmail: '654321' };
    expect(toChecks(checks)).toEqual({ otpEmail: { code: '654321' } });
  });

  it('maps otpSms code', () => {
    const checks: SessionChecks = { otpSms: '000000' };
    expect(toChecks(checks)).toEqual({ otpSms: { code: '000000' } });
  });

  it('maps webAuthN credentialAssertionData', () => {
    const cred = { type: 'public-key', id: 'abc' };
    const checks: SessionChecks = { webAuthN: { credentialAssertionData: cred } };
    const result = toChecks(checks);
    expect(result.webAuthN?.credentialAssertionData).toBe(cred);
  });

  it('maps multiple MFA checks simultaneously', () => {
    const checks: SessionChecks = { totp: '111111', otpEmail: '222222' };
    const result = toChecks(checks);
    expect(result.totp).toEqual({ code: '111111' });
    expect(result.otpEmail).toEqual({ code: '222222' });
  });

  it('does not include password or idpIntent fields (those are handled by updateSession directly)', () => {
    const checks: SessionChecks = { password: 'secret', totp: '123456' };
    const result = toChecks(checks);
    expect(result).not.toHaveProperty('password');
    expect(result.totp).toEqual({ code: '123456' });
  });
});

// ── toPasswordComplexity ──────────────────────────────────────────────────────
// Proto PasswordComplexitySettings.minLength is uint64 → bigint in generated code.
// These tests confirm BigInt is coerced to number and the result is JSON-serialisable.

describe('toPasswordComplexity', () => {
  it('coerces BigInt minLength to number', () => {
    const result = toPasswordComplexity({ minLength: BigInt(8) });
    expect(typeof result.minLength).toBe('number');
    expect(result.minLength).toBe(8);
  });

  it('coerces large BigInt minLength correctly', () => {
    const result = toPasswordComplexity({ minLength: BigInt(20) });
    expect(result.minLength).toBe(20);
  });

  it('result is JSON.stringify-safe (no BigInt left)', () => {
    const result = toPasswordComplexity({
      minLength: BigInt(8),
      requiresUppercase: true,
      requiresLowercase: true,
      requiresNumber: false,
      requiresSymbol: true,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('preserves boolean fields correctly', () => {
    const result = toPasswordComplexity({
      minLength: BigInt(6),
      requiresUppercase: true,
      requiresLowercase: false,
      requiresNumber: true,
      requiresSymbol: false,
    });
    expect(result.requiresUppercase).toBe(true);
    expect(result.requiresLowercase).toBe(false);
    expect(result.requiresNumber).toBe(true);
    expect(result.requiresSymbol).toBe(false);
  });

  it('handles missing/undefined fields with safe defaults', () => {
    const result = toPasswordComplexity({});
    expect(result.minLength).toBe(0);
    expect(result.requiresUppercase).toBe(false);
    expect(result.requiresLowercase).toBe(false);
    expect(result.requiresNumber).toBe(false);
    expect(result.requiresSymbol).toBe(false);
  });

  it('handles number minLength passthrough (non-proto path)', () => {
    const result = toPasswordComplexity({ minLength: 10 });
    expect(typeof result.minLength).toBe('number');
    expect(result.minLength).toBe(10);
  });
});

// ── toSessionChallenges ───────────────────────────────────────────────────────
// Proto Challenges shape (SetSessionResponse.challenges, field 3):
//   webAuthN?: { publicKeyCredentialRequestOptions?: JsonObject }  — google.protobuf.Struct passthrough
//   otpSms?:   string  — OTP code when returnCode=true was requested
//   otpEmail?: string  — OTP code when returnCode delivery was requested

describe('toSessionChallenges', () => {
  it('maps webAuthN publicKeyCredentialRequestOptions through as-is', () => {
    const pkOptions = { publicKey: { challenge: 'abc123', allowCredentials: [] } };
    const result = toSessionChallenges({
      webAuthN: { publicKeyCredentialRequestOptions: pkOptions },
    });
    expect(result.webAuthN).toBeDefined();
    expect(result.webAuthN?.publicKeyCredentialRequestOptions).toBe(pkOptions);
  });

  it('maps webAuthN with undefined publicKeyCredentialRequestOptions', () => {
    const result = toSessionChallenges({ webAuthN: {} });
    expect(result.webAuthN).toBeDefined();
    expect(result.webAuthN?.publicKeyCredentialRequestOptions).toBeUndefined();
  });

  it('maps otpEmail code onto the typed otpEmailCode', () => {
    const result = toSessionChallenges({ otpEmail: '123456' });
    expect(result.otpEmailCode).toBe('123456');
    expect(result.webAuthN).toBeUndefined();
    expect(result.otpSms).toBeUndefined();
  });

  it('maps otpSms string value', () => {
    const result = toSessionChallenges({ otpSms: '654321' });
    expect(result.otpSms).toBe('654321');
    expect(result.webAuthN).toBeUndefined();
    expect(result.otpEmailCode).toBeUndefined();
  });

  it('maps all three challenge types simultaneously', () => {
    const pkOptions = { publicKey: { challenge: 'xyz' } };
    const result = toSessionChallenges({
      webAuthN: { publicKeyCredentialRequestOptions: pkOptions },
      otpEmail: '111111',
      otpSms: '222222',
    });
    expect(result.webAuthN?.publicKeyCredentialRequestOptions).toBe(pkOptions);
    expect(result.otpEmailCode).toBe('111111');
    expect(result.otpSms).toBe('222222');
  });

  it('returns empty object when all fields are absent', () => {
    const result = toSessionChallenges({});
    expect(result).toEqual({});
  });

  it('omits webAuthN when it is null', () => {
    const result = toSessionChallenges({ webAuthN: null, otpEmail: '000000' });
    expect(result.webAuthN).toBeUndefined();
    expect(result.otpEmailCode).toBe('000000');
  });

  it('omits otpEmailCode when otpEmail is null', () => {
    const result = toSessionChallenges({ otpEmail: null });
    expect(result.otpEmailCode).toBeUndefined();
  });

  it('omits otpSms when it is null', () => {
    const result = toSessionChallenges({ otpSms: null });
    expect(result.otpSms).toBeUndefined();
  });
});

// ── toChallengeRequest (neutral challenges → proto RequestChallenges) ──────────

describe('toChallengeRequest — otpEmail url_template', () => {
  it("sends an EMPTY sendCode value for { kind: 'send' } (no template)", () => {
    const result = toChallengeRequest({ otpEmail: { kind: 'send' } });
    expect(result.otpEmail).toEqual({ deliveryType: { case: 'sendCode', value: {} } });
  });

  it("sets url_template on the sendCode value for { kind: 'send-template' }", () => {
    // Bug A: without this, the proto RequestChallenges.OTPEmail.SendCode.url_template is
    // never set and Zitadel mails its default /ui/v2/login/otp/email link instead of OUR
    // /id/login/verify/email route. The proto field name is `urlTemplate` (proto: url_template).
    const tmpl =
      'https://h/id/login/verify/email?code={{.Code}}&userId={{.UserID}}&sessionId={{.SessionID}}&loginName=x';
    const result = toChallengeRequest({ otpEmail: { kind: 'send-template', urlTemplate: tmpl } });
    expect(result.otpEmail).toEqual({
      deliveryType: { case: 'sendCode', value: { urlTemplate: tmpl } },
    });
  });

  it('omits otpEmail entirely when not requested', () => {
    const result = toChallengeRequest({});
    expect(result.otpEmail).toBeUndefined();
  });
});
