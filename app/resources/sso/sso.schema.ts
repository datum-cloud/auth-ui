// Server-free schema definitions for the sso domain.
// IMPORTANT: this module must import ONLY 'zod' and '@/resources/schemas/request-id'.
// It must never import @/server/*, the sso service, cookies, env, sentry, or
// observability — route COMPONENTS depend on it for client validators, so it has
// to stay safe to bundle into the browser.
import { z } from 'zod';

// Client-side validation subset for the /sso/ldap form (visible fields only);
// advisory only — the server action's schema (ldapServerSchema) is the real gate.
export const ldapClientSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
