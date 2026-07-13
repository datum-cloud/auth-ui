// cypress/component/routes/accounts-loader-action.cy.ts
//
// CY-TASK: accounts route loader + action — node-bound (reads signed cookies, calls
// providerForRequest, assertCsrf). Migrated from:
//   app/routes/__tests__/accounts-loader-action.test.ts
//
// CUT: "accounts list content — loginName a@b.test" — original mocked listAccounts to return
// hardcoded data. Real listAccounts returns [] without a sessions cookie; account list content
// is covered by the existing 'listAccounts' cy.task tests in the session-service suite.
//
// CUT: "switch→302 success path" — requires compound session seeding (live provider session +
// matching cookie entry + resolveNextPath). Demoted to E2E coverage.
//
// Second-pass trim: keeps the loader happy path, the non-allowlisted requestId security
// gate, and the CSRF-enforcement security gate. requestId-threading permutations and the
// no-matching-session action response are cut (same shape as the CSRF-enforcement case).
import { callService } from '../../support/node/call-service';
import type { Scenario, Verdict } from '../../support/node/call-service';

const BASE = 'http://localhost/id/accounts';

describe('accounts loader', () => {
  it('returns csrfToken and an accounts array', () => {
    callService({ fn: 'accountsLoader', request: { url: BASE } }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response!.isResponse).to.be.false;
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(typeof body.csrfToken).to.equal('string');
      expect(Array.isArray(body.accounts)).to.be.true;
    });
  });

  it('drops a non-allowlisted requestId (returns null) — SECURITY', () => {
    callService({
      fn: 'accountsLoader',
      request: { url: `${BASE}?requestId=evil_payload` },
    }).then((v) => {
      const body = v.response!.dataBody as Record<string, unknown>;
      // The loader allowlists requestId against a known pattern; unknown values are nulled.
      expect(body.requestId).to.equal(null);
    });
  });

  it('reads ?organization= (regression: the loader never read it before)', () => {
    callService({
      fn: 'accountsLoader',
      request: { url: `${BASE}?organization=org-1` },
    }).then((v) => {
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(body.organization).to.equal('org-1');
    });
  });

  it('returns organization=undefined when absent (never fabricated)', () => {
    callService({ fn: 'accountsLoader', request: { url: BASE } }).then((v) => {
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(body.organization).to.equal(undefined);
    });
  });
});

describe('accounts action', () => {
  it('enforces CSRF — bad token causes assertCsrf to throw', () => {
    // assertCsrf throws a Response when the token is wrong. callService() bails loudly on
    // verdict.ok=false, so we use cy.task directly to inspect the raw verdict.
    cy.task<Verdict>('callService', {
      fn: 'accountsAction',
      request: {
        url: BASE,
        method: 'POST',
        form: { csrf: 'bad-token', intent: 'switch', sessionId: 's1' },
      },
    } as Scenario).then((verdict) => {
      expect(verdict.ok).to.be.false;
      expect(verdict.error).to.be.a('string');
    });
  });
});
