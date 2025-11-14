"use client";

import { createNewSessionFromIdpIntent } from "@/lib/server/idp";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "./alert";

type Props = {
  userId: string;
  // organization: string;
  idpIntent: {
    idpIntentId: string;
    idpIntentToken: string;
  };
  requestId?: string;
};

export function IdpSignin({
  userId,
  idpIntent: { idpIntentId, idpIntentToken },
  requestId,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
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

        if (response && "redirect" in response && response?.redirect) {
          return router.push(response.redirect);
        }
      })
      .catch(() => {
        setError("An internal error occurred");
        return;
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <div className="flex items-center justify-center py-4">
      {loading && (
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
