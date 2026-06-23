/**
 * Static predecessor map for the "← Back" control (spec §5). Each entry is a
 * pathname matcher → the step to return to. Terminal/headless screens are
 * intentionally absent (no Back rendered). First match wins.
 */
const PREVIOUS_STEP: Array<[match: (p: string) => boolean, target: string]> = [
  [(p) => p === '/login/password', '/login'],
  [(p) => p === '/login/mfa', '/login/password'],
  [(p) => p.startsWith('/login/verify/'), '/login/mfa'],
  [(p) => p === '/signup/password', '/signup'],
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
