// cypress/support/node/harness.ts
//
// The Bun-side node harness. It runs OUTSIDE the Vite browser bundle, so it imports the REAL app
// modules — real HMAC cookie signing (cookie.ts), real audit emission (observability.ts), the real
// services — with only the FakeAuthProvider (AUTH_PROVIDER=fake) substituted, per scenario.
//
// This file is imported (dynamically) by run-scenario.ts AFTER the required env vars are set, so the
// env.server schema parse at module-load succeeds. Never import this from a browser spec.
import type {
  AuditEvent,
  CookieSessionSpec,
  RequestSpec,
  Scenario,
  SerializedResponse,
  Verdict,
} from './scenario';
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import {
  createServerTransport,
  createServiceClient,
  __cacheSize,
  __CACHE_MAX,
} from '@/modules/auth/providers/zitadel/transport';
import { getAuthProvider, providerRegistry } from '@/modules/auth/select.server';
import {
  sessionsCookie,
  serializeSessions,
  readSessions,
  type SessionEntry,
} from '@/modules/auth/session/cookie';
import { serializeIdpAutostart } from '@/modules/auth/session/idp-autostart';
import {
  lastUsedLoginCookie,
  serializeLastUsedLogin,
} from '@/modules/auth/session/last-used-login';
import {
  passkeyHintCookie,
  serializePasskeyHint,
  clearPasskeyHint,
} from '@/modules/auth/session/passkey-hint';
import {
  serializeReauthIntent,
  readReauthIntent,
  clearReauthIntent,
  checkReauthIntent,
} from '@/modules/auth/session/reauth-intent';
import { ProviderError, type IdpIntentResult } from '@/modules/auth/types';
import { resolveAuthorize, outcomeToResponse } from '@/resources/authorize';
import {
  lookupDeviceCode,
  lookupOutcomeToResponse,
  loadDeviceConsent,
  deviceConsentErrorToResponse,
  resolveDeviceDecision,
  decisionOutcomeToResponse,
} from '@/resources/device';
// ── mfa / otp / webauthn services (batch 8d) ──
import { chooseMfaMethod, resolveMfaPicker, resolveMfaSetup } from '@/resources/mfa';
import {
  dispatchEmailChallenge,
  submitOtpCode,
  createOtpVerifyHandlers,
  createOtpEnrollHandlers,
  type OtpSessionEntry,
} from '@/resources/otp';
import {
  resolveSignedIn,
  listAccounts,
  switchAccount,
  removeAccount,
  performLogout,
  logoutOutcomeToResponse,
  completeOidcLogout,
  type SignedInConfig,
} from '@/resources/session';
import { resolveOrg } from '@/resources/shared/resolve-org';
// ── signup / verify services (batch 8e) ──
import {
  registerAndLinkIdp,
  registerWithPassword,
  registerEmailLinkSignup,
  completeEmailLinkSignup,
} from '@/resources/signup';
import { allowResend, _resetResendLimiterForTests } from '@/resources/signup/signup-resend-limit';
import {
  processIdpCallback,
  submitLdapCredentials,
  runSsoAction,
  resolveSsoLink,
  resolveSsoManagement,
  outcomeToResponse as ssoOutcomeToResponse,
  type CallbackLoaderDeps,
  type SsoActionDeps,
} from '@/resources/sso';
import { getActiveIdPs } from '@/resources/sso/idp-providers';
import { idpReturnUrls } from '@/resources/sso/idp-return-urls';
import { signInWithIdpIntent } from '@/resources/sso/idp-session';
import { dispatchEmailCode, resendEmailCode, submitEmailCode } from '@/resources/verify';
import {
  requestPasskeyAttestation,
  requestU2FAttestation,
  requestWebAuthnChallenge,
  verifyPasskeyEnrollment,
  verifyU2FEnrollment,
} from '@/resources/webauthn/webauthn.service';
// ── routes/accounts + logout + password + setup/authenticator + verify handlers (batch 13d) ─────
import { loader as accountsLoader, action as accountsAction } from '@/routes/accounts';
// ── routes/device + routes/signup handlers (batch 13c) ────────────────────────────────────────
import {
  loader as deviceAuthorizeLoader,
  action as deviceAuthorizeAction,
} from '@/routes/device/authorize';
import { loader as deviceCompleteLoader } from '@/routes/device/complete';
import { loader as deviceIndexLoader } from '@/routes/device/index';
// ── routes/login handlers (batch 13b) ─────────────────────────────────────────────────────────
import { loader as loginLoader, action as loginAction } from '@/routes/login/index';
import { loader as loginMethodLoader, action as loginMethodAction } from '@/routes/login/method';
import { action as loginMfaAction } from '@/routes/login/mfa';
import { action as loginPasskeyAction, loader as loginPasskeyLoader } from '@/routes/login/passkey';
import { action as passkeyDiscoverAction } from '@/routes/login/passkey-discover';
import {
  action as loginPasswordAction,
  loader as loginPasswordLoader,
} from '@/routes/login/password';
import { action as securityKeyAction } from '@/routes/login/security-key';
import { loader as loginVerifyEmailLoader } from '@/routes/login/verify/email';
import { loader as logoutLoader, action as logoutAction } from '@/routes/logout/index';
import { loader as logoutSuccessLoader } from '@/routes/logout/success';
import {
  loader as passwordChangeLoader,
  action as passwordChangeAction,
} from '@/routes/password/change';
import { loader as passwordNewLoader, action as passwordNewAction } from '@/routes/password/new';
import {
  loader as passwordResetLoader,
  action as passwordResetAction,
} from '@/routes/password/reset';
import { action as reauthAction } from '@/routes/reauth';
import { loader as reauthProviderCallbackLoader } from '@/routes/reauth/provider/callback';
import { loader as setupAuthenticatorLoader } from '@/routes/setup/authenticator';
import { loader as signupCompleteLoader } from '@/routes/signup/complete';
import { loader as signupIndexLoader, action as signupIndexAction } from '@/routes/signup/index';
import { loader as signupMethodLoader, action as signupMethodAction } from '@/routes/signup/method';
import {
  loader as signupPasswordLoader,
  action as signupPasswordAction,
} from '@/routes/signup/password';
import { loader as verifyIndexLoader, action as verifyIndexAction } from '@/routes/verify/index';
import { providerForRequest } from '@/server/composition';
import { getCsrfToken, loaderCsrf, assertCsrf, assertCsrfWith } from '@/server/csrf';
import { _envSchema } from '@/server/infra/env.server';
import {
  loginPasswordRateLimit,
  webauthnVerifyRateLimit,
  mfaEnrollRateLimit,
  accountsRateLimit,
  verifyEmailSendRateLimit,
  loginMethodIntentRateLimit,
  loginMethodIntentIpRateLimit,
  loginIdentifierRateLimit,
} from '@/server/middleware/rate-limit';
import { getTraceId, runWithTraceId } from '@/server/middleware/request-context';
import {
  logAuthEvent,
  httpRequestDuration,
  registry,
  httpMetrics,
  hashActor,
  auditSink,
} from '@/server/observability';
import { samlPostHandler } from '@/server/routes/saml-post';
import { getOrCreateFingerprintId, userAgentFromRequest } from '@/server/user-agent';
import { SessionService } from '@zitadel/proto/zitadel/session/v2/session_service_pb';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCookie } from 'react-router';

// Defaults for the cookie-entry timestamps every ported spec used (the entry shape Zod-validates).
const DEFAULT_CREATION_TS = '2026-01-01T00:00:00.000Z';
const DEFAULT_EXPIRATION_TS = '2099-01-01T00:00:00.000Z';
const DEFAULT_CHANGE_TS = '2026-01-01T00:00:00.000Z';

/** Map the serializable cookie specs to the real SessionEntry[] (the Zod-validated entry shape).
 *  Shared by the cookie signer AND the 8d services that take an already-read SessionEntry[] list
 *  directly (chooseMfaMethod / resolveMfaPicker / resolveMfaSetup / verify*Enrollment). */
function buildSessionEntries(specs?: CookieSessionSpec[]): SessionEntry[] {
  return (specs ?? []).map((s) => ({
    id: s.id,
    token: s.token,
    loginName: s.loginName,
    organization: s.organization,
    creationTs: s.creationTs ?? DEFAULT_CREATION_TS,
    expirationTs: s.expirationTs ?? DEFAULT_EXPIRATION_TS,
    changeTs: s.changeTs ?? DEFAULT_CHANGE_TS,
    requestId: s.requestId,
  }));
}

/** Build a validly-signed `sessions` cookie HEADER value (name=value, attributes stripped). */
async function signSessionsCookieHeader(specs?: CookieSessionSpec[]): Promise<string | undefined> {
  if (!specs || specs.length === 0) return undefined;
  const setCookie = await sessionsCookie.serialize(buildSessionEntries(specs));
  return setCookie.split(';')[0];
}

/**
 * Compose the full Cookie request header from all the per-scenario sources: the signed `sessions`
 * cookie, a raw `fingerprintId=<value>` cookie (the OLD-app fingerprint cookie a browser already
 * carries), and a REAL signed `reauth-intent` cookie. The whole reason these specs are node-bound
 * is that the browser/Fetch spec forbids setting a Cookie header — here we build the real signed
 * values so readSessions / readReauthIntent / getOrCreateFingerprintId see authentic input.
 */
async function buildCookieHeader(req: RequestSpec): Promise<string | undefined> {
  const parts: string[] = [];
  const sessionsPart = await signSessionsCookieHeader(req.sessions);
  if (sessionsPart) parts.push(sessionsPart);
  if (req.fingerprintId) parts.push(`fingerprintId=${encodeURIComponent(req.fingerprintId)}`);
  if (req.reauthIntent) parts.push((await serializeReauthIntent(req.reauthIntent)).split(';')[0]);
  if (req.lastUsedLogin)
    parts.push((await serializeLastUsedLogin(req.lastUsedLogin)).split(';')[0]);
  if (req.passkeyHint) parts.push((await serializePasskeyHint(req.passkeyHint)).split(';')[0]);
  if (req.idpAutostart) parts.push((await serializeIdpAutostart(req.idpAutostart)).split(';')[0]);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

/**
 * Rewrite a request url to carry the `policyOrg` + `policyOrgSig` pair a REAL IdP start would
 * have minted (see RequestSpec.signPolicyOrg). Routed through `idpReturnUrls` itself rather than
 * calling the signer directly, so the producer and the consumer under test are the shipping pair.
 */
function withSignedPolicyOrg(spec: RequestSpec): RequestSpec {
  if (!spec.signPolicyOrg) return spec;
  const minted = new URL(
    idpReturnUrls('http://start.invalid', 'idp', { policyOrg: spec.signPolicyOrg }).success
  );
  const url = new URL(spec.url);
  for (const key of ['policyOrg', 'policyOrgSig']) {
    const value = minted.searchParams.get(key);
    if (value !== null) url.searchParams.set(key, value);
  }
  // Keep the signature, swap the value it vouches for (see RequestSpec.tamperPolicyOrg).
  if (spec.tamperPolicyOrg) url.searchParams.set('policyOrg', spec.tamperPolicyOrg);
  return { ...spec, url: url.toString() };
}

/**
 * Duck-typed Request. The services only ever read `.url` (via `new URL`) and
 * `.headers.get('cookie')` (via readSessions). We deliberately do NOT use `new Request` with a
 * Cookie header — the whole reason these specs are node-bound is that the Fetch spec forbids it in
 * the browser. A plain object with a real Headers carrier satisfies every call site.
 *
 * `method` defaults to 'POST' when form fields are present (action services), else 'GET'.
 * An explicit `RequestSpec.method` always wins.
 */
function buildRequest(
  url: string,
  cookieHeader?: string,
  method?: string,
  hasForm?: boolean
): Request {
  const headers = new Headers();
  if (cookieHeader) headers.set('cookie', cookieHeader);
  const resolvedMethod = method ?? (hasForm ? 'POST' : 'GET');
  return { url, method: resolvedMethod, headers } as unknown as Request;
}

function buildForm(fields?: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields ?? {})) form.set(k, v);
  return form;
}

/**
 * Build the Request a ROUTE-HANDLER FACTORY (createOtpVerifyHandlers) consumes. Unlike the bare
 * service requests, the handler internals call remix-utils' CSRF helpers, whose `getHeaders` only
 * unwraps a value that is `instanceof Request` — so this MUST be a real Request (the cookie/CSRF
 * round-trip in Bun is NOT stripped). We build a real Request and override `headers` (to carry the
 * signed Cookie) + `formData` (the action calls `request.formData()`). When `request.csrf` is set,
 * a REAL signed CSRF cookie is minted (getCsrfToken) and its token threaded into the form so
 * `assertCsrf` (csrf.validate(form, headers)) passes.
 */
async function buildHandlerRequest(
  req: RequestSpec
): Promise<{ request: Request; form: FormData }> {
  const parts: string[] = [];
  const cookieHeader = await buildCookieHeader(req);
  if (cookieHeader) parts.push(cookieHeader);

  const form = buildForm(req.form);

  if (req.csrf) {
    // getHeaders accepts a real Headers object directly (instanceof check), so probe with Headers.
    const probeHeaders = new Headers();
    if (cookieHeader) probeHeaders.set('cookie', cookieHeader);
    const [token, setCookie] = await getCsrfToken(probeHeaders as unknown as Request);
    if (setCookie) parts.push(setCookie.split(';')[0]);
    form.set('csrf', token);
  }

  const headers = new Headers();
  const finalCookie = parts.join('; ');
  if (finalCookie) headers.set('cookie', finalCookie);
  const method = req.method ?? (req.form !== undefined || req.csrf ? 'POST' : 'GET');

  // A real Request keeps `instanceof Request` true (remix-utils getHeaders needs it); override
  // headers + formData so the signed Cookie and parsed form reach the handler unmodified.
  const request = new Request(req.url, { method });
  Object.defineProperty(request, 'headers', { value: headers, configurable: true });
  Object.defineProperty(request, 'formData', { value: async () => form, configurable: true });
  // login/passkey's action wrapper reads loginName via request.clone().formData() BEFORE
  // delegating to the factory action (which consumes the body). A clone of this synthetic
  // body-less Request would NOT inherit the formData override, so hand back the same
  // object — the override is repeatable (async () => form).
  Object.defineProperty(request, 'clone', { value: () => request, configurable: true });
  return { request, form };
}

