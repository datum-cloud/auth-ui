import { BoxedCard } from "@/components/boxed-card";
import { ReactNode } from "react";

export default function BoxedLayout({ children }: { children: ReactNode }) {
  return <BoxedCard>{children}</BoxedCard>;
}
