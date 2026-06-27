// cypress/component/modules/auth/providers/zitadel/mappers.p5.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/mappers.p5.test.ts.
// Phase 5 mapper helpers: durationToMs, mapAuthMethod, mfaInitSkippedToIso, toUser,
// toLoginSettings duration fields, toChecks, toPasswordComplexity, toSessionChallenges,
// toChallengeRequest — browser-side Chai only.
import type { SessionChecks } from '@/modules/auth/auth-provider';
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
} from '@/modules/auth/providers/zitadel/mappers';

// ── durationToMs ─────────────────────────────────────────────────────────────

describe('durationToMs', () => {
  it('returns undefined for undefined input', () => {
    expect(durationToMs(undefined)).to.be.undefined;
  });

  it('returns undefined for null input', () => {
    expect(durationToMs(null)).to.be.undefined;
  });

  it('returns undefined for non-object input', () => {
    expect(durationToMs('300s')).to.be.undefined;
  });

  it('returns undefined for zero duration (0 seconds, 0 nanos)', () => {
    expect(durationToMs({ seconds: 0, nanos: 0 })).to.be.undefined;
  });

  it('converts whole seconds only', () => {
    expect(durationToMs({ seconds: 3600, nanos: 0 })).to.equal(3_600_000);
  });

  it('converts nanos only', () => {
    expect(durationToMs({ seconds: 0, nanos: 500_000_000 })).to.equal(500);
  });

  it('converts seconds + nanos together', () => {
    expect(durationToMs({ seconds: 1, nanos: 500_000_000 })).to.equal(1_500);
  });

  it('handles BigInt seconds (proto uint64 field)', () => {
    // Proto Duration.seconds is int64 — generated code uses BigInt in JS
    expect(durationToMs({ seconds: BigInt(7200), nanos: 0 })).to.equal(7_200_000);
  });

  it('handles BigInt seconds + nanos', () => {
    expect(durationToMs({ seconds: BigInt(1), nanos: 250_000_000 })).to.equal(1_250);
  });
});

// ── mapAuthMethod ─────────────────────────────────────────────────────────────

describe('mapAuthMethod', () => {
  it('maps 1 → password', () => expect(mapAuthMethod(1)).to.equal('password'));
  it('maps 2 → passkey', () => expect(mapAuthMethod(2)).to.equal('passkey'));
  it('maps 3 → idp', () => expect(mapAuthMethod(3)).to.equal('idp'));
  it('maps 4 → totp', () => expect(mapAuthMethod(4)).to.equal('totp'));
  it('maps 5 → u2f', () => expect(mapAuthMethod(5)).to.equal('u2f'));
  it('maps 6 → otp_sms', () => expect(mapAuthMethod(6)).to.equal('otp_sms'));
  it('maps 7 → otp_email', () => expect(mapAuthMethod(7)).to.equal('otp_email'));
  it('returns undefined for unknown enum value 0', () => expect(mapAuthMethod(0)).to.be.undefined);
  it('returns undefined for unknown enum value 99', () =>
    expect(mapAuthMethod(99)).to.be.undefined);
});

// ── mfaInitSkippedToIso ───────────────────────────────────────────────────────

describe('mfaInitSkippedToIso', () => {
  it('returns null for null', () => expect(mfaInitSkippedToIso(null)).to.be.null);
  it('returns null for undefined', () => expect(mfaInitSkippedToIso(undefined)).to.be.null);
  it('returns null for empty string', () => expect(mfaInitSkippedToIso('')).to.be.null);
  it('returns an ISO string unchanged', () => {
    expect(mfaInitSkippedToIso('2026-01-01T00:00:00.000Z')).to.equal('2026-01-01T00:00:00.000Z');
  });
  it('converts a proto Timestamp object to ISO string', () => {
    const ts = { $typeName: 'google.protobuf.Timestamp', seconds: BigInt(1700000000), nanos: 0 };
    const result = mfaInitSkippedToIso(ts);
    expect(typeof result).to.equal('string');
    expect(result).to.include('2023-');
  });
  it('returns null on invalid/unparseable input', () => {
    expect(mfaInitSkippedToIso({ seconds: 'notanumber' })).to.be.null;
  });
});

// ── toUser wires mfaInitSkippedAt ─────────────────────────────────────────────

