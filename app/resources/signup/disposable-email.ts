// The list ships in the pinned disposable-email-domains-js package, so a change to it arrives as a
// reviewed dependency update. The package's own isDisposableEmail answers only true or false; the
// walk below also returns the matched entry, which is what the sign-up audit event logs.
import { disposableEmailBlocklistSet } from 'disposable-email-domains-js';

/** Built once per process; the package returns a fresh copy on every call. */
const DISPOSABLE_DOMAINS: ReadonlySet<string> = disposableEmailBlocklistSet();

/**
 * The listed domain the address falls under, or null. Checks the domain and each parent suffix
 * of two labels or more, so `a.b.mailinator.com` matches `mailinator.com` while
 * `acmemailinator.com` does not, and a bare top-level label never matches.
 */
export function matchDisposableDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const labels = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .split('.');
  for (let i = 0; i <= labels.length - 2; i++) {
    const candidate = labels.slice(i).join('.');
    if (DISPOSABLE_DOMAINS.has(candidate)) return candidate;
  }
  return null;
}

export function isDisposableEmail(email: string): boolean {
  return matchDisposableDomain(email) !== null;
}
