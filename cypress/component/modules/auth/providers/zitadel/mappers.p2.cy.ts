// cypress/component/modules/auth/providers/zitadel/mappers.p2.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/mappers.p2.test.ts.
// Phase 2 normalizeError extensions + toRegisterRequest — browser-side Chai only.
//
// Final squeeze: merged into one test per genuinely distinct function, keeping the named P1
// regression guard (failedAttempts must still win over message discrimination). Code-9
// already/verified mapping is exercised in mappers.cy.ts and verify.adapter.cy.ts, so it is not
// repeated here.
import { normalizeError, toRegisterRequest } from '@/modules/auth/providers/zitadel/mappers';
import { ProviderError } from '@/modules/auth/types';

// minimal ConnectError shape
const ce = (code: number, message = 'boom', details: unknown[] = []) => ({
  code,
  message,
  findDetails: () => details,
});

describe('normalizeError Phase 2 extensions', () => {
  it('maps code 3 + /complexity/i to PASSWORD_COMPLEXITY, code 6 to ALREADY_EXISTS, and preserves P1: failedAttempts wins over message discrimination', () => {
    const complexity = normalizeError(ce(3, 'Password does not meet complexity requirements'));
    expect(complexity).to.be.instanceOf(ProviderError);
    expect(complexity.code).to.equal('PASSWORD_COMPLEXITY');
    expect(normalizeError(ce(6, 'user already exists')).code).to.equal('ALREADY_EXISTS');

    // P1 regression: failedAttempts still wins over message discrimination
    const e = normalizeError(ce(3, 'complexity check', [{ failedAttempts: 1 }]));
    expect(e.code).to.equal('INVALID_CREDENTIALS');
    expect(e.detail?.failedAttempts).to.equal(1);
  });
});

describe('toRegisterRequest', () => {
  it('maps minimal input to AddHumanUser shape, and includes organization/passwordType/email-verification oneofs when provided', () => {
    const minimal = toRegisterRequest({
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    expect(minimal.profile).to.deep.equal({ givenName: 'Alice', familyName: 'Smith' });
    expect(minimal.organization).to.be.undefined;
    expect(minimal.passwordType.case).to.be.undefined;

    const withOrgAndPassword = toRegisterRequest({
      email: 'bob@example.com',
      firstName: 'Bob',
      lastName: 'Jones',
      orgId: 'org-123',
      password: 'Secret123!',
    });
    expect(withOrgAndPassword.organization).to.deep.equal({
      org: { case: 'orgId', value: 'org-123' },
    });
    expect(withOrgAndPassword.passwordType).to.deep.equal({
      case: 'password',
      value: { password: 'Secret123!', changeRequired: false },
    });

    const tmpl = 'https://localhost:3000/id/verify?code={{.Code}}&userId={{.UserID}}';
    const withVerifyTemplate = toRegisterRequest({
      email: 'fox@example.com',
      firstName: 'Fox',
      lastName: 'Mulder',
      verifyUrlTemplate: tmpl,
    });
    expect(withVerifyTemplate.email).to.deep.equal({
      email: 'fox@example.com',
      verification: { case: 'sendCode', value: { urlTemplate: tmpl } },
    });
  });
});
