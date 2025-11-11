"use client";

import { load, trackPageview } from "fathom-client";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function TrackPageView({ clientId }: { clientId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    load(clientId, {
      auto: false,
    });
  }, [clientId]);

  useEffect(() => {
    if (!pathname) return;

    trackPageview({
      url: pathname + searchParams?.toString(),
      referrer: document.referrer,
    });
  }, [pathname, searchParams]);

  return null;
}

export function FathomAnalytics({ clientId }: { clientId: string }) {
  return (
    <Suspense fallback={null}>
      <TrackPageView clientId={clientId} />
    </Suspense>
  );
}
