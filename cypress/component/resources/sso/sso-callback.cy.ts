// cypress/component/resources/sso/sso-callback.cy.ts
//
// cy.task node-spec port of app/resources/sso/__tests__/callback.service.test.ts (+ the
// processIdpCallback getUser-drop cases from sso-perf-returnto.test.ts). processIdpCallback reads
// the signed `sessions` cookie, mints/reads the fingerprintId cookie, emits REAL logAuthEvent audit,
// and writes the signed last-used-login cookie — all node-bound. SECURITY-CRITICAL: identity
// matching, the 755-J1 link-failure reason mapping, and the PII-safe account-link audit.
import { callService, type AuditEvent, type Scenario } from '../../../support/node/call-service';

const REGISTER_INTENT_VERIFIED: Scenario['idpIntent'] = {
  userId: null,
  information: { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'you@gmail.com' },
  draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
};

function hasAudit(audit: AuditEvent[], event: string, outcome: string): boolean {
  return audit.some((e) => e.event === event && e.outcome === outcome);
}
function findLink(audit: AuditEvent[]): AuditEvent[] {
  return audit.filter((e) => e.event === 'idp.link');
}
const isSignedInOrAuthorize = (loc: string) => loc === '/signed-in' || loc.startsWith('/authorize');
const CB = (provider = 'google', query = 'id=intent-1&token=tok-1') =>
  `https://auth.localtest.me/sso/${provider}/callback?${query}`;

// Every scripted-failure path that must land on the SSO error page with a SPECIFIC, actionable
// reason rather than the generic signin_failed. Merged from four separate describes that each
// drove processIdpCallback with one scripted error and asserted the same result shape.
//
// NOT merged here: the same-email collision hard error (reason=account-exists) — that one also
// asserts the no-session-cookie and PII-safe-audit properties of the default fail-closed
// posture, and stays standalone below.
const AUTOLINK_INTENT: Scenario['idpIntent'] = {
  userId: null,
  information: { idpId: 'idp-g', idpUserId: 'g-al', idpUserName: 'you@gmail.com' },
  draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
};
const AUTOLINK_SEED = {
  users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }],
};

interface ErrorCase {
  label: string;
  scenario: Scenario;
  /** Substrings that MUST appear in the redirect Location. */
  includes: string[];
  /** Substrings that must NOT appear — the point of the 755-J1/K1 reason mapping. */
  excludes: string[];
  /** Audit event that must carry a failure outcome. */
  auditFailure?: string;
  /** Needle that must NOT appear in Set-Cookie (no session may be minted). */
  noCookieNeedle?: string;
}

