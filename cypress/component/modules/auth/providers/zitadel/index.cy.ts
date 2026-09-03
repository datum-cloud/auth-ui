// cypress/component/modules/auth/providers/zitadel/index.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/index.test.ts.
// Uses the browser-safe transport stub (vite.config.ts Task 9a) with the
// __setCreateServiceClientImpl hook to drive stubbed service-client responses.
// window.fetch is stubbed with cy.stub() for the isInstanceAdmin REST tests.
//
// Final squeeze: this is adapter/wiring code, not user-facing security logic. Reduced to one
// test per genuinely distinct behavior category; request-building/response-mapping cases across
// createSession/updateSession/deleteSession/verifyPasskey/verifyU2F share the same mechanism
// (build a request, forward it, map the response) and are merged into a single test.
// isInstanceAdmin's bearer-token forwarding and the RPC deadline behavior are kept standalone.
import { ZitadelAuthProvider } from '@/modules/auth/providers/zitadel/index';
import { TIMEOUTS } from '@/modules/auth/providers/zitadel/timeouts';
import * as transport from '@/modules/auth/providers/zitadel/transport';
import { ProviderError } from '@/modules/auth/types';
import { AuthFactorState } from '@zitadel/proto/zitadel/user/v2/user_pb';

const provider = () => new ZitadelAuthProvider({ serviceUrl: 'https://z.test', serviceToken: 't' });

// Drive the branching with canned service-client responses.
const stubClient = (impl: Record<string, unknown>) =>
  (
    transport as unknown as { __setCreateServiceClientImpl: (fn: unknown) => void }
  ).__setCreateServiceClientImpl(() => impl);

afterEach(() => {
  (
    transport as unknown as { __resetCreateServiceClientImpl: () => void }
  ).__resetCreateServiceClientImpl();
});

// ── method surface + pure branching ─────────────────────────────────────────────

describe('ZitadelAuthProvider — method surface & pure branching', () => {
  it('exposes the 12 Phase 1 methods, resolves findUser null/mapped, and throws NOT_FOUND when the auth request is missing', async () => {
    const p = provider() as unknown as Record<string, unknown>;
    for (const m of [
      'getLoginSettings',
      'getBranding',
      'getPasswordComplexity',
      'findUser',
      'getUser',
      'listAuthMethods',
      'createSession',
      'getSession',
      'updateSession',
      'deleteSession',
      'getAuthRequest',
      'createCallback',
    ]) {
      expect(typeof p[m]).to.equal('function');
    }

    stubClient({ listUsers: async () => ({ result: [] }) });
    expect(await provider().findUser('a@b.c')).to.be.null;

    stubClient({
      listUsers: async () => ({ result: [{ userId: 'u1', preferredLoginName: 'a@b.c' }] }),
    });
    expect((await provider().findUser('a@b.c'))?.id).to.equal('u1');

    stubClient({ getAuthRequest: async () => ({ authRequest: undefined }) });
    try {
      await provider().getAuthRequest('oidc', 'x');
      throw new Error('expected rejection');
    } catch (err) {
      expect((err as { code: string }).code).to.equal('NOT_FOUND');
      expect(err).to.be.instanceOf(ProviderError);
    }
  });

  // 755-K1: findUser is called with an email address (sso-callback.ts's same-email collision
  // check) but only ever queried Zitadel by exact loginName. When an org's domain policy suffixes
  // loginName (the Zitadel default), loginName !== email, so the query silently finds nothing even
  // though a real account with that email exists — the collision check is defeated and a duplicate
  // registration attempt reaches Zitadel, which then rejects it with ALREADY_EXISTS.
  it('findUser searches Zitadel by email (emailQuery), not just an exact loginName match', async () => {
    type Query = { query?: { case?: string; value?: { queries?: Query[] } } };
    let captured: { queries?: Query[] } | undefined;
    stubClient({
      listUsers: async (req: typeof captured) => {
        captured = req;
        return { result: [] };
      },
    });
    await provider().findUser('someone@example.com', 'org-1');
    // Flatten one level: the loginName/email queries are OR-combined so they still AND with the
    // separate organizationIdQuery entry, rather than being flat siblings in the top-level array.
    const flattened = (captured?.queries ?? []).flatMap((q) =>
      q.query?.case === 'orQuery' ? (q.query.value?.queries ?? []) : [q]
    );
    const cases = flattened.map((q) => q.query?.case);
    expect(cases).to.include('emailQuery');
  });
});

// ── isInstanceAdmin ────────────────────────────────────────────────────────────

