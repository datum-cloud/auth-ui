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
});

// ─────────────────────────────────────────────────────────────────────────────
// submitEmailCode — action default verify intent
// ─────────────────────────────────────────────────────────────────────────────

describe('submitEmailCode — action default verify intent', () => {
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
});
