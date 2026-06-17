// Self-hosted woff2 — converted from @datum-cloud/datum-ui v1.2.0 TTFs (see app/styles/fonts/).
// Vite content-hashes the file into /id/assets/AllianceNo1-Regular-[hash].woff2.
import allianceFontRegularUrl from './styles/fonts/AllianceNo1-Regular.woff2?url';
import './styles/root.css';
import { AuthCard } from '@/components/auth-card/auth-card';
import { loadMessages } from '@/modules/i18n/lingui';
import { detectLocale } from '@/modules/i18n/lingui.server';
import { authErrorMessage } from '@/utils/errors/auth-error';
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import { ThemeProvider, ThemeScript } from '@datum-cloud/datum-ui/theme';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, useMemo } from 'react';
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
  type AppLoadContext,
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
}: LoaderFunctionArgs & { context: AppLoadContext }) {
  const locale = detectLocale(request);
  const messages = await loadMessages(locale);
  // Thread the per-request CSP nonce into the route data so Layout can pass it to
  // <Scripts nonce> / <ScrollRestoration nonce> / renderToPipeableStream.
  // In dev mode the nonce is undefined (Hono uses 'unsafe-inline' instead of NONCE).
  return { locale, messages, cspNonce: context?.cspNonce };
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
        <Meta />
        <Links />
        <ThemeScript nonce={data?.cspNonce} attribute="class" defaultTheme="light" />
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
  const { locale, messages } = useLoaderData<typeof loader>();

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

  // QueryClient inside component state — prevents shared server-side cache across users.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
      })
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <I18nProvider i18n={i18nInstance}>
          <ConformAdapter>
            <Outlet />
          </ConformAdapter>
        </I18nProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

// CCD-10 / CODE-MAJ-06: pure presentational view — unit-testable without router context.
// Always shows the generic fallback from authErrorMessage(undefined); raw error text is
// NEVER reflected into the DOM (no branching on error contents).
export function ErrorView() {
  const { title, body } = authErrorMessage(undefined); // always the generic fallback
  return (
    <AuthCard title={title}>
      <div className="flex flex-col gap-4 text-center">
        <p className="text-foreground">{body}</p>
      </div>
    </AuthCard>
  );
}

// CCD-10 / CODE-MAJ-06: app-wide error boundary. Every route inherits this when a loader,
// action, or render throws — replacing React Router's unstyled default with the branded
// AuthCard and a FIXED, non-leaking message.
export function ErrorBoundary() {
  const error = useRouteError();
  // We deliberately do NOT branch on error contents to avoid reflecting attacker-influenced
  // text. isRouteErrorResponse is read only to keep a future status hook honest.
  void (isRouteErrorResponse(error) ? error.status : 500);
  return <ErrorView />;
}