describe('ZitadelAuthProvider — isInstanceAdmin', () => {
  const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

  it('is true for IAM membership, false otherwise, and forwards the session token as a bearer header', async () => {
    const fetchStub = cy.stub(window, 'fetch');

    fetchStub.callsFake(async () => okJson({ result: [{ roles: ['IAM_OWNER'], iam: true }] }));
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).to.equal(true);

    fetchStub.callsFake(async () => okJson({ result: [{ roles: ['ORG_OWNER'], orgId: 'o' }] }));
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).to.equal(false);

    fetchStub.callsFake(async () => okJson({ result: [] }));
    await provider().isInstanceAdmin({ id: 's', token: 'sess-tok' });
    expect(fetchStub).to.have.been.calledWith(
      'https://z.test/auth/v1/memberships/me/_search',
      Cypress.sinon.match({
        method: 'POST',
        headers: Cypress.sinon.match({ Authorization: 'Bearer sess-tok' }),
      })
    );
  });
});

// ── RPC deadline ───────────────────────────────────────────────────────────────

describe('ZitadelAuthProvider — RPC deadline', () => {
  it('exposes bounded admin-check and gRPC deadlines, and rejects a hanging RPC', async () => {
    // Range gates for both deadline constants, folded in from the standalone timeouts.cy.ts.
    // GRPC_CALL_MS is additionally proven behaviorally below; ADMIN_CHECK_MS has no behavioral
    // test anywhere, so its bounds check is kept here rather than dropped.
    expect(TIMEOUTS.ADMIN_CHECK_MS).to.be.greaterThan(0);
    expect(TIMEOUTS.ADMIN_CHECK_MS).to.be.at.most(30_000);
    expect(TIMEOUTS.GRPC_CALL_MS).to.be.greaterThan(0);
    expect(TIMEOUTS.GRPC_CALL_MS).to.be.at.most(30_000);

    // Sinon fake timers — synchronous API so the fake clock is in place *before*
    // provider() creates its internal deadline setTimeout (GRPC_CALL_MS = 10 000 ms).
    // cy.clock() is asynchronous (queued), so it cannot guarantee the clock is ready
    // before the synchronous provider call; useFakeTimers() is synchronous.
    const clock = Cypress.sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      stubClient({ getSession: () => new Promise(() => {}) });
      const p = provider().getSession('s1', 't1');
      // Advance past GRPC_CALL_MS (10_000) + 1 ms buffer.  The deadline setTimeout
      // fires synchronously inside tick(); the rejection propagates via microtask.
      clock.tick(11_000);
      await p.then(
        () => {
          throw new Error('expected rejection');
        },
        (err) => {
          expect(err.code).to.equal('UNAVAILABLE');
        }
      );
    } finally {
      clock.restore();
    }
  });
});

// ── session/credential request building ────────────────────────────────────────

