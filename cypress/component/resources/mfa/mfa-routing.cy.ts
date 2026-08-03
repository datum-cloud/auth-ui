// cypress/component/resources/mfa/mfa-routing.cy.ts
//
// Component (no-mount) port of app/resources/mfa/__tests__/mfa-routing.test.ts.
// nextMfaStep + intersectWithPolicy are PURE (plain MfaRoutingInput in, decision out) — no
// provider, no cookie, no Request — so they run browser-side with Chai. This is the MFA routing
// security gate (which factor screen a login lands on), kept as a fast structural spec.
import type { AuthMethod, Factors, LoginSettings } from '@/modules/auth/types';
import { nextMfaStep, type MfaRoutingInput } from '@/resources/mfa/mfa-routing';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const fresh = '2026-01-01T00:00:00.000Z'; // ISO — mfaInitSkippedAt stays a string
const freshDate = new Date(fresh); // factor verifiedAt is Date | null

const settings = (over: Partial<LoginSettings> = {}): LoginSettings => ({
  allowPassword: true,
  allowRegister: true,
  allowExternalIdp: true,
  passkeysType: 'allowed',
  forceMfa: false,
  ...over,
});

const base = (over: Partial<MfaRoutingInput> = {}): MfaRoutingInput => ({
  factors: {},
  enrolledMethods: [],
  settings: settings(),
  nowMs: T0 + 100,
  loginName: 'a@acme.test',
  userVerified: false,
  mfaInitSkippedAt: null,
  context: { role: 'mfa' }, // nextMfaStep always runs in the mfa role
  ...over,
});

/** Narrow + assert a route result (Chai has no toMatchObject — assert the fields explicitly). */
function expectRoute(
  r: ReturnType<typeof nextMfaStep>,
  path: string,
  params?: Record<string, string>,
  label = ''
): void {
  expect(r.kind, `${label}: kind`).to.equal('route');
  if (r.kind !== 'route') return;
  expect(r.path, `${label}: path`).to.equal(path);
  if (params) expect(r.params, `${label}: params`).to.include(params);
}

const passkeyFresh: Factors = { passkey: { verifiedAt: freshDate } };
const totpFresh: Factors = { totp: { verifiedAt: freshDate } };

