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

// Each row is one pure call → one deep.equal on the parsed methods array. The first body
// is the shape of a single-fetch (turbo-stream) loader payload: a flat array of keys and
// values.
const CASES: [label: string, body: string, expected: string[]][] = [
  [
    'chooser loader payload, stable order',
    '[{"loginName":1,"methods":2,"idps":5},"a@b.test",["password","passkey"],"tok",[]]',
    ['passkey', 'password'],
  ],
  [
    'sole-password account — the only case that gets a password step',
    '[{"methods":1},["password"]]',
    ['password'],
  ],
  ['no methods — a sole-IdP 302 has no loader data', '', []],
];

describe('extractChooserMethods', () => {
  it('reads the chooser loader payload back as the account methods in a stable order, down to a single method or none', () => {
    for (const [label, body, expected] of CASES) {
      expect(extractChooserMethods(body), label).to.deep.equal(expected);
    }
  });
});
