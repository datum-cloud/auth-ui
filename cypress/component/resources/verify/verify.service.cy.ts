// cypress/component/resources/verify/verify.service.cy.ts
//
// CY-TASK: runs node-side via cy.task('runScenario') because verify.service.ts has the
// @vitest-environment node marker and tests security-critical session-ownership gates.
// The session-ownership gate (dispatchEmailCode) requires provider.getSession node-side
// so the real fake's ownership check (session.user.id === userId) works. The original
// used vi.spyOn which is impossible in the Cypress browser bundle.
//
// Classification: CY-TASK
// Source: app/resources/verify/__tests__/verify.service.test.ts
import type { Scenario, Verdict } from '../../../support/node/scenario';

const TRUSTED_ORIGIN = 'https://auth.datum.net';
const BASE_URL = 'https://auth.datum.test';

/** Drive the scenario through the real Bun node harness and return the raw verdict.
 *  Uses cy.task('callService') directly so that tests examining error states can check
 *  verdict.ok explicitly without the callService() wrapper auto-failing them. */
function run(s: Scenario): Cypress.Chainable<Verdict> {
  return cy.task<Verdict>('callService', s);
}

// Helper: base scenario with a seeded live session (user=self-1 owns the session).
function sessionOwnerScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    fn: 'dispatchEmailCode',
    request: { url: `${BASE_URL}/verify` },
    provider: 'singleton',
    liveSessions: [
      { id: 's1', token: 't1', user: { id: 'self-1', loginName: 'test@example.com' } },
    ],
    verifyEmailInput: {
      userId: 'self-1',
      origin: TRUSTED_ORIGIN,
      invite: false,
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatchEmailCode — session-ownership gate
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatchEmailCode — session-ownership gate on ?send=true', () => {
  it('does NOT send an email code when the session user does not match the userId query', () => {
    // Seed a live session whose user.id is the attacker, NOT the victim being targeted.
    run({
      fn: 'dispatchEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'singleton',
      liveSessions: [
        { id: 's1', token: 't1', user: { id: 'attacker-1', loginName: 'atk@example.com' } },
      ],
      verifyEmailInput: {
        userId: 'victim-999', // different from attacker-1's id
        origin: TRUSTED_ORIGIN,
        invite: false,
      },
      recordCalls: ['sendEmailCode'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const calls = verdict.calls as Record<string, unknown[][]>;
      // Gate must block the send — sendEmailCode must NOT be called.
      expect(calls['sendEmailCode']).to.have.length(0);
    });
  });

  it('sends an email code when the session user matches the userId query', () => {
    run({
      ...sessionOwnerScenario(),
      recordCalls: ['sendEmailCode'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const calls = verdict.calls as Record<string, unknown[][]>;
      // Ownership verified — sendEmailCode called once.
      expect(calls['sendEmailCode']).to.have.length(1);
    });
  });

  it('does NOT send when there is no active session (fail closed)', () => {
    run({
      fn: 'dispatchEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'singleton',
      // NO liveSessions → harness passes session=undefined to dispatchEmailCode
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
      },
      recordCalls: ['sendEmailCode'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const calls = verdict.calls as Record<string, unknown[][]>;
      expect(calls['sendEmailCode']).to.have.length(0);
    });
  });

  it('builds the verify link with raw braces (no percent-encoding) from the trusted origin', () => {
    run({
      ...sessionOwnerScenario({
        verifyEmailInput: {
          userId: 'self-1',
          origin: TRUSTED_ORIGIN,
          invite: false,
          requestId: 'oidc_42',
        },
      }),
      recordCalls: ['sendEmailCode'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const calls = verdict.calls as Record<string, unknown[][]>;
      expect(calls['sendEmailCode']).to.have.length(1);
      const [, urlTemplate] = calls['sendEmailCode'][0] as [string, string];
      // Verify URL template must start with the trusted origin + verify path
      expect(urlTemplate).to.include(`${TRUSTED_ORIGIN}/id/verify?`);
      // Raw Zitadel template variables — must NOT be percent-encoded
      expect(urlTemplate).to.include('code={{.Code}}');
      expect(urlTemplate).to.not.include('%7B');
      // RequestId must be threaded into the template
      expect(urlTemplate).to.include('&requestId=oidc_42');
    });
  });

  it('uses resendEmailCode (not sendEmailCode) for invite codes', () => {
    run({
      ...sessionOwnerScenario({
        verifyEmailInput: {
          userId: 'self-1',
          origin: TRUSTED_ORIGIN,
          invite: true,
        },
      }),
      recordCalls: ['sendEmailCode', 'resendEmailCode'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const calls = verdict.calls as Record<string, unknown[][]>;
      // Invite path uses resendEmailCode; sendEmailCode must NOT be called.
      expect(calls['sendEmailCode']).to.have.length(0);
      expect(calls['resendEmailCode']).to.have.length(1);
    });
  });

  it('swallows ALREADY_DONE from the provider (already verified) without throwing', () => {
    run({
      ...sessionOwnerScenario(),
      // Script sendEmailCode to throw ALREADY_DONE (user already verified).
      failSendEmailCode: 'ALREADY_DONE',
    }).then((verdict) => {
      // ALREADY_DONE is swallowed — the function resolves normally (outcome=undefined).
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      expect(verdict.error).to.be.undefined;
    });
  });

  it('re-throws non-ALREADY_DONE provider errors', () => {
    run({
      ...sessionOwnerScenario(),
      failSendEmailCode: 'UNKNOWN',
    }).then((verdict) => {
      // The harness catches the re-throw and populates verdict.error.
      expect(verdict.ok).to.be.false;
      expect(verdict.error).to.be.a('string').and.include('UNKNOWN');
    });
  });

  it('does NOT send when getSession fails (fail closed)', () => {
    run({
      ...sessionOwnerScenario(),
      // Script getSession to throw.
      failGetSession: true,
      recordCalls: ['sendEmailCode'],
    }).then((verdict) => {
      // fail-closed: the gate swallows the getSession error and returns without sending.
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const calls = verdict.calls as Record<string, unknown[][]>;
      expect(calls['sendEmailCode']).to.have.length(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resendEmailCode — action intent=resend
// ─────────────────────────────────────────────────────────────────────────────

describe('resendEmailCode — action intent=resend', () => {
  it('returns CODE_SENT on a successful resend', () => {
    run({
      fn: 'resendEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'singleton',
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
      },
      recordCalls: ['resendEmailCode'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.ok).to.be.true;
      expect(r.notice).to.eq('CODE_SENT');
      // The URL template must be correct
      const calls = verdict.calls as Record<string, unknown[][]>;
      expect(calls['resendEmailCode']).to.have.length(1);
      const [, urlTemplate] = calls['resendEmailCode'][0] as [string, string];
      expect(urlTemplate).to.include(`${TRUSTED_ORIGIN}/id/verify?`);
      expect(urlTemplate).to.include('code={{.Code}}');
      expect(urlTemplate).to.not.include('%7B');
    });
  });

  it('returns ALREADY_VERIFIED when the provider reports ALREADY_DONE', () => {
    run({
      fn: 'resendEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'singleton',
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
      },
      failResendEmailCode: 'ALREADY_DONE',
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.ok).to.be.true;
      expect(r.notice).to.eq('ALREADY_VERIFIED');
    });
  });

  it('re-throws non-ALREADY_DONE provider errors', () => {
    run({
      fn: 'resendEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'singleton',
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
      },
      failResendEmailCode: 'UNKNOWN',
    }).then((verdict) => {
      expect(verdict.ok).to.be.false;
      expect(verdict.error).to.be.a('string').and.include('UNKNOWN');
    });
  });

  it('returns INVALID_INPUT and never calls the provider when userId is empty', () => {
    run({
      fn: 'resendEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'singleton',
      verifyEmailInput: {
        userId: '', // empty → INVALID_INPUT gate
        origin: TRUSTED_ORIGIN,
        invite: false,
      },
      recordCalls: ['resendEmailCode'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.ok).to.be.false;
      expect(r.error).to.eq('INVALID_INPUT');
      // Provider must never be called for an empty userId.
      const calls = verdict.calls as Record<string, unknown[][]>;
      expect(calls['resendEmailCode']).to.have.length(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// submitEmailCode — action default verify intent
// ─────────────────────────────────────────────────────────────────────────────

describe('submitEmailCode — action default verify intent', () => {
  it('returns INVALID_INPUT when the form fails schema validation (missing code)', () => {
    // verifyCodeSchema requires code.min(1) — omitting it yields INVALID_INPUT.
    run({
      fn: 'submitEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'singleton',
      // Only userId, no code → schema validation fails
      verifyEmailInput: { userId: 'self-1', origin: TRUSTED_ORIGIN, invite: false },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.ok).to.be.false;
      expect(r.error).to.eq('INVALID_INPUT');
    });
  });

  it('verifies the email and redirects to /authorize when active session + requestId are present', () => {
    run({
      fn: 'submitEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'fresh',
      seed: { users: [{ id: 'self-1', loginName: 'test@example.com', displayName: 'Test' }] },
      // Seed the email code so verifyEmail succeeds (constructor sets emailCodes.set(id, `email-${id}`))
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
        code: 'email-self-1',
        requestId: 'oidc_99',
        isSessionActive: true,
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.ok).to.be.true;
      expect(r.target).to.eq('/authorize?requestId=oidc_99');
    });
  });

  it('redirects to /signed-in when active session is present without a requestId', () => {
    run({
      fn: 'submitEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'fresh',
      seed: { users: [{ id: 'self-1', loginName: 'test@example.com', displayName: 'Test' }] },
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
        code: 'email-self-1',
        isSessionActive: true,
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.ok).to.be.true;
      expect(r.target).to.eq('/signed-in');
    });
  });

  it('redirects to /verify/success carrying loginName/requestId/organization when no active session', () => {
    run({
      fn: 'submitEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'fresh',
      seed: { users: [{ id: 'self-1', loginName: 'alice@acme.test', displayName: 'Alice' }] },
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
        code: 'email-self-1',
        loginName: 'alice@acme.test',
        requestId: 'oidc_7',
        organization: 'org-1',
        isSessionActive: false,
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.ok).to.be.true;
      expect(r.target as string).to.include('/verify/success?');
      expect(r.target as string).to.include('loginName=alice%40acme.test');
      expect(r.target as string).to.include('requestId=oidc_7');
      expect(r.target as string).to.include('organization=org-1');
    });
  });

  it('uses verifyInvite (not verifyEmail directly) for invite flows', () => {
    run({
      fn: 'submitEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'fresh',
      seed: { users: [{ id: 'self-1', loginName: 'test@example.com', displayName: 'Test' }] },
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: true,
        code: 'email-self-1', // the fake's verifyInvite delegates to verifyEmail
        isSessionActive: false,
      },
      recordCalls: ['verifyInvite'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.ok).to.be.true;
      const calls = verdict.calls as Record<string, unknown[][]>;
      // submitEmailCode must route to verifyInvite for invite=true.
      // We record only verifyInvite (not verifyEmail) because the fake's verifyInvite internally
      // delegates to verifyEmail — recording verifyEmail would count that internal delegation.
      expect(calls['verifyInvite']).to.have.length(1);
    });
  });

  it('maps provider INVALID_CREDENTIALS (bad/expired code) to a typed error', () => {
    run({
      fn: 'submitEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'singleton',
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
        code: '123456',
        isSessionActive: false,
      },
      failVerifyEmail: 'INVALID_CREDENTIALS',
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.ok).to.be.false;
      expect(r.error).to.eq('INVALID_CREDENTIALS');
    });
  });

  it('re-throws non-mapped provider errors', () => {
    run({
      fn: 'submitEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'singleton',
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
        code: '123456',
        isSessionActive: false,
      },
      failVerifyEmail: 'UNKNOWN',
    }).then((verdict) => {
      expect(verdict.ok).to.be.false;
      expect(verdict.error).to.be.a('string').and.include('UNKNOWN');
    });
  });

  it("emits 'email.verified' audit on successful email verification", () => {
    run({
      fn: 'submitEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'fresh',
      seed: { users: [{ id: 'self-1', loginName: 'test@example.com', displayName: 'Test' }] },
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: false,
        code: 'email-self-1',
        isSessionActive: false,
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const verified = verdict.audit.find((e) => e.event === 'email.verified');
      expect(verified?.outcome).to.eq('success');
      expect(verified?.userId).to.eq('self-1');
    });
  });

  it("emits 'invite.verified' audit on successful invite verification", () => {
    run({
      fn: 'submitEmailCode',
      request: { url: `${BASE_URL}/verify` },
      provider: 'fresh',
      seed: { users: [{ id: 'self-1', loginName: 'test@example.com', displayName: 'Test' }] },
      verifyEmailInput: {
        userId: 'self-1',
        origin: TRUSTED_ORIGIN,
        invite: true,
        code: 'email-self-1',
        isSessionActive: false,
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const verified = verdict.audit.find((e) => e.event === 'invite.verified');
      expect(verified?.outcome).to.eq('success');
      expect(verified?.userId).to.eq('self-1');
    });
  });
});
