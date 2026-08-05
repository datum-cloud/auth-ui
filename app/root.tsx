// Self-hosted woff2 — converted from @datum-cloud/datum-ui v1.2.0 TTFs (see app/styles/fonts/).
// Vite content-hashes the file into /id/assets/AllianceNo1-Regular-[hash].woff2.
import { ClientHintCheck } from './components/misc/client-hints';
import { DynamicFaviconLinks } from './components/misc/dynamic-favicon';
import allianceFontRegularUrl from './styles/fonts/AllianceNo1-Regular.woff2?url';
import './styles/root.css';
import { AuthCard } from '@/components/auth-card/auth-card';
import { RybbitAnalytics, resolveRybbitSiteId } from '@/modules/analytics/rybbit';
import { MaxMindTracker } from '@/modules/fraud/maxmind-tracker';
import { loadMessages } from '@/modules/i18n/lingui';
import { detectLocale } from '@/modules/i18n/lingui.server';
import { env } from '@/server/infra/env.server';
import { cspNonceContext } from '@/shared/load-context';
import { authErrorMessage } from '@/utils/errors/auth-error';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { ThemeProvider, ThemeScript } from '@datum-cloud/datum-ui/theme';
import { Toaster } from '@datum-cloud/datum-ui/toast';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { useEffect, useMemo } from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type LoaderFunctionArgs,
  type LinksFunction,
  useLoaderData,
  useRouteLoaderData,
  useRouteError,
  isRouteErrorResponse,
  type RouterContextProvider,
} from 'react-router';

// Preload Alliance No1 Regular — primary body font (--font-sans in datum-ui alpha theme).
// Eliminates FOIT and reduces LCP by starting the woff2 fetch in parallel with CSS parsing.
// crossOrigin='anonymous' is required by the font preload spec for cross-origin resources.
export const links: LinksFunction = () => [
  {
    rel: 'preload',
    href: allianceFontRegularUrl,
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous',
  },
];

export async function loader({
  request,
  context,
}: LoaderFunctionArgs & { context: RouterContextProvider }) {
  const locale = detectLocale(request);
  const messages = await loadMessages(locale);
  // Thread the per-request CSP nonce into the route data so Layout can pass it to
  // <Scripts nonce> / <ScrollRestoration nonce> / renderToPipeableStream.
  // In dev mode the nonce is undefined (Hono uses 'unsafe-inline' instead of NONCE).
  return {
    locale,
    messages,
    cspNonce: context.get(cspNonceContext),
    rybbitSiteId: resolveRybbitSiteId(env.RYBBIT_SITE_ID),
    rybbitTag: env.RYBBIT_TAG,
    maxmindAccountId: env.MAXMIND_ACCOUNT_ID ?? '',
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  // useRouteLoaderData is safe here even for error renders — returns undefined when
  // the root loader didn't run (e.g. thrown response before loader completed).
  const data = useRouteLoaderData<typeof loader>('root');
  return (
    <html lang={data?.locale ?? 'en'} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />

        <DynamicFaviconLinks />

        <ClientHintCheck nonce={data?.cspNonce} />

        <Meta />
        <Links />
        {/* Must mirror the <ThemeProvider> props below exactly so the pre-hydration
            class on <html> matches React's first render (no FOUC, no hydration mismatch).
            enableSystem + defaultTheme="system" → a fresh visitor follows prefers-color-scheme;
            the persisted ThemeToggle choice (localStorage) overrides it on return visits. */}
        <ThemeScript nonce={data?.cspNonce} attribute="class" defaultTheme="system" enableSystem />

        <RybbitAnalytics siteId={data?.rybbitSiteId} tag={data?.rybbitTag} nonce={data?.cspNonce} />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={data?.cspNonce} />
        <Scripts nonce={data?.cspNonce} />
      </body>
    </html>
  );
}

export default function App() {
  const { locale, messages, maxmindAccountId } = useLoaderData<typeof loader>();

  // Hydration marker: lets e2e tests wait until React has attached its handlers
  // before interacting with forms. With the conform adapter the forms submit
  // natively even pre-hydration (progressive enhancement), but client-side
  // validation/state only runs once hydrated. html[data-hydrated] flips only client-side.
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
  }, []);

  // Per-request i18n instance — avoids cross-request locale bleed from any global singleton.
  const i18nInstance = useMemo(
    () => setupI18n({ locale, messages: { [locale]: messages } }),
    [locale, messages]
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nProvider i18n={i18nInstance}>
        <ConformAdapter>
          <MaxMindTracker accountId={maxmindAccountId} />
          <Outlet />
          <Toaster position="top-right" />
        </ConformAdapter>
      </I18nProvider>
    </ThemeProvider>
  );
}

// Pure presentational view — unit-testable without router context.
// Always shows the generic fallback from authErrorMessage(undefined); raw error text is
// NEVER reflected into the DOM (no branching on error contents).
export function ErrorView() {
  const { title, body } = authErrorMessage(undefined); // always the generic fallback
  return <AuthCard title={title} description={body} />;
}

// App-wide error boundary. Every route inherits this when a loader,
// action, or render throws — replacing React Router's unstyled default with the branded
// AuthCard and a FIXED, non-leaking message.
export function ErrorBoundary() {
  const error = useRouteError();
  // We deliberately do NOT branch on error contents to avoid reflecting attacker-influenced
  // text. isRouteErrorResponse is read only to keep a future status hook honest.
  void (isRouteErrorResponse(error) ? error.status : 500);
  return <ErrorView />;
}
