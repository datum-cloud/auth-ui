import type { ProviderCapabilities, IdProvider } from '@/modules/auth/types';
import type { LoginSettings } from '@/modules/auth/types';

/**
 * Returns true when IdP buttons should be rendered — capability flag must be on
 * and at least one active IdP must be present.
 */
export function shouldShowIdpButtons(
  capabilities: Pick<ProviderCapabilities, 'externalIdp'>,
  idps: IdProvider[]
): boolean {
  return capabilities.externalIdp && idps.length > 0;
}

/**
 * Returns true when there is exactly one active IdP and password login is
 * disabled — in that case the UI can skip the identifier form and auto-start
 * the only available IdP intent.
 */
export function shouldAutoStartSingleIdp(
  idps: IdProvider[],
  settings: Pick<LoginSettings, 'allowPassword'>
): boolean {
  return idps.length === 1 && !settings.allowPassword;
}
