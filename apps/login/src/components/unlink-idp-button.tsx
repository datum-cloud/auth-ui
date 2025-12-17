"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Spinner } from "./spinner";

interface UnlinkIdpButtonProps {
  unlinkAction: (formData: FormData) => Promise<void>;
  idpId: string;
  linkedUserId: string;
  providerName: string;
  isLastIdp?: boolean;
}

export function UnlinkIdpButton({
  unlinkAction,
  idpId,
  linkedUserId,
  providerName,
  isLastIdp,
}: UnlinkIdpButtonProps) {
  const t = useTranslations("idp.unlink");
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (formData: FormData) => {
    setIsPending(true);
    try {
      await unlinkAction(formData);
      setShowConfirm(false);
    } finally {
      setIsPending(false);
    }
  };

  if (isLastIdp) {
    return null;
  }

  if (!showConfirm) {
    return (
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        className="text-gray-400 hover:text-red-500 transition-colors p-1"
        title={t("tooltip")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-lg bg-white dark:bg-zinc-900 p-6 shadow-xl border border-gray-200 dark:border-gray-800">
        <h3 className="text-lg font-semibold mb-2">
          {t("title", { provider: providerName })}
        </h3>
        <p className="text-sm text-gray-500 mb-6">{t("description")}</p>

        <form action={handleSubmit} className="flex justify-end gap-3">
          <input type="hidden" name="idpId" value={idpId} />
          <input type="hidden" name="linkedUserId" value={linkedUserId} />

          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
            onClick={() => setShowConfirm(false)}
            disabled={isPending}
          >
            {t("cancel")}
          </button>

          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors flex items-center gap-2"
            disabled={isPending}
          >
            {isPending ? <Spinner className="h-4 w-4" /> : null}
            {t("submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
