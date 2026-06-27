// cypress/component/modules/auth/providers/zitadel/mappers.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/mappers.test.ts.
// Pure normalizeError / toAuthRequest / toSession / toLoginSettings mappers — browser-side Chai only.
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
  it('maps gRPC NOT_FOUND(5) → NOT_FOUND', () => {
    const e = normalizeError(ce(5));
    expect(e).to.be.instanceOf(ProviderError);
    expect(e.code).to.equal('NOT_FOUND');
  });
  it('maps PERMISSION_DENIED(7) / UNAVAILABLE(14) / DEADLINE_EXCEEDED(4)', () => {
    expect(normalizeError(ce(7)).code).to.equal('PERMISSION_DENIED');
    expect(normalizeError(ce(14)).code).to.equal('UNAVAILABLE');
    expect(normalizeError(ce(4)).code).to.equal('DEADLINE_EXCEEDED');
  });
  it('extracts failedAttempts from credentials-check details → INVALID_CREDENTIALS', () => {
    const e = normalizeError(ce(3, 'bad', [{ failedAttempts: 2 }]));
    expect(e.code).to.equal('INVALID_CREDENTIALS');
    expect(e.detail?.failedAttempts).to.equal(2);
  });
  it('falls back to UNKNOWN for unmapped codes', () => {
    expect(normalizeError(ce(99)).code).to.equal('UNKNOWN');
  });
  it('passes a ProviderError through unchanged', () => {
    const p = new ProviderError('RATE_LIMITED', 'slow down');
    expect(normalizeError(p)).to.equal(p);
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
    expect(req).to.deep.include({
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
    // Factor verifiedAt is now a Date; expiresAt/changedAt stay ISO strings.
    expect(s.factors.password?.verifiedAt).to.deep.equal(new Date('2023-11-14T22:13:20.000Z'));
    expect(s.expiresAt).to.equal('2027-01-15T08:00:00.000Z');
    expect(s.changedAt).to.equal('2023-11-14T22:13:20.000Z');
    expect(JSON.stringify(s)).not.to.include('[object Object]');
  });

  it('absent factors yield verifiedAt null (never truthy garbage)', () => {
    const s = toSession({ id: 'sess2' }, 'tok');
    expect(s.factors.password?.verifiedAt).to.be.null;
    expect(s.factors.passkey?.verifiedAt).to.be.null;
    expect(s.expiresAt).to.equal('');
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
  expect(session.factors.totp?.verifiedAt).to.deep.equal(new Date('2026-06-14T00:05:00.000Z'));
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
  expect(session.factors.otpEmail?.verifiedAt).to.deep.equal(new Date('2026-06-14T01:00:00.000Z'));
  expect(session.factors.otpSms?.verifiedAt).to.deep.equal(new Date('2026-06-14T02:00:00.000Z'));
  expect(session.factors.u2f?.verifiedAt).to.deep.equal(new Date('2026-06-14T03:00:00.000Z'));
});

it('toSession leaves unset MFA factors null (no false positives)', () => {
  const session = toSession({ id: 's', factors: { user: { id: 'u1', loginName: 'x' } } }, 'tok');
  expect(session.factors.totp?.verifiedAt ?? null).to.be.null;
  expect(session.factors.otpEmail?.verifiedAt ?? null).to.be.null;
});

it('toSession returns empty-string timestamps instead of throwing on a malformed proto Timestamp', () => {
  const bad = { not: 'a timestamp' } as unknown;
  const session = toSession(
    { id: 's', factors: { user: { id: 'u1', loginName: 'x' } }, expirationDate: bad },
    'tok'
  );
  expect(session.expiresAt).to.equal('');
});

it('toSession passes a string expiration/change date through verbatim (string-passthrough)', () => {
  const session = toSession(
    {
      id: 's',
      factors: { user: { id: 'u1', loginName: 'x' } },
      expirationDate: '2026-12-31T23:59:59.000Z',
      changeDate: 'not-an-iso-but-a-string',
    },
    'tok'
  );
  expect(session.expiresAt).to.equal('2026-12-31T23:59:59.000Z');
  // Non-ISO strings are NOT routed through Date parsing — they pass through as-is.
  expect(session.changedAt).to.equal('not-an-iso-but-a-string');
});

it('maps gRPC code 9 without verified/already to FAILED_PRECONDITION, not UNKNOWN', () => {
  const mapped = normalizeError({ code: 9, message: 'precondition: mfa not initialised' });
  expect(mapped.code).to.equal('FAILED_PRECONDITION');
});

it('still maps code 9 with "already" to ALREADY_DONE (regression guard)', () => {
  const mapped = normalizeError({ code: 9, message: 'totp already verified' });
  expect(mapped.code).to.equal('ALREADY_DONE');
});

describe('toLoginSettings defaultRedirectUri', () => {
  it('maps defaultRedirectUri when the proto carries it', () => {
    expect(
      toLoginSettings({ defaultRedirectUri: 'http://localhost:3001' }).defaultRedirectUri
    ).to.equal('http://localhost:3001');
  });
  it('is undefined when empty or absent (proto-JSON omits empty strings)', () => {
    expect(toLoginSettings({ defaultRedirectUri: '' }).defaultRedirectUri).to.be.undefined;
    expect(toLoginSettings({}).defaultRedirectUri).to.be.undefined;
  });
});

// Bug C: policy-allowed second/multi factors.
// Proto enum SecondFactorType (settings/v2): OTP(TOTP)=1, U2F=2, OTP_EMAIL=3, OTP_SMS=4.
// Proto enum MultiFactorType (settings/v2): U2F_WITH_VERIFICATION=1 → our 'passkey'.
describe('toLoginSettings secondFactors / multiFactors (Bug C policy mapping)', () => {
  it('maps proto secondFactors enum values to neutral AuthMethods via the dedicated table', () => {
    // [OTP=1, U2F=2, OTP_EMAIL=3, OTP_SMS=4] → [totp, u2f, otp_email, otp_sms]
    expect(toLoginSettings({ secondFactors: [1, 2, 3, 4] }).secondFactors).to.deep.equal([
      'totp',
      'u2f',
      'otp_email',
      'otp_sms',
    ]);
  });

  it('maps a policy that only enables TOTP', () => {
    expect(toLoginSettings({ secondFactors: [1] }).secondFactors).to.deep.equal(['totp']);
  });

  it('maps proto multiFactors (U2F_WITH_VERIFICATION=1) to passkey', () => {
    expect(toLoginSettings({ multiFactors: [1] }).multiFactors).to.deep.equal(['passkey']);
  });

  it('drops unknown/unspecified enum values rather than emitting undefined entries', () => {
    expect(toLoginSettings({ secondFactors: [0, 1, 99] }).secondFactors).to.deep.equal(['totp']);
  });

  it('leaves secondFactors/multiFactors undefined when the proto omits them (back-compat)', () => {
    const s = toLoginSettings({});
    expect(s.secondFactors).to.be.undefined;
    expect(s.multiFactors).to.be.undefined;
  });

  it('maps an empty proto array to an empty neutral array (caller treats empty as no-restriction)', () => {
    expect(toLoginSettings({ secondFactors: [] }).secondFactors).to.deep.equal([]);
  });
});

describe('toLoginSettings UX flags (hidePasswordReset / ignoreUnknownUsernames)', () => {
  it('maps both flags true from proto', () => {
    const s = toLoginSettings({ hidePasswordReset: true, ignoreUnknownUsernames: true });
    expect(s.hidePasswordReset).to.equal(true);
    expect(s.ignoreUnknownUsernames).to.equal(true);
  });
  it('defaults both flags to false when proto omits them', () => {
    const s = toLoginSettings({});
    expect(s.hidePasswordReset).to.equal(false);
    expect(s.ignoreUnknownUsernames).to.equal(false);
  });
});

describe('toLoginSettings allowDomainDiscovery', () => {
  it('maps true from proto, defaults to false when omitted', () => {
    expect(toLoginSettings({ allowDomainDiscovery: true }).allowDomainDiscovery).to.equal(true);
    expect(toLoginSettings({}).allowDomainDiscovery).to.equal(false);
  });
});

describe('toLoginSettings disableLoginWithEmail / disableLoginWithPhone', () => {
  it('maps both flags true from proto', () => {
    const s = toLoginSettings({ disableLoginWithEmail: true, disableLoginWithPhone: true });
    expect(s.disableLoginWithEmail).to.equal(true);
    expect(s.disableLoginWithPhone).to.equal(true);
  });
  it('defaults both to false when proto omits them', () => {
    const s = toLoginSettings({});
    expect(s.disableLoginWithEmail).to.equal(false);
    expect(s.disableLoginWithPhone).to.equal(false);
  });
});
