// cypress/component/modules/auth/providers/zitadel/mappers.p2.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/mappers.p2.test.ts.
// Phase 2 normalizeError extensions + toRegisterRequest — browser-side Chai only.
//
// Final squeeze: merged into one test per genuinely distinct function, keeping the named P1
// regression guard (failedAttempts must still win over message discrimination). Code-9
// already/verified mapping is exercised in mappers.cy.ts and verify.adapter.cy.ts, so it is not
// repeated here.
// The Phase 2 normalizeError extensions (code 3 + /complexity/i → PASSWORD_COMPLEXITY, code 6 →
// ALREADY_EXISTS) and the P1 failedAttempts-wins regression guard now live in mappers.cy.ts,
// alongside the rest of the normalizeError coverage — one function, one table.
import { toRegisterRequest } from '@/modules/auth/providers/zitadel/mappers';

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

  // Phase B pin (D-B2b): the spec's "CreateUser migration" names two payload properties —
  // sendCode+urlTemplate and no password oneof — that AddHumanUser ALREADY satisfies. This
  // test is evidence, not TDD: it passed on first run, and it exists so an RPC migration
  // cannot silently change the wire payload of the most enumeration-sensitive call we make.
  it('passwordless register emits sendCode + no password oneof (Phase B pinned payload)', () => {
    const req = toRegisterRequest({
      email: 'a@b.test',
      firstName: 'A',
      lastName: 'B',
      orgId: 'org-1',
      verifyUrlTemplate: 'https://auth.test/signup/complete?code={{.Code}}',
    });
    expect(req.passwordType).to.deep.equal({ case: undefined });
    expect(req.email).to.deep.equal({
      email: 'a@b.test',
      verification: {
        case: 'sendCode',
        value: { urlTemplate: 'https://auth.test/signup/complete?code={{.Code}}' },
      },
    });
  });
});
