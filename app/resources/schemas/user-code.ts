import { z } from 'zod';

/**
 * The OAuth device-grant `user_code` shape (RFC 8628 §6.1 permits any printable
 * charset; Zitadel issues alphanumeric plus separators).
 *
 * Bounded so a malformed value can never pollute the `device_<code>` requestId or a
 * redirect target. Three consumers share this: switchSchema and removeSchema
 * (session.service.ts) reflect it onto the post-action redirect, and the /accounts
 * loader (routes/accounts.tsx) feeds it into an automatic 302.
 */
const USER_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export const userCodeSchema = z.string().max(64).regex(USER_CODE_PATTERN).optional();
