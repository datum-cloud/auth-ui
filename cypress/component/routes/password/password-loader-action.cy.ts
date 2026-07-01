// cypress/component/routes/password/password-loader-action.cy.ts
//
// CY-TASK: password/new and password/change loader + action — node-bound.
// Migrated from: app/routes/password/__tests__/password-loader-action.test.ts
//
// For passwordNewAction success: uses the preSendPasswordReset compound seam in harness.ts.
// The harness calls provider.sendPasswordReset(userId, urlTemplate) which sets
// resetCodes[userId]='reset-{userId}'. The action then passes because
// setPasswordWithCode(userId, 'reset-{userId}', password) finds the matching code.
//
// For passwordChangeAction success (redirect→302): the real changePassword calls
// provider.changePasswordWithSession which requires a live session. The success path is
// demoted to E2E coverage; here we pin the error path (INVALID_INPUT from schema / session).
//
// CUT: "changePassword success (302)" — requires a live session seeded in the provider;
// demoted to E2E coverage.
import { callService } from '../../../support/node/call-service';

const NEW_BASE = 'http://localhost/id/password/new';
const CHANGE_BASE = 'http://localhost/id/password/change';

// ─── password/new — loader ────────────────────────────────────────────────────

describe('password/new loader', () => {
  it('returns csrfToken, code, userId, organization, and requestId from query params', () => {
    callService({
      fn: 'passwordNewLoader',
      request: { url: `${NEW_BASE}?code=abc&userId=u1&organization=org1&requestId=rq1` },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(typeof body.csrfToken).to.equal('string');
      expect(body.code).to.equal('abc');
      expect(body.userId).to.equal('u1');
      expect(body.organization).to.equal('org1');
      expect(body.requestId).to.equal('rq1');
    });
  });

  it('returns empty strings when optional params are absent', () => {
    callService({ fn: 'passwordNewLoader', request: { url: NEW_BASE } }).then((v) => {
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(body.code).to.equal('');
      expect(body.userId).to.equal('');
      expect(body.organization).to.be.undefined;
      expect(body.requestId).to.be.undefined;
    });
  });
});

// ─── password/new — action ────────────────────────────────────────────────────

describe('password/new action', () => {
  it('returns 400 with INVALID_INPUT when form data fails schema validation', () => {
    // Missing required code/userId — schema fails before provider interaction.
    callService({
      fn: 'passwordNewAction',
      request: { url: NEW_BASE, csrf: true, form: { password: 'pw', confirm: 'pw' } },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const status = v.response!.dataStatus ?? 200;
      expect(status).to.equal(400);
      expect((v.response!.dataBody as Record<string, unknown>).error).to.equal('INVALID_INPUT');
    });
  });

  it('redirects (302) when reset code matches (compound preSendPasswordReset seam)', () => {
    // preSendPasswordReset='u-reset' causes harness to call provider.sendPasswordReset('u-reset',…)
    // which sets resetCodes['u-reset']='reset-u-reset'. Action then succeeds with that code.
    callService({
      fn: 'passwordNewAction',
      provider: 'singleton',
      request: {
        url: NEW_BASE,
        csrf: true,
        form: {
          preSendPasswordReset: 'u-reset',
          userId: 'u-reset',
          code: 'reset-u-reset',
          password: 'SecurePass123!',
          confirm: 'SecurePass123!',
        },
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.status).to.equal(302);
    });
  });
});

// ─── password/change — loader ─────────────────────────────────────────────────

describe('password/change loader', () => {
  it('returns csrfToken, sessionId, loginName, and optional requestId', () => {
    callService({
      fn: 'passwordChangeLoader',
      request: { url: `${CHANGE_BASE}?requestId=rq2` },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(typeof body.csrfToken).to.equal('string');
      // readSessions returns [] (no cookie) → mostRecent → undefined → empty strings
      expect(body.sessionId).to.equal('');
      expect(body.loginName).to.equal('');
      expect(body.requestId).to.equal('rq2');
    });
  });

  it('returns undefined requestId when param is absent', () => {
    callService({ fn: 'passwordChangeLoader', request: { url: CHANGE_BASE } }).then((v) => {
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(body.requestId).to.be.undefined;
    });
  });
});

// ─── password/change — action ─────────────────────────────────────────────────