/** Construct + seed + script the FakeAuthProvider for one scenario. */
function buildProvider(s: Scenario): FakeAuthProvider {
  const mode = s.provider ?? (s.seed ? 'fresh' : 'singleton');
  const provider =
    mode === 'singleton'
      ? (getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider)
      : new FakeAuthProvider((s.seed ?? {}) as ConstructorParameters<typeof FakeAuthProvider>[0]);

  for (const ls of s.liveSessions ?? []) provider.seedLiveSession(ls);
  // The scenario uses an OPEN ProviderErrorCode union (string & {}) so future codes don't break the
  // serializable contract; cast to the fake's strict union at the call boundary.
  for (const [id, r] of Object.entries(s.sessionResults ?? {}))
    provider.setSessionResult(id, r as Parameters<typeof provider.setSessionResult>[1]);
  for (const [id, r] of Object.entries(s.callbackResults ?? {}))
    provider.setCallbackResult(id, r as Parameters<typeof provider.setCallbackResult>[1]);
  if (s.instanceAdminSession !== undefined)
    provider.setInstanceAdminSession(s.instanceAdminSession);
  if (s.loginDefaultRedirectUri !== undefined)
    provider.setLoginDefaultRedirectUri(s.loginDefaultRedirectUri);

  // Instance-level overrides — the cy.task equivalent of the original tests' vi.spyOn. They force
  // an error/freshness mode the fake's built-in scripting seams don't express; the REAL service
  // logic runs unchanged against them.
  if (s.failLoginSettings) {
    provider.getLoginSettings = (async () => {
      throw new Error('boom');
    }) as FakeAuthProvider['getLoginSettings'];
  }
  if (s.failDeleteSession) {
    provider.deleteSession = (async () => {
      throw new Error('gone');
    }) as FakeAuthProvider['deleteSession'];
  }
  if (s.failStartIdpIntent) {
    // No authUrl — exactly what a provider that accepted the call but produced nothing returns.
    // startIdpIntent (login.service.ts) maps it to { ok: false, error: 'IDP_UNAVAILABLE' }.
    provider.startIdpIntent = (async () => ({})) as FakeAuthProvider['startIdpIntent'];
  }
  if (s.freshness) {
    const { sessionId, token, verifiedAtMs } = s.freshness;
    provider.getSession = (async (id: string) => {
      if (id !== sessionId) return null;
      return {
        id: sessionId,
        token,
        factors: { password: { verifiedAt: new Date(verifiedAtMs) } },
        expiresAt: DEFAULT_EXPIRATION_TS,
        changedAt: DEFAULT_CHANGE_TS,
      };
    }) as FakeAuthProvider['getSession'];
  }
  if (s.passwordComplexity) {
    // Drive the org password-complexity policy the password-setting routes fetch. The org arg is
    // still forwarded so a recordCalls:['getPasswordComplexity'] scenario can assert the resolved org.
    const policy = s.passwordComplexity;
    provider.getPasswordComplexity = (async () =>
      policy) as FakeAuthProvider['getPasswordComplexity'];
  }
  if (s.failMarkEmailVerified) {
    provider.markEmailVerified = (async () => {
      throw new Error('Zitadel SetEmail failed');
    }) as FakeAuthProvider['markEmailVerified'];
  }
  if (s.addIdpLinkError) {
    const code = s.addIdpLinkError as ConstructorParameters<typeof ProviderError>[0];
    provider.addIdpLink = (async () => {
      throw new ProviderError(code, `scripted addIdpLink ${String(code)}`);
    }) as FakeAuthProvider['addIdpLink'];
  }
  if (s.registerError) {
    const code = s.registerError as ConstructorParameters<typeof ProviderError>[0];
    provider.register = (async () => {
      throw new ProviderError(code, `scripted register ${String(code)}`);
    }) as FakeAuthProvider['register'];
  }
  if (s.registerErrorOnce) {
    // Fails the FIRST register() call, then delegates to the REAL fake register() — drives the
    // runEnumerationSafeRegister retry-once test ("register throws transient NOT_FOUND once
    // then succeeds"). Bound before overriding so the real implementation is still reachable
    // through the closure once the script is consumed.
    const code = s.registerErrorOnce as ConstructorParameters<typeof ProviderError>[0];
    const realRegister = provider.register.bind(provider);
    let thrown = false;
    provider.register = (async (input: Parameters<FakeAuthProvider['register']>[0]) => {
      if (!thrown) {
        thrown = true;
        throw new ProviderError(code, `scripted register ${String(code)} (once)`);
      }
      return realRegister(input);
    }) as FakeAuthProvider['register'];
  }

  // ── 8d overrides ────────────────────────────────────────────────────────────
  if (s.failFindUser) {
    provider.findUser = (async () => {
      throw new Error('boom');
    }) as FakeAuthProvider['findUser'];
  }
  if (s.failPasskeyRegisterLink || s.passkeyRegisterLinkError) {
    const code = s.passkeyRegisterLinkError as ConstructorParameters<typeof ProviderError>[0];
    provider.passkeyRegisterLink = (async () => {
      throw code
        ? new ProviderError(code, `scripted passkeyRegisterLink ${String(code)}`)
        : new Error('zitadel down');
    }) as FakeAuthProvider['passkeyRegisterLink'];
  }
  if (s.failVerifyPasskey) {
    const code = s.failVerifyPasskey as ConstructorParameters<typeof ProviderError>[0];
    provider.verifyPasskey = (async () => {
      throw new ProviderError(code, `scripted verifyPasskey ${String(code)}`);
    }) as FakeAuthProvider['verifyPasskey'];
  }
  if (s.failVerifyU2F) {
    const code = s.failVerifyU2F as ConstructorParameters<typeof ProviderError>[0];
    provider.verifyU2F = (async () => {
      throw new ProviderError(code, `scripted verifyU2F ${String(code)}`);
    }) as FakeAuthProvider['verifyU2F'];
  }

  // ── 8e overrides ────────────────────────────────────────────────────────────
  if (s.failSendEmailCode) {
    const code = s.failSendEmailCode as ConstructorParameters<typeof ProviderError>[0];
    provider.sendEmailCode = (async () => {
      throw new ProviderError(code, `scripted sendEmailCode ${String(code)}`);
    }) as FakeAuthProvider['sendEmailCode'];
  }
  if (s.failResendEmailCode) {
    const code = s.failResendEmailCode as ConstructorParameters<typeof ProviderError>[0];
    provider.resendEmailCode = (async () => {
      throw new ProviderError(code, `scripted resendEmailCode ${String(code)}`);
    }) as FakeAuthProvider['resendEmailCode'];
  }
  if (s.failVerifyEmail) {
    const code = s.failVerifyEmail as ConstructorParameters<typeof ProviderError>[0];
    provider.verifyEmail = (async () => {
      throw new ProviderError(code, `scripted verifyEmail ${String(code)}`);
    }) as FakeAuthProvider['verifyEmail'];
    // verifyInvite delegates to verifyEmail in the fake — override it too for invite flows.
    provider.verifyInvite = provider.verifyEmail as unknown as FakeAuthProvider['verifyInvite'];
  }
  if (s.failGetSession) {
    provider.getSession = (async () => {
      throw new Error('scripted getSession failure');
    }) as FakeAuthProvider['getSession'];
  }

  // ── 13b overrides ─────────────────────────────────────────────────────────────
  if (s.mockLoginSettings) {
    const override = s.mockLoginSettings;
    provider.getLoginSettings = (async () =>
      override) as unknown as FakeAuthProvider['getLoginSettings'];
  }

  return provider;
}

/** Serialize a react-router Response (or data() object) for the verdict. */
async function serializeResponse(res: unknown): Promise<SerializedResponse> {
  if (res instanceof Response) {
    const setCookie = res.headers.get('set-cookie');
    // undici exposes getSetCookie() so multi-cookie responses (sessions + last-used-login +
    // fingerprintId) are not flattened into one comma-joined string we'd have to re-split.
    const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const setCookies =
      typeof getSetCookie === 'function'
        ? getSetCookie.call(res.headers)
        : setCookie
          ? [setCookie]
          : [];

    // `sessions` HMAC round-trip (node-only) so a spec can assert the pruned entry set.
    let cookieEntries: Array<{ id: string }> | null = null;
    const sessionsCookieStr = setCookies.find((c) => c.startsWith('sessions='));
    if (sessionsCookieStr) {
      try {
        const parsed = await sessionsCookie.parse(sessionsCookieStr.split(';')[0]);
        cookieEntries = Array.isArray(parsed)
          ? parsed.map((e: { id: string }) => ({ id: e.id }))
          : null;
      } catch {
        cookieEntries = null;
      }
    }

    // last-used-login token (e.g. `idp:<idpId>`) — signed, so parse via the real cookie module.
    let lastUsedLogin: string | null = null;
    const lastUsedStr = setCookies.find((c) => c.startsWith('last-used-login='));
    if (lastUsedStr) {
      try {
        const parsed = await lastUsedLoginCookie.parse(lastUsedStr.split(';')[0]);
        lastUsedLogin = typeof parsed === 'string' ? parsed : (parsed ?? null);
      } catch {
        lastUsedLogin = null;
      }
    }

    // passkey-hint loginName — signed, so parse via the real cookie module. A CLEARING
    // Set-Cookie (empty signed value + Max-Age=0) parses to '' — distinct from null (untouched).
    let passkeyHint: string | null = null;
    const hintStr = setCookies.find((c) => c.startsWith('passkey-hint='));
    if (hintStr) {
      try {
        const parsed = await passkeyHintCookie.parse(hintStr.split(';')[0]);
        passkeyHint = typeof parsed === 'string' ? parsed : (parsed ?? null);
      } catch {
        passkeyHint = null;
      }
    }

    // fingerprintId is a BARE (unsigned) cookie value — decode it directly.
    let fingerprintId: string | null = null;
    const fpStr = setCookies.find((c) => c.startsWith('fingerprintId='));
    if (fpStr) {
      fingerprintId = decodeURIComponent(fpStr.split(';')[0].slice('fingerprintId='.length));
    }

    // Plain-JSON responses (Response.json from direct-fetch API actions like
    // /login/passkey-discover) — capture the body so specs can assert on it.
    let dataBody: unknown;
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      try {
        dataBody = await res.clone().json();
      } catch {
        dataBody = undefined;
      }
    }

    return {
      isResponse: true,
      status: res.status,
      location: res.headers.get('location'),
      setCookie,
      cookieEntries,
      setCookies,
      lastUsedLogin,
      passkeyHint,
      fingerprintId,
      dataBody,
    };
  }
  // react-router data() object: { data, init: { status, headers } }
  const d = res as { data?: unknown; init?: { status?: number; headers?: HeadersInit } };
  const initHeaders = d?.init?.headers ? new Headers(d.init.headers) : null;
  const getInitSetCookie = initHeaders
    ? (initHeaders as Headers & { getSetCookie?: () => string[] }).getSetCookie
    : undefined;
  const dataSetCookies =
    initHeaders && typeof getInitSetCookie === 'function'
      ? getInitSetCookie.call(initHeaders)
      : undefined;
  return { isResponse: false, dataStatus: d?.init?.status, dataBody: d?.data, dataSetCookies };
}

/** Parse a captured audit JSON line into a structured event (or null if it isn't one). */
function parseAuditLine(line: string): AuditEvent | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (obj && typeof obj.event === 'string' && typeof obj.outcome === 'string') {
      return obj as unknown as AuditEvent;
    }
  } catch {
    /* not a structured audit line */
  }
  return null;
}

