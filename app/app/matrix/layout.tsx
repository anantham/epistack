import type { Metadata } from "next";

export const metadata: Metadata = { title: "Claim matrix" };

export default function MatrixLayout({ children }: { children: React.ReactNode }) {
  return children;
}
