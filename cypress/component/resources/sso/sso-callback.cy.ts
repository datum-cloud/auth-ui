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

describe('processIdpCallback — provider error handling', () => {
  it('redirects to the SSO error page and logs idp.signin failure when retrieveIdpIntent throws', () => {
    callService({
      fn: 'processIdpCallback',
      provider: 'singleton',
      slug: 'google',
      idpIntentError: 'UNAVAILABLE',
      request: { url: CB('google', 'id=intent1&token=tok') },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.include('/sso/google/error');
      expect(hasAudit(v.audit, 'idp.signin', 'failure')).to.equal(true);
    });
  });
});

describe('processIdpCallback — existing same-email account auto-link (Task-3)', () => {
  it('auto-links and signs in when existing account is passwordless + email is IdP-verified', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy behavior under test
      seed: { users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB() },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? '')).to.equal(true);
      expect(v.response?.setCookie ?? '').to.include('sessions=');
    });
  });

  it('auto-creates and signs in when no existing account with the same email (new IdP user)', () => {
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

  it('forwards a deviceTrackingToken on the callback URL to the new session as MaxMind metadata (IdP fraud-signal parity)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB('google', 'id=intent-1&token=tok-1&deviceTrackingToken=mm-idp-token-1') },
      inspect: { lastCreateSessionOpts: true },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? '')).to.equal(true);
      const opts = v.inspect?.lastCreateSessionOpts as {
        metadata?: Record<string, unknown>;
      } | null;
      expect(opts?.metadata?.['maxmind/tracking-token']).to.equal('mm-idp-token-1');
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

describe('processIdpCallback — sign-in path MaxMind fraud-signal parity', () => {
  // Mirrors the auto-create test above — the sign-in path (an ALREADY-linked IdP identity,
  // intent.userId present) must forward deviceTrackingToken to the resulting session's metadata
  // exactly like a fresh registration does, via signInWithIdpIntent's own deviceTrackingToken opt.
  it('forwards a deviceTrackingToken on the callback URL to the session on a returning-user sign-in', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: { users: [{ id: 'u-signin', loginName: 'linked@idp.test', displayName: 'Linked' }] },
      idpIntent: {
        userId: 'u-signin',
        information: { idpId: 'idp-g', idpUserId: 'g-linked', idpUserName: 'linked@idp.test' },
        draft: null,
      },
      request: {
        url: CB('google', 'id=intent-si&token=tok-si&deviceTrackingToken=mm-idp-token-signin'),
      },
      inspect: { lastCreateSessionOpts: true },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const opts = v.inspect?.lastCreateSessionOpts as {
        metadata?: Record<string, unknown>;
      } | null;
      expect(opts?.metadata?.['maxmind/tracking-token']).to.equal('mm-idp-token-signin');
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

describe('processIdpCallback — 755-J1 link failure reason mapping', () => {
  const AUTOLINK_INTENT: Scenario['idpIntent'] = {
    userId: null,
    information: { idpId: 'idp-g', idpUserId: 'g-al', idpUserName: 'you@gmail.com' },
    draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
  };

  it('maps ALREADY_EXISTS to reason=identity-linked-elsewhere (not signin_failed)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy auto-link path under test (Step-5 catch)
      seed: { users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: AUTOLINK_INTENT,
      addIdpLinkError: 'ALREADY_EXISTS',
      request: { url: CB() },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/sso/google/error');
      expect(loc).to.include('reason=identity-linked-elsewhere');
      expect(loc).to.not.include('reason=signin_failed');
      expect(hasAudit(v.audit, 'idp.link', 'failure')).to.equal(true);
      expect(v.response?.setCookie ?? '').to.not.include('sess-');
    });
  });

  it('maps a non-ALREADY_EXISTS link ProviderError through providerErrorCode (signin_failed)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy auto-link path under test (Step-5 catch)
      seed: { users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: AUTOLINK_INTENT,
      addIdpLinkError: 'FAILED_PRECONDITION',
      request: { url: CB() },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/sso/google/error');
      expect(loc).to.include('reason=signin_failed');
      expect(loc).to.not.include('identity-linked-elsewhere');
    });
  });
});

describe('processIdpCallback — 755-K1 auto-create failure reason mapping', () => {
  // Real-world bug: findUser's same-email pre-check only matches Zitadel's exact loginName, so an
  // org whose loginName differs from the raw email (the Zitadel domain-suffix default) never finds
  // a real collision — decideIdpCallback falls through to auto-create believing the user is new,
  // and Zitadel's own addHumanUser then correctly rejects the duplicate with ALREADY_EXISTS. The
  // auto-create catch block must not collapse that into the generic, actionable-less signin_failed
  // the same way the sibling `link` branch already avoids doing for its own ALREADY_EXISTS case.
  it('maps ALREADY_EXISTS from a fresh registration to a clear reason (not signin_failed)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {}, // no existing users — decision routes to auto-create, mirroring the missed collision
      idpIntent: REGISTER_INTENT_VERIFIED,
      registerError: 'ALREADY_EXISTS',
      request: { url: CB() },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/sso/google/error');
      expect(loc).to.include('reason=registration-conflict');
      expect(loc).to.not.include('reason=signin_failed');
      expect(hasAudit(v.audit, 'idp.register', 'failure')).to.equal(true);
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
  it('calls register with the resolved default org (not undefined) on a bare flow (no ?organization=)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      // fresh provider: no seed users → decision routes to auto-create
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      // No organization= in the callback URL → raw organization is undefined
      request: { url: CB('google', 'id=intent-1&token=tok-1') },
      // Capture the args passed to provider.register
      recordCalls: ['register'],
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
    });
  });

  it('calls getLoginSettings with the resolved default org (not undefined) on a bare flow', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB('google', 'id=intent-1&token=tok-1') },
      recordCalls: ['getLoginSettings'],
    }).then((v) => {
      const settingsCalls = (v.calls?.['getLoginSettings'] ?? []) as Array<[string | undefined]>;
      expect(settingsCalls.length, 'getLoginSettings was called').to.be.greaterThan(0);
      const orgArg = settingsCalls[0][0];
      expect(orgArg, 'getLoginSettings must receive resolved default org, not undefined').to.equal(
        'org-default-fake'
      );
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
