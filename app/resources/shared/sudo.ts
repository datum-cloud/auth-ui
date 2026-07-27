import { isFactorFresh } from './lifetimes';
import type { Factors } from '@/modules/auth/types';

/** GitHub-sudo-style window: a factor proven ≤ 10 min ago authorizes sensitive ops. */
export const SUDO_TTL_MS = 10 * 60 * 1000;

/**
 * True iff any AUTHENTICATION factor was verified within SUDO_TTL_MS of nowMs.
 * Qualifying factors: password, webAuthN (neutral passkey + u2f both derive from the
 * session webAuthN factor), totp, otpEmail, otpSms, idpIntent. The bare user check is
 * structurally excluded — it never appears in the neutral Factors shape.
 * Pure: nowMs is injected; enforcement call sites pass Date.now() at the route/action layer.
 */
export function isSudoFresh(factors: Factors, nowMs: number): boolean {
  return (
    isFactorFresh(factors.password, nowMs, SUDO_TTL_MS) ||
    isFactorFresh(factors.passkey, nowMs, SUDO_TTL_MS) ||
    isFactorFresh(factors.u2f, nowMs, SUDO_TTL_MS) ||
    isFactorFresh(factors.totp, nowMs, SUDO_TTL_MS) ||
    isFactorFresh(factors.otpEmail, nowMs, SUDO_TTL_MS) ||
    isFactorFresh(factors.otpSms, nowMs, SUDO_TTL_MS) ||
    isFactorFresh(factors.idpIntent, nowMs, SUDO_TTL_MS)
  );
}
