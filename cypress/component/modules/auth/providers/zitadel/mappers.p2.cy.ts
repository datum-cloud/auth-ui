// cypress/component/modules/auth/providers/zitadel/mappers.p2.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/mappers.p2.test.ts.
// Phase 2 normalizeError extensions + toRegisterRequest — browser-side Chai only.
import { normalizeError, toRegisterRequest } from '@/modules/auth/providers/zitadel/mappers';
import { ProviderError } from '@/modules/auth/types';

// minimal ConnectError shape
const ce = (code: number, message = 'boom', details: unknown[] = []) => ({
  code,
  message,
  findDetails: () => details,
});

// ── normalizeError Phase 2 extensions ────────────────────────────────────────

describe('normalizeError Phase 2 extensions', () => {
  it('code 3 + /complexity/i → PASSWORD_COMPLEXITY', () => {
    const e = normalizeError(ce(3, 'Password does not meet complexity requirements'));
    expect(e).to.be.instanceOf(ProviderError);
    expect(e.code).to.equal('PASSWORD_COMPLEXITY');
  });

  it('code 3 WITHOUT complexity → still INVALID_CREDENTIALS (P1 not broken)', () => {
    const e = normalizeError(ce(3, 'invalid credentials'));
    expect(e.code).to.equal('INVALID_CREDENTIALS');
  });

  it('code 6 → ALREADY_EXISTS', () => {
    const e = normalizeError(ce(6, 'user already exists'));
    expect(e).to.be.instanceOf(ProviderError);
    expect(e.code).to.equal('ALREADY_EXISTS');
  });

  it('code 9 + /already/i → ALREADY_DONE', () => {
    const e = normalizeError(ce(9, 'email already verified'));
    expect(e).to.be.instanceOf(ProviderError);
    expect(e.code).to.equal('ALREADY_DONE');
  });

  it('code 9 + /verified/i → ALREADY_DONE', () => {
    const e = normalizeError(ce(9, 'already verified'));
    expect(e.code).to.equal('ALREADY_DONE');
  });

  // P1 regression: failedAttempts still wins over message discrimination
  it('code 3 + failedAttempts detail → INVALID_CREDENTIALS (P1 preserved)', () => {
    const e = normalizeError(ce(3, 'complexity check', [{ failedAttempts: 1 }]));
    expect(e.code).to.equal('INVALID_CREDENTIALS');
    expect(e.detail?.failedAttempts).to.equal(1);
  });
});

// ── toRegisterRequest ─────────────────────────────────────────────────────────

describe('toRegisterRequest', () => {
  it('maps minimal input (no password, no orgId) to AddHumanUser shape', () => {
    const req = toRegisterRequest({
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    expect(req.profile).to.deep.equal({ givenName: 'Alice', familyName: 'Smith' });
    expect(req.email).to.deep.equal({ email: 'alice@example.com' });
    expect(req.organization).to.be.undefined;
    expect(req.passwordType.case).to.be.undefined;
  });

  it('includes organization oneof when orgId provided', () => {
    const req = toRegisterRequest({
      email: 'bob@example.com',
      firstName: 'Bob',
      lastName: 'Jones',
      orgId: 'org-123',
    });
    expect(req.organization).to.deep.equal({ org: { case: 'orgId', value: 'org-123' } });
  });

  it('includes passwordType oneof when password provided', () => {
    const req = toRegisterRequest({
      email: 'charlie@example.com',
      firstName: 'Charlie',
      lastName: 'Brown',
      password: 'Secret123!',
    });
    expect(req.passwordType).to.deep.equal({
      case: 'password',
      value: { password: 'Secret123!', changeRequired: false },
    });
  });

  it('omits the email verification oneof when no verifyUrlTemplate is given', () => {
    const req = toRegisterRequest({
      email: 'dana@example.com',
      firstName: 'Dana',
      lastName: 'Scully',
    });
    expect(req.email).to.deep.equal({ email: 'dana@example.com' });
    expect((req.email as { verification?: unknown }).verification).to.be.undefined;
  });

  it('sets the email sendCode verification urlTemplate when verifyUrlTemplate is given', () => {
    const tmpl =
      'https://localhost:3000/id/verify?code={{.Code}}&userId={{.UserID}}&organization={{.OrgID}}';
    const req = toRegisterRequest({
      email: 'fox@example.com',
      firstName: 'Fox',
      lastName: 'Mulder',
      verifyUrlTemplate: tmpl,
    });
    expect(req.email).to.deep.equal({
      email: 'fox@example.com',
      verification: { case: 'sendCode', value: { urlTemplate: tmpl } },
    });
  });
});
