import { toast } from '@datum-cloud/datum-ui/toast';
import { useEffect, useRef } from 'react';

/** Toast a message once when it appears/changes (e.g. derived from useActionData). */
export function useActionErrorToast(message: string | undefined): void {
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (message && message !== seen.current) {
      toast.error(message);
      seen.current = message;
    }
    if (!message) seen.current = undefined;
  }, [message]);
}
