import { ProviderError } from '@/modules/auth/types';
import type { AppError, AppErrorCode } from '@/shared/errors/app-error';
import { appErrorStatus } from '@/shared/errors/app-error-status';

// Strict error neutrality: the zitadel adapter is the ONLY place a provider error is
// interpreted. Every provider code maps to a closed AppErrorCode (unknown → UNEXPECTED);
// the raw provider message is NEVER copied into the returned AppError (it is logged
// server-side with a traceId elsewhere). This mapper is the neutral-error scaffold the
// error-handling layer adopts.
const CODE_MAP: Record<string, AppErrorCode> = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  PERMISSION_DENIED: 'FORBIDDEN',
  ALREADY_EXISTS: 'CONFLICT',
  NOT_FOUND: 'SESSION_EXPIRED',
  UNAVAILABLE: 'UNEXPECTED',
};

// i18n keys (resolved by useAuthErrorMessage / future catalog). Stable, neutral strings.
const MESSAGE_KEY: Record<AppErrorCode, string> = {
  INVALID_INPUT: 'error.invalid_input',
  INVALID_CREDENTIALS: 'error.invalid_credentials',
  SESSION_EXPIRED: 'error.session_expired',
  NO_SUPPORTED_METHOD: 'error.no_supported_method',
  PASSWORD_NOT_ALLOWED: 'error.password_not_allowed',
  RATE_LIMITED: 'error.rate_limited',
  FORBIDDEN: 'error.forbidden',
  CONFLICT: 'error.conflict',
  UNEXPECTED: 'error.unexpected',
};

export function toAppError(err: unknown): AppError {
  const code: AppErrorCode =
    err instanceof ProviderError ? (CODE_MAP[err.code] ?? 'UNEXPECTED') : 'UNEXPECTED';
  return { code, status: appErrorStatus(code), messageKey: MESSAGE_KEY[code] };
}
