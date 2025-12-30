"use client";

import { createNewSessionFromIdpIntent } from "@/lib/server/idp";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Alert } from "./alert";

type Props = {
  userId: string;
  // organization: string;
  idpIntent: {
    idpIntentId: string;
    idpIntentToken: string;
  };
  requestId?: string;
  onSuccessRedirectTo?: string;
};

export function IdpSignin({
  userId,
  idpIntent: { idpIntentId, idpIntentToken },
  requestId,
  onSuccessRedirectTo,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    startTransition(() => {
      createNewSessionFromIdpIntent({
        userId,
        idpIntent: {
          idpIntentId,
          idpIntentToken,
        },
        requestId,
      })
        .then((response) => {
          if (response && "error" in response && response?.error) {
            setError(response?.error);
            return;
          }

          if (onSuccessRedirectTo) {
            if (
              onSuccessRedirectTo.startsWith("/") &&
              !onSuccessRedirectTo.startsWith("//")
            ) {
              return router.push(onSuccessRedirectTo);
            }
            let target = onSuccessRedirectTo;
            if (target.startsWith("//")) {
              target = `https:${target}`;
            } else if (
              !target.startsWith("http://") &&
              !target.startsWith("https://")
            ) {
              target = `https://${target}`;
            }

            return router.push(target);
          }

          if (response && "redirect" in response && response?.redirect) {
            return router.push(response.redirect);
          }
        })
        .catch(() => {
          setError("An internal error occurred");
          return;
        });
    });
  }, []);

  return (
    <div className="flex items-center justify-center py-4">
      {isPending && (
        <Loader2 className="animate-spin size-8 stroke-loader-color" />
      )}
      {error && (
        <div className="py-4 w-full">
          <Alert>{error}</Alert>
        </div>
      )}
    </div>
  );
}
