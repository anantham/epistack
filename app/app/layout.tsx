import type { Metadata } from "next";
import { headers } from "next/headers";
import { NavigationProgress } from "./components/navigation-progress";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = new URL(`${protocol}://${host}`);
  const title = "Epistack · Question Compiler";
  const description = "A human–AI workspace for turning vague questions into inspectable claims and auditable evidence.";

  return {
    metadataBase: origin,
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: new URL("/og.png", origin), width: 1536, height: 1024, alt: "Epistack evidence graph" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [new URL("/og.png", origin)],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <NavigationProgress />
        {children}
      </body>
    </html>
  );
}
