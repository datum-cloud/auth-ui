// Barrel for the authorize domain. Routes and tests import from here.
export {
  resolveAuthorize,
  outcomeToResponse,
  normalizeRequestId,
  isAllowedRequestId,
} from './authorize.service';
export type { AuthorizeOutcome } from './authorize.service';
export { decideAuthorize, deriveOrganizationFromScopes } from './authorize-decision';
export type { AuthorizeInput } from './authorize-decision';
