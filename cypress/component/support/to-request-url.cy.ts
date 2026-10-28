import { chooserMethodsFromSingleFetch, toRequestUrl } from '../../support/session';

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

// Real /login/method.data payloads (i18n messages trimmed out). Single-fetch dedupes strings,
// so `methods` is an array of indices into the flat array, not the method names themselves.
const NOFACTOR_USER =
  '[{"_1":2,"_3":4,"_5":6},"root",{"_7":27},"login",{"_7":26},"routes/login/method",{"_7":8},"data",{"_9":10,"_11":-7,"_12":-7,"_13":14,"_15":16,"_17":18,"_19":20},"loginName","nofactor-user@acme.test","requestId","organization","methods",[25],"branding",{"_21":22,"_23":24},"idps",[],"csrfToken","^46ubI$YuOq64Yyw%W*E6UKC0h1f!NzH","primaryColor","#5469d4","hideLoginNameSuffix",false,"password",{"_9":10,"_11":-7,"_12":-7},{"_28":29,"_30":31,"_32":33,"_34":-7,"_35":-7,"_36":37},"locale","en","messages",{},"cspNonce","o2rYr+LlW6zh2CfMYdN3cA==","rybbitSiteId","rybbitTag","maxmindAccountId",""]';

const MIA =
  '[{"_1":2,"_3":4,"_5":6},"root",{"_7":28},"login",{"_7":27},"routes/login/method",{"_7":8},"data",{"_9":10,"_11":-7,"_12":-7,"_13":14,"_15":16,"_17":18,"_19":20},"loginName","mia@acme.test","requestId","organization","methods",[25,26],"branding",{"_21":22,"_23":24},"idps",[],"csrfToken","ktj78OfrQ9TXdSDitoPLq2k7K7C2#NB*","primaryColor","#5469d4","hideLoginNameSuffix",false,"passkey","password",{"_9":10,"_11":-7,"_12":-7},{"_29":30,"_31":32,"_33":34,"_35":-7,"_36":-7,"_37":38},"locale","en","messages",{},"cspNonce","/mXASIvQF2eVIDv16l6QeQ==","rybbitSiteId","rybbitTag","maxmindAccountId",""]';

const PASSWORD_ONLY_AS_IDP_NAME =
  '[{"_1":2},"routes/login/method",{"_3":4},"data",{"_5":6,"_7":8},"methods",[],"idps",[9],{"_10":11},"name","password"]';

const CASES: [label: string, body: string, expected: string[]][] = [
  ['password-only account, methods deduped to an index', NOFACTOR_USER, ['password']],
  ['two methods come back in served order', MIA, ['passkey', 'password']],
  ['"password" in an unrelated field is not a method', PASSWORD_ONLY_AS_IDP_NAME, []],
  ['no body — a sole-IdP 302 carries no loader data', '', []],
];

describe('chooserMethodsFromSingleFetch', () => {
  it('decodes the chooser loader payload back into the account methods in served order, or none', () => {
    cy.wrap(null).then(async () => {
      for (const [label, body, expected] of CASES) {
        expect(await chooserMethodsFromSingleFetch(body), label).to.deep.equal(expected);
      }
    });
  });
});
