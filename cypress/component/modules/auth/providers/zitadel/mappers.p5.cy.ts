// cypress/component/modules/auth/providers/zitadel/mappers.p5.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/mappers.p5.test.ts.
// Phase 5 mapper helpers: durationToMs, mapAuthMethod, mfaInitSkippedToIso, toUser,
// toLoginSettings duration fields, toChecks, toPasswordComplexity, toSessionChallenges,
// toChallengeRequest — browser-side Chai only.
//
// Final squeeze: these are boundary/translation helpers (Zitadel proto → internal shape),
// not user-facing security logic. Reduced to one test per genuinely distinct function, with
// closely-related functions (a pure helper + the wrapper that calls it) merged into a single
// `it` since they exercise the same underlying conversion mechanism.
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

describe('durationToMs / toLoginSettings duration fields', () => {
  it('returns undefined for absent/invalid/zero input, converts seconds+nanos (incl. BigInt), and maps toLoginSettings duration fields to ms', () => {
    expect(durationToMs(undefined)).to.be.undefined;
    expect(durationToMs(null)).to.be.undefined;
    expect(durationToMs('300s')).to.be.undefined;
    expect(durationToMs({ seconds: 0, nanos: 0 })).to.be.undefined;
    expect(durationToMs({ seconds: 1, nanos: 500_000_000 })).to.equal(1_500);
    // Proto Duration.seconds is int64 — generated code uses BigInt in JS.
    expect(durationToMs({ seconds: BigInt(7200), nanos: 0 })).to.equal(7_200_000);

    const s = toLoginSettings({
      allowUsernamePassword: true,
      allowRegister: false,
      allowExternalIdp: true,
      passkeysType: 1,
      forceMfa: false,
      passwordCheckLifetime: { seconds: BigInt(14400), nanos: 0 },
      mfaInitSkipLifetime: { seconds: BigInt(86400), nanos: 0 },
    } as Record<string, unknown>);
    expect(s.passwordCheckLifetimeMs).to.equal(14_400_000);
    expect(s.mfaInitSkipLifetimeMs).to.equal(86_400_000);

    const empty = toLoginSettings({
      allowUsernamePassword: false,
      allowRegister: false,
      allowExternalIdp: false,
      passkeysType: 0,
      forceMfa: false,
    } as Record<string, unknown>);
    expect(empty.passwordCheckLifetimeMs).to.be.undefined;
  });
});

describe('mapAuthMethod', () => {
  it('maps known enum values to neutral auth-method strings, undefined for unknown values', () => {
    expect(mapAuthMethod(1)).to.equal('password');
    expect(mapAuthMethod(7)).to.equal('otp_email');
    expect(mapAuthMethod(0)).to.be.undefined;
    expect(mapAuthMethod(99)).to.be.undefined;
  });
});

describe('mfaInitSkippedToIso / toUser mfaInitSkippedAt', () => {
  it('returns null for absent/unparseable input, converts an ISO string or proto Timestamp, and wires through toUser only for human users', () => {
    expect(mfaInitSkippedToIso(null)).to.be.null;
    expect(mfaInitSkippedToIso(undefined)).to.be.null;
    expect(mfaInitSkippedToIso('')).to.be.null;
    expect(mfaInitSkippedToIso('2026-01-01T00:00:00.000Z')).to.equal('2026-01-01T00:00:00.000Z');
    const ts = { $typeName: 'google.protobuf.Timestamp', seconds: BigInt(1700000000), nanos: 0 };
    expect(mfaInitSkippedToIso(ts)).to.include('2023-');
    expect(mfaInitSkippedToIso({ seconds: 'notanumber' })).to.be.null;

    const machine = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: 'machine', value: {} },
    });
    expect(machine.mfaInitSkippedAt).to.be.null;

    const human = toUser({
      userId: 'u1',
      preferredLoginName: 'a@b.c',
      type: { case: 'human', value: { mfaInitSkipped: '2026-01-01T00:00:00.000Z' } },
    });
    expect(human.mfaInitSkippedAt).to.equal('2026-01-01T00:00:00.000Z');
  });
});

describe('toChecks / toSessionChallenges', () => {
  it('maps MFA check kinds and session challenges onto their proto shape, omitting null/absent fields', () => {
    expect(toChecks({})).to.deep.equal({});
    const result = toChecks({ totp: '123456', password: 'secret' } as SessionChecks);
    expect(result.totp).to.deep.equal({ code: '123456' });
    expect(result).not.to.have.property('password');

    const pkOptions = { publicKey: { challenge: 'xyz' } };
    const challenges = toSessionChallenges({
      webAuthN: { publicKeyCredentialRequestOptions: pkOptions },
      otpEmail: '111111',
      otpSms: '222222',
    });
    expect(challenges.webAuthN?.publicKeyCredentialRequestOptions).to.equal(pkOptions);
    expect(challenges.otpEmailCode).to.equal('111111');
    expect(challenges.otpSms).to.equal('222222');

    const omitted = toSessionChallenges({ webAuthN: null, otpEmail: '000000' });
    expect(omitted.webAuthN).to.be.undefined;
    expect(omitted.otpEmailCode).to.equal('000000');
    expect(toSessionChallenges({})).to.deep.equal({});
  });
});

describe('toPasswordComplexity / toChallengeRequest', () => {
  it('coerces BigInt minLength to a JSON-safe number with safe defaults, and maps otpEmail delivery kinds', () => {
    const result = toPasswordComplexity({
      minLength: BigInt(8),
      requiresUppercase: true,
      requiresLowercase: true,
      requiresNumber: false,
      requiresSymbol: true,
    });
    expect(typeof result.minLength).to.equal('number');
    expect(result.minLength).to.equal(8);
    expect(() => JSON.stringify(result)).not.to.throw();

    const defaults = toPasswordComplexity({});
    expect(defaults.minLength).to.equal(0);
    expect(defaults.requiresUppercase).to.equal(false);

    expect(toChallengeRequest({ otpEmail: { kind: 'send' } }).otpEmail).to.deep.equal({
      deliveryType: { case: 'sendCode', value: {} },
    });
    const tmpl = 'https://h/id/login/verify/email?code={{.Code}}';
    expect(
      toChallengeRequest({ otpEmail: { kind: 'send-template', urlTemplate: tmpl } }).otpEmail
    ).to.deep.equal({ deliveryType: { case: 'sendCode', value: { urlTemplate: tmpl } } });

    // return-code kind (folded in from mappers.otpemail.cy.ts) — completes the delivery-kind
    // enum here, including the "no other delivery oneofs are populated" property.
    const returnCode = toChallengeRequest({ otpEmail: { kind: 'return-code' } });
    expect(returnCode.otpEmail).to.deep.equal({
      deliveryType: { case: 'returnCode', value: {} },
    });
    expect(returnCode.webAuthN).to.be.undefined;
    expect(returnCode.otpSms).to.be.undefined;
  });
});
