import type { Metadata } from "next";

export const metadata: Metadata = { title: "Artifact" };

export default function ArtifactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
