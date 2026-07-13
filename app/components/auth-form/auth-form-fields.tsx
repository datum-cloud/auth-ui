import { CsrfInput } from '@/components/auth-form/csrf-input';

// The csrf + identity hidden-input cluster in one fixed order. Conditionals live
// here, eliminating the ordering drift that previously occurred across routes.
export interface AuthFormFieldsProps {
  csrf: string;
  loginName?: string;
  requestId?: string;
  organization?: string;
  next?: string;
}

export function AuthFormFields({
  csrf,
  loginName,
  requestId,
  organization,
  next,
}: AuthFormFieldsProps): React.JSX.Element {
  return (
    <>
      <CsrfInput token={csrf} />
      {loginName !== undefined && <input type="hidden" name="loginName" value={loginName} />}
      {requestId !== undefined && <input type="hidden" name="requestId" value={requestId} />}
      {organization !== undefined && (
        <input type="hidden" name="organization" value={organization} />
      )}
      {next !== undefined && <input type="hidden" name="next" value={next} />}
    </>
  );
}
