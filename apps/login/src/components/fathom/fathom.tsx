'use client';

import { load, trackPageview } from 'fathom-client';
import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export const FathomAnalytics = ({ privateKey }: { privateKey: string }) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (privateKey) {
      load(privateKey);
    }
  }, [privateKey]);

  useEffect(() => {
    if (privateKey) {
      trackPageview();
    }
  }, [pathname, searchParams, privateKey]);

  return null;
};
