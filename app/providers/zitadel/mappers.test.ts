import { ProviderError } from '../types';
import { normalizeError, toAuthRequest, toSession, toLoginSettings } from './mappers';
import { describe, it, expect } from 'vitest';

// minimal ConnectError shape: { code: number, message: string, findDetails?: () => unknown[] }
const ce = (code: number, message = 'boom', details: unknown[] = []) => ({
  code,
  message,
  findDetails: () => details,
});

describe('normalizeError (ConnectError → ProviderError)', () => {
  it('maps gRPC NOT_FOUND(5) → NOT_FOUND', () => {
    const e = normalizeError(ce(5));
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe('NOT_FOUND');
  });
  it('maps PERMISSION_DENIED(7) / UNAVAILABLE(14) / DEADLINE_EXCEEDED(4)', () => {
    expect(normalizeError(ce(7)).code).toBe('PERMISSION_DENIED');
    expect(normalizeError(ce(14)).code).toBe('UNAVAILABLE');
    expect(normalizeError(ce(4)).code).toBe('DEADLINE_EXCEEDED');
  });
  it('extracts failedAttempts from credentials-check details → INVALID_CREDENTIALS', () => {
    const e = normalizeError(ce(3, 'bad', [{ failedAttempts: 2 }]));
    expect(e.code).toBe('INVALID_CREDENTIALS');
    expect(e.detail?.failedAttempts).toBe(2);
  });
  it('falls back to UNKNOWN for unmapped codes', () => {
    expect(normalizeError(ce(99)).code).toBe('UNKNOWN');
  });
  it('passes a ProviderError through unchanged', () => {
    const p = new ProviderError('RATE_LIMITED', 'slow down');
    expect(normalizeError(p)).toBe(p);
  });
});

describe('toAuthRequest (proto → neutral)', () => {
  it('maps id/scope/prompt enums to neutral strings', () => {
    // Prompt enum: 1=NONE, 2=LOGIN, 3=CONSENT, 4=SELECT_ACCOUNT, 5=CREATE (mirror @zitadel/proto)
    const req = toAuthRequest({
      id: 'abc',
      scope: ['openid', 'profile'],
      prompt: [2, 4],
      loginHint: 'a@b.c',
    });
    expect(req).toMatchObject({
      id: 'abc',
      scopes: ['openid', 'profile'],
      prompt: ['login', 'select_account'],
      loginHint: 'a@b.c',
    });
  });
});

describe('toSession (proto → neutral)', () => {
  const ts = (seconds: number) => ({
    $typeName: 'google.protobuf.Timestamp',
    seconds: BigInt(seconds),
    nanos: 0,
  });

  it('converts proto Timestamps to ISO strings (never "[object Object]")', () => {
    const s = toSession(
      {
        id: 'sess1',
        factors: {
          user: { id: 'u1', loginName: 'a@b.c' },
          password: { verifiedAt: ts(1700000000) },
        },
        expirationDate: ts(1800000000),
        changeDate: ts(1700000000),
      },
      'tok'
    );
    expect(s.factors.password?.verifiedAt).toBe('2023-11-14T22:13:20.000Z');
    expect(s.expiresAt).toBe('2027-01-15T08:00:00.000Z');
    expect(s.changedAt).toBe('2023-11-14T22:13:20.000Z');
    expect(JSON.stringify(s)).not.toContain('[object Object]');
  });

  it('absent factors yield verifiedAt null (never truthy garbage)', () => {
    const s = toSession({ id: 'sess2' }, 'tok');
    expect(s.factors.password?.verifiedAt).toBeNull();
    expect(s.factors.passkey?.verifiedAt).toBeNull();
    expect(s.expiresAt).toBe('');
  });
});

it('toSession maps a verified TOTP factor from the real proto shape', () => {
  const proto = {
    id: 'sess-1',
    factors: {
      user: { id: 'u1', loginName: 'a@b.c', organizationId: 'org1' },
      password: { verifiedAt: '2026-06-14T00:00:00.000Z' },
      totp: { verifiedAt: '2026-06-14T00:05:00.000Z' },
    },
  };
  const session = toSession(proto, 'tok');
  expect(session.factors.totp?.verifiedAt).toBe('2026-06-14T00:05:00.000Z');
});

