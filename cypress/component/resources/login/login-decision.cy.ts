// cypress/component/resources/login/login-decision.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/login-decision.test.ts.
// decideAfterIdentifier is a pure routing function → browser-side Chai only.
import type { LoginSettings } from '@/modules/auth/types';
import { decideAfterIdentifier } from '@/resources/login/login-decision';

const PRIMARY = { role: 'primary' } as const;

describe('decideAfterIdentifier → discriminated Decision union', () => {
  it('does NOT count idp when allowExternalIdp is false (policy gate)', () => {
    const d = decideAfterIdentifier({
      methods: ['idp', 'password'],
      settings: {
        allowPassword: true,
        allowExternalIdp: false,
        passkeysType: 'not_allowed',
      } as LoginSettings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    // Only password survives the gate — but a single method now still routes to
    // the chooser, which renders exactly that one method.
    expect(d).to.deep.equal({ kind: 'redirect', path: '/login/method' });
  });

  it('a sole idp routes to /login/method, never to /sso', () => {
    const d = decideAfterIdentifier({
      methods: ['idp'],
      settings: {
        allowPassword: true,
        allowExternalIdp: true,
        passkeysType: 'not_allowed',
      } as LoginSettings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/login/method' });
  });

  // Same settings, same full-object deep.equal — only the enrolled-method list and the
  // expected destination vary.
  const ROUTING: [label: string, methods: string[], path: string][] = [
    ['two methods → the chooser', ['idp', 'password'], '/login/method'],
    ['zero methods → the invite path', [], '/verify'],
  ];

  it('routes two enrolled methods to /login/method and zero enrolled methods to /verify (invite path)', () => {
    for (const [label, methods, path] of ROUTING) {
      const d = decideAfterIdentifier({
        methods,
        settings: {
          allowPassword: true,
          allowExternalIdp: true,
          passkeysType: 'not_allowed',
        } as LoginSettings,
        emailDeliveryEnabled: true,
        context: PRIMARY,
      });
      expect(d, label).to.deep.equal({ kind: 'redirect', path });
    }
  });

  it('enrolled password but policy forbids it → PASSWORD_NOT_ALLOWED', () => {
    const d = decideAfterIdentifier({
      methods: ['password'],
      settings: {
        allowPassword: false,
        allowExternalIdp: false,
        passkeysType: 'not_allowed',
      } as LoginSettings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'error', error: 'PASSWORD_NOT_ALLOWED' });
  });
});
