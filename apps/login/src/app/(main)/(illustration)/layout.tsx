"use client";
import { BoxedCard } from "@/components/boxed-card";
import { ReactNode } from "react";

export default function IllustrationLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <BoxedCard>{children}</BoxedCard>;
}
