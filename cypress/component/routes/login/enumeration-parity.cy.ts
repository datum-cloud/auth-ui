// cypress/component/routes/login/enumeration-parity.cy.ts
//
// `ignoreUnknownUsernames` is a tenant-facing ANTI-ENUMERATION setting, and its entire protection
// is that an UNKNOWN identifier and a real PASSWORD-ONLY account are indistinguishable to an
// unauthenticated observer. Routing every account with >= 1 usable method to /login/method broke
// exactly that: the known side moved and the ghost side did not, turning the identifier step's
// redirect target into a perfect account-existence oracle.
//
// These specs pin the parity itself rather than either side's destination, so a future re-route of
// one branch fails here instead of silently reopening the oracle. Four observable channels:
// status, redirect target, rendered chooser, Set-Cookie shape — plus the audit line.
import { callService } from '../../../support/node/call-service';

/** The default org the fake resolves to; where the tenant flips the flag. */
const DEFAULT_ORG = 'org-default-fake';

/** One real password-only account, in an org that has anti-enumeration ON. */
const ANTI_ENUM_SEED = {
  users: [{ id: 'u1', loginName: 'alice@acme.test' }],
  authMethods: { u1: ['password'] },
  settingsByOrg: { [DEFAULT_ORG]: { ignoreUnknownUsernames: true } },
};

const KNOWN = 'alice@acme.test';
const GHOST = 'nobody-here@acme.test';

/** The identifier submit, as an unauthenticated visitor makes it. */
function submitIdentifier(loginName: string, seed: Record<string, unknown> = ANTI_ENUM_SEED) {
  return callService({
    fn: 'loginAction',
    seed,
    env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
    request: {
      url: 'http://localhost/id/login',
      form: { loginName },
      csrf: true,
    },
  });
}

/** The chooser GET the identifier submit redirects to, carrying the session it just planted. */
function loadChooser(loginName: string, seed: Record<string, unknown> = ANTI_ENUM_SEED) {
  return callService({
    fn: 'loginMethodLoader',
    seed,
    env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
    request: {
      url: `http://localhost/id/login/method?loginName=${encodeURIComponent(loginName)}`,
      sessions: [{ id: 's1', token: 'tok-s1', loginName }],
    },
  });
}

/** Cookie NAMES set by a response, sorted — the shape an observer can compare. */
function cookieNames(setCookies: string[] | undefined): string[] {
  return (setCookies ?? []).map((c) => c.split('=')[0]).sort();
}

describe('ignoreUnknownUsernames — identifier step is not an existence oracle', () => {
  it('unknown and password-only land on the SAME target with the same status', () => {
    submitIdentifier(KNOWN).then((known) => {
      submitIdentifier(GHOST).then((ghost) => {
        expect(known.response?.status, 'known status').to.equal(302);
        expect(ghost.response?.status, 'ghost status').to.equal(known.response?.status);

        // Compare the whole Location minus the one field that legitimately differs: the
        // identifier the visitor typed. Anything else diverging IS the oracle.
        const strip = (loc: string) => loc.replace(/loginName=[^&]*/, 'loginName=<redacted>');
        const knownLoc = strip(known.response?.location ?? '');
        const ghostLoc = strip(ghost.response?.location ?? '');
        expect(knownLoc, 'known goes to the chooser').to.contain('/login/method');
        expect(ghostLoc, 'ghost redirect target must be byte-identical').to.equal(knownLoc);
      });
    });
  });

  it('both set the same Set-Cookie shape (a real ceremony session either way)', () => {
    submitIdentifier(KNOWN).then((known) => {
      submitIdentifier(GHOST).then((ghost) => {
        const knownNames = cookieNames(known.response?.setCookies);
        expect(knownNames, 'the known path persists a ceremony session').to.include('sessions');
        expect(cookieNames(ghost.response?.setCookies), 'same cookies, same order').to.deep.equal(
          knownNames
        );
        // Not merely present — the ghost cookie must carry a real entry, or the chooser's
        // session gate would bounce it and re-open the oracle one hop later.
        expect(
          ghost.response?.cookieEntries ?? [],
          'ghost session entry is planted'
        ).to.have.length(known.response?.cookieEntries?.length ?? 0);
      });
    });
  });

  it('emits the SAME audit event for both (no "not_found" tell in the logs)', () => {
    submitIdentifier(KNOWN).then((known) => {
      submitIdentifier(GHOST).then((ghost) => {
        const shape = (v: typeof known) =>
          v.audit
            .filter((e) => e.event === 'identifier')
            .map((e) => `${e.event}:${e.outcome}:${(e as { reason?: string }).reason ?? ''}`);
        expect(shape(known)).to.deep.equal(['identifier:success:']);
        expect(shape(ghost), 'a failure/reason line here names the branch').to.deep.equal(
          shape(known)
        );
      });
    });
  });

  it('OFF (default): the unknown identifier is still rejected, no ghost session', () => {
    // The parity above must not have turned the flag into a no-op — with it off, an unknown
    // identifier is still USER_NOT_FOUND and plants nothing.
    submitIdentifier(GHOST, {
      users: [{ id: 'u1', loginName: KNOWN }],
      authMethods: { u1: ['password'] },
    }).then((v) => {
      expect(v.response?.dataBody).to.deep.equal({ error: 'USER_NOT_FOUND' });
      expect(cookieNames(v.response?.dataSetCookies), 'no ceremony session').to.not.include(
        'sessions'
      );
    });
  });
});

