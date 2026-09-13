import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contextualize" };

export default function ContextualizeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
