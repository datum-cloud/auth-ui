// cypress/component/resources/sso/sso-callback.cy.ts
//
// cy.task node-spec port of app/resources/sso/__tests__/callback.service.test.ts (+ the
// processIdpCallback getUser-drop cases from sso-perf-returnto.test.ts). processIdpCallback reads
// the signed `sessions` cookie, mints/reads the fingerprintId cookie, emits REAL logAuthEvent audit,
// and writes the signed last-used-login cookie — all node-bound. SECURITY-CRITICAL: identity
// matching, the 755-J1 link-failure reason mapping, and the PII-safe account-link audit.
import { callService, type AuditEvent, type Scenario } from '../../../support/node/call-service';

const REGISTER_INTENT: Scenario['idpIntent'] = {
  userId: null,
  information: { idpId: 'idp-g', idpUserId: 'g-new', idpUserName: 'newbie' },
  draft: { email: 'newbie@idp.test', firstName: 'New', lastName: 'Bie' },
};
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
type RedirectOutcome = { kind: string; location?: string; setCookie?: string };
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

  it('routes to /login with notice=link-existing when existing account has a password', () => {
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
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.include('notice=link-existing');
      expect(loc).to.include('loginName=you%40gmail.com');
      expect(v.response?.setCookie ?? '').to.not.include('sess-');
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

  it('auto-creates a GitHub-style user with NO names by falling back to idpUserName', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'github',
      seed: {},
      idpIntent: {
        userId: null,
        information: { idpId: 'idp-gh', idpUserId: 'gh-1', idpUserName: 'anindia0703' },
        draft: { email: 'gh-user@idp.test', emailVerified: true },
      },
      request: { url: CB('github') },
      inspect: { findUser: ['gh-user@idp.test'] },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? '')).to.equal(true);
      const found = (v.inspect?.findUser as Record<string, { displayName?: string } | null>)[
        'gh-user@idp.test'
      ];
      expect(found).to.not.equal(null);
      expect(found?.displayName).to.equal('anindia0703 anindia0703');
    });
  });

  it('auto-link path threads sessionId into /authorize when a requestId rides in', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy behavior under test
      seed: { users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB('google', 'id=intent-1&token=tok-1&requestId=oidc_ceremony') },
    }).then((v) => {
      const loc = v.response?.location ?? '';
      expect(v.response?.status).to.equal(302);
      expect(loc).to.include('/authorize?requestId=oidc_ceremony');
      expect(loc).to.match(/[?&]sessionId=sess-\d+/);
    });
  });

  it('auto-create path threads sessionId into /authorize when a requestId rides in', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB('google', 'id=intent-1&token=tok-1&requestId=oidc_ceremony') },
    }).then((v) => {
      const loc = v.response?.location ?? '';
      expect(v.response?.status).to.equal(302);
      expect(loc).to.include('/authorize?requestId=oidc_ceremony');
      expect(loc).to.match(/[?&]sessionId=sess-\d+/);
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

  it('emits idp.link success reason=auto_linked (PII-safe) for the auto-link decision', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy behavior under test
      seed: { users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB() },
    }).then((v) => {
      const link = findLink(v.audit);
      const autoLinked = link.find((e) => e.outcome === 'success' && e.reason === 'auto_linked');
      expect(autoLinked, 'idp.link auto_linked event').to.not.equal(undefined);
      expect(autoLinked?.idpId).to.equal('idp-g');
      expect(JSON.stringify(link)).to.not.include('you@gmail.com');
    });
  });
});

describe('processIdpCallback — mark email verified on auto-link (Task-6)', () => {
  it('marks the account email verified after a successful auto-link', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy behavior under test
      seed: { users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB() },
      inspect: { isEmailVerified: ['u1'] },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect((v.inspect?.isEmailVerified as Record<string, boolean>).u1).to.equal(true);
    });
  });

  it('does NOT mark email verified on a plain link ceremony (link=true, no session match)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: { users: [{ id: 'u2', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: {
        userId: 'u2',
        information: { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'you@gmail.com' },
        draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
      },
      request: { url: CB('google', 'id=intent-1&token=tok-1&link=true') },
      inspect: { isEmailVerified: ['u2'] },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect((v.inspect?.isEmailVerified as Record<string, boolean>).u2).to.equal(false);
    });
  });

  it('still redirects even if markEmailVerified throws (best-effort)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy behavior under test
      seed: { users: [{ id: 'u3', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: REGISTER_INTENT_VERIFIED,
      failMarkEmailVerified: true,
      request: { url: CB() },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? '')).to.equal(true);
      expect(v.response?.setCookie ?? '').to.include('sessions=');
    });
  });
});

