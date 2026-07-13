// cypress/component/modules/auth/providers/zitadel/mappers.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/mappers.test.ts.
// Pure normalizeError / toAuthRequest / toSession / toLoginSettings mappers — browser-side Chai only.
//
// Final squeeze: reduced to one test per genuinely distinct mapping concern. Kept standalone:
// the Bug C policy-mapping regression (named in the original comment). The code-9 "already"
// regression guard is merged into the normalizeError test (same function, same describe
// concern) rather than dropped. toAuthRequest and toSession are both simple proto→neutral
// passthrough mappers and are merged into one test.
import {
  normalizeError,
  toAuthRequest,
  toSession,
  toLoginSettings,
} from '@/modules/auth/providers/zitadel/mappers';
import { ProviderError } from '@/modules/auth/types';

// minimal ConnectError shape
const ce = (code: number, message = 'boom', details: unknown[] = []) => ({
  code,
  message,
  findDetails: () => details,
});

describe('normalizeError (ConnectError → ProviderError)', () => {
  it('maps known gRPC codes to ProviderError, extracts failedAttempts detail, falls back to UNKNOWN, passes a ProviderError through unchanged, and maps code 9 + "already" to ALREADY_DONE (regression guard)', () => {
    expect(normalizeError(ce(5)).code).to.equal('NOT_FOUND');
    expect(normalizeError(ce(7)).code).to.equal('PERMISSION_DENIED');
    expect(normalizeError(ce(99)).code).to.equal('UNKNOWN');

    const e = normalizeError(ce(3, 'bad', [{ failedAttempts: 2 }]));
    expect(e.code).to.equal('INVALID_CREDENTIALS');
    expect(e.detail?.failedAttempts).to.equal(2);

    const p = new ProviderError('RATE_LIMITED', 'slow down');
    expect(normalizeError(p)).to.equal(p);

    // Regression guard: code 9 + "already" must map to ALREADY_DONE, not
    // FAILED_PRECONDITION/UNKNOWN.
    const mapped = normalizeError({ code: 9, message: 'totp already verified' });
    expect(mapped.code).to.equal('ALREADY_DONE');
  });
});

describe('toAuthRequest / toSession (proto → neutral)', () => {
  const ts = (seconds: number) => ({
    $typeName: 'google.protobuf.Timestamp',
    seconds: BigInt(seconds),
    nanos: 0,
  });

  it('maps id/scope/prompt enums to neutral strings, converts Timestamps to ISO strings/Dates, and never throws on a malformed Timestamp', () => {
    // Prompt enum: 1=NONE, 2=LOGIN, 3=CONSENT, 4=SELECT_ACCOUNT, 5=CREATE (mirror @zitadel/proto)
    const req = toAuthRequest({
      id: 'abc',
      scope: ['openid', 'profile'],
      prompt: [2, 4],
      loginHint: 'a@b.c',
    });
    expect(req).to.deep.include({
      id: 'abc',
      scopes: ['openid', 'profile'],
      prompt: ['login', 'select_account'],
      loginHint: 'a@b.c',
    });

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
    // Factor verifiedAt is now a Date; expiresAt/changedAt stay ISO strings.
    expect(s.factors.password?.verifiedAt).to.deep.equal(new Date('2023-11-14T22:13:20.000Z'));
    expect(s.expiresAt).to.equal('2027-01-15T08:00:00.000Z');
    expect(JSON.stringify(s)).not.to.include('[object Object]');

    const bad = { not: 'a timestamp' } as unknown;
    const malformed = toSession(
      { id: 's', factors: { user: { id: 'u1', loginName: 'x' } }, expirationDate: bad },
      'tok'
    );
    expect(malformed.expiresAt).to.equal('');
  });
});

// Bug C: policy-allowed second/multi factors.
// Proto enum SecondFactorType (settings/v2): OTP(TOTP)=1, U2F=2, OTP_EMAIL=3, OTP_SMS=4.
// Proto enum MultiFactorType (settings/v2): U2F_WITH_VERIFICATION=1 → our 'passkey'.
describe('toLoginSettings secondFactors / multiFactors (Bug C policy mapping)', () => {
  it('maps proto secondFactors/multiFactors enum values to neutral AuthMethods, dropping unknown values', () => {
    // [OTP=1, U2F=2, OTP_EMAIL=3, OTP_SMS=4] → [totp, u2f, otp_email, otp_sms]
    expect(toLoginSettings({ secondFactors: [1, 2, 3, 4] }).secondFactors).to.deep.equal([
      'totp',
      'u2f',
      'otp_email',
      'otp_sms',
    ]);
    expect(toLoginSettings({ secondFactors: [0, 1, 99] }).secondFactors).to.deep.equal(['totp']);
    expect(toLoginSettings({ multiFactors: [1] }).multiFactors).to.deep.equal(['passkey']);
  });
});
