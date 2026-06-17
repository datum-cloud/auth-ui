import type { SamlResponse } from '@/providers/types';

export type SamlBindingResult =
  | { kind: 'redirect'; url: string }
  | { kind: 'post'; url: string; fields: { RelayState: string; SAMLResponse: string } };

/** Pure: select redirect vs POST binding and shape the POST form fields (P6). */
export function resolveSamlBinding(res: SamlResponse): SamlBindingResult {
  if (res.binding === 'redirect') return { kind: 'redirect', url: res.url };
  if (res.binding === 'post') {
    if (res.relayState == null || res.samlResponse == null) {
      throw new Error('missing SAML POST fields (RelayState/SAMLResponse)');
    }
    return {
      kind: 'post',
      url: res.url,
      fields: { RelayState: res.relayState, SAMLResponse: res.samlResponse },
    };
  }
  // binding arrives from the provider transport — fail loudly on values outside the union
  throw new Error(`unsupported SAML binding: ${String(res.binding)}`);
}
