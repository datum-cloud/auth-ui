// Moved out of vite.config.ts to keep the build config free of test-harness code.
// `root` is the project root passed by vite.config.ts (i.e. __dirname from that file).
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

// When CYPRESS is set, component specs bundle app modules into the browser.
// Server-only modules (env.server, cookie/session storage, server middleware,
// audit, node:crypto-bound provider entries) crash in the browser, so we
// replace them at load() with tiny browser-safe stubs. Discover the exact set
// iteratively: run a pilot spec, read the bundle error naming the offending
// module, add an entry here, repeat (see Task 6).
export function stubServerModulesForCypress(root: string): Plugin {
  const stubs: Record<string, string> = {
    // SEED — env server module (almost always the first offender). Adjust the
    // path to the real file if it differs; remove if auth-ui has no such file.
    [resolve(root, './app/server/infra/env.server.ts')]: `
      export const env = { public: {}, server: {} };
      export const isProduction = false;
      export const isDevelopment = false;
      export const isTest = true;
    `,
    // Task 8a: select.server.ts imports ZitadelAuthProvider (server-only gRPC transport).
    // Stub returns a FakeAuthProvider singleton with the seeds the authorize/device specs need.
    [resolve(root, './app/modules/auth/select.server.ts')]: `
      import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
      let _singleton;
      function makeFake() {
        if (_singleton) return _singleton;
        _singleton = new FakeAuthProvider({
          authRequests: {
            x: { id: 'x', scopes: ['openid'], prompt: ['create'] },
            cb: { id: 'cb', scopes: ['openid'], prompt: [] },
          },
          deviceAuths: [
            { userCode: 'WDJB-MJHT', id: 'dev-1', appName: 'CLI', scope: ['openid'] },
            { userCode: 'DENY-CODE', id: 'dev-deny', appName: 'CLI', scope: [] },
            { userCode: 'AUTH-CODE', id: 'dev-authorize', appName: 'CLI', scope: ['openid'] },
          ],
          samlRequests: [
            { id: 'sr-1', clientId: 'sp', binding: 'redirect' },
            { id: 'sr-post', clientId: 'sp', binding: 'post' },
          ],
        });
        return _singleton;
      }
      export function getAuthProvider(_opts) { return makeFake(); }
      export const providerRegistry = { fake: () => makeFake() };
    `,
    // Task 8a: cookie.ts imports env.server (stubbed) + observability (stubbed) + react-router
    // createCookie (HMAC signing). Stub with no-ops — KEEP specs send no Cookie headers.
    [resolve(root, './app/modules/auth/session/cookie.ts')]: `
      export async function readSessions(_req) { return []; }
      export function mostRecent(_entries) { return undefined; }
      export function byId(list, id) { return (list ?? []).find(s => s.id === id); }
      export function byLoginName(list, loginName, org) { return (list ?? []).find(s => s.loginName === loginName && (!org || s.organization === org)); }
      export function removeSession(list, id) { return (list ?? []).filter(s => s.id !== id); }
      export function addSession(list, entry) { return [...(list ?? []).filter(s => s.id !== entry?.id), entry]; }
      export async function serializeSessions(_entries) { return 'sessions=stub; Path=/id; HttpOnly'; }
      export function sessionEntryFromSession(session, opts) { return { id: session?.id, token: session?.token, loginName: opts?.loginName, organization: opts?.organization, requestId: opts?.requestId }; }
      export function capSessions(_entries) { return _entries ?? []; }
      export function listSessions(_entries) { return _entries ?? []; }
      export const sessionsCookie = {
        serialize: async (_entries) => 'sessions=stub; Path=/id; HttpOnly',
        parse: async (_value) => [],
      };
    `,
    // Task 8a: observability.ts imports node:crypto, prom-client, hono — all server-only.
    [resolve(root, './app/server/observability.ts')]: `
      export function logAuthEvent(_event, _outcome, _meta) {}
      export function hashActor(_id) { return ''; }
      export const registry = {};
      export function logHono() { return (_c, next) => next(); }
      export const httpRequestDuration = { startTimer: () => () => {}, observe: () => {} };
    `,
    // Task 8d: webauthn-verify.ts exports schema + factory handlers. For component specs testing
    // just the schema (no service calls), stub the file to export only the Zod schema.
    [resolve(root, './app/resources/webauthn/webauthn-verify.ts')]: `
      import { z } from 'zod';
      export const webauthnAssertionSchema = z.object({
        credential: z.string().min(1),
        loginName: z.string().min(1),
        requestId: z.string().optional(),
        organization: z.string().optional(),
      });
      export interface WebAuthnVerifyLoaderData {
        csrfToken: string;
        loginName: string;
        requestId: string | undefined;
        organization: string | undefined;
        publicKeyCredentialRequestOptions: unknown;
      }
      export type WebAuthnVerifyActionData =
        | { error: 'INVALID_INPUT' }
        | { error: 'SESSION_EXPIRED' }
        | { error: 'INVALID_CREDENTIALS' };
      export function createWebAuthnVerifyHandlers(_cfg) { return { loader: async () => {}, action: async () => {} }; }
    `,
    // Task 8d: reauth-intent.ts depends on server-only cookie module.
    [resolve(root, './app/modules/auth/session/reauth-intent.ts')]: `
      export async function checkReauthIntent(_request, _loginName) {
        return { clearCookie: null, mismatch: false };
      }
      export async function readReauthIntent(_request) { return null; }
      export async function clearReauthIntent() { return 'reauth-intent=; Max-Age=0; Path=/'; }
      export async function serializeReauthIntent(_loginName) { return 'reauth-intent=stub; Path=/'; }
    `,
    // Task 8d: auth-context.server imports env.server (server-only).
    [resolve(root, './app/server/auth-context.server.ts')]: `
      export function providerForRequest(_request) {
        throw new Error('providerForRequest: not implemented in Cypress component specs');
      }
    `,
    // Task 8d: csrf.ts depends on server infrastructure.
    [resolve(root, './app/server/csrf.ts')]: `
      export async function getCsrfToken(_request) {
        return ['stub-token', null];
      }
      export async function assertCsrf(_request, _form) {}
      export async function assertCsrfWith(_request, _formData) {}
      export async function loaderCsrf(_request) {
        return { csrfToken: 'stub-token', headers: {} };
      }
    `,
    // Task 9a (fidelity fix): transport.ts imports node:crypto + @zitadel/client/node — both
    // node-only. The stub no longer reimplements resolveServiceUrl or the LRU cache; those are
    // now exercised via the REAL code:
    //   • resolveServiceUrl lives in transport.util.ts (browser-safe, NOT stubbed) so
    //     transport.cy.ts imports it directly and gets the real implementation.
    //   • Cache/createServerTransport tests run in Bun via cy.task (transport.cy.ts +
    //     transport.cache.cy.ts), so the real SHA-256 fingerprint and real @zitadel/client/node
    //     transport factory are exercised.
    // What remains here: the __setCreateServiceClientImpl hook required by index.cy.ts and
    // settings-idp.behavior.cy.ts to inject stub service-client behaviour without overwriting an
    // ES-module live binding, and minimal browser-safe stubs for the node-only exports.
    [resolve(root, './app/modules/auth/providers/zitadel/transport.ts')]: `
      // resolveServiceUrl is the real browser-safe implementation from transport.util.ts
      // (that file is NOT stubbed). Re-export it so any code importing resolveServiceUrl
      // from transport.ts or via @/modules/auth/providers/zitadel still gets real logic.
      export { resolveServiceUrl } from '@/modules/auth/providers/zitadel/transport.util';

      // Mutable hook — lets index.cy.ts / settings-idp.behavior.cy.ts replace
      // createServiceClient behaviour without overwriting an ES-module live binding.
      let _createServiceClientImpl = null;

      export function createServerTransport(_token, _baseUrl, _env) {
        return { __stubTransport: true };
      }

      export function createServiceClient(service, token, serviceUrl, env) {
        if (_createServiceClientImpl) return _createServiceClientImpl(service, token, serviceUrl, env);
        if (!serviceUrl) throw new Error('No instance url found');
        if (!token) throw new Error('No service token found');
        return {};
      }

      // Kept for any lingering import (values are meaningless in the browser stub;
      // the real values run via cy.task in Bun).
      export const __cacheSize = () => 0;
      export const __CACHE_MAX = () => 256;

      /** Test-only: replace createServiceClient behaviour for this test run. */
      export function __setCreateServiceClientImpl(fn) { _createServiceClientImpl = fn; }
      /** Test-only: restore default createServiceClient behaviour. */
      export function __resetCreateServiceClientImpl() { _createServiceClientImpl = null; }
    `,
  };
  // Task 9b: fathom-client is a THIRD-PARTY analytics SDK (calls the Fathom CDN). The original
  // vitest test used vi.mock('fathom-client', …); the browser bundle has no vi.mock equivalent, so
  // we resolve the bare specifier to a virtual recorder module that pushes every call into
  // window.__fathomCalls. This doubles only the EXTERNAL SDK (never the code under test, fathom.tsx)
  // — exactly what vi.mock did — so the spec asserts on real load/trackPageview/trackEvent wiring.
  const FATHOM_VIRTUAL = '\0virtual:fathom-client-cypress-stub';
  const fathomStub = `
    const init = () => (globalThis.__fathomCalls ??= { load: [], trackPageview: [], trackEvent: [] });
    init();
    export const load = (...args) => { init().load.push(args); };
    export const trackPageview = (...args) => { init().trackPageview.push(args); };
    export const trackEvent = (...args) => { init().trackEvent.push(args); };
  `;
  return {
    name: 'stub-server-modules-for-cypress',
    enforce: 'pre',
    resolveId(source) {
      return source === 'fathom-client' ? FATHOM_VIRTUAL : null;
    },
    load(id) {
      if (id === FATHOM_VIRTUAL) return fathomStub;
      return stubs[id] ?? null;
    },
  };
}
