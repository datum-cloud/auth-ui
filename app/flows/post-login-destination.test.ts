import { postLoginDestination, postLoginDestinationWithSource } from './post-login-destination';
import { describe, it, expect } from 'vitest';

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
    ).toBe(CONSOLE);
  });
  it('non-admin → Zitadel defaultRedirectUri when set (preferred over env)', () => {
    expect(
      postLoginDestination({
        isAdmin: false,
        consoleUrl: CONSOLE,
        defaultRedirectUri: 'https://portal.example',
        defaultAppUrl: 'http://localhost:3001',
      })
    ).toBe('https://portal.example');
  });
  it('non-admin → DEFAULT_APP_URL env when defaultRedirectUri empty/blank', () => {
    expect(
      postLoginDestination({
        isAdmin: false,
        consoleUrl: CONSOLE,
        defaultRedirectUri: '   ',
        defaultAppUrl: 'http://localhost:3001',
      })
    ).toBe('http://localhost:3001');
  });
  it('non-admin → null when neither configured', () => {
    expect(postLoginDestination({ isAdmin: false, consoleUrl: CONSOLE })).toBeNull();
  });
  it('non-admin → null when defaultRedirectUri undefined and defaultAppUrl is whitespace-only', () => {
    expect(
      postLoginDestination({
        isAdmin: false,
        consoleUrl: CONSOLE,
        defaultRedirectUri: undefined,
        defaultAppUrl: '   ',
      })
    ).toBeNull();
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
    ).toEqual({ dest: 'https://c', source: 'console' });
  });
  it('non-admin with zitadel default → zitadel', () => {
    expect(
      postLoginDestinationWithSource({
        isAdmin: false,
        consoleUrl: 'https://c',
        defaultRedirectUri: 'https://z',
      })
    ).toEqual({ dest: 'https://z', source: 'zitadel' });
  });
  it('non-admin, only env → env', () => {
    expect(
      postLoginDestinationWithSource({
        isAdmin: false,
        consoleUrl: 'https://c',
        defaultAppUrl: 'https://e',
      })
    ).toEqual({ dest: 'https://e', source: 'env' });
  });
  it('nothing configured → null/none', () => {
    expect(postLoginDestinationWithSource({ isAdmin: false, consoleUrl: 'https://c' })).toEqual({
      dest: null,
      source: 'none',
    });
  });
});
