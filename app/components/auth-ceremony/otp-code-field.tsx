import { Form } from '@datum-cloud/datum-ui/form';

export interface OtpCodeFieldProps {
  label: string;
  name?: string;
}

// UI-2: the one-time-code input field shared by the OTP verify + enroll screens.
// Built on datum-ui Form.Field/Form.Input so it KEEPS client-side schema validation
// when composed inside a Form.Root (a bare input would be a functional regression).
export function OtpCodeField({ label, name = 'code' }: OtpCodeFieldProps) {
  return (
    <Form.Field name={name} label={label} required>
      <Form.Input inputMode="numeric" autoComplete="one-time-code" autoFocus />
    </Form.Field>
  );
}
