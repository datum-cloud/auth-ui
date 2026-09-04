// cypress/component/routes/signup/signup-code.cy.ts
//
// Typing the emailed code finishes signup the same way clicking the link does. The form posts
// email + code and never a userId — the terminal also renders for addresses that already have an
// account, so an id there would reveal that it exists.
import { callService } from '../../../support/node/call-service';
import { CONSTANT_TIME_FLOOR_MS } from '@/server/timing';

const URL = 'http://localhost/id/signup';

// Both 400 branches wait for the same constant-time DEADLINE, so this is a lower bound, never a
// comparison between two runs. Sleeps overshoot but do not undershoot; the small slack absorbs
// timer granularity only. Removing the padding drops either branch to single-digit ms — which is
// the point: before this, deleting the timing defence failed no test at all.
const DEADLINE_FLOOR = CONSTANT_TIME_FLOOR_MS - 10;

describe('signup action — code entry', () => {
  it('rejects a wrong code with a generic error and mints no session', () => {
    callService({
      fn: 'signupIndexAction',
      seed: { users: [{ id: 'u-1', loginName: 'coded@acme.test', displayName: 'C' }] },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: URL,
        form: { intent: 'code', email: 'coded@acme.test', code: 'WRONG1' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'INVALID_CODE');
      expect(v.response?.dataSetCookies ?? [], 'no session on a bad code').to.deep.equal([]);
    });
  });

  it('answers an unknown address exactly like a wrong code', () => {
    callService({
      fn: 'signupIndexAction',
      seed: { users: [] },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: URL,
        form: { intent: 'code', email: 'nobody@acme.test', code: 'WRONG1' },
        csrf: true,
      },
    }).then((v) => {
      // Identical to the row above: whether the address exists must not change the answer.
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'INVALID_CODE');
      // Cookie identity is part of that parity — the sibling test asserts it, so this one must
      // too, or an unknown address could start differing by the cookies it sets.
      expect(v.response?.dataSetCookies ?? [], 'no session for an unknown address').to.deep.equal(
        []
      );
    });
  });

  // REGRESSION GUARD (single-shot feature): the rejection used to return `{ error }` with no
  // `sent` key, and the route renders the check-your-email terminal on `'sent' in actionData`. So
  // a mistyped code fell through to the empty "Get started" screen — address gone, code field
  // gone, message attached to the wrong form. One typo ended the flow; the <FormError> inside the
  // code form was unreachable. The rejection must carry the TERMINAL shape.
  it('re-renders the check-your-email terminal, address intact, when the code is wrong', () => {
    callService({
      fn: 'signupIndexAction',
      seed: { users: [{ id: 'u-1', loginName: 'coded@acme.test', displayName: 'C' }] },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: URL,
        form: { intent: 'code', email: 'coded@acme.test', code: 'WRONG1' },
        csrf: true,
      },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown>;
      expect(v.response?.dataStatus).to.equal(400);
      expect(body.sent, 'terminal branch selector').to.equal(true);
      expect(body.email, 'address preserved for the retry').to.equal('coded@acme.test');
      expect(body.error).to.equal('INVALID_CODE');
    });
  });

  it('re-renders the terminal for an unknown address too — same shape, no extra signal', () => {
    callService({
      fn: 'signupIndexAction',
      seed: { users: [] },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: URL,
        form: { intent: 'code', email: 'nobody@acme.test', code: 'WRONG1' },
        csrf: true,
      },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown>;
      expect(v.response?.dataStatus).to.equal(400);
      expect(body.sent).to.equal(true);
      expect(body.email).to.equal('nobody@acme.test');
      expect(body.error).to.equal('INVALID_CODE');
    });
  });

  it('accepts the valid code with surrounding whitespace', () => {
    callService({
      fn: 'signupIndexAction',
      seed: { users: [{ id: 'u-1', loginName: 'coded@acme.test', displayName: 'C' }] },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: URL,
        form: { intent: 'code', email: 'coded@acme.test', code: '  email-u-1  ' },
        csrf: true,
      },
    }).then((v) => {
      // Proves trimming works: the valid code is email-u-1, with whitespace it must be trimmed to verify.
      // The fake provider gives every seeded user a deterministic pending code of email-<userId>.
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/setup/passkey');
    });
  });
});

// The two 400 branches do DIFFERENT amounts of work — unknown address is one round-trip,
// known-address-wrong-code is three — so latency, not the response body, is where the
// account-existence oracle survives. Padding only the unknown branch with a fixed floor does not
// close it: for any provider faster than the floor it INVERTS the channel (unknown becomes
// reliably slower). Both branches must leave at the same deadline.
describe('signup action — code entry is constant-time across account states', () => {
  it('waits for the deadline on an unknown address', () => {
    callService({
      fn: 'signupIndexAction',
      seed: { users: [] },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: URL,
        form: { intent: 'code', email: 'nobody@acme.test', code: 'WRONG1' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.elapsedMs ?? 0, 'unknown address padded to the deadline').to.be.at.least(
        DEADLINE_FLOOR
      );
    });
  });

  it('waits for the SAME deadline on a known address with a wrong code', () => {
    callService({
      fn: 'signupIndexAction',
      seed: { users: [{ id: 'u-1', loginName: 'coded@acme.test', displayName: 'C' }] },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: URL,
        form: { intent: 'code', email: 'coded@acme.test', code: 'WRONG1' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
      // This is the assertion the old floor-only padding never made — the known branch was not
      // padded at all, so it returned as fast as the provider allowed.
      expect(v.elapsedMs ?? 0, 'wrong code padded to the deadline').to.be.at.least(DEADLINE_FLOOR);
    });
  });
});

// The org is parsed on this branch and threaded into completeSignupHandoff already. An unscoped
// findUser cannot see a user outside the default org, so in a multi-org tenant that user could
// never finish signup by code. Every other findUser call site (password.service, mfa.service,
// webauthn-challenge) scopes it; this one was copied without the scope.
describe('signup action — code entry resolves the user in the request org', () => {
  it('passes the organization to findUser', () => {
    callService({
      fn: 'signupIndexAction',
      seed: { users: [{ id: 'u-1', loginName: 'coded@acme.test', displayName: 'C' }] },
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      recordCalls: ['findUser'],
      request: {
        url: URL,
        form: {
          intent: 'code',
          email: 'coded@acme.test',
          code: 'WRONG1',
          organization: 'org-77',
        },
        csrf: true,
      },
    }).then((v) => {
      const args = v.calls?.findUser ?? [];
      expect(args, 'findUser was called').to.have.length.of.at.least(1);
      expect(args[0][0]).to.equal('coded@acme.test');
      expect(args[0][1], 'org-scoped lookup').to.equal('org-77');
    });
  });
});
