// cypress/component/resources/login/post-login-destination.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/post-login-destination.test.ts.
// Pure post-login routing logic → browser-side Chai only.
import { postLoginDestination } from '@/resources/login/post-login-destination';

const CONSOLE = 'https://auth.localtest.me:30000/ui/console';

describe('postLoginDestination', () => {
  it('admin → console (ignores the default URLs)', () => {
    expect(
      postLoginDestination({
        isAdmin: true,
        consoleUrl: CONSOLE,
        defaultRedirectUri: 'https://x',
        defaultAppUrl: 'https://y',
      })
    ).to.equal(CONSOLE);
  });
});
