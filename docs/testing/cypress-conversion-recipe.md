# Vitest → Cypress conversion recipe

Apply to every ported spec. Specs move to `cypress/component/<area>/<name>.cy.{ts,tsx}`.

## 1. Imports
- DELETE `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';`
  (`describe/it/expect/before*/after*` are Cypress globals).
- DELETE `// @vitest-environment happy-dom` / `node` directives.
- REWRITE every relative app import to the `@/` alias:
  `import { X } from '../index'` → `import { X } from '@/modules/auth/providers/zitadel';`
- Testing Library renders → `cy.mount(...)` (see §5).

## 2. Assertions (Jest matcher → Chai)
| Vitest/Jest | Cypress/Chai |
|---|---|
| `expect(x).toBe(y)` | `expect(x).to.equal(y)` |
| `expect(x).toEqual(y)` | `expect(x).to.deep.equal(y)` |
| `expect(x).toStrictEqual(y)` | `expect(x).to.deep.equal(y)` |
| `expect(x).toBeTruthy()` | `expect(x).to.be.ok` |
| `expect(x).toBeFalsy()` | `expect(x).to.not.be.ok` |
| `expect(x).toBeNull()` | `expect(x).to.be.null` |
| `expect(x).toBeUndefined()` | `expect(x).to.be.undefined` |
| `expect(x).toBeDefined()` | `expect(x).to.not.be.undefined` |
| `expect(x).toContain(y)` | `expect(x).to.include(y)` |
| `expect(arr).toHaveLength(n)` | `expect(arr).to.have.length(n)` |
| `expect(o).toHaveProperty('k', v)` | `expect(o).to.have.property('k', v)` |
| `expect(x).toMatch(/re/)` | `expect(x).to.match(/re/)` |
| `expect(fn).toThrow(msg)` | `expect(fn).to.throw(msg)` |
| `expect(spy).toHaveBeenCalled()` | `expect(spy).to.have.been.called` |
| `expect(spy).toHaveBeenCalledWith(a)` | `expect(spy).to.have.been.calledWith(a)` |

## 3. Mocks (vi → Sinon via cy)
| Vitest | Cypress |
|---|---|
| `vi.fn()` | `cy.stub()` |
| `vi.fn().mockReturnValue(x)` | `cy.stub().returns(x)` |
| `vi.fn().mockResolvedValue(x)` | `cy.stub().resolves(x)` |
| `vi.fn().mockRejectedValue(e)` | `cy.stub().rejects(e)` |
| `vi.spyOn(o,'m')` | `cy.stub(o,'m')` (auto-restored) or `cy.spy(o,'m')` |
| `.mockImplementation(fn)` | `.callsFake(fn)` |
| `vi.useFakeTimers()` | `cy.clock()` |
| `vi.clearAllMocks()` / restore | (Cypress auto-restores after each test) |

### Async rejection
```ts
it('rejects on bad input', () => {
  return doThing('bad').then(
    () => { throw new Error('expected rejection'); },
    (err) => { expect(err.message).to.include('invalid'); }
  );
});
```

## 4. Module mocking — the hard case
`vi.mock('module', factory)` has **NO** Cypress equivalent (no hoisted module
factory). Options, in order of preference:
1. **Stub the namespace import:** `import * as transport from '@/.../transport';`
   then `cy.stub(transport, 'createServiceClient').returns(fakeClient);`
   (works when the SUT calls `transport.createServiceClient()`, not a destructured
   binding). Matches the existing zitadel tests' `vi.spyOn(transport, ...)` style.
2. **Dependency injection:** if the SUT imports a server-only singleton, pass the
   dependency in (small refactor) so the spec injects a fake.
3. **Demote to e2e:** if the behavior only makes sense with real server wiring,
   cover it in a `cypress/e2e` spec instead of porting.
4. **Cut:** if it only asserted implementation details, drop it (pruning policy).

## 5. Component renders
```tsx
// before (Testing Library)
const { getByText } = render(<MemoryRouter><I18nProvider i18n={i18n}><X/></I18nProvider></MemoryRouter>);
expect(getByText(/hi/i)).toBeTruthy();
// after (cy.mount already wraps Router + Lingui)
cy.mount(<X/>);
cy.contains(/hi/i).should('exist');
```
For loader/action route components use `cy.mountRemixRoute(<X/>, { remixStubProps: { loaderData } })`.

## 6. Placement & verification
- Save under `cypress/component/<area>/<original-name-without-.test>.cy.{ts,tsx}`.
- Run the area subset: `CYPRESS=true bunx cypress run --component --spec 'cypress/component/<area>/**'`.

## 7. Node-bound / cookie-dependent logic (cy.task pattern)

### When to use it
A browser component spec CANNOT cover logic that:
- builds a `Request` carrying a **`Cookie` header** (the Fetch spec forbids it; happy-dom/Electron
  drop it) — anything that calls `readSessions(request)` / reads the signed `sessions` cookie, or
- needs **node-only modules** that `vite.config.ts` stubs for the browser bundle
  (`@/modules/auth/session/cookie`, `@/server/observability`, `@/modules/auth/select.server`,
  `@/server/infra/env.server`).

Symptom in the original test: `// @vitest-environment node` + `new Request(url, { headers: { cookie } })`.

These run their **real** code in Node via `cy.task`. The task runs OUTSIDE the Vite browser bundle,
so the vite stubs do NOT apply — real HMAC cookie signing, real `logAuthEvent` audit, real provider
selection all work. The **only** substitution is `AUTH_PROVIDER=fake`, seeded per scenario.

