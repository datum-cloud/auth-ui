import type { FactorState, Factors } from '@/modules/auth/types';

/** A factor is fresh iff verified and within its check lifetime (0/undefined ⇒ no expiry). */
export function isFactorFresh(
  f: FactorState | undefined,
  nowMs: number,
  lifetimeMs: number | undefined
): boolean {
  // verifiedAt is `Date | null` — a real Date, never the empty-string third state the
  // old `string | null` permitted. The NaN guard still defends against an Invalid Date.
  if (!f?.verifiedAt) return false;
  const verifiedMs = f.verifiedAt.getTime();
  if (Number.isNaN(verifiedMs)) return false;
  if (!lifetimeMs) return true; // undefined or 0 ⇒ never expires
  return nowMs - verifiedMs <= lifetimeMs;
}

/** Checks if any primary authentication factor is fresh. Pass `lifetimeMs` from `LoginSettings.passwordCheckLifetimeMs`. */
export function primaryFresh(f: Factors, nowMs: number, lifetimeMs: number | undefined): boolean {
  return (
    isFactorFresh(f.password, nowMs, lifetimeMs) ||
    isFactorFresh(f.passkey, nowMs, lifetimeMs) ||
    isFactorFresh(f.idpIntent, nowMs, lifetimeMs)
  );
}

/** Checks if any second factor is fresh. Pass `lifetimeMs` from `LoginSettings.secondFactorCheckLifetimeMs`. */
export function secondFactorFresh(
  f: Factors,
  nowMs: number,
  lifetimeMs: number | undefined
): boolean {
  return (
    isFactorFresh(f.totp, nowMs, lifetimeMs) ||
    isFactorFresh(f.otpEmail, nowMs, lifetimeMs) ||
    isFactorFresh(f.otpSms, nowMs, lifetimeMs) ||
    isFactorFresh(f.u2f, nowMs, lifetimeMs)
  );
}

/** Passwordless passkey satisfies MFA only when it was user-verified and is still fresh. Pass `lifetimeMs` from `LoginSettings.multiFactorCheckLifetimeMs`. */
export function passwordlessPasskeyFresh(
  f: Factors,
  userVerified: boolean,
  nowMs: number,
  lifetimeMs: number | undefined
): boolean {
  return userVerified && isFactorFresh(f.passkey, nowMs, lifetimeMs);
}
