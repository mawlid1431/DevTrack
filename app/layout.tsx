import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Brand type: Inter for the interface and the "DevTrack" name (400 text,
// 500 labels, 600 headings); Geist Mono for issue IDs, shortcuts, numbers.
const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "DevTrack: Plan. Build. Ship.",
    template: "%s · DevTrack",
  },
  description:
    "DevTrack is the issue tracker built for speed. Plan projects, run cycles, and ship with your team, with an AI agent on call.",
  authors: [{ name: "Mowlid", url: "https://devmowlid.vercel.app/" }],
  creator: "Mowlid",
  metadataBase: new URL("https://devmowlid.vercel.app"),
  // Brand favicon set (brand/assets/favicon, head-snippet.html).
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    other: [{ rel: "mask-icon", url: "/safari-pinned-tab.svg", color: "#0B1B2E" }],
  },
  manifest: "/site.webmanifest",
  applicationName: "DevTrack",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1B2E" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