const ERROR_CASES: ErrorCase[] = [
  {
    label: 'retrieveIdpIntent throws',
    scenario: {
      fn: 'processIdpCallback',
      provider: 'singleton',
      slug: 'google',
      idpIntentError: 'UNAVAILABLE',
      request: { url: CB('google', 'id=intent1&token=tok') },
    },
    includes: ['/sso/google/error'],
    excludes: [],
    auditFailure: 'idp.signin',
  },
  {
    // 755-J1: ALREADY_EXISTS on the link must stay distinguishable from a generic failure.
    label: '755-J1 link ALREADY_EXISTS → identity-linked-elsewhere',
    scenario: {
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy auto-link path under test (Step-5 catch)
      seed: AUTOLINK_SEED,
      idpIntent: AUTOLINK_INTENT,
      addIdpLinkError: 'ALREADY_EXISTS',
      request: { url: CB() },
    },
    includes: ['/sso/google/error', 'reason=identity-linked-elsewhere'],
    excludes: ['reason=signin_failed'],
    auditFailure: 'idp.link',
    noCookieNeedle: 'sess-',
  },
  {
    label: '755-J1 link non-ALREADY_EXISTS → providerErrorCode (signin_failed)',
    scenario: {
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy auto-link path under test (Step-5 catch)
      seed: AUTOLINK_SEED,
      idpIntent: AUTOLINK_INTENT,
      addIdpLinkError: 'FAILED_PRECONDITION',
      request: { url: CB() },
    },
    includes: ['/sso/google/error', 'reason=signin_failed'],
    excludes: ['identity-linked-elsewhere'],
  },
  {
    // 755-K1 real-world bug: findUser's same-email pre-check only matches Zitadel's exact
    // loginName, so an org whose loginName differs from the raw email (the Zitadel
    // domain-suffix default) never finds a real collision — decideIdpCallback falls through to
    // auto-create believing the user is new, and Zitadel's own addHumanUser then correctly
    // rejects the duplicate with ALREADY_EXISTS. The auto-create catch must not collapse that
    // into the actionable-less signin_failed, the way the sibling `link` branch already avoids.
    label: '755-K1 auto-create ALREADY_EXISTS → registration-conflict',
    scenario: {
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {}, // no existing users — decision routes to auto-create, mirroring the miss
      idpIntent: REGISTER_INTENT_VERIFIED,
      registerError: 'ALREADY_EXISTS',
      request: { url: CB() },
    },
    includes: ['/sso/google/error', 'reason=registration-conflict'],
    excludes: ['reason=signin_failed'],
    auditFailure: 'idp.register',
  },
];

describe('processIdpCallback — scripted-failure reason mapping', () => {
  it('maps every scripted failure to a specific actionable reason', () => {
    for (const c of ERROR_CASES) {
      callService(c.scenario).then((v) => {
        expect(v.response?.status, `${c.label}: status`).to.equal(302);
        const loc = v.response?.location ?? '';
        for (const needle of c.includes) {
          expect(loc, `${c.label}: location includes ${needle}`).to.include(needle);
        }
        for (const needle of c.excludes) {
          expect(loc, `${c.label}: location excludes ${needle}`).to.not.include(needle);
        }
        if (c.auditFailure) {
          expect(
            hasAudit(v.audit, c.auditFailure, 'failure'),
            `${c.label}: ${c.auditFailure} failure audited`
          ).to.equal(true);
        }
        if (c.noCookieNeedle) {
          expect(v.response?.setCookie ?? '', `${c.label}: no session minted`).to.not.include(
            c.noCookieNeedle
          );
        }
      });
    }
  });
});

describe('processIdpCallback — existing same-email account auto-link (Task-3)', () => {
  // Both success paths land the same way (302 → signed-in/authorize with a session cookie);
  // they differ only in whether an existing same-email account is seeded.
  it('signs in with a session cookie on both the auto-link and auto-create paths', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy behavior under test
      seed: { users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB() },
    }).then((v) => {
      expect(v.response?.status, 'auto-link: status').to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? ''), 'auto-link: signed in').to.equal(
        true
      );
      expect(v.response?.setCookie ?? '', 'auto-link: session minted').to.include('sessions=');
    });

    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB() },
      inspect: { findUser: ['you@gmail.com'] },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? '')).to.equal(true);
      expect(v.response?.setCookie ?? '').to.include('sessions=');
      const found = (v.inspect?.findUser as Record<string, { emailVerified: boolean } | null>)[
        'you@gmail.com'
      ];
      expect(found).to.not.equal(null);
      expect(found?.emailVerified).to.equal(true);
    });
  });

  // Both the auto-CREATE path (fresh identity) and the SIGN-IN path (an ALREADY-linked IdP
  // identity, intent.userId present) must forward deviceTrackingToken to the resulting
  // session's metadata — the sign-in path via signInWithIdpIntent's own deviceTrackingToken
  // opt. Merged from two describes that asserted the same property on the two branches.
  it('forwards deviceTrackingToken to the session on both the auto-create and sign-in paths', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB('google', 'id=intent-1&token=tok-1&deviceTrackingToken=mm-idp-token-1') },
      inspect: { lastCreateSessionOpts: true },
    })
      .then((v) => {
        expect(v.response?.status, 'auto-create: status').to.equal(302);
        expect(
          isSignedInOrAuthorize(v.response?.location ?? ''),
          'auto-create: signed in'
        ).to.equal(true);
        const opts = v.inspect?.lastCreateSessionOpts as {
          metadata?: Record<string, unknown>;
        } | null;
        expect(opts?.metadata?.['maxmind/tracking-token'], 'auto-create: token forwarded').to.equal(
          'mm-idp-token-1'
        );

        return callService({
          fn: 'processIdpCallback',
          slug: 'google',
          seed: {
            users: [{ id: 'u-signin', loginName: 'linked@idp.test', displayName: 'Linked' }],
          },
          idpIntent: {
            userId: 'u-signin',
            information: { idpId: 'idp-g', idpUserId: 'g-linked', idpUserName: 'linked@idp.test' },
            draft: null,
          },
          request: {
            url: CB('google', 'id=intent-si&token=tok-si&deviceTrackingToken=mm-idp-token-signin'),
          },
          inspect: { lastCreateSessionOpts: true },
        });
      })
      .then((v) => {
        expect(v.response?.status, 'sign-in: status').to.equal(302);
        const opts = v.inspect?.lastCreateSessionOpts as {
          metadata?: Record<string, unknown>;
        } | null;
        expect(opts?.metadata?.['maxmind/tracking-token'], 'sign-in: token forwarded').to.equal(
          'mm-idp-token-signin'
        );
      });
  });
});