describe('ignoreUnknownUsernames — the chooser renders the same screen for both', () => {
  it('a ghost that clears the session gate RENDERS, it does not bounce', () => {
    // The gate is the authorization (a live ceremony session for this loginName, which /login
    // mints only under the flag). Bouncing on the findUser miss would move the oracle here.
    loadChooser(GHOST).then((v) => {
      expect(v.response?.status, 'must not redirect').to.not.equal(302);
      expect((v.response?.dataBody as { methods: string[] }).methods).to.deep.equal(['password']);
    });
  });

  it('identical chooser payload: same controls, same branding, same CSRF handling', () => {
    loadChooser(KNOWN).then((known) => {
      loadChooser(GHOST).then((ghost) => {
        type Body = {
          loginName: string;
          methods: string[];
          idps: unknown[];
          branding: unknown;
          csrfToken: string;
        };
        const k = known.response?.dataBody as Body;
        const g = ghost.response?.dataBody as Body;

        expect(known.response?.status).to.equal(ghost.response?.status);
        expect(g.methods, 'same single control').to.deep.equal(k.methods);
        expect(g.idps, 'same (empty) IdP list').to.deep.equal(k.idps);
        expect(g.branding, 'branding resolves identically').to.deep.equal(k.branding);
        // A rotated per-request token either way — its VALUE must differ, its presence must not.
        expect(g.csrfToken, 'ghost gets a real CSRF token').to.be.a('string').and.not.be.empty;
        expect(typeof g.csrfToken).to.equal(typeof k.csrfToken);
        expect(cookieNames(ghost.response?.dataSetCookies)).to.deep.equal(
          cookieNames(known.response?.dataSetCookies)
        );
      });
    });
  });

  it('parity SURVIVES a user whose org is NOT the default org', () => {
    // The regression this pins. A ghost has no user.orgId, so its policy read fell through to the
    // DEFAULT org while a real account was judged by its OWN. Seed the two to DISAGREE — the
    // default org forbids passwords, mia's org does not — and the old code split the pair
    // (known -> /login/method, ghost -> /error): a perfect existence oracle, in the one
    // configuration the rest of this file cannot reach because its users carry no orgId.
    // Both branches now resolve a ghost's policy org from the identifier's DOMAIN
    // (resolveGhostPolicyOrg), so nobody-here@acme.test is judged by the very org
    // mia@acme.test belongs to.
    const seed = {
      users: [{ id: 'u1', loginName: 'mia@acme.test', orgId: 'org-mia' }],
      authMethods: { u1: ['password'] },
      orgDomains: { 'acme.test': 'org-mia' },
      settingsByOrg: {
        [DEFAULT_ORG]: { ignoreUnknownUsernames: true, allowPassword: false },
        'org-mia': { ignoreUnknownUsernames: true },
      },
    };
    submitIdentifier('mia@acme.test', seed).then((known) => {
      submitIdentifier('nobody-here@acme.test', seed).then((ghost) => {
        const strip = (loc: string) => loc.replace(/loginName=[^&]*/, 'loginName=<redacted>');
        expect(known.response?.location ?? '', 'known reaches the chooser').to.contain(
          '/login/method'
        );
        expect(ghost.response?.status, 'same status').to.equal(known.response?.status);
        expect(
          strip(ghost.response?.location ?? ''),
          'the ghost must not be dead-ended by a policy the real account never sees'
        ).to.equal(strip(known.response?.location ?? ''));
      });
    });
  });

  it('an org that forbids passwords dead-ends BOTH at /error, never one of them', () => {
    // The ghost is decided by the same decideAfterIdentifier call a password-only account gets,
    // so a policy that removes the only method removes it for both. Hardcoding a ghost target
    // would send it to a chooser the real account is not allowed to reach.
    const seed = {
      users: [{ id: 'u1', loginName: KNOWN }],
      authMethods: { u1: ['password'] },
      settingsByOrg: {
        [DEFAULT_ORG]: { ignoreUnknownUsernames: true, allowPassword: false },
      },
    };
    submitIdentifier(KNOWN, seed).then((known) => {
      submitIdentifier(GHOST, seed).then((ghost) => {
        expect(known.response?.location ?? '', 'known: policy dead end').to.contain('/error');
        expect(ghost.response?.status).to.equal(known.response?.status);
        expect(ghost.response?.location ?? '').to.contain('/error');
      });
    });
  });
});
