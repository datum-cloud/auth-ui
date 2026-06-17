import { defineConfig } from '@lingui/cli';

export default defineConfig({
  sourceLocale: 'en',
  locales: ['en'],
  catalogs: [
    {
      path: '<rootDir>/app/modules/i18n/locales/{locale}',
      include: ['app'],
      exclude: ['**/node_modules/**', '**/build/**'],
    },
  ],
});
