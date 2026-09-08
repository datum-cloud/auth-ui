// cypress/component/routes/login/email-otp-signin-hidden.cy.ts
//
// #128 hid the two "Email me a sign-in link" entry points; C10 shuts the door they led to.
// A hand-crafted POST with intent=email-link must not start an OTP ceremony while
// EMAIL_OTP_SIGNIN_ENABLED is false — hidden is not disabled until this holds.
//
// PLAN DEVIATION (harness shape, intent unchanged): the refusal is a react-router
// `data({...}, { status: 400 })`, which the harness serializes as `dataStatus` — `status` is
// set only for a real Response (the 302 this used to return). And "no ceremony session" is
// asserted via `cookieEntries` (parsed out of the `sessions` Set-Cookie the branch appends on
// success) because `createSession` is not a recordable name in Scenario['recordCalls'];
// `updateSession` — the OTP challenge dispatch — is, so it is recorded explicitly rather than
// read off an undefined `calls`.
import { callService } from '../../../support/node/call-service';

const SEED = {
  users: [{ id: 'u1', loginName: 'otp-only@acme.test' }],
  authMethods: { u1: ['otp_email'] },
};

function postEmailLink(loginName: string) {
  return callService({
    fn: 'loginAction',
    seed: SEED,
    env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
    recordCalls: ['updateSession'],
    request: {
      url: 'http://localhost/id/login',
      form: { loginName, intent: 'email-link' },
      csrf: true,
    },
  });
}

describe('/login intent=email-link — shut while OTP sign-in is hidden (C10)', () => {
  it('returns 400 and mints no ceremony session', () => {
    postEmailLink('otp-only@acme.test').then((v) => {
      expect(v.response?.dataStatus, 'status').to.equal(400);
      // The success path appends serializeSessions(...) — a planted ceremony session would
      // show up here as a parsed `sessions` cookie entry.
      expect(v.response?.cookieEntries ?? [], 'no ceremony session').to.have.length(0);
      expect(v.calls?.updateSession ?? [], 'no OTP challenge dispatched').to.have.length(0);
    });
  });

  it('is the same 400 for an unknown address (no oracle opened by the shut door)', () => {
    postEmailLink('nobody@acme.test').then((v) => {
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.cookieEntries ?? []).to.have.length(0);
    });
  });
});
