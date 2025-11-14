"use client";

import { useRouter } from "next/navigation";
import { Button, ButtonVariants } from "./button";
import { Translated } from "./translated";

export function BackButton() {
  const router = useRouter();
  return (
    <Button
      className="w-full h-[58px]"
      onClick={() => router.back()}
      type="button"
      variant={ButtonVariants.Ghost}
    >
      <Translated i18nKey="back" namespace="common" />
    </Button>
  );
}
