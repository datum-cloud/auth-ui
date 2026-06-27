// cypress/component/resources/login/post-login-destination.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/post-login-destination.test.ts.
// Pure post-login routing logic → browser-side Chai only.
import {
  postLoginDestination,
  postLoginDestinationWithSource,
} from '@/resources/login/post-login-destination';

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

  it('non-admin → Zitadel defaultRedirectUri when set (preferred over env)', () => {
    expect(
      postLoginDestination({
        isAdmin: false,
        consoleUrl: CONSOLE,
        defaultRedirectUri: 'https://portal.example',
        defaultAppUrl: 'http://localhost:3001',
      })
    ).to.equal('https://portal.example');
  });

  it('non-admin → DEFAULT_APP_URL env when defaultRedirectUri empty/blank', () => {
    expect(
      postLoginDestination({
        isAdmin: false,
        consoleUrl: CONSOLE,
        defaultRedirectUri: '   ',
        defaultAppUrl: 'http://localhost:3001',
      })
    ).to.equal('http://localhost:3001');
  });

  it('non-admin → null when neither configured', () => {
    expect(postLoginDestination({ isAdmin: false, consoleUrl: CONSOLE })).to.equal(null);
  });

  it('non-admin → null when defaultRedirectUri undefined and defaultAppUrl is whitespace-only', () => {
    expect(
      postLoginDestination({
        isAdmin: false,
        consoleUrl: CONSOLE,
        defaultRedirectUri: undefined,
        defaultAppUrl: '   ',
      })
    ).to.equal(null);
  });
});

describe('postLoginDestinationWithSource', () => {
  it('admin → console', () => {
    expect(
      postLoginDestinationWithSource({
        isAdmin: true,
        consoleUrl: 'https://c',
        defaultAppUrl: 'https://e',
      })
    ).to.deep.equal({ dest: 'https://c', source: 'console' });
  });

  it('non-admin with zitadel default → zitadel', () => {
    expect(
      postLoginDestinationWithSource({
        isAdmin: false,
        consoleUrl: 'https://c',
        defaultRedirectUri: 'https://z',
      })
    ).to.deep.equal({ dest: 'https://z', source: 'zitadel' });
  });

  it('non-admin, only env → env', () => {
    expect(
      postLoginDestinationWithSource({
        isAdmin: false,
        consoleUrl: 'https://c',
        defaultAppUrl: 'https://e',
      })
    ).to.deep.equal({ dest: 'https://e', source: 'env' });
  });

  it('nothing configured → null/none', () => {
    expect(
      postLoginDestinationWithSource({ isAdmin: false, consoleUrl: 'https://c' })
    ).to.deep.equal({ dest: null, source: 'none' });
  });
});