describe('toUser mfaInitSkippedAt', () => {
  it('is null when type is absent (no oneof set)', () => {
    const u = toUser({ userId: 'u1', preferredLoginName: 'a@b.c' });
    expect(u.mfaInitSkippedAt).to.be.null;
  });

  it('is null when type.case is machine (non-human user)', () => {
    const u = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: 'machine', value: {} },
    });
    expect(u.mfaInitSkippedAt).to.be.null;
  });

  it('is null when type.case is undefined', () => {
    const u = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: undefined, value: undefined },
    });
    expect(u.mfaInitSkippedAt).to.be.null;
  });

  it('is set when type.case is human and mfaInitSkipped is an ISO string', () => {
    const u = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: 'human', value: { mfaInitSkipped: '2026-01-01T00:00:00.000Z' } },
    });
    expect(u.mfaInitSkippedAt).to.equal('2026-01-01T00:00:00.000Z');
  });

  it('is set when type.case is human and mfaInitSkipped is a proto Timestamp', () => {
    const ts = { $typeName: 'google.protobuf.Timestamp', seconds: BigInt(1700000000), nanos: 0 };
    const u = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: 'human', value: { mfaInitSkipped: ts } },
    });
    expect(typeof u.mfaInitSkippedAt).to.equal('string');
    expect(u.mfaInitSkippedAt).not.to.be.null;
  });

  it('is null when type.case is human but mfaInitSkipped is absent', () => {
    const u = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: 'human', value: {} },
    });
    expect(u.mfaInitSkippedAt).to.be.null;
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
    expect(s.passwordCheckLifetimeMs).to.equal(14_400_000);
    expect(s.secondFactorCheckLifetimeMs).to.equal(3_600_000);
    expect(s.multiFactorCheckLifetimeMs).to.equal(7_200_000);
    expect(s.mfaInitSkipLifetimeMs).to.equal(86_400_000);
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
    expect(s.passwordCheckLifetimeMs).to.be.undefined;
    expect(s.secondFactorCheckLifetimeMs).to.be.undefined;
    expect(s.multiFactorCheckLifetimeMs).to.be.undefined;
    expect(s.mfaInitSkipLifetimeMs).to.be.undefined;
  });
});

// ── toChecks ──────────────────────────────────────────────────────────────────

describe('toChecks', () => {
  it('returns empty object when no MFA checks are present', () => {
    const checks: SessionChecks = {};
    expect(toChecks(checks)).to.deep.equal({});
  });

  it('maps totp code', () => {
    const checks: SessionChecks = { totp: '123456' };
    expect(toChecks(checks)).to.deep.equal({ totp: { code: '123456' } });
  });

  it('maps otpEmail code', () => {
    const checks: SessionChecks = { otpEmail: '654321' };
    expect(toChecks(checks)).to.deep.equal({ otpEmail: { code: '654321' } });
  });

  it('maps otpSms code', () => {
    const checks: SessionChecks = { otpSms: '000000' };
    expect(toChecks(checks)).to.deep.equal({ otpSms: { code: '000000' } });
  });

  it('maps webAuthN credentialAssertionData', () => {
    const cred = { type: 'public-key', id: 'abc' };
    const checks: SessionChecks = { webAuthN: { credentialAssertionData: cred } };
    const result = toChecks(checks);
    expect(result.webAuthN?.credentialAssertionData).to.equal(cred);
  });

  it('maps multiple MFA checks simultaneously', () => {
    const checks: SessionChecks = { totp: '111111', otpEmail: '222222' };
    const result = toChecks(checks);
    expect(result.totp).to.deep.equal({ code: '111111' });
    expect(result.otpEmail).to.deep.equal({ code: '222222' });
  });

  it('does not include password or idpIntent fields (those are handled by updateSession directly)', () => {
    const checks: SessionChecks = { password: 'secret', totp: '123456' };
    const result = toChecks(checks);
    expect(result).not.to.have.property('password');
    expect(result.totp).to.deep.equal({ code: '123456' });
  });
});

// ── toPasswordComplexity ──────────────────────────────────────────────────────

describe('toPasswordComplexity', () => {
  it('coerces BigInt minLength to number', () => {
    const result = toPasswordComplexity({ minLength: BigInt(8) });
    expect(typeof result.minLength).to.equal('number');
    expect(result.minLength).to.equal(8);
  });

  it('coerces large BigInt minLength correctly', () => {
    const result = toPasswordComplexity({ minLength: BigInt(20) });
    expect(result.minLength).to.equal(20);
  });

  it('result is JSON.stringify-safe (no BigInt left)', () => {
    const result = toPasswordComplexity({
      minLength: BigInt(8),
      requiresUppercase: true,
      requiresLowercase: true,
      requiresNumber: false,
      requiresSymbol: true,
    });
    expect(() => JSON.stringify(result)).not.to.throw();
  });

  it('preserves boolean fields correctly', () => {
    const result = toPasswordComplexity({
      minLength: BigInt(6),
      requiresUppercase: true,
      requiresLowercase: false,
      requiresNumber: true,
      requiresSymbol: false,
    });
    expect(result.requiresUppercase).to.equal(true);
    expect(result.requiresLowercase).to.equal(false);
    expect(result.requiresNumber).to.equal(true);
    expect(result.requiresSymbol).to.equal(false);
  });

  it('handles missing/undefined fields with safe defaults', () => {
    const result = toPasswordComplexity({});
    expect(result.minLength).to.equal(0);
    expect(result.requiresUppercase).to.equal(false);
    expect(result.requiresLowercase).to.equal(false);
    expect(result.requiresNumber).to.equal(false);
    expect(result.requiresSymbol).to.equal(false);
  });

  it('handles number minLength passthrough (non-proto path)', () => {
    const result = toPasswordComplexity({ minLength: 10 });
    expect(typeof result.minLength).to.equal('number');
    expect(result.minLength).to.equal(10);
  });
});

