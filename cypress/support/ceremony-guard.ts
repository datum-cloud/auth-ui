/**
 * Ceremony-params regression guardrail — Node-side static-analysis scanner.
 *
 * The requestId (`oidc_`/`saml_`/`device_`) + organization ceremony-context pair must
 * survive EVERY in-app navigation, or a relying-party OIDC/SAML/device request can never
 * resume. An audit found 15 sites across app/routes/** and the shared redirect helpers that
 * silently dropped one or both params on a guard-fail redirect or a static link. This scanner
 * is the regression backstop: it fails if a FUTURE edit reintroduces one of the same
 * ceremony-dropping literal patterns —
 *
 *   - a bare  redirect('/login')  or  redirect('/')
 *   - a hardcoded  to="/"  (React Router <Link>)
 *   - a hardcoded  href="/login"  or  href="/"
 *   - a no-arg  paths.<namespace>.index()  call
 *
 * — in a ceremony route (any file under app/routes/**, plus the handful of shared modules
 * that BUILD the redirect targets those routes call into: next-step-params.ts,
 * ceremony-params.ts, idp-return-urls.ts — a regression in one of those breaks every caller
 * silently).
 *
 * Comment lines (// … , block-comment continuations starting with `*`, and `/*`/`/**` openers)
 * are excluded — several of the patterns above legitimately appear in prose describing the
 * OLD (now-fixed) behavior, and flagging documentation would make this a vacuous, noisy check.
 *
 * ALLOWLIST — routes with NO live ceremony to preserve (each entry documents why; see the
 * ALLOWLIST map below). Everything else that matches is a real offender.
 *
 * This module is registered as the `ceremonyGuard` cy.task in the COMPONENT project's
 * setupNodeEvents (cypress/support/node/tasks.ts) so the gate runs as part of the
 * `--component` suite. It uses only Node `fs`/`path` (no `@/` app import), matching the
 * audit-coverage.ts scanner's pattern.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const ROUTES_DIR = join(ROOT, 'app/routes');

// Shared modules OUTSIDE app/routes/ that build the actual redirect/link targets ceremony
// routes call into. A regression here silently breaks every caller, so they're scanned too.
const HELPER_FILES = [
  join(ROOT, 'app/resources/shared/next-step-params.ts'),
  join(ROOT, 'app/resources/shared/ceremony-params.ts'),
  join(ROOT, 'app/resources/sso/idp-return-urls.ts'),
];

export interface CeremonyGuardOffender {
  /** Path relative to the repo root, e.g. `app/routes/login/mfa.tsx`. */
  file: string;
  line: number;
  text: string;
  pattern: string;
}

export interface CeremonyGuardResult {
  offenders: CeremonyGuardOffender[];
  filesScanned: number;
  /** Echoed back so the (browser-side) spec can assert on it without importing this Node-only
   *  module directly (it pulls in `fs`/`path`, which don't exist in the Vite browser bundle). */
  allowlist: Record<string, string>;
}

/**
 * Routes with NO live ceremony to preserve. Each entry is a documented, deliberate carve-out
 * — not a blanket exemption — keyed by the path relative to app/routes/.
 */
const ALLOWLIST: Record<string, string> = {
  'logout/success.tsx':
    'Terminal post-logout screen. The session is already gone; "Sign in again" intentionally ' +
    'starts a FRESH, ceremony-less login — there is no in-flight OIDC/SAML/device request left ' +
    'to resume after a completed logout.',
  'verify/success.tsx':
    'Terminal post-email-verification screen, reached via a one-time verification link (its ' +
    'own code/userId token, not a requestId). There is no OIDC/SAML/device requestId in scope ' +
    'to carry forward from here.',
  'sso/link.tsx':
    'The account-linking sign-in gate threads its OWN `returnTo` param — resolveSsoLink never ' +
    'reads or resolves a requestId/organization — so there is no OIDC/SAML/device ceremony to ' +
    'preserve on its "Back"/sign-in links.',
  'device/authorize.tsx':
    'The "Enter a new code" recovery link for a stale/expired device code. The device flow is ' +
    "keyed by user_code/deviceAuthId, not requestId; /device's code-entry screen takes no " +
    'ceremony query params, and a stale code has nothing left to resume.',
};

const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "bare redirect('/login')", re: /redirect\(\s*(['"`])\/login\1\s*\)/ },
  { name: "bare redirect('/')", re: /redirect\(\s*(['"`])\/\1\s*\)/ },
  { name: 'to="/"', re: /\bto="\/"/ },
  { name: 'href="/login"', re: /href="\/login"/ },
  { name: 'href="/"', re: /href="\/"/ },
  { name: 'no-arg paths.*.index()', re: /paths\.[a-zA-Z]+(?:\.[a-zA-Z]+)*\.index\(\)/ },
];

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** Recursively collect route modules under app/routes/, skipping __tests__ and test files. */
function routeFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.test.tsx')
      ) {
        out.push(full);
      }
    }
  }
  walk(ROUTES_DIR);
  return out;
}

export function runCeremonyGuard(): CeremonyGuardResult {
  const files = [...routeFiles(), ...HELPER_FILES];
  const offenders: CeremonyGuardOffender[] = [];

  for (const filePath of files) {
    const relToRoutes = relative(ROUTES_DIR, filePath);
    if (ALLOWLIST[relToRoutes]) continue; // documented terminal route — skip entirely

    const content = readFileSync(filePath, 'utf-8');
    const relToRoot = relative(ROOT, filePath);
    content.split('\n').forEach((line, idx) => {
      if (isCommentLine(line)) return;
      for (const { name, re } of PATTERNS) {
        if (re.test(line)) {
          offenders.push({ file: relToRoot, line: idx + 1, text: line.trim(), pattern: name });
        }
      }
    });
  }

  return { offenders, filesScanned: files.length, allowlist: ALLOWLIST };
}
