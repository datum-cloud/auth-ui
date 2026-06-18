import { lingui } from '@lingui/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { reactRouterHonoServer } from 'react-router-hono-server/dev';
import { defineConfig } from 'vite';
import macrosPlugin from 'vite-plugin-babel-macros';

export default defineConfig({
  // Client assets must live under the gateway-routed prefix (HTTPRoute only
  // forwards /id/*) — without this the SSR HTML references /assets/* which the
  // gateway sends to the legacy backend (unstyled, script-less pages, green probes).
  // (trailing slash required for correct asset URL joins; react-router.config.ts
  // basename must match it — RR dev requires basename to begin with base)
  base: '/id/',
  server: {
    port: 3000,
    // Dev server must accept the gateway host when accessed via the local stack
    // (auth.localtest.me). Explicit list (not `true`) to avoid a wildcard allow.
    allowedHosts: ['localhost', '127.0.0.1', 'auth.localtest.me'],
    // Listen on all network interfaces so VS Code can forward it properly
    host: '127.0.0.1',
    hmr: {
      // Forces the browser to connect to your local forwarding address
      host: 'localhost',
    },
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    reactRouter(),
    reactRouterHonoServer({
      runtime: 'bun',
      serverEntryPoint: './app/server.ts',
      // The plugin's built-in dev excludes (what bypasses Hono and goes to Vite)
      // assume root-relative asset URLs (/app/*, /@vite/*, /node_modules/*). With
      // `base: '/id/'` every dev asset URL carries the /id prefix, so none of the
      // built-ins match and the RR catch-all route SSRs HTML for module scripts —
      // hydration never happens in dev. Mirror the built-in patterns under the
      // base (keeping RR's *.data requests routed to Hono).
      dev: {
        exclude: [
          /^\/id\/app\/(?!.*\.data(\?|$)).*\..*(\?.*)?$/,
          /^\/id\/@.+$/,
          /^\/id\/node_modules\/.*/,
          // Public assets (public/images, public/favicons) carry the /id base too; route
          // them to Vite's publicDir instead of the RR catch-all (which SSRs an error page).
          /^\/id\/(images|favicons)\/.+/,
        ],
      },
    }),
    macrosPlugin(),
    lingui(),
  ],
});
