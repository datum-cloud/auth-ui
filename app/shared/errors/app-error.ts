// The single AppError spine. Errors are typed
// VALUES carried via Result<T> — returned, never thrown, across the seam. Lives in the
// shared kernel so every layer (components included) can reference the codes/type.
export type AppErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CREDENTIALS'
  | 'SESSION_EXPIRED'
  | 'NO_SUPPORTED_METHOD'
  | 'PASSWORD_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'UNEXPECTED';

export interface AppError {
  code: AppErrorCode;
  status: number;
  /** i18n message key (resolved client-side); never a raw provider string. */
  messageKey: string;
  meta?: Record<string, unknown>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };
