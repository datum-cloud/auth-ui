import { legacyRedirects } from './server/middleware/legacy-redirects';
import { env } from '@/server/infra/env.server';
import {
  loginPasswordRateLimit,
  signupRateLimit,
  passwordResetRateLimit,
  mfaVerifyRateLimit,
  ldapRateLimit,
  webauthnVerifyRateLimit,
  mfaEnrollRateLimit,
  accountsRateLimit,
  verifyEmailSendRateLimit,
} from '@/server/middleware/rate-limit';
import { requestContext, type RequestContextEnv } from '@/server/middleware/request-context';
import { appSecureHeaders, resolveFrameAncestors } from '@/server/middleware/secure-headers';
import { registry, httpMetrics } from '@/server/observability';
import { samlPostHandler } from '@/server/routes/saml-post';
import { serveStatic } from 'hono/bun';
import { compress } from 'hono/compress';
import { createHonoServer } from 'react-router-hono-server/bun';

declare module 'react-router' {
  interface AppLoadContext {
    traceId: string;
    // EL-TRANSPORT-1 + CSP nonce threading: per-request nonce from hono secure-headers.
    cspNonce: string | undefined;
  }
}

export default await createHonoServer<RequestContextEnv>({
  // Supplying onGracefulShutdown activates react-router-hono-server/bun's built-in
  // SIGTERM + SIGINT handler (bun.js adapter lines 96-124): it calls
  // serverInstance.stop(false) — draining all in-flight requests — then runs this
  // callback, then exits 0.  The preStop sleep in the k8s Deployment (10 s) gives
  // kube-proxy time to deregister the endpoint before SIGTERM arrives, so no new
  // traffic reaches the pod during the drain window.
  async onGracefulShutdown() {
    // Nothing app-level to close today (no DB pool, no persistent connections).
    // The hook intentionally left as a no-op so the SIGTERM path is active and
    // future resources (e.g. a DB pool) can be closed here without changing the
    // activation plumbing.
  },
  configure(app) {
    const isDev = env.NODE_ENV !== 'production';
    // EL-TRANSPORT-1: x-zitadel-forward-host directs where the service-user token is sent.
    // External callers must never control it — strip it at the edge; only the
    // ZITADEL_TRUSTED_FORWARD_HOSTS allowlist may reintroduce trust.
    // Bun/Hono: c.req.raw.headers is a read-only Headers instance in the Fetch API;
    // deletion throws. We guard inside providerForRequest via the fail-closed allowlist
    // instead — a forward-host not in the allowlist is rejected before it reaches the
    // transport. This is the effective SSRF defense; no strip middleware is needed.
    // httpMetrics must be first so the timer captures total request latency.
    app.use('*', httpMetrics);
    app.use('*', requestContext);
    app.use('*', appSecureHeaders(isDev, resolveFrameAncestors(env.FRAME_ANCESTORS)));
    // Legacy 301s: redirect hardcoded /ui/v2/login/* links (sibling repos) to /id/* before routing.
    app.use('*', legacyRedirects);
    // Compress STATIC ASSETS ONLY — never SSR HTML. Auth pages embed a per-session
    // CSRF token (remix-utils commitToken reuses the cookie token) alongside
    // attacker-reflectable query params (loginName, user_code, …); compressing that
    // mix is a BREACH-class oracle. JS/CSS carry no secrets and are where the
    // bytes are anyway, so compression is scoped to the asset path.
    app.use('/id/assets/*', compress());
    // P7 perf fix: react-router-hono-server mounts static assets at /assets/* but vite
    // base='/id/' makes the browser request them as /id/assets/*.  In production the
    // ingress strips the /id prefix before hitting this server; in local `bun run start`
    // (used by lhci) the prefix is preserved and the RR7 catch-all returns error HTML for
    // every JS/CSS file.  Serve the built client assets under the prefixed path so local
    // perf measurements (lhci, Lighthouse, manual `bun run start`) work correctly.
    if (!isDev) {
      app.use(
        '/id/assets/*',
        async (c, next) => {
          await next();
          // content-hashed filenames are immutable by construction
          if (c.res.ok) c.res.headers.set('cache-control', 'public, max-age=31536000, immutable');
        },
        serveStatic({
          root: 'build/client',
          rewriteRequestPath: (path) => path.replace('/id/assets/', '/assets/'),
        })
      );
      // Public assets (vite copies public/ → build/client root) also carry the /id base.
      // Same gateway situation as /id/assets/*: serve them under the prefix so a local
      // `bun run start` (prefix preserved) doesn't fall through to the RR catch-all error.
      // Not content-hashed, so no immutable cache header here.
      for (const prefix of ['/id/images/*', '/id/favicons/*']) {
        app.use(
          prefix,
          serveStatic({
            root: 'build/client',
            rewriteRequestPath: (path) => path.replace('/id/', '/'),
          })
        );
      }
    }
    // Mount covers all sub-paths of /id/login/* so Hono's stricter path-equality matching cannot
    // be bypassed by trailing-slash or case variants that RR7 still routes to the action.
    // The middleware self-guards on method (POST only) and normalized path (/id/login/password),
    // so no other sub-routes or GETs are affected. Body-stream hazard: the middleware never reads
    // the body — key is taken from URL params (see middleware comment).
    app.use('/id/login/*', loginPasswordRateLimit);
    // Signup rate-limit: covers /id/signup and /id/signup/password (POST only).
    // The middleware self-guards on method + normalized path so neither GETs nor
    // unrelated sub-routes are affected. Body-stream hazard: key is ip-only for /signup
    // (email is in the body) and ip+loginName for /signup/password (loginName is a URL param).
    app.use('/id/signup/*', signupRateLimit);
    // Password-reset rate-limit: covers /id/password/reset (POST only).
    // The middleware self-guards on method + normalized path. Key is ip-only
    // (loginName is in the POST body — body-stream hazard; cannot read it here).
    // The ip-keyed response is identical for known/unknown accounts.
    app.use('/id/password/*', passwordResetRateLimit);
    // MFA verify rate-limit: covers /id/login/verify/* (POST only, all three screens).
    // loginPasswordRateLimit already covers this mount path but self-guards on
    // /id/login/password exactly — so the verify sub-routes need their own guard.
    // Key is ip-only (loginName is in the POST body — body-stream hazard).
    app.use('/id/login/verify/*', mfaVerifyRateLimit);
    // LDAP credential-entry rate-limit: covers /id/sso/ldap (POST only).
    // Matches the same window/limit as loginPasswordRateLimit (5 attempts / 5 min).
    // Key is ip-only — body-stream hazard prevents reading username from the body here.
    app.use('/id/sso/ldap', ldapRateLimit);
    // P5 carry-over (2026-06-12): WebAuthn verification ceremony rate-limit.
    // Covers POST /id/login/passkey, /id/login/security-key, /id/login/mfa (10/5min, ip-only).
    // Self-guards on its three exact paths — does NOT overlap with loginPasswordRateLimit
    // (/id/login/password) or mfaVerifyRateLimit (/id/login/verify/*).
    // Body-stream hazard: assertion payloads are in the POST body — key is ip-only.
    app.use('/id/login/*', webauthnVerifyRateLimit);
    // P5 carry-over (2026-06-12): MFA enrollment rate-limit.
    // Covers all POST /id/setup/* surfaces: passkey, security-key, authenticator,
    // email, sms, and mfa (skip/confirm) (15/5min, ip-only).
    // Enrollment is session-gated already; the limiter guards scripted abuse from
    // compromised sessions. Body-stream hazard: key is ip-only.
    app.use('/id/setup/*', mfaEnrollRateLimit);
    // P5 carry-over (2026-06-12): Accounts (session switch/remove) rate-limit.
    // Covers POST /id/accounts (15/5min, ip-only).
    // Body-stream hazard: intent + sessionId are in the POST body — key is ip-only.
    app.use('/id/accounts', accountsRateLimit);
    // Email-code dispatch rate-limit for GET /id/verify?send=true.
    // Defence-in-depth alongside the session-ownership gate in the verify.tsx loader.
    // Self-guards on GET + ?send=true; POST submits are unaffected. Key is ip-only.
    app.use('/id/verify', verifyEmailSendRateLimit);
    app.get('/healthz', (c) => c.json({ status: 'ok' }));
    app.get('/readyz', (c) => c.json({ status: 'ready' }));
    app.get('/security', (c) =>
      c.text('Contact: security@datum.net\n', 200, { 'content-type': 'text/plain' })
    );
    // /metrics is intentionally UNAUTHENTICATED. It is only reachable cluster-internally
    // — the gateway/HTTPRoute does not expose this path externally (see ops config). Do NOT add
    // app-level auth here without a corresponding gateway-policy decision; scraping breaks otherwise.
    app.get('/metrics', async (c) =>
      c.text(await registry.metrics(), 200, { 'content-type': registry.contentType })
    );
    // SAML POST binding BFF renderer (Phase 6 Task 8).
    // RR7 redirects to /sso/saml-post (basename-relative); Hono serves it at /id/sso/saml-post
    // OUTSIDE React Router so the auto-submitting form page is never processed by RR loaders.
    // The route reads SAML fields from the short-lived signed cookie and renders an
    // HTML auto-submit form. The nonce is injected by appSecureHeaders (runs app.use('*')).
    app.get('/id/sso/saml-post', samlPostHandler);
  },
  getLoadContext(c) {
    return {
      traceId: c.get('traceId'),
      // Step 4: thread the per-request CSP nonce into the load context so the root
      // loader can pass it to <Scripts nonce> / <ScrollRestoration nonce> /
      // renderToPipeableStream. Hono stores it under 'secureHeadersNonce' (confirmed
      // in node_modules/hono/dist/middleware/secure-headers/secure-headers.js).
      // In dev mode, NONCE is not used (unsafe-inline instead), so c.get returns undefined.
      cspNonce: c.get('secureHeadersNonce') as string | undefined,
    };
  },
});
