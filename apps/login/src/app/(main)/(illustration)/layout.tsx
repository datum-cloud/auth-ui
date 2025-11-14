"use client";
import loginImage from "@/components/assets/login.svg";
import registerImage from "@/components/assets/register.svg";
import { BoxedCard } from "@/components/boxed-card";
import { Theme } from "@/components/theme";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

export default function IllustrationLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (<BoxedCard>{children}</BoxedCard>);
}
