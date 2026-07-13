import { readCeremonyParams } from '@/resources/shared/ceremony-params';
import { paths } from '@/routes/paths';
import { redirect, type LoaderFunctionArgs } from 'react-router';

// Forward any incoming requestId/organization onto /login so a ceremony link that lands bare
// at "/" (e.g. BrandLogo's home link, or a relying party pointing straight at the app root)
// still resumes the OIDC/SAML/device ceremony instead of dropping into an unscoped /login.
export function loader({ request }: LoaderFunctionArgs) {
  const { requestId, organization } = readCeremonyParams(new URL(request.url));
  return redirect(paths.login.index({ requestId, organization })); // Phase 1 implements /login; until then this falls through to error.tsx
}

export default function Index() {
  return null;
}
