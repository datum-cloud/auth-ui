// cypress/component/routes/paths.cy.ts
//
// NO-MOUNT: pure function assertions — paths.* builders return the correct URL strings.
// No DOM, no cy.mount(), no cy.task(). Chai `expect()` only.
//
// Migrated from: app/routes/__tests__/paths.test.ts
import { paths } from '@/routes/paths';

// Every builder is a pure call → exact string, so the whole surface is one table.
// Rows are evaluated eagerly: these are pure functions with no side effects.
const CASES: [label: string, actual: string, expected: string][] = [
  ['login.index', paths.login.index(), '/login'],
  ['login.method', paths.login.method(), '/login/method'],
  ['login.password', paths.login.password(), '/login/password'],
  ['login.verify.email (bare)', paths.login.verify.email({}), '/login/verify/email'],
  [
    'login.verify.email (params URL-encoded)',
    paths.login.verify.email({ loginName: 'a@b.test', code: '123' }),
    '/login/verify/email?loginName=a%40b.test&code=123',
  ],
  ['login.verify.sms', paths.login.verify.sms({}), '/login/verify/sms'],
  [
    'login.verify.authenticator',
    paths.login.verify.authenticator({}),
    '/login/verify/authenticator',
  ],
  ['passkeys (bare)', paths.passkeys(), '/passkeys'],
  ['reauth (bare)', paths.reauth(), '/reauth'],
  [
    'reauth (method + returnTo encoded)',
    paths.reauth({ method: 'password', returnTo: '/passkeys' }),
    '/reauth?method=password&returnTo=%2Fpasskeys',
  ],
  [
    'passkeys (absolute returnTo encoded)',
    paths.passkeys({ returnTo: 'https://portal.test/settings' }),
    '/passkeys?returnTo=https%3A%2F%2Fportal.test%2Fsettings',
  ],
];

describe("paths.ts — typed builders return today's exact strings", () => {
  it('builds every login ceremony, passkey-management and reauth path, URL-encoding params', () => {
    for (const [label, actual, expected] of CASES) {
      expect(actual, label).to.equal(expected);
    }
  });
});
