import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { NavigationProgress } from "./components/navigation-progress";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = new URL(`${protocol}://${host}`);
  const siteTitle = "Epistack";
  const description = "A human–AI workspace for turning vague questions into inspectable claims and auditable evidence.";

  return {
    metadataBase: origin,
    title: { default: "Decompose · Epistack", template: "%s · Epistack" },
    description,
    openGraph: {
      title: siteTitle,
      description,
      type: "website",
      images: [{ url: new URL("/og.png", origin), width: 1536, height: 1024, alt: "Epistack evidence graph" }],
    },
    twitter: {
      card: "summary_large_image",
      title: siteTitle,
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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <NavigationProgress />
        {children}
      </body>
    </html>
  );
}
