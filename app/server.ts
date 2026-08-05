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
  reauthRateLimit,
  passkeysRateLimit,
  loginMethodRateLimit,
  loginMethodIntentRateLimit,
  loginMethodIntentIpRateLimit,
  loginIdentifierRateLimit,
} from '@/server/middleware/rate-limit';
import { requestContext, type RequestContextEnv } from '@/server/middleware/request-context';
import { appSecureHeaders, resolveFrameAncestors } from '@/server/middleware/secure-headers';
import { registry, httpMetrics } from '@/server/observability';
import { samlPostHandler } from '@/server/routes/saml-post';
import { serveStatic } from 'hono/bun';
import { compress } from 'hono/compress';
import { cspNonceContext, traceIdContext } from '@/shared/load-context';
import { createHonoServer } from 'react-router-hono-server/bun';
import { RouterContextProvider } from 'react-router';

// React Router 8 reads the load context through typed keys on a
// RouterContextProvider instead of an augmented AppLoadContext interface.
// The keys are defined in @/shared/load-context so client-reachable readers
// (root.tsx, entry.server.tsx) don't have to import this server entry.

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
    // x-zitadel-forward-host directs where the service-user token is sent.
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
    // Perf fix: react-router-hono-server mounts static assets at /assets/* but vite
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
    // Rate-limit middlewares are mounted on '*' (catch-all) rather than specific path prefixes.
    //
    // WHY: Hono's static-segment path matching is case-sensitive, but React Router matches routes
    // case-insensitively. A request to e.g. /id/Login/password (capital L) bypasses a
    // '/id/login/*' Hono mount entirely and reaches the RR action unthrottled. Mounting on '*'
    // ensures the middleware always executes and its own `match` self-guard handles filtering.
    //
    // Each middleware is safe on every request because `match` receives a pathname already
    // normalized to lowercase by `normalizedPathname` in net.ts (toLowerCase + trailing-slash
    // strip + .data strip). Requests that do not match call `next()` immediately with no
    // meaningful overhead beyond a pathname parse.
    // The identifier submit is what hands out the ceremony session /id/login/method's gate
    // demands, so it needs its own ceiling — see the rationale in rate-limit.ts.
    app.use('*', loginIdentifierRateLimit);
    app.use('*', loginPasswordRateLimit);
    app.use('*', signupRateLimit);
    app.use('*', passwordResetRateLimit);
    app.use('*', mfaVerifyRateLimit);
    app.use('*', ldapRateLimit);
    app.use('*', webauthnVerifyRateLimit);
    app.use('*', mfaEnrollRateLimit);
    app.use('*', accountsRateLimit);
    app.use('*', verifyEmailSendRateLimit);
    app.use('*', reauthRateLimit);
    app.use('*', passkeysRateLimit);
    app.use('*', loginMethodRateLimit);
    // The chooser GET is counted by BOTH tiers (tight ip|loginName, loose ip ceiling) —
    // see the two-tier rationale in rate-limit.ts.
    app.use('*', loginMethodIntentRateLimit);
    app.use('*', loginMethodIntentIpRateLimit);
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
    const context = new RouterContextProvider();
    context.set(traceIdContext, c.get('traceId'));
    // Step 4: thread the per-request CSP nonce into the load context so the root
    // loader can pass it to <Scripts nonce> / <ScrollRestoration nonce> /
    // renderToPipeableStream. Hono stores it under 'secureHeadersNonce' (confirmed
    // in node_modules/hono/dist/middleware/secure-headers/secure-headers.js).
    // In dev mode, NONCE is not used (unsafe-inline instead), so c.get returns undefined.
    context.set(cspNonceContext, c.get('secureHeadersNonce') as string | undefined);
    return context;
  },
});