describe('processIdpCallback — stale ceremony-session cookie resilience', () => {
  it('proceeds with a fresh IdP sign-in when the sessions cookie entry causes getSession to throw', () => {
    callService({
      fn: 'processIdpCallback',
      provider: 'singleton',
      slug: 'google',
      idpIntent: REGISTER_INTENT,
      sessionResults: { 'stale-session': { mode: 'throw', code: 'NOT_FOUND' } },
      request: {
        url: CB('google', 'id=intent-fresh&token=tok-fresh'),
        sessions: [{ id: 'stale-session', token: 'stale-token', loginName: 'stale@example.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.not.include('/error');
      expect(loc).to.not.include('request_expired');
      expect(isSignedInOrAuthorize(loc)).to.equal(true);
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

  it('emits idp:<idpId> last-used-login cookie on the auto-link path', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy behavior under test
      seed: { users: [{ id: 'u-autolink', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: {
        userId: null,
        information: { idpId: IDP, idpUserId: 'g-al', idpUserName: 'you@gmail.com' },
        draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
      },
      request: { url: CB('google', 'id=intent-al&token=tok-al') },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? '')).to.equal(true);
      expect(v.response?.lastUsedLogin).to.equal(`idp:${IDP}`);
    });
  });

  it('emits idp:<idpId> last-used-login cookie on the auto-create path', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {},
      idpIntent: {
        userId: null,
        information: { idpId: IDP, idpUserId: 'g-new', idpUserName: 'newbie@idp.test' },
        draft: { email: 'newbie@idp.test', firstName: 'New', lastName: 'Bie', emailVerified: true },
      },
      request: { url: CB('google', 'id=intent-ac&token=tok-ac') },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? '')).to.equal(true);
      expect(v.response?.lastUsedLogin).to.equal(`idp:${IDP}`);
    });
  });

  it('does NOT emit a last-used-login cookie on the link-needs-auth path', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy behavior under test
      seed: {
        users: [{ id: 'u-lna', loginName: 'you@gmail.com', displayName: 'You User' }],
        authMethods: { 'u-lna': ['password'] },
      },
      idpIntent: {
        userId: null,
        information: { idpId: IDP, idpUserId: 'g-lna', idpUserName: 'you@gmail.com' },
        draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
      },
      request: { url: CB('google', 'id=intent-lna&token=tok-lna') },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.include('notice=link-existing');
      expect(v.response?.lastUsedLogin).to.equal(null);
    });
  });

  it('does NOT emit a last-used-login cookie on the provider-error path', () => {
    callService({
      fn: 'processIdpCallback',
      provider: 'singleton',
      slug: 'google',
      idpIntentError: 'UNAVAILABLE',
      request: { url: CB('google', 'id=intent-err&token=tok-err') },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.include('/sso/google/error');
      expect(v.response?.lastUsedLogin).to.equal(null);
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

describe('processIdpCallback — session-user resolution', () => {
  it('resolves the ceremony user via getSession, not getUser(sessionId)', () => {
    callService({
      fn: 'processIdpCallback',
      provider: 'singleton',
      slug: 'google',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: 'alice@acme.test' } }],
      idpIntent: REGISTER_INTENT,
      recordCalls: ['getUser'],
      request: {
        url: CB('google', 'id=intent-new&token=tok'),
        sessions: [{ id: 's1', token: 't1', loginName: 'alice@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.not.include('/error');
      const getUserCalls = v.calls?.getUser ?? [];
      expect(getUserCalls.some((args) => args[0] === 's1')).to.equal(false);
    });
  });
});

// ── Performance (sso-perf-returnto.test.ts): redundant getUser elided ──
describe('processIdpCallback — redundant getUser dropped', () => {
  it('does not call getUser on the sign-in path (idpUserName suffices)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: { users: [{ id: 'u-signin', loginName: 'linked@idp.test', displayName: 'Linked' }] },
      idpIntent: {
        userId: 'u-signin',
        information: { idpId: 'idp-g', idpUserId: 'g-linked', idpUserName: 'linked@idp.test' },
        draft: null,
      },
      recordCalls: ['getUser'],
      request: { url: CB('google', 'id=i1&token=t1') },
    }).then((v) => {
      expect((v.outcome as RedirectOutcome).kind).to.equal('redirect');
      expect((v.calls?.getUser ?? []).length).to.equal(0);
    });
  });

  it('does not call getUser on the auto-link path — identical redirect + cookie', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_AUTO_LINK: 'true' }, // legacy behavior under test
      seed: { users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }] },
      idpIntent: {
        userId: null,
        information: { idpId: 'idp-g', idpUserId: 'g-al', idpUserName: 'you@gmail.com' },
        draft: { email: 'you@gmail.com', firstName: 'You', lastName: 'User', emailVerified: true },
      },
      recordCalls: ['getUser'],
      request: { url: CB('google', 'id=i1&token=t1') },
    }).then((v) => {
      const o = v.outcome as RedirectOutcome;
      expect(o.kind).to.equal('redirect');
      expect(o.setCookie ?? '').to.include('sessions=');
      expect((v.calls?.getUser ?? []).length).to.equal(0);
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

  it('errors account-exists even when the existing account has a password (no link-needs-auth)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      seed: {
        users: [{ id: 'u1', loginName: 'you@gmail.com', displayName: 'You User' }],
        authMethods: { u1: ['password'] },
      },
      idpIntent: REGISTER_INTENT_VERIFIED,
      request: { url: CB() },
    }).then((v) => {
      expect(v.response?.location ?? '').to.include('reason=account-exists');
      expect(v.response?.location ?? '').to.not.include('notice=link-existing');
    });
  });
});

