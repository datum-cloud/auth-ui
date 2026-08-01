import { extractChooserMethods, toRequestUrl } from '../../support/session';

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

describe('extractChooserMethods', () => {
  it('reads the chooser loader payload back as the account methods, in a stable order', () => {
    // Shape of a single-fetch (turbo-stream) loader payload: a flat array of keys and values.
    const body =
      '[{"loginName":1,"methods":2,"idps":5},"a@b.test",["password","passkey"],"tok",[]]';
    expect(extractChooserMethods(body)).to.deep.equal(['passkey', 'password']);
  });

  it('reports a single method for the sole-password account — the only case that gets a password step', () => {
    expect(extractChooserMethods('[{"methods":1},["password"]]')).to.deep.equal(['password']);
  });

  it('reports nothing for a body carrying no methods (a sole-IdP 302 has no loader data)', () => {
    expect(extractChooserMethods('')).to.deep.equal([]);
  });
});
