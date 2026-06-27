import { toRequestUrl } from '../../support/session';

describe('toRequestUrl', () => {
  it('passes absolute URLs through unchanged', () => {
    expect(toRequestUrl('https://x.test/id/login/password')).to.equal(
      'https://x.test/id/login/password'
    );
  });
  it('adds the /id basename to a bare path exactly once', () => {
    expect(toRequestUrl('/login/password')).to.equal('/id/login/password');
    expect(toRequestUrl('/id/login/password')).to.equal('/id/login/password');
  });
  it('does not corrupt a path that contains /id as a non-prefix segment', () => {
    expect(toRequestUrl('/login/idp/callback')).to.equal('/id/login/idp/callback');
  });
});
