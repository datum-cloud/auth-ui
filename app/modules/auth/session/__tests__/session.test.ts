import {
  addSession,
  byLoginName,
  capSessions,
  listSessions,
  mostRecent,
  needsLivenessCheck,
  removeSession,
  type SessionEntry,
} from '@/modules/auth/session/session';
import { describe, it, expect } from 'vitest';

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
  it('adds and lists sessions', () => {
    expect(listSessions(addSession([], base), NOW)).toHaveLength(1);
  });
  it('replaces an existing session by id (no duplicates)', () => {
    const next = addSession([base], { ...base, changeTs: '2' });
    expect(listSessions(next, NOW)).toHaveLength(1);
    expect(mostRecent(next)?.changeTs).toBe('2');
  });
  it('removes by id', () => {
    expect(listSessions(removeSession([base], 's1'), NOW)).toHaveLength(0);
  });
  it('drops expired sessions on list', () => {
    const expired = { ...base, id: 's2', expirationTs: '1' };
    expect(listSessions([base, expired], NOW)).toHaveLength(1);
  });
  it('KEEPS an entry with an empty expirationTs (Zitadel session created without a lifetime → no expirationDate)', () => {
    // Regression: Number('') === 0, so the old filter read an absent expiry as "expired in 1970"
    // and dropped every session — making the /accounts multi-account picker render empty even
    // though the sessions were live. Unknown expiry must be KEPT; the /accounts loader
    // re-validates true liveness against the provider (degraded "needs re-auth" card if dead).
    const noExpiry = { ...base, id: 's3', expirationTs: '' };
    expect(listSessions([noExpiry], NOW)).toHaveLength(1);
  });
  it('caps the cookie at the byte budget, evicting the oldest by changeTs first', () => {
    // each entry "costs" 800 bytes via the injected sizeOf; budget 2048 fits only 2
    const sizeOf = (list: SessionEntry[]) => list.length * 800;
    const entries = [
      { ...base, id: 's1', changeTs: '1' },
      { ...base, id: 's2', changeTs: '2' },
      { ...base, id: 's3', changeTs: '3' },
    ];
    const capped = capSessions(entries, 2048, sizeOf);
    expect(capped).toHaveLength(2);
    expect(capped.map((s) => s.id)).toEqual(['s2', 's3']); // oldest (s1) evicted
    expect(sizeOf(capped)).toBeLessThanOrEqual(2048);
  });
});

describe('session store — ISO-8601 timestamp support', () => {
  const FAR_FUTURE_ISO = '2099-01-01T00:00:00.000Z';
  const PAST_ISO = '2000-01-01T00:00:00.000Z';
  const isoBase: SessionEntry = {
    ...base,
    expirationTs: FAR_FUTURE_ISO,
    changeTs: FAR_FUTURE_ISO,
  };

  it('listSessions keeps a future-ISO expirationTs entry', () => {
    const entry: SessionEntry = { ...isoBase, id: 'iso-future', expirationTs: FAR_FUTURE_ISO };
    expect(listSessions([entry], NOW)).toHaveLength(1);
  });

  it('listSessions drops a past-ISO expirationTs entry', () => {
    const entry: SessionEntry = { ...isoBase, id: 'iso-past', expirationTs: PAST_ISO };
    expect(listSessions([entry], NOW)).toHaveLength(0);
  });

  it('mostRecent orders mixed epoch-string and ISO changeTs entries correctly', () => {
    const epochEntry: SessionEntry = { ...base, id: 'epoch', changeTs: '1000' }; // epoch ms — very old
    const isoEntry: SessionEntry = { ...isoBase, id: 'iso-newer', changeTs: FAR_FUTURE_ISO };
    const result = mostRecent([epochEntry, isoEntry]);
    expect(result?.id).toBe('iso-newer');
  });

  it('capSessions evicts the ISO-oldest first when changeTs are ISO strings', () => {
    const sizeOf = (list: SessionEntry[]) => list.length * 800;
    const entries: SessionEntry[] = [
      { ...isoBase, id: 'iso-old', changeTs: '2020-01-01T00:00:00.000Z' },
      { ...isoBase, id: 'iso-mid', changeTs: '2021-01-01T00:00:00.000Z' },
      { ...isoBase, id: 'iso-new', changeTs: FAR_FUTURE_ISO },
    ];
    const capped = capSessions(entries, 2048, sizeOf);
    expect(capped).toHaveLength(2);
    expect(capped.map((s) => s.id)).not.toContain('iso-old'); // oldest evicted
    expect(capped.map((s) => s.id)).toContain('iso-new');
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

  it('finds a session by loginName (no org filter)', () => {
    expect(byLoginName([alice, bob], 'alice@acme.test')).toEqual(alice);
  });
  it('finds a session by loginName + organization when both match', () => {
    expect(byLoginName([alice, aliceOrg], 'alice@acme.test', 'acme')).toEqual(aliceOrg);
  });
  it('returns undefined when loginName matches but organization does not', () => {
    // alice has no org; filter requires 'other-org' — should not match
    expect(byLoginName([alice], 'alice@acme.test', 'other-org')).toBeUndefined();
  });
  it('returns undefined when loginName does not match (miss)', () => {
    expect(byLoginName([alice, bob], 'charlie@acme.test')).toBeUndefined();
  });
  it('returns undefined on empty list', () => {
    expect(byLoginName([], 'alice@acme.test')).toBeUndefined();
  });
});

describe('needsLivenessCheck', () => {
  const base = { id: 's', token: 't', loginName: 'a', creationTs: '0', changeTs: '0' };
  it('flags an entry with an empty expirationTs (unknown expiry → must verify with provider)', () => {
    expect(needsLivenessCheck({ ...base, expirationTs: '' })).toBe(true);
  });
  it('does not flag an entry with a known future expiry', () => {
    expect(needsLivenessCheck({ ...base, expirationTs: '2099-01-01T00:00:00.000Z' })).toBe(false);
  });
});
