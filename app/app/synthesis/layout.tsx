import type { Metadata } from "next";

export const metadata: Metadata = { title: "Decision workbench" };

export default function SynthesisLayout({ children }: { children: React.ReactNode }) {
  return children;
}
