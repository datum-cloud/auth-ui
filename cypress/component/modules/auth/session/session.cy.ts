// cypress/component/modules/auth/session/session.cy.ts
//
// Component (no-mount) port of app/modules/auth/session/__tests__/session.test.ts.
// session.ts is PURE cookie-array logic (no env / no signing / no node imports), so it is
// browser-safe and runs directly in the spec bundle (NOT the cookie SIGNING module, which is
// stubbed — see cookie.cy.ts / cookie.guard.cy.ts for the node-bound signing tests).
import {
  addSession,
  byLoginName,
  capSessions,
  listSessions,
  mostRecent,
  needsLivenessCheck,
  type SessionEntry,
} from '@/modules/auth/session/session';

const NOW = Date.parse('2026-01-01T00:00:00Z');
const base: SessionEntry = {
  id: 's1',
  token: 't1',
  loginName: 'a@acme.test',
  creationTs: '1',
  expirationTs: '9999999999999',
  changeTs: '1',
};

describe('session store (cookie-array logic)', () => {
  it('replaces an existing session by id (no duplicates)', () => {
    const next = addSession([base], { ...base, changeTs: '2' });
    expect(listSessions(next, NOW)).to.have.length(1);
    expect(mostRecent(next)?.changeTs).to.equal('2');
  });
  it('drops expired sessions on list', () => {
    const expired = { ...base, id: 's2', expirationTs: '1' };
    expect(listSessions([base, expired], NOW)).to.have.length(1);
  });
  it('KEEPS an entry with an empty expirationTs (Zitadel session created without a lifetime → no expirationDate)', () => {
    const noExpiry = { ...base, id: 's3', expirationTs: '' };
    expect(listSessions([noExpiry], NOW)).to.have.length(1);
  });
  it('caps the cookie at the byte budget, evicting the oldest by changeTs first', () => {
    const sizeOf = (list: SessionEntry[]) => list.length * 800;
    const entries = [
      { ...base, id: 's1', changeTs: '1' },
      { ...base, id: 's2', changeTs: '2' },
      { ...base, id: 's3', changeTs: '3' },
    ];
    const capped = capSessions(entries, 2048, sizeOf);
    expect(capped).to.have.length(2);
    expect(capped.map((s) => s.id)).to.deep.equal(['s2', 's3']); // oldest (s1) evicted
    expect(sizeOf(capped)).to.be.at.most(2048);
  });
});

describe('session store — ISO-8601 timestamp support', () => {
  const FAR_FUTURE_ISO = '2099-01-01T00:00:00.000Z';
  const isoBase: SessionEntry = {
    ...base,
    expirationTs: FAR_FUTURE_ISO,
    changeTs: FAR_FUTURE_ISO,
  };

  it('mostRecent orders mixed epoch-string and ISO changeTs entries correctly', () => {
    const epochEntry: SessionEntry = { ...base, id: 'epoch', changeTs: '1000' };
    const isoEntry: SessionEntry = { ...isoBase, id: 'iso-newer', changeTs: FAR_FUTURE_ISO };
    const result = mostRecent([epochEntry, isoEntry]);
    expect(result?.id).to.equal('iso-newer');
  });
});

describe('byLoginName', () => {
  const alice: SessionEntry = { ...base, id: 's1', loginName: 'alice@acme.test' };
  const aliceOrg: SessionEntry = {
    ...base,
    id: 's2',
    loginName: 'alice@acme.test',
    organization: 'acme',
  };
  const bob: SessionEntry = { ...base, id: 's3', loginName: 'bob@acme.test' };

  it('finds sessions by loginName (optionally scoped by organization) and returns undefined on any mismatch', () => {
    expect(byLoginName([alice, bob], 'alice@acme.test')).to.deep.equal(alice);
    expect(byLoginName([alice, aliceOrg], 'alice@acme.test', 'acme')).to.deep.equal(aliceOrg);
    expect(byLoginName([alice], 'alice@acme.test', 'other-org')).to.be.undefined;
    expect(byLoginName([alice, bob], 'charlie@acme.test')).to.be.undefined;
  });

  // Fix B (fix/dead-session-recovery): a stale ceremony entry left behind by an RP-initiated
  // logout (organization: undefined, the caller's RAW query org) can shadow a fresh entry
  // created moments later by signup/resolveIdentifier (organization: the RESOLVED org id) —
  // `undefined !== '<orgId>'` so login.service.ts's prior-entry filter never supersedes it, and
  // addSession appends the fresh entry AFTER the stale one. When the caller queries with NO
  // organization (the common case — VerifyLoginPasswordInput.organization is usually undefined),
  // both entries match by loginName; byLoginName must prefer the MOST RECENT (by changeTs, the
  // same comparison mostRecent uses) rather than the first (insertion-order) match.
  it('prefers the MOST RECENT match when duplicate loginName entries differ only by organization (stale vs. resolved-org shadowing)', () => {
    const stale: SessionEntry = {
      ...base,
      id: 'stale',
      loginName: 'bob@acme.test',
      organization: undefined,
      changeTs: '1',
    };
    const fresh: SessionEntry = {
      ...base,
      id: 'fresh',
      loginName: 'bob@acme.test',
      organization: 'org-123',
      changeTs: '2',
    };
    // Stale inserted first, fresh appended after (mirrors addSession ordering) — first-match
    // (pre-fix) would return `stale`; recency-based lookup must return `fresh`.
    expect(byLoginName([stale, fresh], 'bob@acme.test')).to.deep.equal(fresh);
    // Order-independent: the fix must not be a positional accident.
    expect(byLoginName([fresh, stale], 'bob@acme.test')).to.deep.equal(fresh);
  });
});

describe('needsLivenessCheck', () => {
  const livenessBase = { id: 's', token: 't', loginName: 'a', creationTs: '0', changeTs: '0' };
  it('flags an entry with an empty expirationTs (unknown expiry → must verify with provider)', () => {
    expect(needsLivenessCheck({ ...livenessBase, expirationTs: '' })).to.equal(true);
  });
  it('does not flag an entry with a known future expiry', () => {
    expect(
      needsLivenessCheck({ ...livenessBase, expirationTs: '2099-01-01T00:00:00.000Z' })
    ).to.equal(false);
  });
});
