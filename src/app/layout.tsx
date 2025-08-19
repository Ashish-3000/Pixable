// app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TRPCReactProvider } from "@/trpc/client";
import { Toaster } from "sonner";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Helpful if you deploy on a custom domain
const METADATA_BASE = process.env.NEXT_PUBLIC_SITE_URL
  ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
  : undefined;

export const metadata: Metadata = {
  metadataBase: METADATA_BASE,
  applicationName: "Pixable",
  title: {
    default: "Pixable — AI Website Maker",
    template: "%s · Pixable",
  },
  description:
    "Pixable is a fast, friendly AI website maker. Generate, edit, and publish beautiful sites in minutes.",
  keywords: [
    "Pixable",
    "AI website builder",
    "no-code",
    "site generator",
    "landing page",
    "website maker",
  ],
  authors: [{ name: "Pixable" }],
  creator: "Pixable",
  publisher: "Pixable",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Pixable",
    title: "Pixable — AI Website Maker",
    description:
      "Generate, edit, and publish beautiful sites in minutes with Pixable.",
    images: [
      {
        url: "/og.png", // add this image under /public if you have one
        width: 1200,
        height: 630,
        alt: "Pixable preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@pixable", // update/remove if not applicable
    creator: "@pixable",
    title: "Pixable — AI Website Maker",
    description:
      "Generate, edit, and publish beautiful sites in minutes with Pixable.",
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" }, // favicon in tab
      { url: "/favicon.ico" }, // optional fallback
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-touch-icon.png" }], // optional if you add it
  },
  category: "technology",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#1F4E57", // dark teal from your palette
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
      appearance={{
        variables: { colorPrimary: "#C96342" }, // heart/orange from your palette
      }}
    >
      <TRPCReactProvider>
        <html lang="en" suppressHydrationWarning>
          <body
            className={`${geistSans.variable} ${geistMono.variable} antialiased`}
          >
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <Toaster richColors />
              {children}
            </ThemeProvider>
          </body>
        </html>
      </TRPCReactProvider>
    </ClerkProvider>
  );
}
