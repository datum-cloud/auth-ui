/**
 * Static predecessor map for the "← Back" control (spec §5). Each entry is a
 * pathname matcher → the step to return to. Terminal/headless screens are
 * intentionally absent (no Back rendered). First match wins.
 */
const PREVIOUS_STEP: Array<[match: (p: string) => boolean, target: string]> = [
  [(p) => p === '/login/password', '/login'],
  [(p) => p === '/login/mfa', '/login/password'],
  // Verify screens AND /login/security-key are all USE_SCREEN targets of
  // resolveMfaPicker's sole-factor short-circuit (mfa.service.ts): whenever the user has
  // exactly one enrolled+policy-allowed second factor, /login/mfa's loader redirects
  // straight back to that screen BEFORE any picker UI renders. A Back target of
  // /login/mfa therefore silently loops back to the same page. Go straight to /login
  // instead (matches "Not you?" semantics) — 2+-factor users still reach the real
  // picker via forward navigation from /login/password, which is unaffected.
  [(p) => p.startsWith('/login/verify/'), '/login'],
  [(p) => p === '/login/passkey', '/login'],
  [(p) => p === '/login/security-key', '/login'],
  [(p) => p === '/signup/password', '/signup'],
  [(p) => p === '/signup/method', '/signup'],
  [(p) => p === '/password/reset', '/login/password'],
  // Password-management screens previously had no Back control.
  [(p) => p === '/password/new', '/login/password'],
  [(p) => p === '/password/change', '/login/password'],
  // The /setup/mfa chooser returns to /login/password (mirrors
  // /login/mfa); each enrollment leaf is reached FROM the chooser, so Back goes
  // there. Order matters — the exact /setup/mfa match precedes the leaf prefix.
  [(p) => p === '/setup/mfa', '/login/password'],
  [(p) => p.startsWith('/setup/'), '/setup/mfa'],
];

export function previousStepFor(pathname: string): string | null {
  for (const [match, target] of PREVIOUS_STEP) {
    if (match(pathname)) return target;
  }
  return null;
}
