// Pure decider tests for the signup branch logic extracted from signup/index.tsx.
//
// The two routing decisions the /signup identifier screen makes:
//   1. decideSignupIdpIntent — the IdP-button branch: a startIdpIntent result becomes
//      either a redirect to the provider authUrl or a surfaced error (the Decision union).
//   2. decideAfterSignupIdentifier — the email-identifier branch: parse the name from the
//      email and route to /signup/method, threading the optional context as typed params
//      (NO stringly target — it returns the shared Decision union by `kind`).
import type { Decision } from '@/resources/login/login-decision';
import {
  decideAfterSignupIdentifier,
  decideSignupIdpIntent,
} from '@/resources/signup/signup-decision';
import { describe, it, expect } from 'vitest';

describe('decideSignupIdpIntent', () => {
  it('redirects to the provider authUrl on a successful intent', () => {
    const d = decideSignupIdpIntent({ ok: true, authUrl: 'https://idp.example/start?x=1' });
    expect(d).toEqual<Decision>({
      kind: 'redirect',
      path: 'https://idp.example/start?x=1',
    });
  });

  it('surfaces the service error code when the intent fails', () => {
    const d = decideSignupIdpIntent({ ok: false, error: 'IDP_START_FAILED' });
    expect(d).toEqual<Decision>({ kind: 'error', error: 'IDP_START_FAILED' });
  });
});

describe('decideAfterSignupIdentifier', () => {
  it('routes to /signup/method with the parsed name and identifier', () => {
    const d = decideAfterSignupIdentifier({ email: 'john.doe@example.com' });
    expect(d.kind).toBe('redirect');
    if (d.kind !== 'redirect') throw new Error('expected redirect');
    expect(d.path).toBe('/signup/method');
    expect(d.params).toEqual({
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
    expect(d.params).toEqual({
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
    expect(d.params?.deviceTrackingToken).toBe('mm-token-abc');
  });

  it('omits optional context keys entirely when absent (no empty-string params)', () => {
    const d = decideAfterSignupIdentifier({ email: 'sam@example.com' });
    if (d.kind !== 'redirect') throw new Error('expected redirect');
    expect(d.params).not.toHaveProperty('organization');
    expect(d.params).not.toHaveProperty('requestId');
    expect(d.params).not.toHaveProperty('deviceTrackingToken');
  });
});
