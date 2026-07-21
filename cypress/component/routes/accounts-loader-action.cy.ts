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

  // ── issue #99: an empty picker mid-ceremony is a dead end ───────────────────────────
  // The harness has no sessions cookie, so listAccounts() returns [] for every case below.

  // A ceremony legitimately arrives in Zitadel's RAW param shape (?authRequest=/?samlRequest=)
  // as well as the threaded ?requestId=. normalizeRequestId folds all three into one value, so
  // the raw shapes must be detected as a ceremony too — otherwise the legacy
  // /ui/v2/login/accounts?authRequest=… 301 lands on an empty picker whose "Add an account"
  // link drops the ceremony entirely.
  it('empty + raw authRequest → 302 to /login?requestId=oidc_<id>', () => {
    callService({
      fn: 'accountsLoader',
      request: { url: `${BASE}?authRequest=abc` },
    }).then((v) => {
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.location).to.equal('/login?requestId=oidc_abc');
    });
  });

  it('empty + raw samlRequest → 302 to /login?requestId=saml_<id>', () => {
    callService({
      fn: 'accountsLoader',
      request: { url: `${BASE}?samlRequest=xyz` },
    }).then((v) => {
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.location).to.equal('/login?requestId=saml_xyz');
    });
  });

  it('a threaded requestId wins over a raw authRequest', () => {
    callService({
      fn: 'accountsLoader',
      request: { url: `${BASE}?requestId=oidc_threaded&authRequest=raw` },
    }).then((v) => {
      expect(v.response!.location).to.equal('/login?requestId=oidc_threaded');
    });
  });

  it('empty + ceremony requestId → 302 to /login carrying the ceremony', () => {
    callService({
      fn: 'accountsLoader',
      request: { url: `${BASE}?requestId=oidc_abc&organization=org-1` },
    }).then((v) => {
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.status).to.equal(302);
      expect(v.response!.location).to.equal('/login?requestId=oidc_abc&organization=org-1');
    });
  });

  it('empty + device user_code → 302 to /login?requestId=device_<code>', () => {
    callService({
      fn: 'accountsLoader',
      request: { url: `${BASE}?user_code=WDJB-MJHT` },
    }).then((v) => {
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.location).to.equal('/login?requestId=device_WDJB-MJHT');
    });
  });

  it('empty + malformed user_code → no redirect, no polluted target — SECURITY', () => {
    callService({
      fn: 'accountsLoader',
      request: { url: `${BASE}?user_code=${encodeURIComponent('X&loginName=admin')}` },
    }).then((v) => {
      expect(v.response!.isResponse).to.be.false;
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(body.userCode).to.equal(null);
    });
  });

  it('empty + BARE url → renders the empty state (logout probe must stay put)', () => {
    callService({ fn: 'accountsLoader', request: { url: BASE } }).then((v) => {
      expect(v.response!.isResponse).to.be.false;
    });
  });

  it('empty + non-allowlisted requestId → no redirect — SECURITY', () => {
    callService({
      fn: 'accountsLoader',
      request: { url: `${BASE}?requestId=evil_payload` },
    }).then((v) => {
      expect(v.response!.isResponse).to.be.false;
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
