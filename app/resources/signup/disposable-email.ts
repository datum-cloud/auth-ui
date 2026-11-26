// Vendored, not fetched at runtime: the list changes only through
// scripts/update-disposable-domains.sh, so every change is a reviewed diff.
import listText from '@/resources/signup/data/disposable-email-domains.txt?raw';

/** Built once per process. Blank lines and `#` comments are not domains. */
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set(
  listText
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== '' && !line.startsWith('#'))
);

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