describe('ZitadelAuthProvider — session/credential request building', () => {
  type CapturedReq = {
    lifetime?: { seconds?: bigint };
    metadata?: Record<string, Uint8Array>;
    checks?: { user?: { search?: { case?: string; value?: string } } };
  };

  it('createSession requests a lifetime and encodes metadata; updateSession/deleteSession forward correctly; webauthn names default', async () => {
    let captured: CapturedReq | undefined;
    stubClient({
      createSession: async (req: CapturedReq) => {
        captured = req;
        return { sessionId: 's1', sessionToken: 'tok' };
      },
      getSession: async () => ({ session: { id: 's1' } }),
    });
    await provider().createSession(
      { password: 'p' },
      { userId: 'u1', metadata: { 'maxmind/tracking-token': 'tok-abc' } }
    );
    expect(captured?.lifetime).not.to.be.undefined;
    expect(Number(captured?.lifetime?.seconds)).to.be.greaterThan(0);
    expect(captured?.checks?.user?.search?.value).to.equal('u1');
    const bytes = captured?.metadata?.['maxmind/tracking-token'];
    expect(bytes).to.be.instanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).to.equal('tok-abc');

    const updateImpl = {
      setSession: async () => ({ sessionToken: 'newtok' }),
      getSession: async () => ({
        session: { id: 's1', factors: { user: { id: 'u1', loginName: 'a@b.c' } } },
      }),
    };
    const setSessionSpy = cy.stub(updateImpl, 'setSession').resolves({ sessionToken: 'newtok' });
    const getSessionSpy = cy.stub(updateImpl, 'getSession').resolves({
      session: { id: 's1', factors: { user: { id: 'u1', loginName: 'a@b.c' } } },
    });
    stubClient(updateImpl);
    const out = await provider().updateSession('s1', 'tok', { password: 'pw' });
    expect(setSessionSpy).to.have.callCount(1);
    expect(getSessionSpy).to.have.callCount(1);
    expect(out.id).to.equal('s1');
    expect(out.token).to.equal('newtok');

    const deleteImpl = { deleteSession: async () => ({}) };
    const deleteSessionSpy = cy.stub(deleteImpl, 'deleteSession').resolves({});
    stubClient(deleteImpl);
    await provider().deleteSession('s1', 'tok');
    // The adapter forwards a second `{}` options arg — assert only the first (request) arg.
    expect(deleteSessionSpy).to.have.been.calledWith(
      Cypress.sinon.match({ sessionId: 's1', sessionToken: 'tok' }),
      Cypress.sinon.match.any
    );

    const passkeyImpl = { verifyPasskeyRegistration: async () => ({}) };
    const passkeySpy = cy.stub(passkeyImpl, 'verifyPasskeyRegistration').resolves({});
    stubClient(passkeyImpl);
    await provider().verifyPasskey('u1', 'pk1', { fake: true });
    expect(passkeySpy).to.have.been.calledWith(
      Cypress.sinon.match({ passkeyName: 'Passkey' }),
      Cypress.sinon.match.any
    );

    const u2fImpl = { verifyU2FRegistration: async () => ({}) };
    const u2fSpy = cy.stub(u2fImpl, 'verifyU2FRegistration').resolves({});
    stubClient(u2fImpl);
    await provider().verifyU2F('u1', { u2fId: 'k1', publicKeyCredential: {}, tokenName: '' });
    expect(u2fSpy).to.have.been.calledWith(
      Cypress.sinon.match({ tokenName: 'Security key' }),
      Cypress.sinon.match.any
    );
  });

  it('createSession retries ONLY the post-write read on a replica-lag NOT_FOUND — the write fires exactly once (no duplicate session)', async () => {
    const createSpy = cy.stub().resolves({ sessionId: 's1', sessionToken: 'tok' });
    let getCalls = 0;
    const getSpy = cy.stub().callsFake(async () => {
      getCalls += 1;
      // First read races a lagging replica → gRPC NotFound (code 5); the write already succeeded.
      if (getCalls === 1) throw Object.assign(new Error('not found'), { code: 5 });
      return { session: { id: 's1', factors: { user: { id: 'u1', loginName: 'a@b.c' } } } };
    });
    stubClient({ createSession: createSpy, getSession: getSpy });

    const out = await provider().createSession({}, { userId: 'u1' });

    expect(out.id).to.equal('s1');
    // The WRITE is issued exactly once — the retry re-reads, it does NOT re-create the session.
    expect(createSpy).to.have.callCount(1);
    // The READ was retried after the lag NotFound.
    expect(getSpy).to.have.callCount(2);
  });
});

