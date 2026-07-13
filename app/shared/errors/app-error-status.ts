import type { AppErrorCode } from '@/shared/errors/app-error';

// The ONE place a code becomes an HTTP status. Meaningful codes only — no blanket 400.
const STATUS: Record<AppErrorCode, number> = {
  INVALID_INPUT: 422,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  NO_SUPPORTED_METHOD: 422,
  PASSWORD_NOT_ALLOWED: 422,
  RATE_LIMITED: 429,
  FORBIDDEN: 403,
  CONFLICT: 409,
  UNEXPECTED: 500,
};

export function appErrorStatus(code: AppErrorCode): number {
  return STATUS[code];
}
