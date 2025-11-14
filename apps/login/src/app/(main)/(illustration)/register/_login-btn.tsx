"use client";

import { Translated } from "@/components/translated";
import { useRouter } from "next/navigation";

export const LoginBtn = () => {
  const router = useRouter();

  return (
    <div className="text-center ztdl-p text-sm font-normal flex items-center gap-0.5 mt-6">
      <Translated i18nKey="alreadyRegistered" namespace="register" />
      <button
        className="underline"
        onClick={() => router.replace("/loginname")}
        type="button"
        data-testid="register-button"
      >
        <Translated i18nKey="loginNow" namespace="register" />
      </button>
    </div>
  );
};
