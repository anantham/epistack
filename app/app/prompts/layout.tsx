import type { Metadata } from "next";

export const metadata: Metadata = { title: "Agent prompts" };

export default function PromptsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