describe('processIdpCallback — account-link-by-email observability log (PII-safe)', () => {
  it('emits idp.link failure reason=needs_auth (PII-safe) for the link-needs-auth decision', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy behavior under test
      seed: {
        users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }],
        authMethods: { u1: ['password'] },
      },
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB() },
    }).then((v) => {
      const link = findLink(v.audit);
      const needsAuth = link.find((e) => e.outcome === 'failure' && e.reason === 'needs_auth');
      expect(needsAuth, 'idp.link needs_auth event').to.not.equal(undefined);
      expect(needsAuth?.idpId).to.equal('idp-g');
      expect(needsAuth?.emailVerified).to.equal(true);
      expect(needsAuth?.existingHasPassword).to.equal(true);
      expect(link.length).to.be.greaterThan(0);
      expect(JSON.stringify(link)).to.not.include('you@gmail.com');
    });
  });
});

describe('processIdpCallback — last-used-login Set-Cookie', () => {
  const IDP = 'idp-g';

  it('emits idp:<idpId> last-used-login cookie on the sign-in path', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: { users: [{ id: 'u-signin', loginName: 'linked@idp.test', displayName: 'Linked' }] },
      idpIntent: {
        userId: 'u-signin',
        information: { idpId: IDP, idpUserId: 'g-linked', idpUserName: 'linked@idp.test' },
        draft: null,
      },
      request: { url: CB('google', 'id=intent-si&token=tok-si') },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.lastUsedLogin).to.equal(`idp:${IDP}`);
    });
  });
});

describe('processIdpCallback — same-email collision hard error (default: ALLOW_IDP_AUTO_LINK off)', () => {
  it('redirects to the SSO error page with reason=account-exists instead of auto-linking', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: { users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB() },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.include('/sso/google/error?reason=account-exists');
      expect(v.response?.setCookie ?? '').to.not.include('sessions=');
      // The hard-reject path is audited (PII-safe: reason + requestId only, never the email).
      expect(hasAudit(v.audit, 'idp.link.denied', 'failure')).to.equal(true);
      expect(JSON.stringify(v.audit)).to.not.include('you@gmail.com');
    });
  });
});

