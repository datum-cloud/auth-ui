import { Button } from '@datum-cloud/datum-ui/button';
import type { ReactNode } from 'react';
import { useNavigation } from 'react-router';

interface SubmitButtonProps {
  children: ReactNode;
  /** Override the auto navigation-state loading (e.g. when using a fetcher). */
  loading?: boolean;
  className?: string;
  /**
   * Optional click handler, fired before the browser's native form submission (see
   * modules/fraud/maxmind-tracker.tsx#syncMaxMindTokenToRef). A click on this button always
   * runs before the resulting `submit` event, so callers can use this to synchronously
   * populate a hidden field right before the request goes out.
   */
  onClick?: () => void;
}

/**
 * Primary submit button (datum-ui Button, real submit). Loading defaults to the
 * router's navigation state so it reflects the in-flight server action — NOT RHF's
 * isSubmitting, which resolves instantly under the native-RR-submit pattern.
 */
export function SubmitButton({ children, loading, className, onClick }: SubmitButtonProps) {
  const navigation = useNavigation();
  const isSubmitting = loading ?? navigation.state === 'submitting';
  return (
    <Button
      type="primary"
      theme="solid"
      block
      htmlType="submit"
      loading={isSubmitting}
      className={className}
      onClick={onClick}>
      {children}
    </Button>
  );
}
