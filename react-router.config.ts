import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
  // trailing slash matches vite.config.ts `base: '/id/'` (RR dev requires
  // basename to begin with base); route URLs are unaffected (/id/login etc.)
  basename: '/id/',
} satisfies Config;
