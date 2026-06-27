// cypress/component/resources/signup/signup-decision.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/signup-decision.test.ts.
// Pure decision helpers (decideSignupIdpIntent, decideAfterSignupIdentifier) → browser-side Chai only.
import {
  decideAfterSignupIdentifier,
  decideSignupIdpIntent,
} from '@/resources/signup/signup-decision';

describe('decideSignupIdpIntent', () => {
  it('redirects to the provider authUrl on a successful intent', () => {
    const d = decideSignupIdpIntent({ ok: true, authUrl: 'https://idp.example/start?x=1' });
    expect(d).to.deep.equal({
      kind: 'redirect',
      path: 'https://idp.example/start?x=1',
    });
  });

  it('surfaces the service error code when the intent fails', () => {
    const d = decideSignupIdpIntent({ ok: false, error: 'IDP_START_FAILED' });
    expect(d).to.deep.equal({ kind: 'error', error: 'IDP_START_FAILED' });
  });
});

describe('decideAfterSignupIdentifier', () => {
  it('routes to /signup/method with the parsed name and identifier', () => {
    const d = decideAfterSignupIdentifier({ email: 'john.doe@example.com' });
    expect(d.kind).to.equal('redirect');
    if (d.kind !== 'redirect') throw new Error('expected redirect');
    expect(d.path).to.equal('/signup/method');
    expect(d.params).to.deep.equal({
      loginName: 'john.doe@example.com',
      firstName: 'John',
      lastName: 'Doe',
    });
  });

  it('threads organization and requestId into the params when present', () => {
    const d = decideAfterSignupIdentifier({
      email: 'alice@example.com',
      organization: 'acme',
      requestId: 'req-abc',
    });
    if (d.kind !== 'redirect') throw new Error('expected redirect');
    expect(d.params).to.deep.equal({
      loginName: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Alice',
      organization: 'acme',
      requestId: 'req-abc',
    });
  });

  it('threads deviceTrackingToken when present', () => {
    const d = decideAfterSignupIdentifier({
      email: 'user@example.com',
      deviceTrackingToken: 'mm-token-abc',
    });
    if (d.kind !== 'redirect') throw new Error('expected redirect');
    expect(d.params?.deviceTrackingToken).to.equal('mm-token-abc');
  });

  it('omits optional context keys entirely when absent (no empty-string params)', () => {
    const d = decideAfterSignupIdentifier({ email: 'sam@example.com' });
    if (d.kind !== 'redirect') throw new Error('expected redirect');
    expect(d.params).not.to.have.property('organization');
    expect(d.params).not.to.have.property('requestId');
    expect(d.params).not.to.have.property('deviceTrackingToken');
  });
});
