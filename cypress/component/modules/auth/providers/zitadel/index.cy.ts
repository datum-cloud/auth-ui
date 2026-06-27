// cypress/component/modules/auth/providers/zitadel/index.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/index.test.ts.
// Uses the browser-safe transport stub (vite.config.ts Task 9a) with the
// __setCreateServiceClientImpl hook to drive stubbed service-client responses.
// window.fetch is stubbed with cy.stub() for the isInstanceAdmin REST tests.
import { ZitadelAuthProvider } from '@/modules/auth/providers/zitadel/index';
import * as transport from '@/modules/auth/providers/zitadel/transport';
import { ProviderError } from '@/modules/auth/types';

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

// ── method surface ─────────────────────────────────────────────────────────────

describe('ZitadelAuthProvider — method surface', () => {
  it('exposes the 12 Phase 1 methods (getLegalSupport removed)', () => {
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
  });
});

// ── pure branching ─────────────────────────────────────────────────────────────

describe('ZitadelAuthProvider — pure branching', () => {
  it('findUser returns null when listUsers yields 0 results', async () => {
    stubClient({ listUsers: async () => ({ result: [] }) });
    expect(await provider().findUser('a@b.c')).to.be.null;
  });
  it('findUser returns null when listUsers yields 2 results (ambiguous)', async () => {
    stubClient({ listUsers: async () => ({ result: [{ userId: 'u1' }, { userId: 'u2' }] }) });
    expect(await provider().findUser('a@b.c')).to.be.null;
  });
  it('findUser maps the user when exactly 1 result', async () => {
    stubClient({
      listUsers: async () => ({ result: [{ userId: 'u1', preferredLoginName: 'a@b.c' }] }),
    });
    expect((await provider().findUser('a@b.c'))?.id).to.equal('u1');
  });
  it('getAuthRequest throws ProviderError(NOT_FOUND) when authRequest is missing', () => {
    stubClient({ getAuthRequest: async () => ({ authRequest: undefined }) });
    return provider()
      .getAuthRequest('oidc', 'x')
      .then(
        () => {
          throw new Error('expected rejection');
        },
        (err) => {
          expect(err.code).to.equal('NOT_FOUND');
          expect(err).to.be.instanceOf(ProviderError);
        }
      );
  });
});

// ── isInstanceAdmin ────────────────────────────────────────────────────────────

describe('ZitadelAuthProvider — isInstanceAdmin', () => {
  const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

  it('true when a membership has iam:true', async () => {
    cy.stub(window, 'fetch').callsFake(async () =>
      okJson({
        result: [
          { roles: ['ORG_OWNER'], orgId: 'o' },
          { roles: ['IAM_OWNER'], iam: true },
        ],
      })
    );
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).to.equal(true);
  });

  it('true when a role starts with IAM_ even without the iam flag', async () => {
    cy.stub(window, 'fetch').callsFake(async () => okJson({ result: [{ roles: ['IAM_OWNER'] }] }));
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).to.equal(true);
  });

  it('false for an org-owner only (no instance membership)', async () => {
    cy.stub(window, 'fetch').callsFake(async () =>
      okJson({ result: [{ roles: ['ORG_OWNER'], orgId: 'o' }] })
    );
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).to.equal(false);
  });

  it('false on empty result, non-2xx, or thrown error', async () => {
    const fetchStub = cy.stub(window, 'fetch');

    fetchStub.callsFake(async () => okJson({}));
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).to.equal(false);

    fetchStub.callsFake(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response);
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).to.equal(false);

    fetchStub.callsFake(() => Promise.reject(new Error('net')));
    expect(await provider().isInstanceAdmin({ id: 's', token: 't' })).to.equal(false);
  });

  it('calls the memberships endpoint with the session token as bearer', async () => {
    const fetchStub = cy.stub(window, 'fetch').callsFake(async () => okJson({ result: [] }));
    await provider().isInstanceAdmin({ id: 's', token: 'sess-tok' });
    expect(fetchStub).to.have.been.calledWith(
      'https://z.test/auth/v1/memberships/me/_search',
      Cypress.sinon.match({
        method: 'POST',
        headers: Cypress.sinon.match({ Authorization: 'Bearer sess-tok' }),
      })
    );
  });

  it('isInstanceAdmin returns false when the membership fetch is aborted (timeout)', async () => {
    cy.stub(window, 'fetch').callsFake(() => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    const result = await provider().isInstanceAdmin({ id: 's1', token: 't1' });
    expect(result).to.equal(false);
  });
});