it('toSession maps verified otpEmail / otpSms / u2f factors', () => {
  const proto = {
    id: 'sess-2',
    factors: {
      user: { id: 'u1', loginName: 'a@b.c' },
      otpEmail: { verifiedAt: '2026-06-14T01:00:00.000Z' },
      otpSms: { verifiedAt: '2026-06-14T02:00:00.000Z' },
      u2f: { verifiedAt: '2026-06-14T03:00:00.000Z', userVerified: true },
    },
  };
  const session = toSession(proto, 'tok');
  expect(session.factors.otpEmail?.verifiedAt).toBe('2026-06-14T01:00:00.000Z');
  expect(session.factors.otpSms?.verifiedAt).toBe('2026-06-14T02:00:00.000Z');
  expect(session.factors.u2f?.verifiedAt).toBe('2026-06-14T03:00:00.000Z');
});

it('toSession leaves unset MFA factors null (no false positives)', () => {
  const session = toSession({ id: 's', factors: { user: { id: 'u1', loginName: 'x' } } }, 'tok');
  expect(session.factors.totp?.verifiedAt ?? null).toBeNull();
  expect(session.factors.otpEmail?.verifiedAt ?? null).toBeNull();
});

it('toSession returns empty-string timestamps instead of throwing on a malformed proto Timestamp', () => {
  const bad = { not: 'a timestamp' } as unknown;
  const session = toSession(
    { id: 's', factors: { user: { id: 'u1', loginName: 'x' } }, expirationDate: bad },
    'tok'
  );
  expect(session.expiresAt).toBe('');
});

it('maps gRPC code 9 without verified/already to FAILED_PRECONDITION, not UNKNOWN', () => {
  const mapped = normalizeError({ code: 9, message: 'precondition: mfa not initialised' });
  expect(mapped.code).toBe('FAILED_PRECONDITION');
});

it('still maps code 9 with "already" to ALREADY_DONE (regression guard)', () => {
  const mapped = normalizeError({ code: 9, message: 'totp already verified' });
  expect(mapped.code).toBe('ALREADY_DONE');
});

describe('toLoginSettings defaultRedirectUri', () => {
  it('maps defaultRedirectUri when the proto carries it', () => {
    expect(
      toLoginSettings({ defaultRedirectUri: 'http://localhost:3001' }).defaultRedirectUri
    ).toBe('http://localhost:3001');
  });
  it('is undefined when empty or absent (proto-JSON omits empty strings)', () => {
    expect(toLoginSettings({ defaultRedirectUri: '' }).defaultRedirectUri).toBeUndefined();
    expect(toLoginSettings({}).defaultRedirectUri).toBeUndefined();
  });
});

// Bug C: policy-allowed second/multi factors.
// Proto enum SecondFactorType (settings/v2): OTP(TOTP)=1, U2F=2, OTP_EMAIL=3, OTP_SMS=4.
// Proto enum MultiFactorType (settings/v2): U2F_WITH_VERIFICATION=1 → our 'passkey'.
describe('toLoginSettings secondFactors / multiFactors (Bug C policy mapping)', () => {
  it('maps proto secondFactors enum values to neutral AuthMethods via the dedicated table', () => {
    // [OTP=1, U2F=2, OTP_EMAIL=3, OTP_SMS=4] → [totp, u2f, otp_email, otp_sms]
    expect(toLoginSettings({ secondFactors: [1, 2, 3, 4] }).secondFactors).toEqual([
      'totp',
      'u2f',
      'otp_email',
      'otp_sms',
    ]);
  });

  it('maps a policy that only enables TOTP', () => {
    expect(toLoginSettings({ secondFactors: [1] }).secondFactors).toEqual(['totp']);
  });

  it('maps proto multiFactors (U2F_WITH_VERIFICATION=1) to passkey', () => {
    expect(toLoginSettings({ multiFactors: [1] }).multiFactors).toEqual(['passkey']);
  });

  it('drops unknown/unspecified enum values rather than emitting undefined entries', () => {
    expect(toLoginSettings({ secondFactors: [0, 1, 99] }).secondFactors).toEqual(['totp']);
  });

  it('leaves secondFactors/multiFactors undefined when the proto omits them (back-compat)', () => {
    const s = toLoginSettings({});
    expect(s.secondFactors).toBeUndefined();
    expect(s.multiFactors).toBeUndefined();
  });

  it('maps an empty proto array to an empty neutral array (caller treats empty as no-restriction)', () => {
    expect(toLoginSettings({ secondFactors: [] }).secondFactors).toEqual([]);
  });
});