// ── Passkey created-at metadata — best-effort scopes ──────────────────────
//
// verifyPasskey/listPasskeys/removePasskey each touch a user-metadata RPC (set/list/delete)
// in its own ctx.call scope specifically so that RPC can NEVER fail the primary operation.
// These tests drive that metadata RPC into failure and assert the primary operation still
// resolves, plus the listPasskeys join behaviour (present/absent createdAt per row).
describe('ZitadelAuthProvider — passkey metadata best-effort scopes', () => {
  it('verifyPasskey resolves even when the best-effort setUserMetadata RPC throws', async () => {
    const primarySpy = cy.stub().resolves({});
    stubClient({
      verifyPasskeyRegistration: primarySpy,
      setUserMetadata: async () => {
        throw new Error('metadata backend down');
      },
    });
    // Must not throw — the primary operation is not allowed to fail because of the
    // best-effort metadata RPC (created-at stamp on enroll).
    await provider().verifyPasskey('u1', 'pk1', { fake: true });
    expect(primarySpy).to.have.callCount(1);
  });

  // Phase B (D-PK): the metadata VALUE is JSON {created, name}, not a bare ISO string —
  // zitadel-provider's passkey-removed handler parses `.name` out of it to name the device
  // in the removal email. The SAME resolved name must reach both the Zitadel passkeyName
  // field and the metadata JSON.
  it('stamps enroll metadata as JSON carrying the resolved passkey name', async () => {
    const metaCalls: Array<{
      userId: string;
      metadata: Array<{ key: string; value: Uint8Array }>;
    }> = [];
    const verifySpy = cy.stub().resolves({});
    stubClient({
      verifyPasskeyRegistration: verifySpy,
      setUserMetadata: async (req: {
        userId: string;
        metadata: Array<{ key: string; value: Uint8Array }>;
      }) => {
        metaCalls.push(req);
        return {};
      },
    });

    await provider().verifyPasskey('u1', 'pk-9', { fake: true }, '  MacBook Touch ID  ');

    expect(verifySpy).to.have.been.calledWith(
      Cypress.sinon.match({ passkeyName: 'MacBook Touch ID' }),
      Cypress.sinon.match.any
    );
    expect(metaCalls).to.have.length(1);
    expect(metaCalls[0].metadata[0].key).to.equal('passkey:pk-9:created');
    const parsed = JSON.parse(new TextDecoder().decode(metaCalls[0].metadata[0].value));
    expect(parsed.name).to.equal('MacBook Touch ID');
    expect(parsed.created).to.match(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('falls back to the default name in the metadata JSON when the route supplies none', async () => {
    const metaCalls: Array<{ metadata: Array<{ key: string; value: Uint8Array }> }> = [];
    stubClient({
      verifyPasskeyRegistration: async () => ({}),
      setUserMetadata: async (req: { metadata: Array<{ key: string; value: Uint8Array }> }) => {
        metaCalls.push(req);
        return {};
      },
    });

    await provider().verifyPasskey('u1', 'pk-9', { fake: true }, undefined);

    expect(JSON.parse(new TextDecoder().decode(metaCalls[0].metadata[0].value)).name).to.equal(
      'Passkey'
    );
  });

  // Phase B (D-PK): the created-at key must OUTLIVE the passkey. zitadel-provider's
  // passkey-removed handler reads it AFTER the removal event to name the device in the
  // notification email; deleting it here would race that read and win. This replaces the
  // pre-Phase-B "removePasskey survives deleteUserMetadata failure" row — the RPC is now
  // never issued at all.
  it('leaves the created-at key in place after removal (tombstone for the removal email)', async () => {
    const removeSpy = cy.stub().resolves({});
    const deleteMetaSpy = cy.stub().resolves({});
    stubClient({
      removePasskey: removeSpy,
      deleteUserMetadata: deleteMetaSpy,
    });

    await provider().removePasskey('u1', 'pk-9');

    expect(removeSpy).to.have.callCount(1);
    expect(deleteMetaSpy).to.have.callCount(0);
  });

  it('listPasskeys degrades to date-less rows (all createdAt absent) when listUserMetadata throws', async () => {
    stubClient({
      listUserMetadata: async () => {
        throw new Error('metadata backend down');
      },
      listPasskeys: async () => ({
        result: [
          { id: 'pk1', state: AuthFactorState.READY, name: 'Laptop' },
          { id: 'pk2', state: AuthFactorState.NOT_READY, name: 'Phone' },
        ],
      }),
    });
    const rows = await provider().listPasskeys('u1');
    expect(rows).to.have.length(2);
    expect(rows[0]).to.deep.equal({ id: 'pk1', state: 'active', name: 'Laptop' });
    expect(rows[1]).to.deep.equal({ id: 'pk2', state: 'inactive', name: 'Phone' });
    for (const row of rows) {
      expect(row).to.not.have.property('createdAt');
    }
  });

  it('listPasskeys joins createdAt from a matching passkey:<id>:created entry; unmatched rows omit the property', async () => {
    const createdAt = '2026-07-01T00:00:00.000Z';
    const seconds = Math.floor(new Date(createdAt).getTime() / 1000);
    stubClient({
      listUserMetadata: async () => ({
        metadata: [
          { key: 'passkey:pk1:created', creationDate: { seconds: BigInt(seconds), nanos: 0 } },
        ],
      }),
      listPasskeys: async () => ({
        result: [
          { id: 'pk1', state: AuthFactorState.READY, name: 'Laptop' },
          { id: 'pk2', state: AuthFactorState.NOT_READY, name: 'Phone' },
        ],
      }),
    });
    const rows = await provider().listPasskeys('u1');
    const pk1 = rows.find((r) => r.id === 'pk1');
    const pk2 = rows.find((r) => r.id === 'pk2');
    expect(pk1?.createdAt).to.equal(createdAt);
    // Absence must be a missing property (omitted via the `...(createdAt ? {...} : {})` spread),
    // not just an undefined value.
    expect(pk2).to.not.have.property('createdAt');
  });
});

// ── Cross-device session methods ───────────────────────────────────────────

describe('ZitadelAuthProvider — cross-device session methods', () => {
  it('listUserSessions searches by userIdQuery and maps sessions with token ""', async () => {
    let captured: unknown;
    stubClient({
      listSessions: async (req: unknown) => {
        captured = req;
        return { sessions: [{ id: 's1' }, { id: 's2' }] };
      },
    });
    const rows = await provider().listUserSessions('u1');
    const q = (captured as { queries: Array<{ query: { case: string; value: { id?: string } } }> })
      .queries[0].query;
    expect(q.case).to.equal('userIdQuery');
    expect(q.value.id).to.equal('u1');
    expect(rows).to.have.length(2);
    expect(rows[0].id).to.equal('s1');
    expect(rows[0].token).to.equal('');
  });

  it('deleteUserSession sends sessionId WITHOUT a sessionToken field', async () => {
    let captured: unknown;
    stubClient({
      deleteSession: async (req: Record<string, unknown>) => {
        captured = req;
        return {};
      },
    });
    await provider().deleteUserSession('s2');
    expect((captured as { sessionId: string }).sessionId).to.equal('s2');
    expect(captured).to.not.have.property('sessionToken');
  });
});