// ── toSessionChallenges ───────────────────────────────────────────────────────

describe('toSessionChallenges', () => {
  it('maps webAuthN publicKeyCredentialRequestOptions through as-is', () => {
    const pkOptions = { publicKey: { challenge: 'abc123', allowCredentials: [] } };
    const result = toSessionChallenges({
      webAuthN: { publicKeyCredentialRequestOptions: pkOptions },
    });
    expect(result.webAuthN).not.to.be.undefined;
    expect(result.webAuthN?.publicKeyCredentialRequestOptions).to.equal(pkOptions);
  });

  it('maps webAuthN with undefined publicKeyCredentialRequestOptions', () => {
    const result = toSessionChallenges({ webAuthN: {} });
    expect(result.webAuthN).not.to.be.undefined;
    expect(result.webAuthN?.publicKeyCredentialRequestOptions).to.be.undefined;
  });

  it('maps otpEmail code onto the typed otpEmailCode', () => {
    const result = toSessionChallenges({ otpEmail: '123456' });
    expect(result.otpEmailCode).to.equal('123456');
    expect(result.webAuthN).to.be.undefined;
    expect(result.otpSms).to.be.undefined;
  });

  it('maps otpSms string value', () => {
    const result = toSessionChallenges({ otpSms: '654321' });
    expect(result.otpSms).to.equal('654321');
    expect(result.webAuthN).to.be.undefined;
    expect(result.otpEmailCode).to.be.undefined;
  });

  it('maps all three challenge types simultaneously', () => {
    const pkOptions = { publicKey: { challenge: 'xyz' } };
    const result = toSessionChallenges({
      webAuthN: { publicKeyCredentialRequestOptions: pkOptions },
      otpEmail: '111111',
      otpSms: '222222',
    });
    expect(result.webAuthN?.publicKeyCredentialRequestOptions).to.equal(pkOptions);
    expect(result.otpEmailCode).to.equal('111111');
    expect(result.otpSms).to.equal('222222');
  });

  it('returns empty object when all fields are absent', () => {
    const result = toSessionChallenges({});
    expect(result).to.deep.equal({});
  });

  it('omits webAuthN when it is null', () => {
    const result = toSessionChallenges({ webAuthN: null, otpEmail: '000000' });
    expect(result.webAuthN).to.be.undefined;
    expect(result.otpEmailCode).to.equal('000000');
  });

  it('omits otpEmailCode when otpEmail is null', () => {
    const result = toSessionChallenges({ otpEmail: null });
    expect(result.otpEmailCode).to.be.undefined;
  });

  it('omits otpSms when it is null', () => {
    const result = toSessionChallenges({ otpSms: null });
    expect(result.otpSms).to.be.undefined;
  });
});

// ── toChallengeRequest (neutral challenges → proto RequestChallenges) ──────────

describe('toChallengeRequest — otpEmail url_template', () => {
  it("sends an EMPTY sendCode value for { kind: 'send' } (no template)", () => {
    const result = toChallengeRequest({ otpEmail: { kind: 'send' } });
    expect(result.otpEmail).to.deep.equal({ deliveryType: { case: 'sendCode', value: {} } });
  });

  it("sets url_template on the sendCode value for { kind: 'send-template' }", () => {
    const tmpl =
      'https://h/id/login/verify/email?code={{.Code}}&userId={{.UserID}}&sessionId={{.SessionID}}&loginName=x';
    const result = toChallengeRequest({ otpEmail: { kind: 'send-template', urlTemplate: tmpl } });
    expect(result.otpEmail).to.deep.equal({
      deliveryType: { case: 'sendCode', value: { urlTemplate: tmpl } },
    });
  });

  it('omits otpEmail entirely when not requested', () => {
    const result = toChallengeRequest({});
    expect(result.otpEmail).to.be.undefined;
  });
});
