// Barrel for the session domain. Routes and tests import from here.
//
// This domain has no Pass 1 seed flow file — session.service.ts is the whole domain
// (the user-facing session lifecycle: /signed-in, /accounts, /logout). It composes the
// low-level cookie mechanics from @/modules/auth/session/cookie rather than re-exporting them.
export {
  resolveSignedIn,
  listAccounts,
  resolveAccountAction,
  switchAccount,
  removeAccount,
  accountActionOutcomeToResponse,
  performLogout,
  logoutOutcomeToResponse,
  completeOidcLogout,
} from './session.service';
export type { SignedInConfig } from './session.service';