describe('processIdpCallback — default-org resolution for IdP auto-create (bare flow)', () => {
  // BUG: on a bare flow (no ?organization= in the callback URL), raw `organization` is undefined.
  // registerAndLinkIdp receives organization:undefined → provider.register({orgId:undefined}) →
  // Zitadel returns FAILED_PRECONDITION (addHumanUser rejects with no org).
  // FIX: resolveOrg(provider, organization) → 'org-default-fake' → register receives that org.
  // The fake does NOT throw on undefined orgId (it ignores it), so we assert the ARG, not
  // the outcome, to get a genuine RED before the fix.
  // Both consumers of the resolved org were driven by an IDENTICAL scenario differing only by
  // which call it recorded — one run now records both.
  it('calls register AND getLoginSettings with the resolved default org (not undefined) on a bare flow (no ?organization=)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      // fresh provider: no seed users → decision routes to auto-create
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      // No organization= in the callback URL → raw organization is undefined
      request: { url: CB('google', 'id=intent-1&token=tok-1') },
      // Capture the args passed to both provider calls
      recordCalls: ['register', 'getLoginSettings'],
    }).then((v) => {
      // Must route to success (not an error page)
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? '')).to.equal(true);

      // The register call must receive the resolved default org, NOT undefined
      const registerCalls = (v.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls.length, 'register was called').to.be.greaterThan(0);
      const registerInput = registerCalls[0][0];
      expect(registerInput.orgId, 'orgId must be the resolved default org, not undefined').to.equal(
        'org-default-fake'
      );

      const settingsCalls = (v.calls?.['getLoginSettings'] ?? []) as Array<[string | undefined]>;
      expect(settingsCalls.length, 'getLoginSettings was called').to.be.greaterThan(0);
      expect(
        settingsCalls[0][0],
        'getLoginSettings must receive resolved default org, not undefined'
      ).to.equal('org-default-fake');
    });
  });
});

describe('processIdpCallback — ?policyOrg gates the allowRegister/auto-create org', () => {
  // The START side (login/method.tsx's sole-linked-IdP auto-start, and its chooser action) picks
  // an IdP out of a list resolved for the FOUND USER's org while the ceremony `organization` is
  // still absent. `policyOrg` carries that deciding org across the round-trip so the callback
  // gates allowRegister — and auto-creates — under the SAME policy that offered the provider,
  // instead of falling back to the default org.
  it('reads allowRegister from policyOrg and registers into it, ignoring the default-org fallback', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      // signPolicyOrg mints the value + signature through the REAL idpReturnUrls, i.e. exactly
      // what a legitimate start emits. Only that pair is honoured (see the forgery specs below).
      request: { url: CB('google', 'id=intent-1&token=tok-1'), signPolicyOrg: 'org-mia' },
      recordCalls: ['getLoginSettings', 'register'],
    }).then((v) => {
      const settingsCalls = (v.calls?.['getLoginSettings'] ?? []) as Array<[string | undefined]>;
      expect(settingsCalls[0]?.[0], 'allowRegister is read from the deciding org').to.equal(
        'org-mia'
      );
      const registerCalls = (v.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls[0]?.[0]?.orgId, 'auto-create lands in the deciding org').to.equal(
        'org-mia'
      );
    });
  });

  it('does NOT org-scope the same-email findUser — that lookup stays instance-wide', () => {
    // The whole reason policyOrg is its own param: widening `organization` instead would have
    // silently narrowed these findUser lookups (see the note at sso-callback.ts's callbackOrg),
    // so an existing account outside the named org would stop being found and the flow would
    // register a duplicate. The seeded account has NO orgId, so an org-scoped lookup misses it.
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' },
      seed: { users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB('google', 'id=intent-1&token=tok-1'), signPolicyOrg: 'org-mia' },
      recordCalls: ['findUser', 'register'],
    }).then((v) => {
      const findUserCalls = (v.calls?.['findUser'] ?? []) as Array<[string, string | undefined]>;
      expect(findUserCalls.length, 'the same-email pre-check ran').to.be.greaterThan(0);
      // `undefined` crosses the cy.task JSON boundary as null — either way it is NOT 'org-mia'.
      expect(
        findUserCalls[0][1] ?? null,
        'findUser stays instance-wide (org arg untouched)'
      ).to.equal(null);
      // …and the existing account was actually found: it auto-linked instead of registering.
      expect(v.calls?.['register'] ?? []).to.have.length(0);
    });
  });
});

describe('processIdpCallback — an unsigned/forged ?policyOrg is ignored', () => {
  // The callback URL is handed to the IdP broker and then to the browser, so `?policyOrg=` is
  // fully attacker-writable. It is also the ONE param on that URL coupled to nothing else:
  // `organization` drags the same-email findUser scope, createSession's orgId and
  // signInWithIdpIntent along with it, so naming a foreign org there fails closed. policyOrg feeds
  // `callbackOrg` alone — which gates allowRegister and picks the auto-create org — so a crafted
  // one borrows a registration-open org's policy WHILE the same-email lookup stays instance-wide.
  // With ALLOW_IDP_AUTO_LINK on that is a path into a victim's account in any org. A `.max(64)`
  // cannot help: decoupling those two orgs is the param's entire purpose, so only provenance can.
  const FORGED = 'org-attacker-registration-open';

  it('a hand-written policyOrg with NO signature falls back to `organization`', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB('google', `id=intent-1&token=tok-1&policyOrg=${FORGED}`) },
      recordCalls: ['getLoginSettings', 'register'],
    }).then((v) => {
      const settingsCalls = (v.calls?.['getLoginSettings'] ?? []) as Array<[string | undefined]>;
      expect(settingsCalls[0]?.[0], 'allowRegister must NOT come from the forged org').to.equal(
        'org-default-fake'
      );
      const registerCalls = (v.calls?.['register'] ?? []) as Array<[Record<string, unknown>]>;
      expect(registerCalls[0]?.[0]?.orgId, 'auto-create must NOT land in the forged org').to.equal(
        'org-default-fake'
      );
    });
  });

  it('a MIS-signed policyOrg (valid signature, swapped value) is ignored too', () => {
    // The realistic forgery is not a random digest — it is a signature lifted from a legitimate
    // start and pasted next to a different org. Domain separation + signing the VALUE is what
    // makes that fail; a signature is a claim about one exact string, not a bearer token.
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      // Mint a real pair for 'org-mia', then overwrite the VALUE while keeping the signature.
      request: {
        url: CB('google', 'id=intent-1&token=tok-1'),
        signPolicyOrg: 'org-mia',
        tamperPolicyOrg: FORGED,
      },
      recordCalls: ['getLoginSettings'],
    }).then((v) => {
      const settingsCalls = (v.calls?.['getLoginSettings'] ?? []) as Array<[string | undefined]>;
      expect(settingsCalls[0]?.[0], 'a mismatched value voids the signature').to.equal(
        'org-default-fake'
      );
    });
  });

  it('logs the rejection so tampering (or a mid-flight secret rotation) is visible', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB('google', `id=intent-1&token=tok-1&policyOrg=${FORGED}`) },
    }).then((v) => {
      const line = v.audit.find((e) => e.event === 'idp_policy_org');
      expect(line, 'an audit line names the rejected param').to.not.equal(undefined);
      expect(line?.outcome).to.equal('failure');
      expect((line as { reason?: string } | undefined)?.reason).to.equal('invalid_signature');
    });
  });

  it('no policyOrg at all still resolves the default org (unchanged baseline)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB('google', 'id=intent-1&token=tok-1') },
      recordCalls: ['getLoginSettings'],
    }).then((v) => {
      const settingsCalls = (v.calls?.['getLoginSettings'] ?? []) as Array<[string | undefined]>;
      expect(settingsCalls[0]?.[0]).to.equal('org-default-fake');
      expect(
        v.audit.some((e) => e.event === 'idp_policy_org'),
        'nothing to reject, nothing logged'
      ).to.equal(false);
    });
  });
});

