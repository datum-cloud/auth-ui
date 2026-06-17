import type { AuthProvider } from './auth-provider';
import { FakeAuthProvider } from './fake/fake-provider';
import { ZitadelAuthProvider } from './zitadel';

// landed in Task 4

export interface SelectOpts {
  AUTH_PROVIDER?: string;
  serviceUrl?: string;
  serviceToken?: string;
}

// Process-wide fake instance keeps in-memory state across requests in test/dev-fake.
let fakeSingleton: FakeAuthProvider | undefined;

export function getAuthProvider(opts: SelectOpts = {}): AuthProvider {
  const mode = opts.AUTH_PROVIDER ?? process.env.AUTH_PROVIDER ?? 'zitadel';
  if (mode === 'fake') {
    fakeSingleton ??= new FakeAuthProvider({
      users: [
        { id: 'u1', loginName: 'alice@acme.test', displayName: 'Alice' },
        // P5 e2e seed: MFA verify-screen journey users (password + one 2nd factor each).
        { id: 'u2', loginName: 'totp-user@acme.test', displayName: 'TOTP User' },
        { id: 'u3', loginName: 'email-otp-user@acme.test', displayName: 'Email OTP User' },
        { id: 'u4', loginName: 'sms-otp-user@acme.test', displayName: 'SMS OTP User' },
        // P5 Task 9 e2e seed: passkey/u2f ceremony users.
        { id: 'u5', loginName: 'passkey-user@acme.test', displayName: 'Passkey User' },
        { id: 'u6', loginName: 'u2f-user@acme.test', displayName: 'U2F User' },
        // P5 Task 10 e2e seed: two 2nd factors → MFA picker shows.
        { id: 'u7', loginName: 'mfa2-user@acme.test', displayName: 'MFA Two-Factor User' },
        // P5 Task 11 e2e seed: no 2nd factor → enrollment screens.
        { id: 'u8', loginName: 'nofactor-user@acme.test', displayName: 'No Factor User' },
        // P5 Task 12 e2e seed: dedicated skip-only user — never receives enrolled factors from
        // other tests (which run in the same process sharing the fake singleton).
        { id: 'u9', loginName: 'mfa-skip-user@acme.test', displayName: 'MFA Skip User' },
        // P5 Task 14 e2e seed: forced-mfa user — password only, no 2nd factor enrolled.
        // Uses organization=force-org (which has forceMfa=true in settingsByOrg).
        // Dedicated user so other specs do not accidentally enroll factors into this fixture.
        { id: 'u10', loginName: 'forced-user@acme.test', displayName: 'Forced MFA User' },
        // P5 Task 14 e2e seed: account-switch journey users — password only, no 2nd factors.
        // Dedicated users so the switch spec doesn't share state with any enrollment spec.
        { id: 'u11', loginName: 'switch-a@acme.test', displayName: 'Switch User A' },
        { id: 'u12', loginName: 'switch-b@acme.test', displayName: 'Switch User B' },
        // P6 Task 9 e2e seed: LDAP user (isolated from u1-u12 to avoid enrollment state contamination)
        { id: 'u13', loginName: 'ldap-bob@acme.test', displayName: 'LDAP Bob' },
      ],
      // dev/e2e journey seed: without authMethods the /login action routes to /verify
      passwords: {
        u1: 'hunter2',
        u2: 'hunter2',
        u3: 'hunter2',
        u4: 'hunter2',
        u5: 'hunter2',
        u6: 'hunter2',
        u7: 'hunter2',
        u8: 'hunter2',
        u9: 'hunter2',
        u10: 'hunter2',
        u11: 'hunter2',
        u12: 'hunter2',
        u13: 'hunter2',
      },
      authMethods: {
        u1: ['password'],
        u2: ['password', 'totp'],
        u3: ['password', 'otp_email'],
        u4: ['password', 'otp_sms'],
        u5: ['password', 'passkey'],
        u6: ['password', 'u2f'],
        u7: ['password', 'totp', 'otp_email'],
        u8: ['password'],
        u9: ['password'],
        u10: ['password'],
        u11: ['password'],
        u12: ['password'],
        u13: ['password'],
      },
      // route-test + dev seed: x has prompt=['create'] (authorize.create-prompt.test.ts);
      // cb has prompt=[] (callback journey probe: GET /id/authorize?authRequest=cb → login → callback).
      authRequests: {
        x: { id: 'x', scopes: ['openid'], prompt: ['create'] },
        cb: { id: 'cb', scopes: ['openid'], prompt: [] },
      },
      // P4 e2e seed: active IdPs so /login renders "Continue with Google/GitHub" buttons.
      // type values must match TYPE_TO_SLUG in idp-slug.ts: GOOGLE → 'google', GITHUB → 'github'.
      // P6 Task 9: LDAP IdP — type 'LDAP' maps to slug 'ldap' (see idp-slug.ts).
      idps: [
        { id: 'idp-g', name: 'Google', type: 'GOOGLE' },
        { id: 'idp-gh', name: 'GitHub', type: 'GITHUB' },
        { id: 'idp-ldap', name: 'Corporate LDAP', type: 'LDAP' },
      ],
      // P5 Task 14 e2e seed: per-org login settings overrides.
      // 'force-org' has forceMfa=true; all other users (no org param) get the default forceMfa=false.
      // Bug C seed: 'totp-only-org' enables ONLY TOTP as a second factor in policy, so an
      // enrolled-but-policy-disabled method (e.g. otp_email) is dropped by the routing/chooser
      // intersection. Leaving secondFactors/multiFactors undefined for every other org preserves
      // the enrolled-only back-compat behavior the older specs assert.
      settingsByOrg: {
        'force-org': { forceMfa: true },
        'totp-only-org': { secondFactors: ['totp'] },
      },
      // P4 e2e seed: pre-resolved intent results so the callback route can function without
      // a real IdP round-trip.  Keyed by intentId; token is accepted as-is by the fake.
      idpIntents: {
        // intent-signin: existing linked user → decideIdpCallback returns 'sign-in'
        'intent-signin': {
          userId: 'u1',
          information: { idpId: 'idp-g', idpUserId: 'g-alice', idpUserName: 'alice' },
          draft: null,
        },
        // intent-register: new IdP user → decideIdpCallback returns 'register' → /signup prefill
        'intent-register': {
          userId: null,
          information: { idpId: 'idp-g', idpUserId: 'g-new', idpUserName: 'newbie' },
          draft: { email: 'newbie@idp.test', firstName: 'New', lastName: 'Bie' },
        },
      },
      // P6 Task 9 e2e seed: LDAP credentials for the ldap-bob@acme.test user.
      // P7: 'unlinked' mirrors real Zitadel — valid LDAP creds but no linked Zitadel
      // account (startLdapIntent returns userId=''), so direct sign-in must fail gracefully.
      ldapUsers: [
        { username: 'bob', password: 'pw', userId: 'u13' },
        { username: 'unlinked', password: 'pw', userId: '' },
      ],
      // P6 Task 6 route-test + e2e seed: device-grant user code (device.test.ts, device.cy.ts)
      // P6 Task 7 deny test seed: separate id so the deny test doesn't collide with authorize test.
      deviceAuths: [
        { userCode: 'WDJB-MJHT', id: 'dev-1', appName: 'CLI', scope: ['openid'] },
        { userCode: 'DENY-CODE', id: 'dev-deny', appName: 'CLI', scope: [] },
        // CODE-MIN-33: dedicated authorize-only id so the authorize test mutates a private id
        // and never disturbs dev-1 (used read-only by the loader test for user-code resolution).
        { userCode: 'AUTH-CODE', id: 'dev-authorize', appName: 'CLI', scope: ['openid'] },
      ],
      // P6 Task 8 route-test seed: SAML authorize branch (authorize.saml.test.ts).
      // sr-1 → redirect binding; sr-post → post binding.
      samlRequests: [
        { id: 'sr-1', clientId: 'sp', binding: 'redirect' },
        { id: 'sr-post', clientId: 'sp', binding: 'post' },
      ],
    });
    return fakeSingleton;
  }
  return new ZitadelAuthProvider({
    serviceUrl: opts.serviceUrl ?? process.env.ZITADEL_API_URL ?? '',
    serviceToken: opts.serviceToken ?? process.env.ZITADEL_SERVICE_USER_TOKEN ?? '',
  });
}
