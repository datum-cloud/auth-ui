"use client";

import { Translated } from "@/components/translated";
import { useRouter } from "next/navigation";

export const RegisterBtn = ({
  organization,
  requestId,
}: {
  organization?: string;
  requestId?: string;
}) => {
  const router = useRouter();

  return (
    <div className="text-center ztdl-p text-sm font-normal flex items-center gap-0.5 mt-6">
      <Translated i18nKey="notRegistered" namespace="loginname" />
      <button
        className="underline"
        onClick={() => {
          const registerParams = new URLSearchParams();
          if (organization) {
            registerParams.append("organization", organization);
          }
          if (requestId) {
            registerParams.append("requestId", requestId);
          }

          router.push("/register?" + registerParams);
        }}
        type="button"
        data-testid="register-button"
      >
        <Translated i18nKey="register" namespace="loginname" />
      </button>
    </div>
  );
};
