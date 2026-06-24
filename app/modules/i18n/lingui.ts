import type { Messages } from '@lingui/core';

// The 'es' catalog was byte-identical to 'en' (no real translations). Removed so
// detection never selects it and users fall back to English explicitly rather than silently
// receiving English-labelled-as-Spanish.
export const SUPPORTED_LOCALES = ['en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Load the message catalog for a locale WITHOUT activating any global singleton.
 * Returns the raw messages object for use in a per-request i18n instance.
 */
export async function loadMessages(locale: string): Promise<Messages> {
  const { messages } = await import(`./locales/${locale}.po`);
  return messages as Messages;
}