describe('password/change action', () => {
  it('returns 400 with INVALID_INPUT when form data fails schema validation', () => {
    // Mirrors the original vitest test (which mocked changePassword → INVALID_INPUT).
    // In the integrated cy.task stack the REAL changePassword runs: a password shorter
    // than 8 chars fails changePasswordSchema (password.min(8)) BEFORE any session lookup,
    // so the service returns { ok: false, error: 'INVALID_INPUT' } and the route renders
    // data({ error: 'INVALID_INPUT' }, { status: 400 }) — the precise security-relevant shape.
    // (A valid-password form with a missing session would instead yield SESSION_EXPIRED,
    // which is why the prior weakened assertion used `not.equal(302)`.)
    callService({
      fn: 'passwordChangeAction',
      request: {
        url: CHANGE_BASE,
        csrf: true,
        // password 'pw' (< 8 chars) → changePasswordSchema fails → INVALID_INPUT
        form: { sessionId: 's', password: 'pw', confirm: 'pw' },
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const status = v.response!.isResponse ? v.response!.status : (v.response!.dataStatus ?? 200);
      expect(status).to.equal(400);
      expect((v.response!.dataBody as Record<string, unknown>).error).to.equal('INVALID_INPUT');
    });
  });
});

// ─── password/new + change — org password-complexity policy ────────────────────
//
// Each loader fetches provider.getPasswordComplexity(resolveOrg(...)) and returns the policy; the
// action re-fetches it and drives the schema so the SERVER validation is policy-driven.

const SYMBOL_POLICY = {
  minLength: 12,
  requiresUppercase: false,
  requiresLowercase: false,
  requiresNumber: false,
  requiresSymbol: true,
};

describe('password/new loader — complexity policy', () => {
  it('returns the fetched policy AND fetches it with the ?organization from the reset link', () => {
    callService({
      fn: 'passwordNewLoader',
      passwordComplexity: SYMBOL_POLICY,
      recordCalls: ['getPasswordComplexity'],
      request: { url: `${NEW_BASE}?code=abc&userId=u1&organization=acme` },
    }).then((v) => {
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(body.passwordComplexity).to.deep.equal(SYMBOL_POLICY);
      expect(v.calls?.getPasswordComplexity?.[0]?.[0]).to.equal('acme');
    });
  });
});

describe('password/new action — policy-driven validation', () => {
  it('rejects a symbol-less password (400 INVALID_INPUT) when the policy requiresSymbol', () => {
    // preSendPasswordReset seeds a matching reset code; the symbol rule is what fails here.
    callService({
      fn: 'passwordNewAction',
      provider: 'singleton',
      passwordComplexity: SYMBOL_POLICY,
      request: {
        url: NEW_BASE,
        csrf: true,
        form: {
          preSendPasswordReset: 'u-reset',
          userId: 'u-reset',
          code: 'reset-u-reset',
          password: 'NoSymbolHere1',
          confirm: 'NoSymbolHere1',
        },
      },
    }).then((v) => {
      const status = v.response!.isResponse ? v.response!.status : (v.response!.dataStatus ?? 200);
      expect(status).to.equal(400);
      expect((v.response!.dataBody as Record<string, unknown>).error).to.equal('INVALID_INPUT');
    });
  });
});

describe('password/change loader — complexity policy', () => {
  it('fetches the policy with the active session org and returns it', () => {
    callService({
      fn: 'passwordChangeLoader',
      passwordComplexity: SYMBOL_POLICY,
      recordCalls: ['getPasswordComplexity'],
      request: {
        url: CHANGE_BASE,
        sessions: [{ id: 's1', token: 't1', loginName: 'a@acme.test', organization: 'acme' }],
      },
    }).then((v) => {
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(body.passwordComplexity).to.deep.equal(SYMBOL_POLICY);
      // Org-first: the active session's organization is threaded into getPasswordComplexity.
      expect(v.calls?.getPasswordComplexity?.[0]?.[0]).to.equal('acme');
    });
  });
});

describe('password/change action — policy-driven validation', () => {
  it('rejects a symbol-less password at schema time (INVALID_INPUT) when policy requiresSymbol', () => {
    // A ≥minLength symbol-less password isolates the symbol rule: it fails the policy schema BEFORE
    // the session lookup, so the error is INVALID_INPUT (not SESSION_EXPIRED — see control below).
    callService({
      fn: 'passwordChangeAction',
      provider: 'singleton',
      passwordComplexity: SYMBOL_POLICY,
      request: {
        url: CHANGE_BASE,
        csrf: true,
        form: { sessionId: 's', password: 'NoSymbolHere1', confirm: 'NoSymbolHere1' },
      },
    }).then((v) => {
      const status = v.response!.isResponse ? v.response!.status : (v.response!.dataStatus ?? 200);
      expect(status).to.equal(400);
      expect((v.response!.dataBody as Record<string, unknown>).error).to.equal('INVALID_INPUT');
    });
  });

  it('control: the SAME password passes the schema under the default policy (→ SESSION_EXPIRED)', () => {
    // No requiresSymbol → the password clears the schema, so the failure moves to the missing
    // session. Proves the INVALID_INPUT above came from the POLICY, not an unrelated rule.
    callService({
      fn: 'passwordChangeAction',
      provider: 'singleton',
      request: {
        url: CHANGE_BASE,
        csrf: true,
        form: { sessionId: 's', password: 'NoSymbolHere1', confirm: 'NoSymbolHere1' },
      },
    }).then((v) => {
      const status = v.response!.isResponse ? v.response!.status : (v.response!.dataStatus ?? 200);
      expect(status).to.equal(400);
      expect((v.response!.dataBody as Record<string, unknown>).error).to.equal('SESSION_EXPIRED');
    });
  });
});