### Architecture
```
spec (browser)  --cy.task('callService', Scenario)-->  Cypress node (tasks.ts)
                                                          └─ execFileSync('bun', run-scenario.ts)  (cwd = repo root → @/* resolves)
                                                               └─ harness.ts: build provider+request, run REAL service, capture audit
                                                          <-- Verdict (JSON) --
spec asserts on the Verdict with Chai
```
Files (`cypress/support/node/`):
- **`scenario.ts`** — the serializable `Scenario`/`Verdict` contract. Types only; safe in BOTH the
  browser spec bundle and the Bun runner (never import an app *value* here).
- **`harness.ts`** — Bun-side. Imports the REAL app modules + FakeAuthProvider; `runScenario()`
  builds the provider/request, runs the service, serializes the outcome + translated Response +
  captured audit.
- **`run-scenario.ts`** — Bun CLI entry. Sets `SESSION_SECRET` + `AUTH_PROVIDER=fake` + `NODE_ENV`
  BEFORE dynamically importing the harness (env.server parses at load), prints the verdict between
  `__VERDICT_START__`/`__VERDICT_END__` markers.
- **`tasks.ts`** — Cypress-node side. `registerNodeTasks(on)` shells out to Bun and parses the
  verdict. MUST stay free of any `@/` import (it's bundled into the ESM config). Registered from
  `cypress.config.ts` → `component.setupNodeEvents`.
- **`call-service.ts`** — browser helper: `callService(scenario)` wraps `cy.task` with types and
  asserts `verdict.ok`.

### The cy.task API (`Scenario`)
- **request builder** — `request: { url, sessions?, form? }`. The harness signs `sessions` into a
  real `sessions` cookie (REAL cookie module) and builds a **duck-typed** request (`{ url, headers }`
  — services only read `.url` + `.headers.get('cookie')`; action services take a parsed `FormData`,
  never `request.formData()`). Do NOT use `new Request` with a Cookie header.
- **fake-provider seeding** — `provider: 'singleton'` (rich `select.server` seed: `cb`/`sr-1`/`dev-1`…)
  or `'fresh'` + `seed` (`new FakeAuthProvider(seed)`). Plus the built-in scripting seams:
  `liveSessions` (seedLiveSession), `sessionResults` (getSession → null / throw CODE),
  `callbackResults` (createCallback → throw CODE), `instanceAdminSession`, `loginDefaultRedirectUri`.
  Each cy.task call is a fresh Bun process, so the singleton is clean per case (no afterEach needed).
- **`vi.spyOn` equivalents** — for the few error/freshness modes the fake's seams don't express, the
  harness applies **instance-level method overrides** (NOT inline logic doubles):
  `failLoginSettings` (getLoginSettings throws), `failDeleteSession` (deleteSession throws),
  `freshness: { sessionId, token, verifiedAtMs }` (getSession returns a session with a CONTROLLABLE
  `password.verifiedAt` — for the prompt=login freshness gate).
- **audit capture** — the harness reassigns `console.log` around the call (logAuthEvent's default
  sink reads `console.log` by reference), returning `verdict.audit` (parsed `{event,outcome,...}`)
  and `verdict.auditLines` (raw JSON). No need to mock `logAuthEvent`.
- **call recording** — `recordCalls: ['listAuthMethods' | 'deleteSession']` wraps the method to
  record args (the N+1 / delete-all assertions). Returned in `verdict.calls`.
- **state read-back** — `inspect: { isDeviceAuthorized: [...] }` → `verdict.inspect`.
- **verdict** — `{ ok, outcome, response?, audit, auditLines, calls?, inspect? }`. `response` carries
  the translated `*ToResponse` output: `{ isResponse, status, location, setCookie, cookieEntries }`
  for a `Response`, or `{ isResponse:false, dataStatus, dataBody }` for a react-router `data()` object.
  `cookieEntries` is the node-side HMAC round-trip of the `Set-Cookie` (so the spec can assert a
  pruned entry without the cookie module).

**Assertions stay in the spec** (browser-side Chai). The task returns raw outcomes only.

### Before / after
```ts
// before (vitest, @vitest-environment node)
const req = new Request('http://localhost/id/authorize?requestId=oidc_cb', {
  headers: { cookie: (await sessionsCookie.serialize([entry])).split(';')[0] },
});
fake.setSessionResult('stale-b', { mode: 'null' });
const res = outcomeToResponse(await resolveAuthorize(fake, req), new URL(req.url));
expect(res.headers.get('location')).toContain('/login');

// after (cypress cy.task)
import { callService } from '../../../support/node/call-service';
callService({
  fn: 'resolveAuthorize',
  provider: 'singleton',
  sessionResults: { 'stale-b': { mode: 'null' } },
  request: {
    url: 'http://localhost/id/authorize?requestId=oidc_cb',
    sessions: [{ id: 'stale-b', token: 'tok-stale', loginName: 'alice@acme.test' }],
  },
}).then((v) => {
  expect(v.response?.location ?? '').to.include('/login');
  expect(v.audit.some((e) => e.event === 'session_stale')).to.equal(true);
});
```

### Extending to a new service
Add the entrypoint to `ServiceFn` (scenario.ts) and a `case` in `harness.ts`'s switch (call the
real service; serialize its outcome + any `*ToResponse`). No task re-registration needed.
