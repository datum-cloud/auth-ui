"use client";
import loginImage from "@/components/assets/login.svg";
import registerImage from "@/components/assets/register.svg";
import { BoxedCard } from "@/components/boxed-card";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

export default function IllustrationLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="grid min-h-svh lg:grid-cols-2 w-full">
      <div className="flex flex-1 items-center justify-center px-6 py-[70px]">
        <BoxedCard>{children}</BoxedCard>
      </div>
      <div className="bg-muted relative hidden lg:block">
        <Image
          src={pathname === "/register" ? registerImage : loginImage}
          alt="Image"
          fill
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    </div>
  );
}
