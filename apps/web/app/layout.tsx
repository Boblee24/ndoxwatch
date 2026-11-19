import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Atkinson_Hyperlegible, Big_Shoulders } from "next/font/google";
import { Shell } from "./shell";
import "./globals.css";

// Self-hosted at build time (no runtime request to Google). Atkinson Hyperlegible was designed for low-vision
// legibility; Big Shoulders is condensed signage type, so big numbers and labels fit a 360px screen.
const body = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-body", display: "swap" });
const gauge = Big_Shoulders({ subsets: ["latin"], weight: ["800"], variable: "--font-gauge", display: "swap" });

export const metadata: Metadata = {
  title: "NdoxWatch",
  description: "Report the flood water, get sats.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffd60a",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading headers makes every page dynamic, which the per-request CSP nonce requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const demo = process.env.DEMO_MODE === "1";
  return (
    <html lang="en" className={`${body.variable} ${gauge.variable}`}>
      <body className="min-h-dvh">
        <Shell demo={demo} nonce={nonce}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