describe('processIdpCallback — fresh-identity link ceremony (Req 2)', () => {
  // A FRESH external identity (intent.userId == null) attached to the ACTIVE session user via
  // ?link=true — the Req-2 wiring (sso-callback.ts:144-153) that the existing already-MAPPED link
  // test (intent.userId='u2') never exercises. Session seeding: liveSessions seeds the provider so
  // getSession(recent.id, recent.token) resolves a user, and request.sessions signs the matching
  // `sessions` cookie the loader reads.
  // The verified draft email ('fresh@idp.test') deliberately DIFFERS from the session user's email
  // ('owner@datum.test') so the owner-resolution branch is meaningfully distinguishable.
  const FRESH_VERIFIED_LINK: Scenario['idpIntent'] = {
    userId: null,
    information: { idpId: 'idp-g', idpUserId: 'g-fresh', idpUserName: 'fresh@idp.test' },
    draft: { email: 'fresh@idp.test', firstName: 'Fresh', lastName: 'Id', emailVerified: true },
  };

  it('denies the link when the verified email is owned by a DIFFERENT user (env any-email OFF → POSTURE B2)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_LINK_ANY_EMAIL: 'false' }, // restore the strict POSTURE B2 gate (B2 enforced)
      // The verified email 'fresh@idp.test' is owned by u-other — NOT the session user (u-sess).
      seed: { users: [{ id: 'u-other', loginName: 'fresh@idp.test', displayName: 'Other Owner' }] },
      liveSessions: [
        { id: 's1', token: 't1', user: { id: 'u-sess', loginName: 'owner@datum.test' } },
      ],
      idpIntent: FRESH_VERIFIED_LINK,
      request: {
        url: CB('google', 'id=intent-link&token=tok-link&link=true'),
        sessions: [{ id: 's1', token: 't1', loginName: 'owner@datum.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      // B2: linkEmailOwnerUserId (u-other) !== sessionUserId (u-sess) → access-denied; no link, no cookie.
      expect(v.response?.location ?? '').to.include('/sso/google/error?reason=access-denied');
      expect(v.response?.setCookie ?? '').to.not.include('sessions=');
      // The idp_link_decision diagnostic must actually FIRE on a link decision — the registry
      // presence check alone can't prove emission. PII-safe: booleans + opaque ids, no email.
      expect(v.audit.some((e) => e.event === 'idp_link_decision')).to.equal(true);
      expect(JSON.stringify(v.audit.filter((e) => e.event === 'idp_link_decision'))).to.not.include(
        '@'
      );
    });
  });
});

describe('processIdpCallback — passkey-hint write', () => {
  // Both success paths must write passkey-hint = the loginName the session lands on:
  // auto-link uses the IdP-vouched existing loginName, auto-create the freshly created one.
  const HINT_CASES: Array<{ label: string; scenario: Scenario }> = [
    {
      label: 'auto-link',
      scenario: {
        fn: 'processIdpCallback',
        slug: 'google',
        env: { ALLOW_IDP_AUTO_LINK: 'true' },
        seed: { users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }] },
        idpIntent: REGISTER_INTENT_VERIFIED,
        request: { url: CB() },
      },
    },
    {
      label: 'auto-create',
      scenario: {
        fn: 'processIdpCallback',
        slug: 'google',
        seed: { users: [] }, // no existing account → auto-create path
        idpIntent: REGISTER_INTENT_VERIFIED,
        request: { url: CB() },
      },
    },
  ];

  it('writes passkey-hint = the signed-in loginName on both the auto-link and auto-create paths', () => {
    for (const c of HINT_CASES) {
      callService(c.scenario).then((v) => {
        expect(v.response?.status, `${c.label}: status`).to.equal(302);
        expect(v.response?.passkeyHint, `${c.label}: passkey-hint`).to.equal('you@gmail.com');
      });
    }
  });
});
