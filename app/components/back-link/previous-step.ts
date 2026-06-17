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
];

export function previousStepFor(pathname: string): string | null {
  for (const [match, target] of PREVIOUS_STEP) {
    if (match(pathname)) return target;
  }
  return null;
}
