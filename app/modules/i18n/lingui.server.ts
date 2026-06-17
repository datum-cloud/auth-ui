import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '@/modules/i18n/lingui';
import { detect } from '@lingui/detect-locale';

// Single source of truth: SUPPORTED_LOCALES / DEFAULT_LOCALE live in lingui.ts.
// lingui.config.ts is CLI-only config — leave it; it references the same locale list.

/**
 * Parse the Accept-Language header and return the first tag whose base code is
 * in SUPPORTED. Tags are evaluated in listed order (position = priority); we do
 * not numerically sort q-values, which is fine for our small supported set.
 *
 * Example: "es-MX,es;q=0.9,en-US;q=0.8,en;q=0.7" → "es"
 */
function fromAcceptLanguage(request: Request): () => string | null {
  return () => {
    const header = request.headers.get('accept-language');
    if (!header) return null;

    const tags = header.split(',');
    for (const tag of tags) {
      // Strip optional ;q=... weight parameter
      const base = tag.trim().split(';')[0]?.trim().split('-')[0]?.trim().toLowerCase();
      if (base && (SUPPORTED_LOCALES as readonly string[]).includes(base)) {
        return base;
      }
    }
    return null;
  };
}

export function detectLocale(request: Request): string {
  const cookieHeader = request.headers.get('cookie') ?? '';

  // Extract raw cookie value and decode it safely before the allowlist check
  const rawCookieValue = /(?:^|;\s*)locale=([^;]+)/.exec(cookieHeader)?.[1] ?? null;
  const cookieLocale = (): string | null => {
    if (!rawCookieValue) return null;
    try {
      return decodeURIComponent(rawCookieValue);
    } catch {
      return null;
    }
  };

  const found = detect(cookieLocale, fromAcceptLanguage(request), () => DEFAULT_LOCALE);

  // Normalize to base code and validate against allowlist
  const code = (found ?? DEFAULT_LOCALE).split('-')[0]?.toLowerCase() ?? DEFAULT_LOCALE;
  return (SUPPORTED_LOCALES as readonly string[]).includes(code) ? code : DEFAULT_LOCALE;
}
