# Adding a Locale

Four steps. Two of them are lists that must agree — that is where this goes wrong.

The app currently ships **English only** (see [Internationalization](../development/i18n.md) for why the previous `es` catalog was removed). Adding a second locale means adding real translations, not an empty catalog.

## 1. Create the catalog

```bash
touch app/modules/i18n/locales/fr.po
```

An empty file is enough to start — `lingui extract` fills in every `msgid` from the source. You then supply the `msgstr` values.

## 2. Add the code to `lingui.config.ts`

This is what the **CLI** extracts and compiles.

```ts
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'fr'], // ← add it here
  catalogs: [/* … */],
});
```

## 3. Add it to `SUPPORTED_LOCALES` in `app/modules/i18n/lingui.ts`

This is what the **app** will detect and serve. Miss this step and the catalog is generated but never selectable.

```ts
export const SUPPORTED_LOCALES = ['en', 'fr'] as const;
```

`DEFAULT_LOCALE` stays `'en'` — it is the fallback when detection finds nothing supported.

## 4. Compile

```bash
bun run i18n:extract    # populate fr.po with every msgid from app/
bun run i18n:compile    # fr.po → fr.ts, which loadMessages() imports at runtime
```

Then translate: fill in the `msgstr` entries in `app/modules/i18n/locales/fr.po` and re-run `bun run i18n:compile`.

## Checklist

- [ ] `app/modules/i18n/locales/<code>.po` exists
- [ ] `<code>` added to `locales[]` in `lingui.config.ts`
- [ ] `<code>` added to `SUPPORTED_LOCALES` in `app/modules/i18n/lingui.ts`
- [ ] `bun run i18n:extract && bun run i18n:compile` run, and `<code>.ts` generated
- [ ] The `msgstr` entries are **real translations** — not copies of the English
- [ ] `bun run typecheck` clean

## Related Documentation

- [Internationalization](../development/i18n.md) — how Lingui is wired, and the per-request i18n instance
- [Code Quality](../development/code-quality.md) — the `i18n` pre-commit hook that regenerates catalogs
