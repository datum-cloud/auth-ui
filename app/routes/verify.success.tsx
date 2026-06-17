import { AuthCard } from '@/components/auth-card';
import { Trans } from '@lingui/react/macro';
import {
  data,
  Link,
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Email verified' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return data({
    loginName: url.searchParams.get('loginName') ?? undefined,
  });
}

export default function VerifySuccess() {
  const { loginName } = useLoaderData<typeof loader>();
  return (
    <AuthCard title={<Trans>Your email is verified</Trans>}>
      <div className="flex flex-col gap-4 text-center">
        {loginName ? <p className="text-foreground text-sm">{loginName}</p> : null}
        <Link to="/login" className="text-sm underline">
          <Trans>Continue to sign in</Trans>
        </Link>
      </div>
    </AuthCard>
  );
}
