import { toRequestUrl } from '../../support/session';

describe('toRequestUrl', () => {
  it('passes absolute URLs through unchanged, adds the /id basename exactly once, and does not corrupt a path with /id as a non-prefix segment', () => {
    expect(toRequestUrl('https://x.test/id/login/password')).to.equal(
      'https://x.test/id/login/password'
    );
    expect(toRequestUrl('/login/password')).to.equal('/id/login/password');
    expect(toRequestUrl('/id/login/password')).to.equal('/id/login/password');
    expect(toRequestUrl('/login/idp/callback')).to.equal('/id/login/idp/callback');
  });
});
