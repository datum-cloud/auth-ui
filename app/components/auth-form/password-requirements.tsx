import type { PasswordComplexity } from '@/modules/auth/types';
import { passwordRules } from '@/resources/schemas/password-complexity';
import { Form } from '@datum-cloud/datum-ui/form';

export interface PasswordRequirementsProps {
  /** The org's fetched complexity policy (from the loader). Undefined → default (min length only). */
  policy?: PasswordComplexity;
  /** The form field to watch. Defaults to `password`. */
  fieldName?: string;
}

/**
 * Live password-requirement checklist. Reads the entered password reactively (Form.useWatch) and
 * ticks each requirement off as it is satisfied. The requirement set is POLICY-DRIVEN — derived
 * from the same `passwordRules(policy)` the Zod validator uses, so what the user sees and what the
 * form accepts never drift. Must be rendered inside a `<Form.Root>` (adapter context).
 */
export function PasswordRequirements({
  policy,
  fieldName = 'password',
}: PasswordRequirementsProps): React.JSX.Element {
  const value = Form.useWatch<string>(fieldName) ?? '';
  const rules = passwordRules(policy);

  return (
    <ul
      aria-label="Password requirements"
      // polite: announce a requirement becoming satisfied without interrupting typing.
      aria-live="polite"
      className="flex flex-col gap-1 text-sm">
      {rules.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.id}
            data-rule={rule.id}
            data-met={met}
            className={[
              'flex items-center gap-2',
              met ? 'text-foreground' : 'text-muted-foreground',
            ].join(' ')}>
            <span
              aria-hidden="true"
              className={[
                'inline-flex size-4 items-center justify-center rounded-full text-xs',
                met ? 'bg-primary text-primary-foreground' : 'border-muted-foreground/40 border',
              ].join(' ')}>
              {met ? '✓' : ''}
            </span>
            <span>{rule.requirement}</span>
            <span className="sr-only">{met ? ' — satisfied' : ' — not yet satisfied'}</span>
          </li>
        );
      })}
    </ul>
  );
}
