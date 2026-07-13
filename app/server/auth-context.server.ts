// The neutral server boundary routes import. The provider-wiring logic moved to the
// composition root; this file delegates so existing `@/server/auth-context.server`
// importers stay byte-identical. It imports ZERO zitadel modules now.
export { providerForRequest } from '@/server/composition';
