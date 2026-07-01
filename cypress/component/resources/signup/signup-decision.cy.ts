// cypress/component/resources/signup/signup-decision.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/signup-decision.test.ts.
// Pure decision helpers (decideSignupIdpIntent, decideAfterSignupIdentifier) → browser-side Chai only.
import {
  decideAfterSignupIdentifier,
  decideSignupIdpIntent,
} from '@/resources/signup/signup-decision';

describe('decideSignupIdpIntent', () => {
  it('redirects to the provider authUrl on success and surfaces the error code on failure', () => {
    expect(
      decideSignupIdpIntent({ ok: true, authUrl: 'https://idp.example/start?x=1' })
    ).to.deep.equal({
      kind: 'redirect',
      path: 'https://idp.example/start?x=1',
    });
    expect(decideSignupIdpIntent({ ok: false, error: 'IDP_START_FAILED' })).to.deep.equal({
      kind: 'error',
      error: 'IDP_START_FAILED',
    });
  });
});

describe('decideAfterSignupIdentifier', () => {
  it('routes to /signup/method with parsed name, threads optional org/requestId, and omits absent keys', () => {
    const withContext = decideAfterSignupIdentifier({
      email: 'alice@example.com',
      organization: 'acme',
      requestId: 'req-abc',
    });
    if (withContext.kind !== 'redirect') throw new Error('expected redirect');
    expect(withContext.path).to.equal('/signup/method');
    expect(withContext.params).to.deep.equal({
      loginName: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Alice',
      organization: 'acme',
      requestId: 'req-abc',
    });

    const withoutContext = decideAfterSignupIdentifier({ email: 'sam@example.com' });
    if (withoutContext.kind !== 'redirect') throw new Error('expected redirect');
    expect(withoutContext.params).not.to.have.property('organization');
    expect(withoutContext.params).not.to.have.property('requestId');
    expect(withoutContext.params).not.to.have.property('deviceTrackingToken');
  });
});
