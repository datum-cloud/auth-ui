// cypress/component/resources/signup/signup.service.cy.ts
//
// CY-TASK: runs node-side via cy.task('runScenario') because signup.service.ts imports
// observability.ts (logAuthEvent → console.log), which is stubbed to a no-op in the Vite
// browser bundle. Real audit must flow through the Bun harness so audit-shape assertions
// are meaningful.
//
// Classification: CY-TASK
// Source: app/resources/signup/__tests__/signup.service.test.ts
import type { Scenario, Verdict } from '../../../support/node/scenario';

const BASE_URL = 'https://auth.datum.test';
const ORIGIN = 'https://auth.datum.test';

/** Drive the scenario through the real Bun node harness and return the raw verdict.
 *  Uses the low-level cy.task('callService') rather than the callService() wrapper so that
 *  tests which examine error states (verdict.ok === false) can do so without the wrapper
 *  auto-failing the assertion. Each test checks verdict.ok / verdict.error explicitly. */
function run(s: Scenario): Cypress.Chainable<Verdict> {
  return cy.task<Verdict>('callService', s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Default-org resolution — register paths (bare flow, no organization= in URL)
//
// On a bare signup (no ?organization= in the URL) raw `organization` is undefined.
// Each register service must resolve the default org via resolveOrg and pass it as
// orgId to provider.register() (and createSession). The fake does NOT throw on
// undefined orgId, so we assert the ARG to get a genuine RED before the fix.
// RED: orgId === undefined. GREEN: orgId === 'org-default-fake'.
// ─────────────────────────────────────────────────────────────────────────────

describe('register paths — default-org resolution on bare flow (no organization)', () => {
  // Four byte-identical assertions that differed only by `fn` and the signupInput payload.
  // Kept as a labeled table so a failure still names which register path regressed.
  const BARE_FLOW: [fn: string, path: string, signupInput: Record<string, unknown>][] = [
    [
      'registerAndLinkIdp',
      '/signup',
      {
        email: 'idp-bare@test.com',
        firstName: 'Idp',
        lastName: 'Bare',
        idpIntentId: 'intent-bare',
        idpIntentToken: 'tok-bare',
        idpId: 'idp-g',
        idpUserId: 'g-bare',
        idpUserName: 'idp-bare@test.com',
      },
    ],
    [
      'registerWithPassword',
      '/signup/password',
      {
        email: 'pw-bare@test.com',
        firstName: 'Pw',
        lastName: 'Bare',
        password: 'hunter2hunter2',
        requireVerification: false,
        origin: ORIGIN,
      },
    ],
    [
      'registerEmailLinkSignup',
      '/signup',
      { email: 'emaillink-bare@test.com', firstName: 'Email', lastName: 'Bare', origin: ORIGIN },
    ],
  ];

  it('every register path calls register with the resolved default org (not undefined) when organization is omitted', () => {
    for (const [fn, path, signupInput] of BARE_FLOW) {
      run({
        fn,
        request: { url: `${BASE_URL}${path}` },
        provider: 'singleton',
        // No organization in signupInput → bare flow
        signupInput,
        recordCalls: ['register'],
      } as Scenario).then((verdict) => {
        expect(verdict.ok, `${fn}: ${verdict.error ?? ''}`).to.be.true;
        const registerCalls = (verdict.calls?.['register'] ?? []) as Array<
          [Record<string, unknown>]
        >;
        expect(registerCalls.length, `${fn}: register was called`).to.be.greaterThan(0);
        const registerInput = registerCalls[0][0];
        expect(
          registerInput.orgId,
          `${fn}: orgId must be the resolved default org, not undefined`
        ).to.equal('org-default-fake');
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerEmailLinkSignup — enumeration safety
// ─────────────────────────────────────────────────────────────────────────────

describe('registerEmailLinkSignup', () => {
  it('returns the identical sent result whether the email is new or already registered (no enumeration)', () => {
    run({
      fn: 'registerEmailLinkSignup',
      request: { url: `${BASE_URL}/signup` },
      provider: 'fresh',
      seed: { users: [] },
      signupInput: {
        email: 'new@x.com',
        firstName: 'New',
        lastName: 'User',
        origin: 'https://auth.test',
      },
    }).then((freshVerdict) => {
      expect(freshVerdict.ok, freshVerdict.error ?? '').to.be.true;
      const freshOutcome = freshVerdict.outcome as Record<string, unknown>;
      expect(freshOutcome.kind).to.eq('sent');

      run({
        fn: 'registerEmailLinkSignup',
        request: { url: `${BASE_URL}/signup` },
        provider: 'fresh',
        seed: { users: [{ id: 'u1', loginName: 'dupe@x.com', displayName: 'Dupe' }] },
        signupInput: {
          email: 'dupe@x.com',
          firstName: 'Dupe',
          lastName: 'Dupe',
          origin: 'https://auth.test',
        },
      }).then((dupeVerdict) => {
        expect(dupeVerdict.ok, dupeVerdict.error ?? '').to.be.true;
        const dupeOutcome = dupeVerdict.outcome as Record<string, unknown>;
        // Enumeration-safe: identical shape as a fresh signup.
        expect(dupeOutcome.kind).to.eq('sent');
        expect(dupeOutcome.email).to.eq('dupe@x.com');
      });
    });
  });

  // ── D-RL: resend-if-squatted, behind the per-address rate limit ─────────────
  //
  // Inherited bug: an unverified factorless account occupies its email forever — the real
  // owner's later signup hits ALREADY_EXISTS → silent drop → they can never sign up. The fix
  // resends verification when the squatting account is factorless; a REAL account (any auth
  // method) gets nothing; a rate-limited resend is silently skipped. All three return the
  // identical generic result — only the side effect varies. None of these scenarios set
  // VERIFICATION_MAIL_URL, so (CRITICAL 1 fallback, final-findings.md) they exercise the
  // Zitadel-sends branch: resendEmailCodeWithUrl (url-template delivery), not resendEmailCode
  // (returnCode delivery via sendVerificationMail) — see the "milo pipeline configured" cases
  // further down for that branch.
  describe('resend-if-squatted (D-RL)', () => {
    const squatSeed = { users: [{ id: 'u-1', loginName: 'squat@b.test', displayName: 'Sq' }] };
    const input = {
      email: 'squat@b.test',
      firstName: 'A',
      lastName: 'B',
      origin: 'https://auth.test',
    };

    it('resends verification when the existing account is unverified and factorless', () => {
      run({
        fn: 'registerEmailLinkSignup',
        request: { url: `${BASE_URL}/signup` },
        provider: 'fresh',
        seed: squatSeed,
        signupInput: input,
        recordCalls: ['resendEmailCodeWithUrl'],
      }).then((v) => {
        expect(v.ok, v.error ?? '').to.be.true;
        expect(v.outcome).to.deep.equal({ kind: 'sent', email: 'squat@b.test' });
        const sends = (v.calls?.['resendEmailCodeWithUrl'] ?? []) as Array<[string, string]>;
        expect(sends.length, 'one resend to the squatting account').to.equal(1);
        expect(sends[0][0]).to.equal('u-1');
      });
    });

    it('stays silent when the existing account is real (has an auth method)', () => {
      run({
        fn: 'registerEmailLinkSignup',
        request: { url: `${BASE_URL}/signup` },
        provider: 'fresh',
        seed: {
          users: [{ id: 'u-1', loginName: 'real@b.test', displayName: 'R' }],
          authMethods: { 'u-1': ['passkey'] },
        },
        signupInput: { ...input, email: 'real@b.test' },
        recordCalls: ['resendEmailCodeWithUrl'],
      }).then((v) => {
        expect(v.ok, v.error ?? '').to.be.true;
        expect(v.outcome).to.deep.equal({ kind: 'sent', email: 'real@b.test' });
        expect(
          (v.calls?.['resendEmailCodeWithUrl'] ?? []).length,
          'no resend to a real account'
        ).to.equal(0);
      });
    });

    it('returns the identical result when the resend is rate-limited (side effect diverges, response does not)', () => {
      // BOTH submissions run inside ONE scenario/process: every callService spawns a fresh
      // Bun process, so a cross-call test would silently reset the module-level limiter and
      // prove nothing.
      run({
        fn: 'registerEmailLinkSignupTwice',
        request: { url: `${BASE_URL}/signup` },
        provider: 'fresh',
        seed: squatSeed,
        signupInput: input,
        recordCalls: ['resendEmailCodeWithUrl'],
      }).then((v) => {
        expect(v.ok, v.error ?? '').to.be.true;
        const [first, second] = v.outcome as [unknown, unknown];
        // Exactly ONE send across both submissions — the second was rate-limited...
        expect((v.calls?.['resendEmailCodeWithUrl'] ?? []).length).to.equal(1);
        // ...and its response is indistinguishable from the first.
        expect(second).to.deep.equal(first);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerEmailLinkSignup — returnTo content (Task 6 review fix)
//
// The gap that let this regression through a full green run: nothing asserted on what URL
// sendVerificationMail actually receives. verificationReturnTo emits query params VERBATIM —
// unlike the old signupCompleteUrlTemplate's `organization={{.OrgID}}`, which was a Zitadel
// PLACEHOLDER substituted with the resolved org at send time regardless of what the caller's
// `organization` variable held. So passing the raw (possibly-undefined, on a bare no-
// ?organization= flow) `organization` param — instead of the already-resolved
// `registrationOrg` — silently dropped `organization` from the emailed link. These specs pin
// the actual returnTo query string via the harness's generic verificationMailListen capture,
// so a future re-introduction of this bug fails a test instead of shipping silently again.
// ─────────────────────────────────────────────────────────────────────────────

describe('registerEmailLinkSignup — returnTo carries organization/requestId/next=passkey', () => {
  it('returnTo carries the RESOLVED default org (not empty) on a bare flow with no ?organization=', () => {
    run({
      fn: 'registerEmailLinkSignup',
      request: { url: `${BASE_URL}/signup` },
      provider: 'fresh',
      seed: { users: [] },
      env: { VERIFICATION_MAIL_URL: 'http://127.0.0.1:58760/webhook' },
      verificationMailListen: true,
      signupInput: {
        email: 'returnto-bare@test.com',
        firstName: 'Return',
        lastName: 'To',
        // No `organization` — bare flow; resolveOrg falls back to the fake's default org
        // ('org-default-fake', pinned by the "default-org resolution" spec above).
        requestId: 'req-bare-1',
        origin: 'https://auth.test',
      },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      expect(v.verificationMailReceived?.length, 'exactly one verification mail sent').to.equal(1);
      const body = v.verificationMailReceived?.[0]?.body as { returnTo?: string };
      const returnTo = new URL(body.returnTo ?? '', 'http://placeholder');
      // RED before the fix: 'organization' is ABSENT (raw `organization` was undefined on this
      // bare flow, so verificationReturnTo's `if (params.organization)` guard dropped it).
      // GREEN: the RESOLVED default org — the SAME value provider.register() used for orgId —
      // lands in the link.
      expect(
        returnTo.searchParams.get('organization'),
        'organization must be the resolved default org, not dropped'
      ).to.equal('org-default-fake');
      expect(returnTo.searchParams.get('requestId')).to.equal('req-bare-1');
      expect(returnTo.searchParams.get('next')).to.equal('passkey');
      expect(returnTo.pathname).to.equal('/id/signup/complete');
    });
  });

  it('returnTo carries an explicit organization unchanged', () => {
    run({
      fn: 'registerEmailLinkSignup',
      request: { url: `${BASE_URL}/signup` },
      provider: 'fresh',
      seed: { users: [] },
      env: { VERIFICATION_MAIL_URL: 'http://127.0.0.1:58761/webhook' },
      verificationMailListen: true,
      signupInput: {
        email: 'returnto-org@test.com',
        firstName: 'Return',
        lastName: 'To',
        organization: 'org-explicit',
        requestId: 'req-org-1',
        origin: 'https://auth.test',
      },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      const body = v.verificationMailReceived?.[0]?.body as { returnTo?: string };
      const returnTo = new URL(body.returnTo ?? '', 'http://placeholder');
      expect(returnTo.searchParams.get('organization')).to.equal('org-explicit');
      expect(returnTo.searchParams.get('requestId')).to.equal('req-org-1');
      expect(returnTo.searchParams.get('next')).to.equal('passkey');
    });
  });

  it('resendIfSquatted (squat-fix) also carries the RESOLVED org, not the raw (undefined) one', () => {
    const squatSeed = { users: [{ id: 'u-1', loginName: 'squat-org@b.test', displayName: 'Sq' }] };
    run({
      fn: 'registerEmailLinkSignup',
      request: { url: `${BASE_URL}/signup` },
      provider: 'fresh',
      seed: squatSeed,
      env: { VERIFICATION_MAIL_URL: 'http://127.0.0.1:58762/webhook' },
      verificationMailListen: true,
      signupInput: {
        email: 'squat-org@b.test',
        firstName: 'A',
        lastName: 'B',
        // No `organization` — the same bare-flow gap, but on the ALREADY_EXISTS →
        // resendIfSquatted leg rather than the fresh-registration leg above.
        requestId: 'req-squat-1',
        origin: 'https://auth.test',
      },
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      expect(v.verificationMailReceived?.length, 'one resend mail sent').to.equal(1);
      const body = v.verificationMailReceived?.[0]?.body as { returnTo?: string };
      const returnTo = new URL(body.returnTo ?? '', 'http://placeholder');
      expect(
        returnTo.searchParams.get('organization'),
        'resendIfSquatted must also use the resolved org'
      ).to.equal('org-default-fake');
      expect(returnTo.searchParams.get('requestId')).to.equal('req-squat-1');
      expect(returnTo.searchParams.get('next')).to.equal('passkey');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1: registerWithPassword — verification skip (EMAIL_VERIFICATION=false)
//
// When requireVerification=false, provider.register() must be called with
// emailVerified:true and NO verifyUrlTemplate (Zitadel marks the email
// verified in-place, sends nothing). When requireVerification=true, the arm taken
// depends on VERIFICATION_MAIL_URL (CRITICAL 1 fallback, final-findings.md):
// unset (these cases) → register() gets verifyUrlTemplate, same as the pre-milo-pipeline
// behavior; configured (see the describe block below) → register() gets returnCode:true
// instead, and the code is delivered through sendVerificationMail rather than Zitadel's
// own SMTP.
// ─────────────────────────────────────────────────────────────────────────────

describe('registerWithPassword — verification skip (requireVerification=false)', () => {
  // The two register-arg cases stay written out rather than table-driven: they assert
  // DIFFERENT fields with different matchers (a present non-empty string vs. undefined),
  // so a shared row shape would either lose a matcher or obscure which field failed.
  it('sets emailVerified without verifyUrlTemplate when verification is off, and verifyUrlTemplate (no returnCode) when on but VERIFICATION_MAIL_URL is unset', () => {
    // RED: before the fix, register was always called with verifyUrlTemplate and no emailVerified.
    // GREEN: when requireVerification=false, emailVerified:true + no verifyUrlTemplate.
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        email: 'noverify@test.com',
        firstName: 'No',
        lastName: 'Verify',
        password: 'hunter2hunter2',
        requireVerification: false,
        origin: ORIGIN,
        organization: 'org-z',
      },
      recordCalls: ['register'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const registerCalls = (verdict.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls.length, 'no-verify: register was called once').to.equal(1);
      const arg = registerCalls[0][0];
      // Must be pre-verified — Zitadel marks email verified, sends nothing.
      expect(arg.emailVerified, 'no-verify: emailVerified must be true').to.equal(true);
      // Must NOT include verifyUrlTemplate — that would trigger Zitadel's sendCode path.
      expect(arg.verifyUrlTemplate, 'no-verify: verifyUrlTemplate must be absent').to.be.undefined;
    });

    // CRITICAL 1 fallback: no `env` set on this scenario, so VERIFICATION_MAIL_URL is unset —
    // the milo pipeline isn't configured, so register() must fall back to verifyUrlTemplate
    // (Zitadel sends) rather than requesting returnCode and delivering nowhere.
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        email: 'withverify@test.com',
        firstName: 'With',
        lastName: 'Verify',
        password: 'hunter2hunter2',
        requireVerification: true,
        origin: ORIGIN,
        organization: 'org-z',
      },
      recordCalls: ['register'],
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const registerCalls = (verdict.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls.length, 'with-verify: register was called once').to.equal(1);
      const arg = registerCalls[0][0];
      // Verification ON, VERIFICATION_MAIL_URL unset: verifyUrlTemplate requested, no
      // returnCode — Zitadel sends its own mail, exactly as it did before the milo pipeline.
      expect(
        arg.verifyUrlTemplate,
        'with-verify, no mail URL: verifyUrlTemplate must be present'
      ).to.be.a('string').and.not.be.empty;
      expect(arg.returnCode, 'with-verify, no mail URL: returnCode must be absent').to.be.undefined;
      expect(arg.emailVerified, 'with-verify: emailVerified must be absent').to.be.undefined;
    });
  });

  // Kept as its own `it()` rather than a helper invoked from the test above: assertions that
  // live in a plain function are only as alive as their call site, and orphaning that one
  // call would silently retire them — no failing test, no change in reported test count.
  const OUTCOMES: [requireVerification: boolean, expectedKind: string][] = [
    // No-verification path must redirect, never stall on "check your email".
    [false, 'redirect'],
    [true, 'sent-with-session'],
  ];

  it('resolves to a redirect when requireVerification=false and to sent-with-session when it is true', () => {
    for (const [requireVerification, expectedKind] of OUTCOMES) {
      run({
        fn: 'registerWithPassword',
        request: { url: `${BASE_URL}/signup/password` },
        provider: 'singleton',
        signupInput: {
          email: `outcome-${expectedKind}@test.com`,
          firstName: 'Outcome',
          lastName: 'Verify',
          password: 'hunter2hunter2',
          requireVerification,
          origin: ORIGIN,
        },
      }).then((verdict) => {
        expect(verdict.ok, verdict.error ?? '').to.be.true;
        const r = verdict.outcome as Record<string, unknown>;
        expect(r.kind, `requireVerification=${requireVerification}`).to.equal(expectedKind);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL 1 (final-findings.md) — VERIFICATION_MAIL_URL unset falls back to the
// Zitadel-sends path instead of silently dropping verification mail.
//
// auth-ui, zitadel-provider, and infra deploy independently, and infra wires
// VERIFICATION_MAIL_URL only in SOME environments — an auth-ui release can land before
// infra's URL is configured there. Before this fix, every requireVerification=true arm
// requested `returnCode` UNCONDITIONALLY: Zitadel sends nothing (returnCode takes priority
// over its own mail), and with the URL unset sendVerificationMail's OWN guard
// (`if (!url) return false`) never gets a code to deliver either — net effect, no mail
// anywhere, no error, nothing to alert on. A regression here is invisible by construction, so
// this pins the register()-call shape directly rather than relying on side effects.
// ─────────────────────────────────────────────────────────────────────────────

describe('CRITICAL 1 — VERIFICATION_MAIL_URL unset uses the Zitadel path, not returnCode', () => {
  it('registerEmailLinkSignup: no `env` set → register() gets verifyUrlTemplate, never returnCode, and sendVerificationMail is never reached (no resendEmailCode call either)', () => {
    run({
      fn: 'registerEmailLinkSignup',
      request: { url: `${BASE_URL}/signup` },
      provider: 'fresh',
      seed: { users: [] },
      // No `env` — VERIFICATION_MAIL_URL is unset, same as any environment infra hasn't
      // wired yet.
      signupInput: {
        email: 'fallback-emaillink@test.com',
        firstName: 'Fallback',
        lastName: 'EmailLink',
        origin: 'https://auth.test',
      },
      recordCalls: ['register', 'resendEmailCode'],
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      expect(v.outcome).to.deep.equal({ kind: 'sent', email: 'fallback-emaillink@test.com' });
      const registerCalls = (v.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls.length, 'register called once').to.equal(1);
      const arg = registerCalls[0][0];
      expect(arg.verifyUrlTemplate, 'verifyUrlTemplate must be present').to.be.a('string').and.not
        .be.empty;
      expect(arg.returnCode, 'returnCode must be absent — Zitadel must send, not us').to.be
        .undefined;
      // sendVerificationMail is only reachable from inside the returnCode branch of
      // registerEmailLinkSignup — no verification mail was posted anywhere to observe, so the
      // only reachable proof is that its code path (and resendEmailCode, its resend-side twin)
      // was never entered.
      expect((v.calls?.['resendEmailCode'] ?? []).length, 'resendEmailCode never called').to.equal(
        0
      );
    });
  });

  it('registerWithPassword: no `env` set → the requireVerification=true arm gets verifyUrlTemplate, never returnCode', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        email: 'fallback-password@test.com',
        firstName: 'Fallback',
        lastName: 'Password',
        password: 'hunter2hunter2',
        requireVerification: true,
        origin: ORIGIN,
      },
      recordCalls: ['register'],
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      const registerCalls = (v.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls.length, 'register called once').to.equal(1);
      const arg = registerCalls[0][0];
      expect(arg.verifyUrlTemplate, 'verifyUrlTemplate must be present').to.be.a('string').and.not
        .be.empty;
      expect(arg.returnCode, 'returnCode must be absent — Zitadel must send, not us').to.be
        .undefined;
    });
  });

  it('registerWithPassword: VERIFICATION_MAIL_URL configured → the requireVerification=true arm switches to returnCode + delivers via sendVerificationMail', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      env: { VERIFICATION_MAIL_URL: 'http://127.0.0.1:58770/webhook' },
      verificationMailListen: true,
      signupInput: {
        email: 'configured-password@test.com',
        firstName: 'Configured',
        lastName: 'Password',
        password: 'hunter2hunter2',
        requireVerification: true,
        origin: ORIGIN,
      },
      recordCalls: ['register'],
    }).then((v) => {
      expect(v.ok, v.error ?? '').to.be.true;
      const registerCalls = (v.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      const arg = registerCalls[0][0];
      expect(arg.returnCode, 'returnCode must be true — the milo pipeline delivers').to.equal(true);
      expect(arg.verifyUrlTemplate, 'verifyUrlTemplate must be absent').to.be.undefined;
      expect(v.verificationMailReceived?.length, 'exactly one verification mail sent').to.equal(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerWithPassword — session metadata + audit-event shape
//
// (Phase B: registerPasskeyFirst and its 'signup.requested' divergence leg were retired
// with the intent collapse; the password path's audit shape is what remains to pin.)
//   with-password  no-verify success → 'signup.created'   { userId, actor }
// ─────────────────────────────────────────────────────────────────────────────

describe('registerWithPassword — session metadata + audit-event shape', () => {
  const base = {
    email: 'dave@acme.test',
    firstName: 'Dave',
    lastName: 'Acme',
    origin: ORIGIN,
  };

  it('forwards deviceTrackingToken as MaxMind session metadata; password no-verify success emits signup.created', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        email: 'bob@acme.test',
        firstName: 'Bob',
        lastName: 'Acme',
        password: 'hunter2hunter2',
        requireVerification: false,
        origin: ORIGIN,
        deviceTrackingToken: 'tok',
      },
      inspect: { lastCreateSessionOpts: true },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const opts = (verdict.inspect as Record<string, unknown>)?.lastCreateSessionOpts as Record<
        string,
        unknown
      > | null;
      expect(opts).to.not.be.null;
      expect((opts?.metadata as Record<string, unknown>)?.['maxmind/tracking-token']).to.eq('tok');
      expect(opts?.userId).to.be.a('string').and.not.be.empty;
    });

    // Phase B: the registerPasskeyFirst leg of this divergence guard was DELETED, not
    // adapted — the passkey intent now routes through registerEmailLinkSignup, so the
    // 'signup.requested'-with-organization audit shape it pinned no longer exists.
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      signupInput: {
        ...base,
        password: 'hunter2hunter2',
        organization: 'org-z',
        requireVerification: false,
      },
    }).then((verdict) => {
      expect(verdict.ok, verdict.error ?? '').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.eq('redirect');

      // The password path uses 'signup.created', carrying userId, no organization.
      const created = verdict.audit.find((e) => e.event === 'signup.created');
      expect(created?.outcome).to.eq('success');
      expect(created).to.have.property('userId');
      expect(created).to.have.property('actor');
      expect(created).to.not.have.property('organization');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Read-after-write retry (Zitadel eventual consistency): runEnumerationSafeRegister
// previously only caught ALREADY_EXISTS from register()/persistSession() — a transient
// NOT_FOUND (the register-side mirror of the authorize-side healIfSessionDead race, e.g. a
// replica lag on a follow-up lookup) rethrew uncaught, surfacing to the route as a raw 400
// instead of completing registration. retryOnceIfNotFound retries the failed step exactly once
// before letting it propagate — this must NOT weaken the ALREADY_EXISTS enumeration-safe path
// (covered above; untouched by this change) and must NOT loop on a genuine not-found.
// ─────────────────────────────────────────────────────────────────────────────

describe('registerWithPassword — read-after-write retry on a transient NOT_FOUND', () => {
  it('register() throws NOT_FOUND once then succeeds on retry → registration completes normally (RED before the fix: verdict.ok is false, the error propagates uncaught)', () => {
    run({
      fn: 'registerWithPassword',
      request: { url: `${BASE_URL}/signup/password` },
      provider: 'singleton',
      // Harness hook (fake-provider.ts + harness.ts): fails the FIRST register() call only,
      // then delegates to the real fake register() — simulating "the write raced a lagging
      // read replica once, then resolved".
      registerErrorOnce: 'NOT_FOUND',
      signupInput: {
        email: 'retry-once@test.com',
        firstName: 'Retry',
        lastName: 'Once',
        password: 'hunter2hunter2',
        requireVerification: true,
        origin: ORIGIN,
      },
    }).then((verdict) => {
      // Before the fix this assertion is the RED signal: the uncaught NOT_FOUND propagates out
      // of registerWithPassword, the harness's try/catch sets ok:false, and verdict.error holds
      // the raw provider message — never reaching the sent-with-session outcome below.
      expect(verdict.ok, verdict.error ?? 'registration should not have thrown').to.be.true;
      const r = verdict.outcome as Record<string, unknown>;
      expect(r.kind).to.equal('sent-with-session');
      expect(r.email).to.equal('retry-once@test.com');
    });
  });
});
