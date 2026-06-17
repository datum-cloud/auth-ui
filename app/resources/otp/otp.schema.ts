import { z } from 'zod';

/**
 * Server-free OTP route schemas.
 *
 * BOUNDARY: This file MUST import only 'zod' (and, if ever needed,
 * '@/resources/schemas/request-id'). It must NEVER import the otp service,
 * '@/server/*', cookies, env.server, sentry, or any observability module — route
 * COMPONENTS pull their client validators from here so the server-only service
 * never gets dragged into the browser bundle.
 *
 * `otpCodeClientSchema` is the shared client-side form validator for all OTP
 * code-entry screens (login authenticator/email/sms verify + setup
 * authenticator). It deliberately only enforces non-empty input; the strict
 * digit-length validation lives server-side in mfa.schema (otpCodeSchema /
 * otpDeliveryCodeSchema).
 */
export const otpCodeClientSchema = z.object({ code: z.string().min(1) });