// ── RPC deadline ───────────────────────────────────────────────────────────────

describe('ZitadelAuthProvider — RPC deadline', () => {
  it('rejects a never-resolving RPC with a deadline error instead of hanging', async () => {
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

// ── createSession lifetime + opts ──────────────────────────────────────────────

describe('ZitadelAuthProvider — createSession lifetime + opts', () => {
  type CapturedReq = {
    lifetime?: { seconds?: bigint };
    metadata?: Record<string, Uint8Array>;
    checks?: { user?: { search?: { case?: string; value?: string } } };
  };

  it('requests an explicit session lifetime and builds the user check from opts.userId', async () => {
    let captured: CapturedReq | undefined;
    stubClient({
      createSession: async (req: CapturedReq) => {
        captured = req;
        return { sessionId: 's1', sessionToken: 'tok' };
      },
      getSession: async () => ({ session: { id: 's1' } }),
    });
    await provider().createSession({ password: 'p' }, { userId: 'u1' });
    expect(captured?.lifetime).not.to.be.undefined;
    expect(Number(captured?.lifetime?.seconds)).to.be.greaterThan(0);
    expect(captured?.checks?.user?.search?.value).to.equal('u1');
  });

  it('forwards opts.metadata to the CreateSession proto metadata map, encoded string→bytes', async () => {
    let captured: CapturedReq | undefined;
    stubClient({
      createSession: async (req: CapturedReq) => {
        captured = req;
        return { sessionId: 's1', sessionToken: 'tok' };
      },
      getSession: async () => ({ session: { id: 's1' } }),
    });
    await provider().createSession(
      {},
      { userId: 'u1', metadata: { 'maxmind/tracking-token': 'tok-abc' } }
    );
    const bytes = captured?.metadata?.['maxmind/tracking-token'];
    expect(bytes).to.be.instanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).to.equal('tok-abc');
  });

  it('omits the metadata field entirely when opts.metadata is absent', async () => {
    let captured: CapturedReq | undefined;
    stubClient({
      createSession: async (req: CapturedReq) => {
        captured = req;
        return { sessionId: 's1', sessionToken: 'tok' };
      },
      getSession: async () => ({ session: { id: 's1' } }),
    });
    await provider().createSession({}, { userId: 'u1' });
    expect(captured?.metadata).to.be.undefined;
  });

  it('issues exactly one getSession after createSession (no redundant second fetch)', async () => {
    const impl = {
      createSession: async () => ({ sessionId: 's1', sessionToken: 'tok' }),
      getSession: async () => ({ session: { id: 's1' } }),
    };
    const createSessionSpy = cy
      .stub(impl, 'createSession')
      .resolves({ sessionId: 's1', sessionToken: 'tok' });
    const getSessionSpy = cy.stub(impl, 'getSession').resolves({ session: { id: 's1' } });
    stubClient(impl);
    await provider().createSession({ password: 'p' }, { userId: 'u1' });
    expect(createSessionSpy).to.have.callCount(1);
    expect(getSessionSpy).to.have.callCount(1);
  });
});

// ── updateSession / deleteSession ──────────────────────────────────────────────

describe('ZitadelAuthProvider — updateSession / deleteSession', () => {
  it('updateSession sends the checks and maps the refreshed session', async () => {
    const impl = {
      setSession: async () => ({ sessionToken: 'newtok' }),
      getSession: async () => ({
        session: { id: 's1', factors: { user: { id: 'u1', loginName: 'a@b.c' } } },
      }),
    };
    const setSessionSpy = cy.stub(impl, 'setSession').resolves({ sessionToken: 'newtok' });
    const _getSessionSpy = cy.stub(impl, 'getSession').resolves({
      session: { id: 's1', factors: { user: { id: 'u1', loginName: 'a@b.c' } } },
    });
    stubClient(impl);
    const out = await provider().updateSession('s1', 'tok', { password: 'pw' });
    expect(setSessionSpy).to.have.callCount(1);
    expect(out.id).to.equal('s1');
    expect(out.token).to.equal('newtok');
  });

  it('updateSession issues exactly one getSession after setSession (no redundant second fetch)', async () => {
    const impl = {
      setSession: async () => ({ sessionToken: 'newtok' }),
      getSession: async () => ({
        session: { id: 's1', factors: { user: { id: 'u1', loginName: 'a@b.c' } } },
      }),
    };
    const setSessionSpy = cy.stub(impl, 'setSession').resolves({ sessionToken: 'newtok' });
    const getSessionSpy = cy.stub(impl, 'getSession').resolves({
      session: { id: 's1', factors: { user: { id: 'u1', loginName: 'a@b.c' } } },
    });
    stubClient(impl);
    await provider().updateSession('s1', 'tok', { password: 'pw' });
    expect(setSessionSpy).to.have.callCount(1);
    expect(getSessionSpy).to.have.callCount(1);
  });

  it('deleteSession calls the delete RPC with id + token', async () => {
    const impl = { deleteSession: async () => ({}) };
    const deleteSessionSpy = cy.stub(impl, 'deleteSession').resolves({});
    stubClient(impl);
    await provider().deleteSession('s1', 'tok');
    // The adapter forwards a second `{}` options arg — assert only the first (request) arg.
    expect(deleteSessionSpy).to.have.been.calledWith(
      Cypress.sinon.match({ sessionId: 's1', sessionToken: 'tok' }),
      Cypress.sinon.match.any
    );
  });
});

// ── webauthn credential names ──────────────────────────────────────────────────

describe('ZitadelAuthProvider — webauthn credential names', () => {
  it('verifyPasskey sends a non-empty default passkeyName', async () => {
    const impl = { verifyPasskeyRegistration: async () => ({}) };
    const spy = cy.stub(impl, 'verifyPasskeyRegistration').resolves({});
    stubClient(impl);
    await provider().verifyPasskey('u1', 'pk1', { fake: true });
    expect(spy).to.have.been.calledWith(
      Cypress.sinon.match({ passkeyName: 'Passkey' }),
      Cypress.sinon.match.any
    );
  });

  it('verifyPasskey forwards a route-supplied label', async () => {
    const impl = { verifyPasskeyRegistration: async () => ({}) };
    const spy = cy.stub(impl, 'verifyPasskeyRegistration').resolves({});
    stubClient(impl);
    await provider().verifyPasskey('u1', 'pk1', { fake: true }, 'My Laptop');
    expect(spy).to.have.been.calledWith(
      Cypress.sinon.match({ passkeyName: 'My Laptop' }),
      Cypress.sinon.match.any
    );
  });

  it('verifyU2F defaults tokenName when the route passes an empty string', async () => {
    const impl = { verifyU2FRegistration: async () => ({}) };
    const spy = cy.stub(impl, 'verifyU2FRegistration').resolves({});
    stubClient(impl);
    await provider().verifyU2F('u1', { u2fId: 'k1', publicKeyCredential: {}, tokenName: '' });
    expect(spy).to.have.been.calledWith(
      Cypress.sinon.match({ tokenName: 'Security key' }),
      Cypress.sinon.match.any
    );
  });
});