/** Run one scenario against the real services and produce a fully serializable verdict. */
export async function runScenario(s: Scenario): Promise<Verdict> {
  const provider = buildProvider(s);

  // Record provider call args where requested (e.g. the listAuthMethods N+1 dedupe assertion).
  const calls: Record<string, unknown[][]> = {};
  for (const name of s.recordCalls ?? []) {
    calls[name] = [];
    const target = provider as unknown as Record<string, (...a: unknown[]) => unknown>;
    const orig = target[name].bind(provider);
    target[name] = (...args: unknown[]) => {
      calls[name].push(args);
      return orig(...args);
    };
  }

  const requestSpec = s.request ? withSignedPolicyOrg(s.request) : undefined;
  const cookieHeader = requestSpec ? await buildCookieHeader(requestSpec) : undefined;
  const request = requestSpec
    ? buildRequest(
        requestSpec.url,
        cookieHeader,
        requestSpec.method,
        requestSpec.form !== undefined
      )
    : (undefined as unknown as Request);

  // Capture REAL audit output: logAuthEvent's default sink is console.log, read by reference at
  // call time, so reassigning console.log here intercepts every emitted event (the cy.task
  // analogue of the vitest `vi.spyOn(console, 'log')` the logout spec used).
  const auditLines: string[] = [];
  /* eslint-disable no-console -- intentional: intercept the audit sink (console.log) to capture
     real logAuthEvent output, then restore it in the finally block below. */
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    auditLines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  /* eslint-enable no-console */

  let outcome: unknown;
  let response: SerializedResponse | undefined;
  let error: string | undefined;

  // Pre-Task-10 cases always supply request; Task-10 cases build their own requests internally.
  const sr = s.request ?? { url: '' };

  try {
    switch (s.fn) {
      case 'resolveAuthorize': {
        outcome = await resolveAuthorize(provider, request, s.nowMs);
        response = await serializeResponse(
          outcomeToResponse(
            outcome as Parameters<typeof outcomeToResponse>[0],
            new URL(request.url)
          )
        );
        break;
      }
      case 'resolveSignedIn': {
        const cfg: SignedInConfig = s.signedInConfig ?? { consoleUrl: '' };
        outcome = await resolveSignedIn(provider, request, cfg);
        break;
      }
      case 'switchAccount': {
        outcome = await switchAccount(provider, request, buildForm(sr.form));
        break;
      }
      case 'removeAccount': {
        outcome = await removeAccount(provider, request, buildForm(sr.form));
        break;
      }
      case 'listAccounts': {
        outcome = await listAccounts(provider, request);
        break;
      }
      case 'performLogout': {
        const o = await performLogout(provider, request);
        outcome = o;
        response = await serializeResponse(logoutOutcomeToResponse(o));
        break;
      }
      case 'completeOidcLogout': {
        outcome = await completeOidcLogout(provider, request);
        break;
      }
      case 'lookupDeviceCode': {
        const o = await lookupDeviceCode(provider, buildForm(sr.form));
        outcome = o;
        response = await serializeResponse(lookupOutcomeToResponse(o));
        break;
      }
      case 'loadDeviceConsent': {
        const o = await loadDeviceConsent(provider, request);
        outcome = o;
        if (o.kind === 'error')
          response = await serializeResponse(deviceConsentErrorToResponse(o.error));
        break;
      }
      case 'resolveDeviceDecision': {
        const o = await resolveDeviceDecision(provider, request, buildForm(sr.form));
        outcome = o;
        response = await serializeResponse(decisionOutcomeToResponse(o));
        break;
      }
      case 'processIdpCallback': {
        // DI seam: inject the resolved intent (or a transient ProviderError) instead of a real
        // IdP round-trip — mirrors the original tests' `retrieveIdpIntent` stub.
        const deps: CallbackLoaderDeps = {};
        if (s.idpIntentError !== undefined) {
          const code = s.idpIntentError as ConstructorParameters<typeof ProviderError>[0];
          deps.retrieveIdpIntent = () =>
            Promise.reject(new ProviderError(code, `scripted retrieveIdpIntent ${String(code)}`));
        } else if (s.idpIntent !== undefined) {
          const intent = s.idpIntent as unknown as IdpIntentResult;
          deps.retrieveIdpIntent = () => Promise.resolve(intent);
        }
        const o = await processIdpCallback(provider, request, s.slug, deps);
        outcome = o;
        response = await serializeResponse(ssoOutcomeToResponse(o));
        break;
      }
      case 'signInWithIdpIntent': {
        if (!s.signInOpts) throw new Error('signInWithIdpIntent requires signInOpts');
        outcome = await signInWithIdpIntent(provider, request, s.signInOpts);
        break;
      }
      case 'reauthAction': {
        const originalFake = providerRegistry.fake;
        providerRegistry.fake = () => provider;
        try {
          const { request } = await buildHandlerRequest(
            s.request ?? { url: 'http://localhost/id/reauth', csrf: true }
          );
          const result = await reauthAction({
            request,
            params: {},
            context: {} as never,
          } as never);
          response = await serializeResponse(result);
        } finally {
          providerRegistry.fake = originalFake;
        }
        break;
      }

      case 'reauthProviderCallback': {
        // The route loader resolves its own provider via providerForRequest → getAuthProvider('fake')
        // → providerRegistry.fake(), which is INDEPENDENT of the `provider` this harness already
        // built above (buildProvider constructs a FRESH FakeAuthProvider whenever `seed` is present —
        // and this fn's tests always seed idpIntents/users). Without this bridge the loader would see
        // the unrelated process-fake singleton (no seeded idpIntent, no seeded live session) instead
        // of the one this scenario actually configured. Point the registry at the SAME seeded
        // provider for the duration of this call only, then restore it.
        const originalFake = providerRegistry.fake;
        providerRegistry.fake = () => provider;
        try {
          const { request: req } = await buildHandlerRequest(sr);
          const res = await reauthProviderCallbackLoader({
            request: req,
            params: { provider: s.slug ?? 'idp' },
          } as never);
          outcome = res;
          response = await serializeResponse(res);
        } finally {
          providerRegistry.fake = originalFake;
        }
        break;
      }
      case 'submitLdapCredentials': {
        const o = await submitLdapCredentials(provider, request, buildForm(sr.form));
        outcome = o;
        response = await serializeResponse(ssoOutcomeToResponse(o));
        break;
      }
      case 'runSsoAction': {
        const deps: SsoActionDeps = {};
        if (s.startIdpIntentError !== undefined) {
          const code = s.startIdpIntentError as ConstructorParameters<typeof ProviderError>[0];
          deps.startIdpIntent = () =>
            Promise.reject(new ProviderError(code, `scripted startIdpIntent ${String(code)}`));
        }
        const o = await runSsoAction(provider, request, buildForm(sr.form), deps);
        outcome = o;
        response = await serializeResponse(ssoOutcomeToResponse(o));
        break;
      }
      case 'resolveSsoLink': {
        // IdP-DISPLAY flow: resolveSsoLink reads a real Request (org from `?organization=`) and the
        // seeded fake provider. recordCalls captures the org threaded into getActiveIdPs.
        outcome = await resolveSsoLink(provider, request);
        break;
      }
      case 'resolveSsoManagement': {
        // /sso management IdP-DISPLAY flow. csrf is a stub token — the getActiveIdPs read runs
        // before CSRF is consumed, and the no-session case still records the org arg.
        outcome = await resolveSsoManagement(provider, request, {
          token: 'harness-csrf',
          setCookie: null,
        });
        break;
      }
      case 'activeIdPsProbe': {
        // The idp-providers wrapper choke point directly: assert the org threaded into the port.
        const idps = await getActiveIdPs(provider, s.resolveOrgInput?.urlOrg);
        outcome = { count: idps.length };
        break;
      }
      // ── mfa / otp / webauthn services (batch 8d) ──────────────────────────
      case 'chooseMfaMethod': {
        if (!s.mfaInput) throw new Error('chooseMfaMethod requires mfaInput');
        outcome = await chooseMfaMethod(
          provider,
          buildSessionEntries(sr.sessions),
          sr.form ?? {},
          s.mfaInput
        );
        break;
      }
      case 'resolveMfaPicker': {
        if (!s.mfaInput) throw new Error('resolveMfaPicker requires mfaInput');
        outcome = await resolveMfaPicker(provider, buildSessionEntries(sr.sessions), s.mfaInput);
        break;
      }
      case 'resolveMfaSetup': {
        if (!s.mfaInput) throw new Error('resolveMfaSetup requires mfaInput');
        outcome = await resolveMfaSetup(provider, buildSessionEntries(sr.sessions), s.mfaInput);
        break;
      }
      case 'dispatchEmailChallenge': {
        if (!s.emailChallengeInput)
          throw new Error('dispatchEmailChallenge requires emailChallengeInput');
        const entry = buildSessionEntries(sr.sessions)[0] as OtpSessionEntry;
        outcome = await dispatchEmailChallenge(provider, entry, s.emailChallengeInput);
        break;
      }
      case 'submitOtpCode': {
        if (!s.otpChannel) throw new Error('submitOtpCode requires otpChannel');
        const entry = buildSessionEntries(sr.sessions)[0] as OtpSessionEntry | undefined;
        outcome = await submitOtpCode(provider, s.otpChannel, sr.form ?? {}, entry);
        break;
      }
      case 'requestPasskeyAttestation': {
        if (!s.attestationInput)
          throw new Error('requestPasskeyAttestation requires attestationInput');
        outcome = await requestPasskeyAttestation(
          provider,
          buildSessionEntries(sr.sessions),
          s.attestationInput
        );
        break;
      }
      case 'requestU2FAttestation': {
        if (!s.attestationInput) throw new Error('requestU2FAttestation requires attestationInput');
        outcome = await requestU2FAttestation(
          provider,
          buildSessionEntries(sr.sessions),
          s.attestationInput
        );
        break;
      }
      case 'requestWebAuthnChallenge': {
        if (!s.attestationInput)
          throw new Error('requestWebAuthnChallenge requires attestationInput');
        // Mirror the real verify loader, which always opts into the stale-session self-heal.
        // Recovery re-mints a session, so it needs a Request for the fingerprint + user-agent.
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/login/passkey' }
        );
        outcome = await requestWebAuthnChallenge(
          provider,
          buildSessionEntries(sr.sessions),
          { userVerificationRequirement: 'required', challengeAuditEvent: 'mfa_passkey_challenge' },
          s.attestationInput,
          { request }
        );
        break;
      }
      case 'verifyPasskeyEnrollment': {
        const i = s.verifyEnrollInput;
        if (!i) throw new Error('verifyPasskeyEnrollment requires verifyEnrollInput');
        outcome = await verifyPasskeyEnrollment(provider, buildSessionEntries(sr.sessions), {
          credential: i.credential,
          passkeyId: i.passkeyId ?? '',
          loginName: i.loginName,
          requestId: i.requestId,
          organization: i.organization,
          checkAfter: i.checkAfter,
        });
        break;
      }
      case 'verifyU2FEnrollment': {
        const i = s.verifyEnrollInput;
        if (!i) throw new Error('verifyU2FEnrollment requires verifyEnrollInput');
        outcome = await verifyU2FEnrollment(provider, buildSessionEntries(sr.sessions), {
          credential: i.credential,
          u2fId: i.u2fId ?? '',
          loginName: i.loginName,
          requestId: i.requestId,
          organization: i.organization,
          checkAfter: i.checkAfter,
        });
        break;
      }
      case 'otpVerifyLoader': {
        if (!s.otpVerifyConfig) throw new Error('otpVerifyLoader requires otpVerifyConfig');
        const { loader } = createOtpVerifyHandlers(s.otpVerifyConfig);
        const { request: req } = await buildHandlerRequest(sr);
        const res = await loader({ request: req } as never);
        outcome = res;
        response = await serializeResponse(res);
        break;
      }
      case 'otpVerifyAction': {
        if (!s.otpVerifyConfig) throw new Error('otpVerifyAction requires otpVerifyConfig');
        const { action } = createOtpVerifyHandlers(s.otpVerifyConfig);
        const { request: req } = await buildHandlerRequest(sr);
        const res = await action({ request: req } as never);
        outcome = res;
        response = await serializeResponse(res);
        break;
      }
      case 'otpEnrollLoader': {
        if (!s.otpEnrollConfig) throw new Error('otpEnrollLoader requires otpEnrollConfig');
        // enroll/factor are unused by the LOADER (only the action's checkAfter branch reads
        // cfg.verifyPath, and enroll/factor drive the action's enroll step) — this task only
        // exercises the loader's guard-fail /login bounce, so a no-op stub is enough.
        const { loader } = createOtpEnrollHandlers({
          enroll: async () => {},
          factor: 'otp_email',
          verifyPath: s.otpEnrollConfig.verifyPath,
        });
        const { request: req } = await buildHandlerRequest(sr);
        const res = await loader({ request: req } as never);
        outcome = res;
        response = await serializeResponse(res);
        break;
      }
      // ── signup service (batch 8e) ────────────────────────────────────────────
      // observability.ts is stubbed to a no-op in the Vite browser bundle — the real logAuthEvent
      // (with its console.log sink) must run node-side so audit-shape assertions are meaningful.
      case 'registerWithPassword': {
        if (!s.signupInput) throw new Error('registerWithPassword requires signupInput');
        const i = s.signupInput;
        if (!i.password) throw new Error('registerWithPassword requires signupInput.password');
        outcome = await registerWithPassword(provider, buildSessionEntries(sr.sessions), {
          email: i.email,
          firstName: i.firstName,
          lastName: i.lastName,
          password: i.password,
          organization: i.organization,
          requestId: i.requestId,
          requireVerification: i.requireVerification ?? false,
          origin: i.origin ?? 'https://auth.datum.net',
          deviceTrackingToken: i.deviceTrackingToken,
          userAgent: i.userAgent as never,
        });
        break;
      }
      case 'allowResend': {
        // Each callService spawns a fresh Bun process, so limiter state starts clean; the
        // reset is a belt-and-braces guard against that process model ever changing.
        _resetResendLimiterForTests();
        const verdicts: boolean[] = [];
        for (const c of s.resendChecks ?? []) {
          verdicts.push(await allowResend(c.email, c.nowMs));
        }
        outcome = verdicts;
        break;
      }
      case 'registerEmailLinkSignupTwice': {
        // D-RL: both submissions must share one process, or the module-level rate limiter
        // can never fire (every callService is a fresh Bun process).
        if (!s.signupInput) throw new Error('registerEmailLinkSignupTwice requires signupInput');
        const i = s.signupInput;
        const signupInput = {
          email: i.email,
          firstName: i.firstName,
          lastName: i.lastName,
          organization: i.organization,
          requestId: i.requestId,
          origin: i.origin ?? 'https://auth.datum.net',
          deviceTrackingToken: i.deviceTrackingToken,
        };
        const first = await registerEmailLinkSignup(
          provider,
          buildSessionEntries(sr.sessions),
          signupInput
        );
        const second = await registerEmailLinkSignup(
          provider,
          buildSessionEntries(sr.sessions),
          signupInput
        );
        outcome = [first, second];
        break;
      }
      case 'registerEmailLinkSignup': {
        if (!s.signupInput) throw new Error('registerEmailLinkSignup requires signupInput');
        const i = s.signupInput;
        outcome = await registerEmailLinkSignup(provider, buildSessionEntries(sr.sessions), {
          email: i.email,
          firstName: i.firstName,
          lastName: i.lastName,
          organization: i.organization,
          requestId: i.requestId,
          origin: i.origin ?? 'https://auth.datum.net',
          deviceTrackingToken: i.deviceTrackingToken,
        });
        break;
      }
      case 'registerAndLinkIdp': {
        if (!s.signupInput) throw new Error('registerAndLinkIdp requires signupInput');
        const i = s.signupInput;
        if (!i.idpIntentId || !i.idpIntentToken || !i.idpId || !i.idpUserId || !i.idpUserName)
          throw new Error(
            'registerAndLinkIdp requires idpIntentId/Token/idpId/idpUserId/idpUserName'
          );
        outcome = await registerAndLinkIdp(provider, buildSessionEntries(sr.sessions), {
          email: i.email,
          firstName: i.firstName,
          lastName: i.lastName,
          organization: i.organization,
          requestId: i.requestId,
          idpIntentId: i.idpIntentId,
          idpIntentToken: i.idpIntentToken,
          idpId: i.idpId,
          idpUserId: i.idpUserId,
          idpUserName: i.idpUserName,
          userAgent: i.userAgent as never,
        });
        break;
      }
      case 'completeEmailLinkSignup': {
        if (!s.signupInput) throw new Error('completeEmailLinkSignup requires signupInput');
        const i = s.signupInput;
        if (!i.userId || !i.loginName)
          throw new Error('completeEmailLinkSignup requires userId and loginName');
        // verifyEmail needs a valid code — in the fake, register() sets emailCodes.set(id, `email-${id}`)
        // so the spec must pass the right code for the registered user.
        const code = i.code ?? `email-${i.userId}`;
        outcome = await completeEmailLinkSignup(provider, buildSessionEntries(sr.sessions), {
          userId: i.userId,
          code,
          loginName: i.loginName,
          organization: i.organization,
          requestId: i.requestId,
          next: i.next === 'passkey' ? 'passkey' : undefined,
          deviceTrackingToken: i.deviceTrackingToken,
          userAgent: i.userAgent as never,
        });
        break;
      }
      // ── verify service (batch 8e) ─────────────────────────────────────────────
      // The session-ownership gate (dispatchEmailCode) requires getSession to run node-side so the
      // provider-side ownership check (session.user.id === userId) works against the real fake.
      case 'dispatchEmailCode': {
        if (!s.verifyEmailInput) throw new Error('dispatchEmailCode requires verifyEmailInput');
        const vei = s.verifyEmailInput;
        // Resolve the active session from the scenario's liveSessions (first seeded entry).
        // buildProvider already seeded these into the provider via seedLiveSession. We pass
        // the raw spec entry so dispatchEmailCode's ownership gate can call getSession(id, token).
        const activeSessionEntry = s.liveSessions?.[0];
        const session = activeSessionEntry
          ? { id: activeSessionEntry.id, token: activeSessionEntry.token }
          : undefined;
        outcome = await dispatchEmailCode(provider, {
          userId: vei.userId,
          origin: vei.origin,
          requestId: vei.requestId,
          invite: vei.invite,
          session,
        });
        break;
      }
      case 'resendEmailCode': {
        if (!s.verifyEmailInput) throw new Error('resendEmailCode requires verifyEmailInput');
        const vei = s.verifyEmailInput;
        // Thread the active session (first seeded liveSessions entry) so resendEmailCode's
        // session-ownership gate can call getSession(id, token) node-side against the real fake —
        // mirrors dispatchEmailCode above. Without it the gate fail-closes to INVALID_INPUT.
        const activeSessionEntry = s.liveSessions?.[0];
        const session = activeSessionEntry
          ? { id: activeSessionEntry.id, token: activeSessionEntry.token }
          : undefined;
        outcome = await resendEmailCode(provider, {
          userId: vei.userId,
          origin: vei.origin,
          requestId: vei.requestId,
          invite: vei.invite,
          session,
        });
        break;
      }
      case 'submitEmailCode': {
        if (!s.verifyEmailInput) throw new Error('submitEmailCode requires verifyEmailInput');
        const vei = s.verifyEmailInput;
        // Build formEntries from verifyEmailInput fields (mirrors verifyCodeSchema input shape).
        const formEntries: Record<string, unknown> = {
          userId: vei.userId,
          ...(vei.code !== undefined && { code: vei.code }),
          ...(vei.invite !== undefined && { invite: String(vei.invite) }),
          ...(vei.loginName !== undefined && { loginName: vei.loginName }),
          ...(vei.organization !== undefined && { organization: vei.organization }),
          ...(vei.requestId !== undefined && { requestId: vei.requestId }),
        };
        outcome = await submitEmailCode(provider, formEntries, vei.isSessionActive ?? false);
        break;
      }
      case 'parseEnv': {
        // Drive the REAL env.server Zod schema with an arbitrary raw object (SEC-5).
        const result = _envSchema.safeParse(s.parseEnvRaw ?? {});
        outcome = {
          success: result.success,
          ALLOW_IDP_UNLINK: result.success ? result.data.ALLOW_IDP_UNLINK : undefined,
        };
        break;
      }
      // ── transport cache (9a fidelity fix) ────────────────────────────────────
      // Runs the REAL transport.ts code (SHA-256 fingerprint, real LRU cap, real
      // @zitadel/client/node factory) in this Bun process. Each cy.task call is a
      // fresh process so module-level Maps start empty — no afterEach needed.
      case 'transportCacheCheck': {
        const op = s.transportOp;
        if (!op) throw new Error('transportCacheCheck requires transportOp');
        switch (op) {
          case 'serverTransportCacheHit': {
            const a = createServerTransport('tok-ct-1', 'https://z-ct.test');
            const b = createServerTransport('tok-ct-1', 'https://z-ct.test');
            outcome = { hit: a === b };
            break;
          }
          case 'serverTransportCacheMiss': {
            const a = createServerTransport('tok-ct-2', 'https://z-ct.test');
            const b = createServerTransport('tok-ct-2', 'https://other-ct.test');
            outcome = { miss: a !== b };
            break;
          }
          case 'serverTransportThrowsEmptyBase': {
            let threw = false;
            let message = '';
            try {
              createServerTransport('tok', '');
            } catch (e) {
              threw = true;
              message = e instanceof Error ? e.message : String(e);
            }
            outcome = { threw, message };
            break;
          }
          case 'serverTransportThrowsEmptyToken': {
            let threw = false;
            let message = '';
            try {
              createServerTransport('', 'https://z.test');
            } catch (e) {
              threw = true;
              message = e instanceof Error ? e.message : String(e);
            }
            outcome = { threw, message };
            break;
          }
          case 'clientCacheCap': {
            // 500 unique tokens — real SHA-256 fingerprinting, real client creation.
            // Uses SessionService (a real DescService descriptor) so createClientFor works.
            for (let i = 0; i < 500; i++) {
              createServiceClient(SessionService, `tok-cache-${i}`, 'https://z.test');
            }
            outcome = { size: __cacheSize(), max: __CACHE_MAX() };
            break;
          }
          case 'clientCacheRotatedToken': {
            const a = createServiceClient(SessionService, 'tok-cache-A', 'https://z-cache.test');
            const b = createServiceClient(SessionService, 'tok-cache-B', 'https://z-cache.test');
            outcome = { distinct: a !== b };
            break;
          }
          case 'clientCacheSameToken': {
            const a = createServiceClient(SessionService, 'tok-cache-same', 'https://z-cache.test');
            const b = createServiceClient(SessionService, 'tok-cache-same', 'https://z-cache.test');
            outcome = { reused: a === b };
            break;
          }
          case 'sha256FingerprintDistinctness': {
            // Two tokens with the same first 16 chars but different suffixes must produce
            // DIFFERENT cache entries. The old stub used slice(0,16) as the fingerprint,
            // which would key these identically (a === b). The real SHA-256 distinguishes them.
            const prefix = 'aaaaaaaabbbbbbbb'; // exactly 16 chars
            const a = createServerTransport(prefix + 'CCCC', 'https://z-sha256.test');
            const b = createServerTransport(prefix + 'DDDD', 'https://z-sha256.test');
            outcome = { distinct: a !== b };
            break;
          }
          default: {
            const exhaustiveOp: never = op;
            throw new Error(`unknown transportOp: ${String(exhaustiveOp)}`);
          }
        }
        break;
      }
      // ── session-cookie / signing checks (batch 9b) ─────────────────────────────
      // Runs the REAL cookie/last-used-login/reauth-intent/select.server code in Bun (those
      // modules are stubbed out of the Vite browser bundle). Each op runs ONE real function so the
      // console.log audit captured above belongs to that single call; the spec asserts on it.
      case 'cookieGuardCheck': {
        const op = s.cookieGuardOp;
        if (!op) throw new Error('cookieGuardCheck requires cookieGuardOp');
        const entry: SessionEntry = {
          id: 's1',
          token: 't1',
          loginName: 'a@acme.test',
          creationTs: '2026-01-01T00:00:00.000Z',
          expirationTs: '2099-01-01T00:00:00.000Z',
          changeTs: '2026-01-01T00:00:00.000Z',
        };
        const toHeader = (setCookie: string): string => setCookie.split(';')[0].trim();
        const reqWithCookie = (cookieHeader?: string): Request => {
          const headers = new Headers();
          if (cookieHeader) headers.set('cookie', cookieHeader);
          return {
            url: 'http://localhost/id/accounts',
            method: 'GET',
            headers,
          } as unknown as Request;
        };
        let result: SessionEntry[] = [];
        if (op === 'validRoundTrip') {
          result = await readSessions(reqWithCookie(toHeader(await serializeSessions([entry]))));
        } else if (op === 'absent') {
          result = await readSessions(reqWithCookie());
        } else if (op === 'tamperedSignature') {
          const header = toHeader(await serializeSessions([entry]));
          const eq = header.indexOf('=');
          const tampered = header.slice(0, eq + 6) + 'XXXXX' + header.slice(eq + 11);
          result = await readSessions(reqWithCookie(tampered));
        } else if (op === 'forgedWrongShape') {
          const forger = createCookie('sessions', {
            secrets: [process.env.SESSION_SECRET ?? ''],
            path: '/',
          });
          const garbage = toHeader(await forger.serialize([{ bogus: true }]));
          result = await readSessions(reqWithCookie(garbage));
        } else if (op === 'forgedNonArray') {
          const forger = createCookie('sessions', {
            secrets: [process.env.SESSION_SECRET ?? ''],
            path: '/',
          });
          const garbage = toHeader(await forger.serialize({ not: 'an array' }));
          result = await readSessions(reqWithCookie(garbage));
        }
        outcome = { count: result.length, firstId: result[0]?.id ?? null };
        break;
      }
      case 'cookieRoundTripCheck': {
        const op = s.cookieOp;
        if (!op) throw new Error('cookieRoundTripCheck requires cookieOp');
        const base: SessionEntry = {
          id: 's1',
          token: 't1',
          loginName: 'a@acme.test',
          creationTs: '1000',
          expirationTs: '9999999999999',
          changeTs: '1000',
        };
        const makeEntry = (
          id: string,
          changeTs: string,
          loginName = 'a@acme.test'
        ): SessionEntry => ({
          ...base,
          id,
          token: `tok-${id}`,
          loginName,
          changeTs,
        });
        const toHeader = (sc: string): string => sc.split(';')[0].trim();
        if (op === 'roundTrip2') {
          const sc = await serializeSessions([makeEntry('s1', '100'), makeEntry('s2', '200')]);
          const parsed = ((await sessionsCookie.parse(toHeader(sc))) ?? []) as SessionEntry[];
          outcome = { ids: parsed.map((p) => p.id).sort() };
        } else if (op === 'tampered') {
          const header = toHeader(await serializeSessions([makeEntry('s1', '100')]));
          const parts = header.split('=');
          const tampered =
            parts[0] +
            '=' +
            parts
              .slice(1)
              .join('=')
              .replace(/^(.....)/, (m) => m.split('').reverse().join(''));
          const result = ((await sessionsCookie.parse(tampered)) ?? []) as SessionEntry[];
          outcome = { result: result.map((p) => p.id) };
        } else if (op === 'overflow') {
          const longName = 'a'.repeat(150) + '@acme.test';
          const entries = Array.from({ length: 10 }, (_, i) =>
            makeEntry(`s${i + 1}`, String((i + 1) * 100), longName)
          );
          const sc = await serializeSessions(entries);
          const bytes = new TextEncoder().encode(sc).byteLength;
          const parsed = ((await sessionsCookie.parse(toHeader(sc))) ?? []) as SessionEntry[];
          const byNewest = [...entries].sort((a, b) => Number(b.changeTs) - Number(a.changeTs));
          const expectedIds = byNewest
            .slice(0, parsed.length)
            .map((e) => e.id)
            .sort();
          outcome = {
            bytes,
            parsedIds: parsed.map((p) => p.id).sort(),
            expectedIds,
            parsedLen: parsed.length,
          };
        } else if (op === 'giant') {
          const giant = makeEntry('s-giant', '999', 'x'.repeat(2000) + '@example.com');
          const sc = await serializeSessions([giant]);
          const bytes = new TextEncoder().encode(sc).byteLength;
          const parsed = ((await sessionsCookie.parse(toHeader(sc))) ?? []) as SessionEntry[];
          outcome = { bytes, parsedLen: parsed.length };
        } else if (op === 'crossReplica') {
          const SHARED = 'test-secret-test-secret-32-chars!!';
          const replicaA = createCookie('sessions', {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            secrets: [SHARED],
          });
          const sc = await replicaA.serialize([makeEntry('x1', '500')]);
          const replicaB = createCookie('sessions', {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            secrets: [SHARED],
          });
          const parsed = ((await replicaB.parse(toHeader(sc))) ?? []) as SessionEntry[];
          outcome = { count: parsed.length, firstId: parsed[0]?.id ?? null };
        }
        break;
      }
      case 'lastUsedLoginCheck': {
        const op = s.lastUsedOp;
        if (!op) throw new Error('lastUsedLoginCheck requires lastUsedOp');
        const toHeader = (sc: string): string => sc.split(';')[0].trim();
        if (op === 'absent') {
          outcome = { parsed: await lastUsedLoginCookie.parse(null) };
        } else if (op === 'scopedToId') {
          outcome = { setCookie: await serializeLastUsedLogin('email') };
        } else {
          const token =
            op === 'roundTripIdp' ? 'idp:g' : op === 'roundTripEmail' ? 'email' : 'passkey';
          const sc = await serializeLastUsedLogin(token);
          outcome = { parsed: await lastUsedLoginCookie.parse(toHeader(sc)) };
        }
        break;
      }
      case 'passkeyHintCheck': {
        const op = s.passkeyHintOp;
        if (!op) throw new Error('passkeyHintCheck requires passkeyHintOp');
        if (op === 'absent') {
          outcome = { parsed: await passkeyHintCookie.parse(null) };
        } else if (op === 'clear') {
          outcome = { setCookie: await clearPasskeyHint() };
        } else if (op === 'attrs') {
          outcome = { setCookie: await serializePasskeyHint('alice@acme.test') };
        } else {
          const sc = await serializePasskeyHint('alice@acme.test');
          outcome = { parsed: await passkeyHintCookie.parse(sc.split(';')[0].trim()) };
        }
        break;
      }
      case 'reauthIntentCheck': {
        const op = s.reauthOp;
        if (!op) throw new Error('reauthIntentCheck requires reauthOp');
        const reqWith = async (intent: string | null): Promise<Request> => {
          const headers = new Headers();
          if (intent !== null)
            headers.set('cookie', (await serializeReauthIntent(intent)).split(';')[0]);
          return {
            url: 'http://localhost/id/login/password',
            method: 'GET',
            headers,
          } as unknown as Request;
        };
        if (op === 'roundTrip') {
          outcome = { value: await readReauthIntent(await reqWith('alice@acme.test')) };
        } else if (op === 'absent') {
          outcome = { value: await readReauthIntent(await reqWith(null)) };
        } else if (op === 'clear') {
          outcome = { cleared: await clearReauthIntent() };
        } else if (op === 'checkNoIntent') {
          outcome = await checkReauthIntent(await reqWith(null), 'whoever@acme.test');
        } else if (op === 'checkMatch') {
          outcome = await checkReauthIntent(await reqWith('alice@acme.test'), 'alice@acme.test');
        } else if (op === 'checkCaseInsensitive') {
          outcome = await checkReauthIntent(await reqWith('Alice@ACME.test'), 'alice@acme.test');
        } else if (op === 'checkMismatch') {
          outcome = await checkReauthIntent(await reqWith('alice@acme.test'), 'bob@acme.test');
        }
        break;
      }
      case 'selectProvider': {
        const op = s.selectOp;
        if (!op) throw new Error('selectProvider requires selectOp');
        if (op === 'fakeIsInstance') {
          outcome = {
            isFake: getAuthProvider({ AUTH_PROVIDER: 'fake' }) instanceof FakeAuthProvider,
          };
        } else if (op === 'zitadelNoThrow') {
          let threw = false;
          try {
            getAuthProvider({ AUTH_PROVIDER: 'zitadel', serviceUrl: 'https://z.test' });
          } catch {
            threw = true;
          }
          outcome = { threw };
        } else if (op === 'registryKeys') {
          outcome = { keys: Object.keys(providerRegistry).sort() };
        } else if (op === 'fakeSingleton') {
          const a = providerRegistry.fake({ AUTH_PROVIDER: 'fake' });
          const b = providerRegistry.fake({ AUTH_PROVIDER: 'fake' });
          outcome = { same: a === b };
        }
        break;
      }
      // ── Task 10: server/* checks ─────────────────────────────────────────────
      case 'compositionCheck': {
        const op = s.compositionOp;
        if (!op) throw new Error('compositionCheck requires compositionOp');
        if (op === 'fakeProvider') {
          const prev = process.env.AUTH_PROVIDER;
          process.env.AUTH_PROVIDER = 'fake';
          try {
            const p = providerForRequest(new Request('https://auth.example.test/id/login'));
            outcome = {
              isDefined: p !== undefined && p !== null,
              hasListSessions:
                typeof (p as unknown as Record<string, unknown>).listSessions === 'function',
            };
          } finally {
            process.env.AUTH_PROVIDER = prev;
          }
        } else if (op === 'noZitadelImport') {
          const src = readFileSync(
            join(process.cwd(), 'app/server/auth-context.server.ts'),
            'utf-8'
          );
          outcome = { containsZitadel: /providers\/zitadel/.test(src) };
        } else if (op === 'authContextReexport') {
          const mod = await import('@/server/auth-context.server');
          outcome = {
            hasFn: typeof (mod as Record<string, unknown>).providerForRequest === 'function',
          };
        }
        break;
      }

      case 'csrfFoundationsCheck': {
        const op = s.csrfFoundationsOp;
        if (!op) throw new Error('csrfFoundationsCheck requires csrfFoundationsOp');
        if (op === 'loaderCsrfToken') {
          const req = new Request('https://x.test/id/login');
          const { csrfToken, headers } = await loaderCsrf(req);
          outcome = {
            tokenLength: typeof csrfToken === 'string' ? csrfToken.length : 0,
            setCookieNotNull: headers['set-cookie'] !== 'null',
          };
        } else if (op === 'setCookieNotNull') {
          const req = new Request('https://x.test/id/login');
          const { headers } = await loaderCsrf(req);
          const hasSetCookie = Object.prototype.hasOwnProperty.call(headers, 'set-cookie');
          outcome = {
            setCookieIsLiteralNull: hasSetCookie ? headers['set-cookie'] === 'null' : false,
          };
        } else if (op === 'formKeyInSource') {
          const { CSRF_FORM_KEY } = await import('@/shared');
          const src = readFileSync(join(process.cwd(), 'app/server/csrf.ts'), 'utf-8');
          outcome = { containsKey: src.includes('CSRF_FORM_KEY'), keyValue: CSRF_FORM_KEY };
        }
        break;
      }

      case 'csrfCheck': {
        const op = s.csrfOp;
        if (!op) throw new Error('csrfCheck requires csrfOp');
        const baseReq = () => new Request('http://localhost/id/login');
        const requestWithCookie = (cookieHeader: string): Request => {
          const cookieValue = cookieHeader.split(';')[0];
          const h = new Headers({ cookie: cookieValue });
          return {
            url: 'http://localhost/id/login',
            method: 'GET',
            headers: h,
          } as unknown as Request;
        };
        const formWithCsrf = (token: string | null): FormData => {
          const fd = new FormData();
          if (token !== null) fd.set('csrf', token);
          return fd;
        };
        if (op === 'roundTrip') {
          const [token, cookieHeader] = await getCsrfToken(baseReq());
          const req2 = requestWithCookie(cookieHeader as string);
          const fd = formWithCsrf(token);
          let threw = false;
          try {
            await assertCsrf(req2, fd);
          } catch {
            threw = true;
          }
          outcome = {
            tokenLength: token.length,
            setCookieMatches: (cookieHeader as string).startsWith('csrf='),
            resolved: !threw,
          };
        } else if (op === 'forgedToken') {
          const [, cookieHeader] = await getCsrfToken(baseReq());
          const req2 = requestWithCookie(cookieHeader as string);
          let status: number | undefined;
          try {
            await assertCsrf(req2, formWithCsrf('forged-value'));
          } catch (e) {
            if (e instanceof Response) status = e.status;
          }
          outcome = { status };
        } else if (op === 'missingToken') {
          const [, cookieHeader] = await getCsrfToken(baseReq());
          const req2 = requestWithCookie(cookieHeader as string);
          let status: number | undefined;
          try {
            await assertCsrf(req2, formWithCsrf(null));
          } catch (e) {
            if (e instanceof Response) status = e.status;
          }
          outcome = { status };
        } else if (op === 'missingCookie') {
          const [token] = await getCsrfToken(baseReq());
          const req2 = {
            url: 'http://localhost/id/login',
            method: 'GET',
            headers: new Headers(),
          } as unknown as Request;
          let status: number | undefined;
          try {
            await assertCsrf(req2, formWithCsrf(token));
          } catch (e) {
            if (e instanceof Response) status = e.status;
          }
          outcome = { status };
        } else if (op === 'csrfErrorClass') {
          const { CSRFError } = await import('remix-utils/csrf/server');
          outcome = {
            isFunction: typeof CSRFError === 'function',
            isInstance: new CSRFError('missing_token_in_cookie', 'test') instanceof Error,
          };
        } else if (op === 'nonCsrfErrorRethrow') {
          const boom = new Error('not a csrf error');
          const req2 = baseReq();
          const fd = new FormData();
          let rethrown = false;
          try {
            await assertCsrfWith(req2, fd, () => {
              throw boom;
            });
          } catch (e) {
            rethrown = e === boom;
          }
          outcome = { rethrown };
        }
        break;
      }

      case 'observabilityCheck': {
        const op = s.observabilityOp;
        if (!op) throw new Error('observabilityCheck requires observabilityOp');
        if (op === 'hashActorDeterministic') {
          const h = hashActor('alice@example.com');
          outcome = {
            matchesHex16: /^[0-9a-f]{16}$/.test(h),
            stable: hashActor('alice@example.com') === h,
          };
        } else if (op === 'hashActorDiverse') {
          const a = hashActor('alice@example.com');
          const b = hashActor('bob@example.com');
          outcome = {
            differs: a !== b,
            noEcho: !a.includes('alice'),
          };
        } else if (op === 'hashActorEmpty') {
          outcome = { result: hashActor('') };
        } else if (op === 'logAuthEventMetric') {
          const sinkFn = (line: string): void => {
            auditLines.push(line);
          };
          logAuthEvent('password_check', 'success', { userId: 'u1' }, sinkFn);
          const dump = await registry.metrics();
          outcome = {
            containsMetric: dump.includes(
              'auth_events_total{event="password_check",outcome="success"}'
            ),
          };
        } else if (op === 'logAuthEventAuditLine') {
          const calls: string[] = [];
          const sinkFn = (line: string): void => {
            calls.push(line);
          };
          logAuthEvent('password_check', 'success', { userId: 'u1' }, sinkFn);
          const line = calls.length > 0 ? JSON.parse(calls[0]) : null;
          outcome = { sinkCalled: calls.length === 1, line };
        } else if (op === 'logAuthEventExplicitTrace') {
          const calls: string[] = [];
          const traceId = '550e8400-e29b-41d4-a716-446655440000';
          logAuthEvent('password_check', 'success', { userId: 'u2', traceId }, (l) =>
            calls.push(l)
          );
          const line = JSON.parse(calls[0]);
          outcome = { sinkCalled: calls.length === 1, line };
        } else if (op === 'logAuthEventAlsTrace') {
          const calls: string[] = [];
          const traceId = 'als-real-00000000-0000-4000-a000-000000000002';
          runWithTraceId(traceId, () => {
            logAuthEvent('mfa_verify', 'success', { userId: 'u7' }, (l) => calls.push(l));
          });
          const line = JSON.parse(calls[0]);
          outcome = { traceId: line.traceId };
        } else if (op === 'logAuthEventNoTrace') {
          const calls: string[] = [];
          logAuthEvent('session_expired', 'failure', { userId: 'u3' }, (l) => calls.push(l));
          const line = JSON.parse(calls[0]);
          outcome = {
            sinkCalled: calls.length === 1,
            hasTraceIdKey: Object.prototype.hasOwnProperty.call(line, 'traceId'),
            line,
          };
        } else if (op === 'getTraceIdOutside') {
          outcome = { result: getTraceId() };
        } else if (op === 'auditSinkIsFunction') {
          outcome = { isFunction: typeof auditSink === 'function' };
        } else if (op === 'auditSinkDefault') {
          // logAuthEvent without explicit sink → calls auditSink (default = console.log)
          // console.log is already intercepted by the harness; capture the line.
          logAuthEvent('password_check', 'success', { userId: 'u9' });
          const lastLine = auditLines.at(-1);
          outcome = { line: lastLine ? JSON.parse(lastLine) : null };
        } else if (op === 'httpDurationMetric') {
          const end = httpRequestDuration.startTimer();
          end({ method: 'GET', route: '/healthz', status_code: '200' });
          const dump = await registry.metrics();
          outcome = {
            containsMetric: dump.includes('http_request_duration_seconds'),
            hasMethod: dump.includes('method="GET"'),
            hasRoute: dump.includes('route="/healthz"'),
            hasStatus: dump.includes('status_code="200"'),
          };
        } else if (op === 'httpMetricsThrowing') {
          const route = '/id/login/throw-test';
          let endCalled = false;
          let capturedLabels: Record<string, string> | undefined;
          const origStartTimer = httpRequestDuration.startTimer.bind(httpRequestDuration);
          (httpRequestDuration as unknown as Record<string, unknown>).startTimer =
            () => (labels: unknown) => {
              endCalled = true;
              capturedLabels = labels as Record<string, string>;
            };
          const c = {
            req: { method: 'POST', path: route, routeIndex: 0 },
            res: undefined,
          } as unknown as Parameters<typeof httpMetrics>[0];
          const next = async () => {
            throw new Error('downstream boom');
          };
          let threw = false;
          try {
            await httpMetrics(c, next);
          } catch {
            threw = true;
          }
          (httpRequestDuration as unknown as Record<string, unknown>).startTimer = origStartTimer;
          outcome = { threw, endCalled, labels: capturedLabels };
        }
        break;
      }

      case 'userAgentCheck': {
        const op = s.userAgentOp;
        if (!op) throw new Error('userAgentCheck requires userAgentOp');
        const CHROME_UA =
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        const makeUARequest = (h: Record<string, string>): Request => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(h)) headers.set(k, v);
          return { url: 'http://localhost/id/login', method: 'GET', headers } as unknown as Request;
        };
        if (op === 'uaHeaderMapped') {
          const r = userAgentFromRequest(makeUARequest({ 'user-agent': CHROME_UA }));
          outcome = { header: r.header };
        } else if (op === 'noUaHeader') {
          const r = userAgentFromRequest(makeUARequest({}));
          outcome = { headerDefined: r.header !== undefined };
        } else if (op === 'xffLastHop') {
          const r = userAgentFromRequest(
            makeUARequest({
              'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12',
              'user-agent': CHROME_UA,
            })
          );
          outcome = { ip: r.ip };
        } else if (op === 'singleXff') {
          const r = userAgentFromRequest(
            makeUARequest({ 'x-forwarded-for': '203.0.113.5', 'user-agent': CHROME_UA })
          );
          outcome = { ip: r.ip };
        } else if (op === 'noXff') {
          const r = userAgentFromRequest(makeUARequest({ 'user-agent': CHROME_UA }));
          outcome = { ipDefined: r.ip !== undefined };
        } else if (op === 'descriptionRaw') {
          const r = userAgentFromRequest(makeUARequest({ 'user-agent': CHROME_UA }));
          outcome = { description: r.description };
        } else if (op === 'descriptionTokens') {
          const desc = userAgentFromRequest(
            makeUARequest({ 'user-agent': CHROME_UA })
          ).description!;
          outcome = {
            hasMacintosh: desc.includes('Macintosh'),
            hasMacOsX: desc.includes('Mac OS X'),
          };
        } else if (op === 'descriptionMobile') {
          const IPHONE_UA =
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
          const desc = userAgentFromRequest(makeUARequest({ 'user-agent': IPHONE_UA })).description;
          outcome = { description: desc };
        } else if (op === 'descriptionCurl') {
          const desc = userAgentFromRequest(
            makeUARequest({ 'user-agent': 'curl/8.4.0' })
          ).description;
          outcome = { description: desc };
        } else if (op === 'noDescription') {
          const r = userAgentFromRequest(makeUARequest({}));
          outcome = { descriptionDefined: r.description !== undefined };
        } else if (op === 'explicitFpId') {
          const r = userAgentFromRequest(makeUARequest({ 'user-agent': CHROME_UA }), 'fp-abc-123');
          outcome = { fingerprintId: r.fingerprintId };
        } else if (op === 'fpIdFromCookie') {
          const r = userAgentFromRequest(
            makeUARequest({
              'user-agent': CHROME_UA,
              cookie: 'foo=bar; fingerprintId=bbd33da2-1234-5678; baz=qux',
            })
          );
          outcome = { fingerprintId: r.fingerprintId };
        } else if (op === 'urlEncodedFpId') {
          const r = userAgentFromRequest(
            makeUARequest({ 'user-agent': CHROME_UA, cookie: 'fingerprintId=abc%20def' })
          );
          outcome = { fingerprintId: r.fingerprintId };
        } else if (op === 'fpIdParamOverride') {
          const r = userAgentFromRequest(
            makeUARequest({ 'user-agent': CHROME_UA, cookie: 'fingerprintId=cookie-value' }),
            'param-value'
          );
          outcome = { fingerprintId: r.fingerprintId };
        } else if (op === 'noFpId') {
          const r = userAgentFromRequest(makeUARequest({ 'user-agent': CHROME_UA }));
          outcome = { fingerprintIdDefined: r.fingerprintId !== undefined };
        } else if (op === 'noFpIdCookie') {
          const r = userAgentFromRequest(
            makeUARequest({ 'user-agent': CHROME_UA, cookie: 'foo=bar; baz=qux' })
          );
          outcome = { fingerprintIdDefined: r.fingerprintId !== undefined };
        } else if (op === 'allFields') {
          const r = userAgentFromRequest(
            makeUARequest({ 'user-agent': CHROME_UA, 'x-forwarded-for': '10.0.0.1, 203.0.113.99' }),
            'fp-xyz'
          );
          outcome = { result: r };
        } else if (op === 'emptyRequest') {
          const r = userAgentFromRequest(makeUARequest({}));
          outcome = { keyCount: Object.keys(r).length };
        } else if (op === 'reuseExistingFp') {
          const req = makeUARequest({ cookie: 'fingerprintId=existing-fp-123' });
          const [id, setCookie] = getOrCreateFingerprintId(req);
          outcome = { id, setCookieIsNull: setCookie === null };
        } else if (op === 'mintNewFp') {
          const req = makeUARequest({});
          const [id, setCookie] = getOrCreateFingerprintId(req, true);
          const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
          outcome = {
            matchesUUID: UUID_RE.test(id),
            setCookieNotNull: setCookie !== null,
            idInCookie: setCookie?.includes(`fingerprintId=${id}`) ?? false,
          };
        } else if (op === 'fpCookieAttrs') {
          const [, setCookie] = getOrCreateFingerprintId(makeUARequest({}), true);
          outcome = {
            maxAge: setCookie?.includes('Max-Age=31536000') ?? false,
            path: setCookie?.includes('Path=/') ?? false,
            httpOnly: setCookie?.includes('HttpOnly') ?? false,
            sameSite: setCookie?.includes('SameSite=Lax') ?? false,
          };
        } else if (op === 'fpSecureFlag') {
          const [, withSecure] = getOrCreateFingerprintId(makeUARequest({}), true);
          const [, withoutSecure] = getOrCreateFingerprintId(makeUARequest({}), false);
          outcome = {
            trueHasSecure: withSecure?.includes('Secure') ?? false,
            falseNoSecure: !(withoutSecure?.includes('Secure') ?? true),
          };
        } else if (op === 'fpDistinctMints') {
          const [a] = getOrCreateFingerprintId(makeUARequest({}), false);
          const [b] = getOrCreateFingerprintId(makeUARequest({}), false);
          outcome = { distinct: a !== b };
        } else if (op === 'fpRoundTrip') {
          const [id] = getOrCreateFingerprintId(makeUARequest({}), false);
          const ua = userAgentFromRequest(makeUARequest({ 'user-agent': CHROME_UA }), id);
          outcome = { fingerprintId: ua.fingerprintId };
        }
        break;
      }

      case 'rateLimitCheck': {
        const op = s.rateLimitOp;
        if (!op) throw new Error('rateLimitCheck requires rateLimitOp');

        // Control Date.now() for deterministic rate-limit windows (safe: fresh Bun process per cy.task)
        let nowMs = 1_000_000;
        const origDateNow = Date.now;
        Date.now = () => nowMs;

        try {
          if (op === 'loginPasswordBlocked') {
            const app = new Hono();
            app.use('/id/login/*', loginPasswordRateLimit);
            app.all('/id/login/password', (c) => c.json({ ok: true }, 200));
            const ip = '10.0.0.1';
            const url = 'http://app/id/login/password?loginName=alice';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            const statuses: number[] = [];
            for (let i = 0; i < 5; i++) {
              nowMs += 100;
              const r = await app.request(new Request(url, { method: 'POST', headers: hd }));
              statuses.push(r.status);
            }
            nowMs += 100;
            const blocked = await app.request(new Request(url, { method: 'POST', headers: hd }));
            const body = (await blocked.json()) as { error: string };
            outcome = {
              allPassed: statuses.every((s) => s === 200),
              blockedStatus: blocked.status,
              retryAfter: blocked.headers.get('Retry-After'),
              error: body.error,
            };
          } else if (op === 'loginPasswordGetNoConsume') {
            const app = new Hono();
            app.use('/id/login/*', loginPasswordRateLimit);
            app.all('/id/login/password', (c) => c.json({ ok: true }, 200));
            const ip = '10.0.0.2';
            const url = 'http://app/id/login/password?loginName=bob';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 10; i++) {
              nowMs += 50;
              await app.request(new Request(url, { method: 'GET', headers: hd }));
            }
            nowMs += 50;
            const postRes = await app.request(new Request(url, { method: 'POST', headers: hd }));
            outcome = { postStatus: postRes.status };
          } else if (op === 'loginPasswordTrailingSlash') {
            const app = new Hono();
            app.use('/id/login/*', loginPasswordRateLimit);
            app.all('/id/login/password', (c) => c.json({ ok: true }, 200));
            app.all('/id/login/password/', (c) => c.json({ ok: true }, 200));
            const ip = '10.0.0.3';
            const canonical = 'http://app/id/login/password?loginName=carol';
            const withSlash = 'http://app/id/login/password/?loginName=carol';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 4; i++) {
              nowMs += 100;
              await app.request(new Request(canonical, { method: 'POST', headers: hd }));
            }
            nowMs += 100;
            const fifth = await app.request(
              new Request(withSlash, { method: 'POST', headers: hd })
            );
            nowMs += 100;
            const sixth = await app.request(
              new Request(withSlash, { method: 'POST', headers: hd })
            );
            outcome = { fifthStatus: fifth.status, sixthStatus: sixth.status };
          } else if (op === 'loginPasswordXffRotation') {
            const app = new Hono();
            app.use('/id/login/*', loginPasswordRateLimit);
            app.all('/id/login/password', (c) => c.json({ ok: true }, 200));
            const trustedIp = '10.0.0.4';
            const url = 'http://app/id/login/password?loginName=dave';
            for (let i = 0; i < 5; i++) {
              nowMs += 100;
              await app.request(
                new Request(url, {
                  method: 'POST',
                  headers: { 'x-forwarded-for': `192.168.${i}.${i}, ${trustedIp}` },
                })
              );
            }
            nowMs += 100;
            const blocked = await app.request(
              new Request(url, {
                method: 'POST',
                headers: { 'x-forwarded-for': `99.99.99.99, ${trustedIp}` },
              })
            );
            outcome = { blockedStatus: blocked.status };
          } else if (op === 'webauthnBlocked') {
            const app = new Hono();
            app.use('/id/login/*', webauthnVerifyRateLimit);
            app.all('/id/login/passkey', (c) => c.json({ ok: true }, 200));
            const ip = '10.1.0.1';
            const url = 'http://app/id/login/passkey';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 10; i++) {
              nowMs += 100;
              await app.request(new Request(url, { method: 'POST', headers: hd }));
            }
            nowMs += 100;
            const blocked = await app.request(new Request(url, { method: 'POST', headers: hd }));
            const body = (await blocked.json()) as { error: string };
            outcome = {
              blockedStatus: blocked.status,
              retryAfter: blocked.headers.get('Retry-After'),
              error: body.error,
            };
          } else if (op === 'webauthnSharedBucket') {
            const app = new Hono();
            app.use('/id/login/*', webauthnVerifyRateLimit);
            app.all('/id/login/security-key', (c) => c.json({ ok: true }, 200));
            app.all('/id/login/mfa', (c) => c.json({ ok: true }, 200));
            app.all('/id/login/passkey', (c) => c.json({ ok: true }, 200));
            const ip = '10.1.0.2';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 5; i++) {
              nowMs += 100;
              await app.request(
                new Request('http://app/id/login/security-key', { method: 'POST', headers: hd })
              );
            }
            for (let i = 0; i < 5; i++) {
              nowMs += 100;
              await app.request(
                new Request('http://app/id/login/mfa', { method: 'POST', headers: hd })
              );
            }
            nowMs += 100;
            const blocked = await app.request(
              new Request('http://app/id/login/passkey', { method: 'POST', headers: hd })
            );
            outcome = { blockedStatus: blocked.status };
          } else if (op === 'webauthnPasswordNoConsume') {
            const app = new Hono();
            app.use('/id/login/*', webauthnVerifyRateLimit);
            app.all('/id/login/password', (c) => c.json({ ok: true }, 200));
            app.all('/id/login/passkey', (c) => c.json({ ok: true }, 200));
            const ip = '10.1.0.3';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 10; i++) {
              nowMs += 100;
              await app.request(
                new Request('http://app/id/login/password', { method: 'POST', headers: hd })
              );
            }
            nowMs += 100;
            const res = await app.request(
              new Request('http://app/id/login/passkey', { method: 'POST', headers: hd })
            );
            outcome = { passkeyStatus: res.status };
          } else if (op === 'webauthnGetNoConsume') {
            const app = new Hono();
            app.use('/id/login/*', webauthnVerifyRateLimit);
            app.all('/id/login/passkey', (c) => c.json({ ok: true }, 200));
            const ip = '10.1.0.4';
            const url = 'http://app/id/login/passkey';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 12; i++) {
              nowMs += 50;
              await app.request(new Request(url, { method: 'GET', headers: hd }));
            }
            nowMs += 50;
            const res = await app.request(new Request(url, { method: 'POST', headers: hd }));
            outcome = { postStatus: res.status };
          } else if (op === 'webauthnTrailingSlash') {
            const app = new Hono();
            app.use('/id/login/*', webauthnVerifyRateLimit);
            app.all('/id/login/passkey', (c) => c.json({ ok: true }, 200));
            app.all('/id/login/passkey/', (c) => c.json({ ok: true }, 200));
            const ip = '10.1.0.5';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 10; i++) {
              nowMs += 100;
              await app.request(
                new Request('http://app/id/login/passkey', { method: 'POST', headers: hd })
              );
            }
            nowMs += 100;
            const blocked = await app.request(
              new Request('http://app/id/login/passkey/', { method: 'POST', headers: hd })
            );
            outcome = { blockedStatus: blocked.status };
          } else if (op === 'mfaEnrollBlocked') {
            const app = new Hono();
            app.use('/id/setup/*', mfaEnrollRateLimit);
            app.all('/id/setup/passkey', (c) => c.json({ ok: true }, 200));
            const ip = '10.2.0.1';
            const url = 'http://app/id/setup/passkey';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 15; i++) {
              nowMs += 100;
              await app.request(new Request(url, { method: 'POST', headers: hd }));
            }
            nowMs += 100;
            const blocked = await app.request(new Request(url, { method: 'POST', headers: hd }));
            const body = (await blocked.json()) as { error: string };
            outcome = { blockedStatus: blocked.status, error: body.error };
          } else if (op === 'mfaEnrollSharedPaths') {
            const app = new Hono();
            app.use('/id/setup/*', mfaEnrollRateLimit);
            const routes = ['passkey', 'security-key', 'authenticator', 'email', 'sms', 'mfa'];
            for (const r of routes) app.all(`/id/setup/${r}`, (c) => c.json({ ok: true }, 200));
            const ip = '10.2.0.2';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            const paths = ['passkey', 'security-key', 'authenticator', 'email', 'sms'];
            for (const p of paths)
              for (let i = 0; i < 3; i++) {
                nowMs += 100;
                await app.request(
                  new Request(`http://app/id/setup/${p}`, { method: 'POST', headers: hd })
                );
              }
            nowMs += 100;
            const blocked = await app.request(
              new Request('http://app/id/setup/mfa', { method: 'POST', headers: hd })
            );
            outcome = { blockedStatus: blocked.status };
          } else if (op === 'mfaEnrollGetNoConsume') {
            const app = new Hono();
            app.use('/id/setup/*', mfaEnrollRateLimit);
            app.all('/id/setup/passkey', (c) => c.json({ ok: true }, 200));
            const ip = '10.2.0.3';
            const url = 'http://app/id/setup/passkey';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 20; i++) {
              nowMs += 50;
              await app.request(new Request(url, { method: 'GET', headers: hd }));
            }
            nowMs += 50;
            const res = await app.request(new Request(url, { method: 'POST', headers: hd }));
            outcome = { postStatus: res.status };
          } else if (op === 'accountsBlocked') {
            const app = new Hono();
            app.use('/id/accounts', accountsRateLimit);
            app.all('/id/accounts', (c) => c.json({ ok: true }, 200));
            const ip = '10.3.0.1';
            const url = 'http://app/id/accounts';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 15; i++) {
              nowMs += 100;
              await app.request(new Request(url, { method: 'POST', headers: hd }));
            }
            nowMs += 100;
            const blocked = await app.request(new Request(url, { method: 'POST', headers: hd }));
            const body = (await blocked.json()) as { error: string };
            outcome = { blockedStatus: blocked.status, error: body.error };
          } else if (op === 'accountsGetNoConsume') {
            const app = new Hono();
            app.use('/id/accounts', accountsRateLimit);
            app.all('/id/accounts', (c) => c.json({ ok: true }, 200));
            const ip = '10.3.0.2';
            const url = 'http://app/id/accounts';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 20; i++) {
              nowMs += 50;
              await app.request(new Request(url, { method: 'GET', headers: hd }));
            }
            nowMs += 50;
            const res = await app.request(new Request(url, { method: 'POST', headers: hd }));
            outcome = { postStatus: res.status };
          } else if (op === 'accountsIsolatedIps') {
            const app = new Hono();
            app.use('/id/accounts', accountsRateLimit);
            app.all('/id/accounts', (c) => c.json({ ok: true }, 200));
            const ipA = '10.3.0.3',
              ipB = '10.3.0.4';
            const url = 'http://app/id/accounts';
            for (let i = 0; i < 15; i++) {
              nowMs += 100;
              await app.request(
                new Request(url, {
                  method: 'POST',
                  headers: { 'x-forwarded-for': `1.2.3.4, ${ipA}` },
                })
              );
            }
            nowMs += 100;
            const blockedA = await app.request(
              new Request(url, {
                method: 'POST',
                headers: { 'x-forwarded-for': `1.2.3.4, ${ipA}` },
              })
            );
            nowMs += 100;
            const allowedB = await app.request(
              new Request(url, {
                method: 'POST',
                headers: { 'x-forwarded-for': `1.2.3.4, ${ipB}` },
              })
            );
            outcome = { blockedA: blockedA.status, allowedB: allowedB.status };
          } else if (op === 'verifyEmailBlocked') {
            const app = new Hono();
            app.use('/id/verify', verifyEmailSendRateLimit);
            app.all('/id/verify', (c) => c.json({ ok: true }, 200));
            const ip = '10.4.0.1';
            const url = 'http://app/id/verify?send=true';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 10; i++) {
              nowMs += 100;
              await app.request(new Request(url, { method: 'GET', headers: hd }));
            }
            nowMs += 100;
            const blocked = await app.request(new Request(url, { method: 'GET', headers: hd }));
            const body = (await blocked.json()) as { error: string };
            outcome = { blockedStatus: blocked.status, error: body.error };
          } else if (
            op === 'loginMethodIntentBlocked' ||
            op === 'loginMethodIntentPerLoginName' ||
            op === 'loginMethodIntentIpCeiling' ||
            op === 'loginMethodIntentHtml429' ||
            op === 'loginMethodIntentDataJson429'
          ) {
            // The chooser LOADER mints a real IdP intent for a sole-linked-IdP account, so a GET
            // carrying ?loginName is state-changing and must be counted. TWO tiers guard it: a
            // tight ip|loginName budget (10) and a loose ip-only ceiling (120). Both are mounted
            // together here exactly as server.ts mounts them, so each case sees the real
            // interaction rather than one tier in isolation.
            const app = new Hono();
            app.use('*', loginMethodIntentRateLimit);
            app.use('*', loginMethodIntentIpRateLimit);
            app.all('/id/login/method', (c) => c.json({ ok: true }, 200));
            // Distinct per op: the module-level limiters are shared for the lifetime of the
            // process, so each case needs its own bucket to stay independent.
            const ip = {
              loginMethodIntentBlocked: '10.5.0.1',
              loginMethodIntentPerLoginName: '10.5.0.3',
              loginMethodIntentIpCeiling: '10.5.0.4',
              loginMethodIntentHtml429: '10.5.0.5',
              loginMethodIntentDataJson429: '10.5.0.6',
            }[op];
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            const hit = async (loginName: string, path = '/id/login/method', accept?: string) => {
              nowMs += 10;
              const headers: Record<string, string> = { ...hd };
              if (accept) headers.accept = accept;
              return app.request(
                new Request(`http://app${path}?loginName=${loginName}`, { method: 'GET', headers })
              );
            };
            if (op === 'loginMethodIntentBlocked') {
              const statuses: number[] = [];
              for (let i = 0; i < 10; i++) statuses.push((await hit('alice')).status);
              const blocked = await hit('alice');
              outcome = {
                allPassed: statuses.every((st) => st === 200),
                blockedStatus: blocked.status,
                retryAfter: blocked.headers.get('Retry-After') ?? undefined,
              };
            } else if (op === 'loginMethodIntentPerLoginName') {
              // The tight tier is keyed per address: exhausting alice must not lock out bob from
              // the same office. (The loose ip ceiling is what bounds enumeration breadth.)
              for (let i = 0; i < 11; i++) await hit('alice');
              const alice = await hit('alice');
              const bob = await hit('bob');
              outcome = { aliceStatus: alice.status, bobStatus: bob.status };
            } else if (op === 'loginMethodIntentIpCeiling') {
              // Spread across distinct addresses so the tight tier never trips — only the
              // ip-only ceiling (120) can answer here.
              const statuses: number[] = [];
              for (let i = 0; i < 120; i++) statuses.push((await hit(`u${i}`)).status);
              const blocked = await hit('u999');
              outcome = {
                allPassed: statuses.every((st) => st === 200),
                blockedStatus: blocked.status,
                retryAfter: blocked.headers.get('Retry-After') ?? undefined,
              };
            } else if (op === 'loginMethodIntentHtml429') {
              // A rate-limited top-level GET navigation is RENDERED by the browser as the page —
              // a raw JSON blob is what the user would see.
              for (let i = 0; i < 11; i++) await hit('alice', '/id/login/method', 'text/html');
              const blocked = await hit('alice', '/id/login/method', 'text/html');
              const body = await blocked.text();
              outcome = {
                blockedStatus: blocked.status,
                contentType: blocked.headers.get('content-type') ?? '',
                hasHeading: /<h1[^>]*>Too many attempts<\/h1>/.test(body),
                hasBackLink: body.includes('href="/id/login"'),
                isRawJson: body.trim().startsWith('{'),
              };
            } else {
              // The single-fetch (.data) variant is consumed by code, not rendered — JSON stays.
              for (let i = 0; i < 11; i++) await hit('alice', '/id/login/method.data', 'text/html');
              const blocked = await hit('alice', '/id/login/method.data', 'text/html');
              const body = await blocked.text();
              outcome = {
                blockedStatus: blocked.status,
                contentType: blocked.headers.get('content-type') ?? '',
                error: (JSON.parse(body) as { error?: string }).error,
              };
            }
          } else if (op === 'serverMountsChooserLimiters') {
            // A limiter that exists but is never mounted throttles nothing. server.ts is the only
            // wiring point, and it cannot be imported here without standing up the whole Hono app
            // — so assert the wiring at the source, the same way the auth-context/csrf fitness
            // checks in this harness do.
            const src = readFileSync(join(process.cwd(), 'app/server.ts'), 'utf-8');
            const mounted = (name: string) =>
              src.includes(name) && src.includes(`app.use('*', ${name});`);
            outcome = {
              tightTierMounted: mounted('loginMethodIntentRateLimit'),
              ipTierMounted: mounted('loginMethodIntentIpRateLimit'),
              // The identifier POST is what hands out the ceremony session the chooser's gate
              // demands, so leaving this one unmounted undercuts both tiers above.
              identifierMounted: mounted('loginIdentifierRateLimit'),
            };
          } else if (op === 'loginIdentifierBlocked') {
            // POST /id/login is the identifier submit — the endpoint that mints the ceremony
            // session /id/login/method's gate demands, and the one that reveals existence
            // directly whenever ignoreUnknownUsernames is off. ip-only (the loginName is in the
            // POST body), 120/5min to mirror the chooser GET's ip ceiling.
            const app = new Hono();
            app.use('*', loginIdentifierRateLimit);
            app.all('/id/login', (c) => c.json({ ok: true }, 200));
            const hd = { 'x-forwarded-for': `1.2.3.4, 10.5.0.7` };
            const post = async (path = '/id/login') => {
              nowMs += 10;
              return app.request(new Request(`http://app${path}`, { method: 'POST', headers: hd }));
            };
            const statuses: number[] = [];
            for (let i = 0; i < 120; i++) statuses.push((await post()).status);
            const blocked = await post();
            // A GET must not spend the budget — only the submit is counted.
            const getResp = await app.request(
              new Request('http://app/id/login', { method: 'GET', headers: hd })
            );
            outcome = {
              allPassed: statuses.every((s) => s === 200),
              blockedStatus: blocked.status,
              retryAfter: blocked.headers.get('retry-after'),
              // The RR7 single-fetch variant normalizes to the same path, so it shares the bucket
              // rather than slipping past the matcher.
              dataVariantStatus: (await post('/id/login.data')).status,
              getStatus: getResp.status,
            };
          } else if (op === 'loginMethodBareGetNoConsume') {
            // Without ?loginName (or with an EMPTY one) the loader identifies nobody and only
            // bounces to /login — nothing is minted and nothing is revealed, so it must not
            // spend the budget of either tier.
            const app = new Hono();
            app.use('*', loginMethodIntentRateLimit);
            app.use('*', loginMethodIntentIpRateLimit);
            app.all('/id/login/method', (c) => c.json({ ok: true }, 200));
            const ip = '10.5.0.2';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 140; i++) {
              nowMs += 10;
              await app.request(
                new Request('http://app/id/login/method', { method: 'GET', headers: hd })
              );
              nowMs += 10;
              await app.request(
                new Request('http://app/id/login/method?loginName=', { method: 'GET', headers: hd })
              );
            }
            nowMs += 10;
            const res = await app.request(
              new Request('http://app/id/login/method?loginName=alice', {
                method: 'GET',
                headers: hd,
              })
            );
            outcome = { identifiedStatus: res.status };
          } else if (op === 'verifyEmailNoSendNoConsume') {
            const app = new Hono();
            app.use('/id/verify', verifyEmailSendRateLimit);
            app.all('/id/verify', (c) => c.json({ ok: true }, 200));
            const ip = '10.4.0.2';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            for (let i = 0; i < 15; i++) {
              nowMs += 50;
              await app.request(
                new Request('http://app/id/verify', { method: 'GET', headers: hd })
              );
            }
            nowMs += 50;
            const res = await app.request(
              new Request('http://app/id/verify?send=true', { method: 'GET', headers: hd })
            );
            outcome = { sendStatus: res.status };
          } else if (op === 'verifyEmailPostNoConsume') {
            const app = new Hono();
            app.use('/id/verify', verifyEmailSendRateLimit);
            app.all('/id/verify', (c) => c.json({ ok: true }, 200));
            const ip = '10.4.0.3';
            const url = 'http://app/id/verify?send=true';
            const hd = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
            const statuses: number[] = [];
            for (let i = 0; i < 15; i++) {
              nowMs += 50;
              statuses.push(
                (await app.request(new Request(url, { method: 'POST', headers: hd }))).status
              );
            }
            outcome = { allPassed: statuses.every((st) => st === 200) };
          }
        } finally {
          Date.now = origDateNow;
        }
        break;
      }

      case 'samlPostCheck': {
        const op = s.samlPostOp;
        if (!op) throw new Error('samlPostCheck requires samlPostOp');

        // samlPostHandler calls providerForRequest → getAuthProvider(fake) → singleton.
        // Seed the singleton with SAML requests (no public method; write the private field directly).
        const samlProvider = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
        for (const ls of s.liveSessions ?? []) samlProvider.seedLiveSession(ls);
        for (const [id, r] of Object.entries(s.sessionResults ?? {}))
          samlProvider.setSessionResult(
            id,
            r as Parameters<typeof samlProvider.setSessionResult>[1]
          );
        if (s.seed?.samlRequests?.length) {
          (samlProvider as unknown as Record<string, unknown>).samlRequestSeeds =
            s.seed.samlRequests;
        }

        type AppVars = { Variables: { secureHeadersNonce?: string } };
        const buildSamlApp = (nonce: string | undefined) => {
          const app = new Hono<AppVars>();
          if (nonce !== undefined) {
            app.use('*', async (c, next) => {
              c.set('secureHeadersNonce', nonce);
              await next();
            });
          }
          app.get('/id/sso/saml-post', samlPostHandler);
          return app;
        };

        const mintCookie = async () => {
          const entry = {
            id: 's1',
            token: 't1',
            loginName: 'alice@acme.test',
            creationTs: DEFAULT_CREATION_TS,
            expirationTs: DEFAULT_EXPIRATION_TS,
            changeTs: DEFAULT_CHANGE_TS,
          };
          const setCookie = await sessionsCookie.serialize([entry]);
          return setCookie.split(';')[0];
        };

        if (op === 'handlerMissingId') {
          const app = buildSamlApp('n-1');
          const res = await app.request('/id/sso/saml-post');
          outcome = { status: res.status };
        } else if (op === 'handlerNoSession') {
          const app = buildSamlApp('n-1');
          const res = await app.request('/id/sso/saml-post?id=sr-post');
          const location = res.headers.get('location');
          outcome = { status: res.status, location };
        } else if (op === 'handlerPostBinding') {
          const app = buildSamlApp('n-1');
          const cookie = await mintCookie();
          const res = await app.request('/id/sso/saml-post?id=sr-post', { headers: { cookie } });
          const body = await res.text();
          outcome = { status: res.status, body };
        } else if (op === 'handlerRedirectBinding') {
          const app = buildSamlApp('n-1');
          const cookie = await mintCookie();
          const res = await app.request('/id/sso/saml-post?id=sr-1', { headers: { cookie } });
          outcome = { status: res.status, location: res.headers.get('location') };
        } else if (op === 'handlerUnresolvable') {
          const app = buildSamlApp('n-1');
          const cookie = await mintCookie();
          const res = await app.request('/id/sso/saml-post?id=does-not-exist', {
            headers: { cookie },
          });
          outcome = { status: res.status, location: res.headers.get('location') };
        } else if (op === 'handlerMissingNonce') {
          const app = buildSamlApp(undefined);
          const cookie = await mintCookie();
          const res = await app.request('/id/sso/saml-post?id=sr-post', { headers: { cookie } });
          outcome = { status: res.status };
        } else if (op === 'handlerDeadSession') {
          samlProvider.setSessionResult('s1', { mode: 'null' });
          const app = buildSamlApp('n-1');
          const cookie = await mintCookie();
          const res = await app.request('/id/sso/saml-post?id=sr-post', { headers: { cookie } });
          outcome = { status: res.status, location: res.headers.get('location') };
        } else if (op === 'handlerRedirectBadUrl') {
          // Override createSamlResponse to return a javascript: ACS url (malicious adapter value).
          // The REAL samlPostHandler must call assertHttpUrl(bound.url) and reject it with 400.
          // This exercises the handler-level URL guard in the redirect-binding code path,
          // distinct from the pure-function assertHttpUrl tests in saml-post.url-guard.cy.ts.
          const origCreateSamlResponse = samlProvider.createSamlResponse.bind(samlProvider);
          samlProvider.createSamlResponse = (async () => ({
            url: 'javascript:alert(1)',
            binding: 'redirect' as const,
          })) as FakeAuthProvider['createSamlResponse'];
          try {
            const app = buildSamlApp('n-1');
            const cookie = await mintCookie();
            const res = await app.request('/id/sso/saml-post?id=sr-1', { headers: { cookie } });
            outcome = { status: res.status };
          } finally {
            samlProvider.createSamlResponse = origCreateSamlResponse;
          }
        }
        break;
      }

      // ── Task 11 migrations ───────────────────────────────────────────────────────
      // env.server._envSchema comprehensive validation: takes parseEnvRaw, runs the REAL Zod
      // schema (not the Vite browser stub), and returns full { success, data?, issues? }.
      case 'envSchemaFull': {
        const result = _envSchema.safeParse(s.parseEnvRaw ?? {});
        if (result.success) {
          outcome = { success: true, data: result.data as unknown as Record<string, unknown> };
        } else {
          outcome = {
            success: false,
            issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })),
          };
        }
        break;
      }

      // resolveOrg precedence probe (org-first / default-org fallback). The env pin
      // (ZITADEL_DEFAULT_ORG_ID) is set per-scenario via `env` (applied before app modules load),
      // and each cy.task is a fresh Bun process so the module-level default-org cache starts clean.
      case 'resolveOrgProbe': {
        const org = await resolveOrg(provider, s.resolveOrgInput?.urlOrg);
        outcome = { org: org ?? null };
        break;
      }

      // Hono /metrics trust-boundary pinning test: mirror the exact handler from app/server.ts
      // and assert unauthenticated GET /metrics returns 200 with the metric name in the body.
      case 'serverMetrics': {
        const app = new Hono();
        app.get('/metrics', async (c) =>
          c.text(await registry.metrics(), 200, { 'content-type': registry.contentType })
        );
        const res = await app.request('/metrics');
        const body = await res.text();
        outcome = {
          status: res.status,
          containsMetric: body.includes('auth_events_total'),
        };
        break;
      }

      // ── routes/login handlers (batch 13b) ──────────────────────────────────────────────────────
      // Route loaders/actions are node-bound: they read REAL signed cookies off a Request and emit
      // REAL audit. buildHandlerRequest mints a real `instanceof Request` so remix-utils' getHeaders
      // instanceof check passes. The provider singleton is used so providerForRequest resolves it.
      case 'loginLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/login' }
        );
        const result = await loginLoader({ request, params: {}, context: {} as never } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'loginAction': {
        // Same providerRegistry.fake bridge as loginMethodLoader: this action resolves its own
        // provider via providerForRequest, which is INDEPENDENT of the `provider` this harness
        // built — so without the bridge a scenario `seed` (and recordCalls) would be ignored.
        // A no-op when the scenario already uses the singleton.
        const originalFake = providerRegistry.fake;
        providerRegistry.fake = () => provider;
        try {
          const { request } = await buildHandlerRequest(
            s.request ?? { url: 'http://localhost/id/login', csrf: true }
          );
          const result = await loginAction({ request, params: {}, context: {} as never } as never);
          response = await serializeResponse(result);
        } finally {
          providerRegistry.fake = originalFake;
        }
        break;
      }

      case 'loginPasswordLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/login/password' }
        );
        const result = await loginPasswordLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'loginPasswordAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/login/password', csrf: true }
        );
        const result = await loginPasswordAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'securityKeyAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/login/security-key', csrf: true }
        );
        const result = await securityKeyAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'passkeyDiscoverAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/login/passkey-discover', csrf: true }
        );
        const result = await passkeyDiscoverAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'loginPasskeyAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/login/passkey', csrf: true }
        );
        const result = await loginPasskeyAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'loginPasskeyLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/login/passkey' }
        );
        const result = await loginPasskeyLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'loginVerifyEmailLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/login/verify/email' }
        );
        const result = await loginVerifyEmailLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'loginMethodLoader': {
        // Same providerRegistry.fake bridge as reauthProviderCallback below — this loader
        // resolves its own provider via providerForRequest, independent of the `provider`
        // this harness built above whenever the scenario passes a custom `seed`.
        const originalFake = providerRegistry.fake;
        providerRegistry.fake = () => provider;
        try {
          const { request } = await buildHandlerRequest(
            s.request ?? { url: 'http://localhost/id/login/method' }
          );
          const result = await loginMethodLoader({
            request,
            params: {},
            context: {} as never,
          } as never);
          response = await serializeResponse(result);
        } finally {
          providerRegistry.fake = originalFake;
        }
        break;
      }

      case 'loginMethodAction': {
        const originalFake = providerRegistry.fake;
        providerRegistry.fake = () => provider;
        try {
          const { request } = await buildHandlerRequest(
            s.request ?? { url: 'http://localhost/id/login/method', csrf: true }
          );
          const result = await loginMethodAction({
            request,
            params: {},
            context: {} as never,
          } as never);
          response = await serializeResponse(result);
        } finally {
          providerRegistry.fake = originalFake;
        }
        break;
      }

      // ── routes/device + routes/signup handlers (batch 13c) ─────────────────────────────────────
      // Uses buildHandlerRequest (real instanceof Request, signed CSRF cookie) so assertCsrf passes.
      // providerForRequest(request) returns the same singleton that buildProvider('singleton') built.
      case 'deviceAuthorizeLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/device/authorize' }
        );
        const result = await deviceAuthorizeLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        if (result instanceof Response) {
          response = await serializeResponse(result);
        } else {
          response = {
            isResponse: false,
            dataBody:
              (result as { data?: Record<string, unknown> }).data ??
              (result as Record<string, unknown>),
            dataStatus: (result as { init?: { status?: number } }).init?.status,
          };
        }
        break;
      }

      case 'deviceAuthorizeAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/device/authorize', csrf: true }
        );
        const result = await deviceAuthorizeAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'deviceCompleteLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/device/complete' }
        );
        const result = await deviceCompleteLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        if (result instanceof Response) {
          response = await serializeResponse(result);
        } else {
          response = {
            isResponse: false,
            dataBody:
              (result as { data?: Record<string, unknown> }).data ??
              (result as Record<string, unknown>),
            dataStatus: (result as { init?: { status?: number } }).init?.status,
          };
        }
        break;
      }

      case 'deviceIndexLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/device' }
        );
        const result = await deviceIndexLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        if (result instanceof Response) {
          response = await serializeResponse(result);
        } else {
          // deviceIndexLoader returns data()-wrapped object; carry the payload as dataBody.
          response = {
            isResponse: false,
            dataBody:
              (result as { data?: Record<string, unknown> }).data ??
              (result as Record<string, unknown>),
            dataStatus: (result as { init?: { status?: number } }).init?.status,
          };
        }
        break;
      }

      case 'signupCompleteLoader': {
        // Compound: if s.request.form contains registerEmail, first register a user
        // via the FakeAuthProvider to obtain a real (userId, code) pair, then inject
        // them into the URL before calling the loader. Avoids needing vi.mock.
        // FakeAuthProvider.register() sets emailCodes[user.id] = `email-${user.id}`.
        let resolvedUrl = s.request?.url ?? 'http://localhost/id/signup/complete';
        const registerEmail = s.request?.form?.registerEmail;
        if (registerEmail) {
          const registeredUser = await (provider as FakeAuthProvider).register({
            email: registerEmail,
            firstName: s.request?.form?.firstName ?? 'Test',
            lastName: s.request?.form?.lastName ?? 'User',
            ...(s.request?.form?.orgId ? { orgId: s.request.form.orgId } : {}),
          });
          const code = `email-${registeredUser.id}`;
          const parsedUrl = new URL(resolvedUrl);
          parsedUrl.searchParams.set('userId', registeredUser.id);
          parsedUrl.searchParams.set('code', code);
          resolvedUrl = parsedUrl.toString();
        }
        const { request } = await buildHandlerRequest({ url: resolvedUrl });
        const result = await signupCompleteLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        if (result instanceof Response) {
          response = await serializeResponse(result);
        } else {
          response = {
            isResponse: false,
            dataBody:
              (result as { data?: Record<string, unknown> }).data ??
              (result as Record<string, unknown>),
            dataStatus: (result as { init?: { status?: number } }).init?.status,
          };
        }
        break;
      }

      case 'signupMethodLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/signup/method' }
        );
        const result = await signupMethodLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        if (result instanceof Response) {
          response = await serializeResponse(result);
        } else {
          response = {
            isResponse: false,
            dataBody:
              (result as { data?: Record<string, unknown> }).data ??
              (result as Record<string, unknown>),
            dataStatus: (result as { init?: { status?: number } }).init?.status,
          };
        }
        break;
      }

      case 'signupMethodAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/signup/method', csrf: true }
        );
        const result = await signupMethodAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'signupPasswordLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/signup/password' }
        );
        const result = await signupPasswordLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        if (result instanceof Response) {
          response = await serializeResponse(result);
        } else {
          response = {
            isResponse: false,
            dataBody:
              (result as { data?: Record<string, unknown> }).data ??
              (result as Record<string, unknown>),
            dataStatus: (result as { init?: { status?: number } }).init?.status,
          };
        }
        break;
      }

      case 'signupPasswordAction': {
        // Compound seam: if form.preRegisterEmail is set, seed the FakeAuthProvider singleton
        // with that email first, then shadow its register() on the instance to throw
        // ALREADY_EXISTS when called with the same address again (mimicking real-provider
        // uniqueness enforcement). The service's runEnumerationSafeRegister catches the thrown
        // error and returns { kind: 'sent' } → the route emits 200, NOT 409. This is intentional
        // enumeration safety (SEC: account existence must be indistinguishable from a fresh signup
        // to prevent email harvesting). The observable security property under test: no raw
        // provider message or error code leaks to the client via the 200 enumeration-safe path.
        const preRegisterEmail = s.request?.form?.preRegisterEmail;
        if (preRegisterEmail) {
          await provider.register({
            email: preRegisterEmail,
            firstName: 'Pre',
            lastName: 'Registered',
          });
          const origRegister = provider.register.bind(provider);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (provider as any).register = async (
            input: Parameters<FakeAuthProvider['register']>[0]
          ) => {
            if (input.email === preRegisterEmail) {
              throw new ProviderError('ALREADY_EXISTS', `user ${input.email} already registered`);
            }
            return origRegister(input);
          };
        }
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/signup/password', csrf: true }
        );
        const result = await signupPasswordAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        // Restore prototype register() on the singleton to avoid polluting subsequent tests.
        if (preRegisterEmail) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (provider as any).register;
        }
        break;
      }

      case 'signupIndexLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/signup' }
        );
        const result = await signupIndexLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        if (result instanceof Response) {
          response = await serializeResponse(result);
        } else {
          response = {
            isResponse: false,
            dataBody:
              (result as { data?: Record<string, unknown> }).data ??
              (result as Record<string, unknown>),
            dataStatus: (result as { init?: { status?: number } }).init?.status,
          };
        }
        break;
      }

      case 'signupIndexAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/signup', csrf: true }
        );
        const result = await signupIndexAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      // ── batch 13d: accounts + logout + password + setup/authenticator + verify ─────────────────
      case 'accountsLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/accounts' }
        );
        const result = await accountsLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'accountsAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/accounts', csrf: true }
        );
        const result = await accountsAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'loginMfaAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/login/mfa', csrf: true }
        );
        const result = await loginMfaAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'logoutLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/logout' }
        );
        const result = await logoutLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'logoutSuccessLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/logout/success' }
        );
        const result = await logoutSuccessLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'logoutAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/logout', csrf: true }
        );
        const result = await logoutAction({ request, params: {}, context: {} as never } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'passwordNewLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/password/new' }
        );
        const result = await passwordNewLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'passwordNewAction': {
        // Compound seam: if form.preSendPasswordReset carries a userId, seed the provider's
        // resetCodes map first (same pattern as signupPasswordAction's preRegisterEmail seam).
        // Zod strips unknown fields from newPasswordSchema.safeParse so this does not affect
        // schema validation. The route then finds the matching code and redirects on success.
        const preSeedUserId = s.request?.form?.preSendPasswordReset as string | undefined;
        if (preSeedUserId) {
          await provider.sendPasswordReset(
            preSeedUserId,
            'http://localhost/id/password/reset?userId=__&code=__'
          );
        }
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/password/new', csrf: true }
        );
        const result = await passwordNewAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'passwordChangeLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/password/change' }
        );
        const result = await passwordChangeLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'passwordChangeAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/password/change', csrf: true }
        );
        const result = await passwordChangeAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'passwordResetLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/password/reset' }
        );
        const result = await passwordResetLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'passwordResetAction': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/password/reset', csrf: true }
        );
        const result = await passwordResetAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'setupAuthenticatorLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/setup/authenticator' }
        );
        const result = await setupAuthenticatorLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'verifyIndexLoader': {
        const { request } = await buildHandlerRequest(
          s.request ?? { url: 'http://localhost/id/verify' }
        );
        const result = await verifyIndexLoader({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      case 'verifyIndexAction': {
        // Compound seam: if form.preRegisterEmail is present, register a user via the
        // SINGLETON provider (same instance used by providerForRequest(request) inside
        // the action). register() sets emailCodes.set(userId, `email-${userId}`) on
        // the singleton so the action's verifyEmail call succeeds deterministically.
        const formData: Record<string, string> = {};
        for (const [k, v] of Object.entries(s.request?.form ?? {})) {
          if (typeof v === 'string') formData[k] = v;
        }
        const preRegisterEmail = formData.preRegisterEmail;
        if (preRegisterEmail) {
          const registeredUser = await (provider as FakeAuthProvider).register({
            email: preRegisterEmail,
            firstName: 'Test',
            lastName: 'User',
          });
          formData.userId = registeredUser.id;
          formData.code = `email-${registeredUser.id}`;
          delete formData.preRegisterEmail;
        }
        const { request } = await buildHandlerRequest(
          s.request
            ? { ...s.request, form: formData }
            : { url: 'http://localhost/id/verify', csrf: true, form: formData }
        );
        const result = await verifyIndexAction({
          request,
          params: {},
          context: {} as never,
        } as never);
        response = await serializeResponse(result);
        break;
      }

      default: {
        const exhaustive: never = s.fn;
        throw new Error(`unknown service fn: ${String(exhaustive)}`);
      }
    }
  } catch (err) {
    error = err instanceof Error ? (err.stack ?? err.message) : String(err);
  } finally {
    // eslint-disable-next-line no-console -- restore the intercepted audit sink
    console.log = originalLog;
  }

  // Provider state read-back (e.g. isDeviceAuthorized).
  const inspect: Record<string, unknown> = {};
  if (s.inspect?.isDeviceAuthorized) {
    const map: Record<string, boolean> = {};
    for (const id of s.inspect.isDeviceAuthorized) map[id] = provider.isDeviceAuthorized(id);
    inspect.isDeviceAuthorized = map;
  }
  if (s.inspect?.isEmailVerified) {
    const map: Record<string, boolean> = {};
    for (const id of s.inspect.isEmailVerified) map[id] = provider.isEmailVerified(id);
    inspect.isEmailVerified = map;
  }
  if (s.inspect?.findUser) {
    const map: Record<string, { id: string; displayName?: string; emailVerified: boolean } | null> =
      {};
    for (const loginName of s.inspect.findUser) {
      const u = await provider.findUser(loginName);
      map[loginName] = u
        ? { id: u.id, displayName: u.displayName, emailVerified: provider.isEmailVerified(u.id) }
        : null;
    }
    inspect.findUser = map;
  }
  if (s.inspect?.lastCreateSessionFingerprintId) {
    inspect.lastCreateSessionFingerprintId =
      provider.lastCreateSessionOpts?.userAgent?.fingerprintId ?? null;
  }
  if (s.inspect?.lastCreateSessionOpts) {
    inspect.lastCreateSessionOpts = provider.lastCreateSessionOpts ?? null;
  }
  if (s.inspect?.cookieSessions) {
    // Round-trip through the REAL cookie module: a spec that hand-decoded the base64 payload would
    // only prove it agrees with itself, whereas parsing what serializeSessions actually produced
    // proves the identity survives the write the browser receives.
    // Every service that writes this cookie emits exactly ONE `sessions=` Set-Cookie, so the value
    // IS the whole string — there is no multi-cookie header to split apart here.
    const written = (outcome as { setCookie?: unknown } | undefined)?.setCookie;
    let entries: Array<{ id: string; loginName: string; organization?: string }> | null = null;
    if (typeof written === 'string' && written.startsWith('sessions=')) {
      try {
        const parsed: unknown = await sessionsCookie.parse(written.split(';')[0]);
        // Shape-check rather than cast: a spec asserting on `loginName` must fail loudly if the
        // payload ever stops carrying one, not read `undefined` as though it were the value.
        entries = Array.isArray(parsed)
          ? parsed.flatMap((raw: unknown) => {
              const e = raw as { id?: unknown; loginName?: unknown; organization?: unknown };
              if (typeof e.id !== 'string' || typeof e.loginName !== 'string') return [];
              return [
                {
                  id: e.id,
                  loginName: e.loginName,
                  organization: typeof e.organization === 'string' ? e.organization : undefined,
                },
              ];
            })
          : null;
      } catch {
        entries = null;
      }
    }
    inspect.cookieSessions = entries;
  }

  const audit = auditLines.map(parseAuditLine).filter((e): e is AuditEvent => e !== null);

  return {
    ok: error === undefined,
    error,
    outcome: outcome as Record<string, unknown> | undefined,
    response,
    audit,
    auditLines,
    calls: s.recordCalls?.length ? calls : undefined,
    inspect: Object.keys(inspect).length ? inspect : undefined,
  };
}