describe('processIdpCallback — fresh-identity link ceremony (Req 2)', () => {
  // A FRESH external identity (intent.userId == null) attached to the ACTIVE session user via
  // ?link=true — the Req-2 wiring (sso-callback.ts:144-153) that the existing already-MAPPED link
  // test (intent.userId='u2') never exercises. Session seeding mirrors the 'session-user
  // resolution' block: liveSessions seeds the provider so getSession(recent.id, recent.token)
  // resolves a user, and request.sessions signs the matching `sessions` cookie the loader reads.
  // The verified draft email ('fresh@idp.test') deliberately DIFFERS from the session user's email
  // ('owner@datum.test') so the owner-resolution branch is meaningfully distinguishable.
  const FRESH_VERIFIED_LINK: Scenario['idpIntent'] = {
    userId: null,
    information: { idpId: 'idp-g', idpUserId: 'g-fresh', idpUserName: 'fresh@idp.test' },
    draft: { email: 'fresh@idp.test', firstName: 'Fresh', lastName: 'Id', emailVerified: true },
  };

  it('links a fresh verified identity to the session user and SKIPS owner findUser (any-email ON)', () => {
    callService({
      fn: 'processIdpCallback',
      slug: 'google',
      env: { ALLOW_IDP_LINK_ANY_EMAIL: 'true' }, // any-email ON → the B2 owner-resolution lookup short-circuits.
      seed: {}, // fresh provider; the session user is injected via liveSessions (no user store entry needed)
      liveSessions: [
        { id: 's1', token: 't1', user: { id: 'u-sess', loginName: 'owner@datum.test' } },
      ],
      idpIntent: FRESH_VERIFIED_LINK,
      // recordCalls spies provider.findUser. With any-email ON the B2 owner lookup
      // (sso-callback.ts:144-153) is gated behind `!allowLinkAnyEmail` and never runs, so the spy
      // sees ZERO calls — the direct proof of the short-circuit. (No `inspect.findUser` here: the
      // post-call inspect read would itself invoke findUser and pollute the recorded count.)
      recordCalls: ['findUser'],
      request: {
        url: CB('google', 'id=intent-link&token=tok-link&link=true'),
        sessions: [{ id: 's1', token: 't1', loginName: 'owner@datum.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(isSignedInOrAuthorize(v.response?.location ?? '')).to.equal(true);
      expect(v.response?.setCookie ?? '').to.include('sessions=');
      // Owner-resolution findUser short-circuited by the `!allowLinkAnyEmail` guard.
      expect((v.calls?.findUser ?? []).length).to.equal(0);
    });
  });

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
