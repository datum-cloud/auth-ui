// cypress/component/routes/signup/disposable-email-gate.cy.ts
//
// The disposable-address check sits on the one register path both sign-up routes share
// (registerPasskeySignup), so both are driven here.
import { callService } from '../../../support/node/call-service';

const ENV = { AUTH_EMAIL_DELIVERY_ENABLED: 'true' };
const ENFORCE = { ...ENV, SIGNUP_BLOCK_DISPOSABLE_EMAIL: 'true' };

const NAMED = { firstName: 'Ada', lastName: 'Lovelace' };

type DisposableEvent = { outcome?: string; mode?: string; domain?: string };

const disposableEvent = (v: { audit?: Array<Record<string, unknown>> }) =>
  v.audit?.find((a) => a.event === 'signup_disposable_email') as DisposableEvent | undefined;

const signupIndex = (env: Record<string, string>, email: string) =>
  callService({
    fn: 'signupIndexAction',
    env,
    recordCalls: ['register'],
    request: { url: 'http://localhost/id/signup', form: { email, ...NAMED }, csrf: true },
  });

describe('sign-up disposable-email check', () => {
  it('observe mode: records the match and lets the sign-up through', () => {
    signupIndex(ENV, 'test@mailinator.com').then((v) => {
      expect(v.calls?.register ?? [], 'observe mode still registers').to.have.length(1);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.sent).to.equal(true);
      expect(body?.email).to.equal('test@mailinator.com');

      const event = disposableEvent(v);
      expect(event, 'the match is recorded').to.exist;
      expect(event?.outcome).to.equal('failure');
      expect(event?.mode).to.equal('observe');
      expect(event?.domain).to.equal('mailinator.com');
      expect(JSON.stringify(v.audit), 'the full address never reaches the log').not.to.include(
        'test@mailinator.com'
      );
    });
  });

  it('enforce mode: refuses before register on /signup', () => {
    signupIndex(ENFORCE, 'test@mailinator.com').then((v) => {
      expect(v.calls?.register ?? [], 'no register call for a refused address').to.have.length(0);
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'DISPOSABLE_EMAIL');
      expect(disposableEvent(v)?.mode).to.equal('enforce');
      expect(disposableEvent(v)?.domain).to.equal('mailinator.com');
    });
  });

  it('enforce mode: refuses before register on /signup/method', () => {
    callService({
      fn: 'signupMethodAction',
      provider: 'singleton',
      env: ENFORCE,
      recordCalls: ['register'],
      request: {
        url: 'http://localhost/id/signup/method',
        form: { intent: 'passkey', loginName: 'test@mailinator.com', ...NAMED },
        csrf: true,
      },
    }).then((v) => {
      expect(v.calls?.register ?? []).to.have.length(0);
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'DISPOSABLE_EMAIL');
      expect(disposableEvent(v)?.mode).to.equal('enforce');
    });
  });

  it('enforce mode: an ordinary address registers as before', () => {
    signupIndex(ENFORCE, 'ada@acme.test').then((v) => {
      expect(v.calls?.register ?? []).to.have.length(1);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.sent).to.equal(true);
      expect(disposableEvent(v), 'no event for an ordinary address').to.be.undefined;
    });
  });
});
