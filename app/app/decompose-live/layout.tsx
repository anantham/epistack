import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hosted decomposition" };

export default function DecomposeLiveLayout({ children }: { children: React.ReactNode }) {
  return children;
}
