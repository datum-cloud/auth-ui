// Server-free schema definitions for the login domain.
// IMPORTANT: this module must import ONLY 'zod' and '@/resources/schemas/request-id'.
// It must never import @/server/*, the login service, cookies, env, sentry, or
// observability — route COMPONENTS depend on it for client validators, so it has
// to stay safe to bundle into the browser.
import { REQUEST_ID_PATTERN } from '@/resources/schemas/request-id';
import { z } from 'zod';

// Identifier (login-name) submission parsed by the /login action.
export const loginIdentifierSchema = z.object({
  loginName: z.string().min(1).max(200),
  requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  organization: z.string().optional(),
});

// IdP intent submission parsed by the /login action.
export const loginIdpSchema = z.object({
  intent: z.literal('idp'),
  idpId: z.string().min(1),
  requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  organization: z.string().optional(),
});

// Client-side validation subset for the /login identifier form; advisory only
// (the server action's schema is the real gate).
export const loginIdentifierClientSchema = z.object({ loginName: z.string().min(1) });

// Password submission parsed by the /login/password action.
export const loginPasswordSchema = z.object({
  password: z.string().min(1).max(512),
  loginName: z.string().min(1),
  requestId: z.string().regex(REQUEST_ID_PATTERN).optional(),
  organization: z.string().optional(),
});

// Client-side validation subset for the /login/password form; advisory only
// (the server action's schema is the real gate).
export const loginPasswordClientSchema = z.object({ password: z.string().min(1) });