describe('nextMfaStep', () => {
  // Every input that must terminate the MFA gate.
  const DONE: [label: string, input: MfaRoutingInput][] = [
    [
      'passwordless passkey user-verified and fresh',
      base({
        factors: passkeyFresh,
        userVerified: true,
        settings: settings({ multiFactorCheckLifetimeMs: 1000 }),
      }),
    ],
    [
      'second factor (totp) already fresh',
      base({ factors: totpFresh, settings: settings({ secondFactorCheckLifetimeMs: 1000 }) }),
    ],
    ['no 2nd factor enrolled, not forced, no skip window configured', base()],
    [
      // No fresh passkey factor (password login, userVerified:false), skip window configured
      // and never skipped → WITHOUT the passkey rule this routes to /setup/mfa?force=false.
      // A passkey is passwordless-primary strong auth the user already has, so the *optional*
      // step-6 "set up MFA" nudge is confusing UX and is suppressed. This affects ONLY the
      // skippable nudge — a hard org policy (forced MFA) still applies, see the routes table.
      // NOTE: a DIFFERENT nudge from the backup-method/lockout banner on the /passkeys
      // management route (methodCount === 1). No overlap: separate file, trigger, and intent.
      'enrolled passkey suppresses the step-6 nudge (password login, skip window elapsed)',
      base({
        enrolledMethods: ['passkey'],
        settings: settings({ mfaInitSkipLifetimeMs: 1000 }),
        mfaInitSkippedAt: null,
      }),
    ],
    [
      'fresh user-verified passwordless passkey still done via step 1, even when enrolled',
      base({
        factors: passkeyFresh,
        userVerified: true,
        enrolledMethods: ['passkey'],
        settings: settings({ multiFactorCheckLifetimeMs: 1000 }),
      }),
    ],
  ];

  it('is done for every input that satisfies the MFA gate', () => {
    for (const [label, input] of DONE) {
      expect(nextMfaStep(input), label).to.deep.equal({ kind: 'done' });
    }
  });

  const directRoutes: Array<[AuthMethod, string]> = [
    ['totp', '/login/verify/authenticator'],
    ['otp_email', '/login/verify/email'],
    ['otp_sms', '/login/verify/sms'],
    ['u2f', '/login/security-key'],
  ];

  // Every input that must send the user to a specific screen.
  const ROUTES: Array<
    [label: string, input: MfaRoutingInput, path: string, params?: Record<string, string>]
  > = [
    [
      'passkey fresh but NOT user-verified falls through to enrolled-method routing',
      base({ factors: passkeyFresh, userVerified: false, enrolledMethods: ['totp'] }),
      '/login/verify/authenticator',
    ],
    [
      'the only fresh second factor is stale',
      base({
        factors: totpFresh,
        enrolledMethods: ['totp'],
        nowMs: T0 + 5000,
        settings: settings({ secondFactorCheckLifetimeMs: 1000 }),
      }),
      '/login/verify/authenticator',
    ],
    ...directRoutes.map(([method, path]): [string, MfaRoutingInput, string] => [
      `${method} is the only enrolled 2nd factor`,
      base({ enrolledMethods: [method] }),
      path,
    ]),
    [
      'more than one 2nd factor enrolled',
      base({ enrolledMethods: ['totp', 'otp_email'] }),
      '/login/mfa',
    ],
    [
      'forceMfa with no 2nd factor enrolled',
      base({ settings: settings({ forceMfa: true }) }),
      '/setup/mfa',
      { force: 'true', checkAfter: 'true' },
    ],
    [
      // 755-M10: suppressMfaSetupNudge (account-switch) must not weaken FORCED setup.
      'suppressMfaSetupNudge does NOT bypass FORCED setup (step 5)',
      base({ settings: settings({ forceMfa: true }), suppressMfaSetupNudge: true }),
      '/setup/mfa',
      { force: 'true', checkAfter: 'true' },
    ],
    [
      'an enrolled passkey does NOT bypass FORCED MFA (step 5)',
      base({
        enrolledMethods: ['passkey'],
        settings: settings({ forceMfa: true, mfaInitSkipLifetimeMs: 1000 }),
      }),
      '/setup/mfa',
      { force: 'true', checkAfter: 'true' },
    ],
    [
      'WITHOUT a passkey, no 2nd factor, not forced, skip window elapsed → skippable nudge fires',
      base({
        enrolledMethods: [],
        settings: settings({ mfaInitSkipLifetimeMs: 1000 }),
        mfaInitSkippedAt: null,
      }),
      '/setup/mfa',
      { force: 'false', checkAfter: 'true' },
    ],
  ];

  it('routes to the correct screen for every non-done input', () => {
    for (const [label, input, path, params] of ROUTES) {
      expectRoute(nextMfaStep(input), path, params, label);
    }
  });

  // ── Bug C: intersect enrolled methods with policy-allowed secondFactors ──────
  // Kept standalone (NOT folded into the routes table): these are the named lockout /
  // escape-hatch regression guards, and they must fail in isolation to be diagnosable.

  it('drops a policy-disabled enrolled factor and routes to the remaining allowed one', () => {
    expectRoute(
      nextMfaStep(
        base({
          enrolledMethods: ['otp_email', 'totp'],
          settings: settings({ secondFactors: ['totp'] }),
        })
      ),
      '/login/verify/authenticator'
    );
  });

  it('falls to setup when the only enrolled factor is policy-disabled (empty intersection escape hatch)', () => {
    expectRoute(
      nextMfaStep(
        base({
          enrolledMethods: ['otp_email'],
          settings: settings({ secondFactors: ['totp'], forceMfa: true }),
        })
      ),
      '/setup/mfa'
    );
  });
});
