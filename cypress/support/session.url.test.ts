import { toRequestUrl } from './session';
import { describe, it, expect } from 'vitest';

describe('toRequestUrl', () => {
  it('passes absolute URLs through unchanged', () => {
    expect(toRequestUrl('https://x.test/id/login/password')).toBe(
      'https://x.test/id/login/password'
    );
  });
  it('adds the /id basename to a bare path exactly once', () => {
    expect(toRequestUrl('/login/password')).toBe('/id/login/password');
    expect(toRequestUrl('/id/login/password')).toBe('/id/login/password');
  });
  it('does not corrupt a path that contains /id as a non-prefix segment', () => {
    expect(toRequestUrl('/login/idp/callback')).toBe('/id/login/idp/callback');
  });
});
