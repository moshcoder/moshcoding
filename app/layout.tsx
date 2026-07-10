import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://moshcoding.com"),
  title: "#MOSHCODING — Code hard. Mosh harder.",
  description:
    "A Spotify playlist for developers who code hard and mosh harder. Point any domain at moshcoding for an instant metal coming-soon page with an email waitlist.",
  openGraph: {
    title: "#MOSHCODING — Code hard. Mosh harder.",
    description: "A Spotify playlist for developers who code hard and mosh harder.",
    images: ["/assets/avatar.png"],
  },
  // Favicon + apple-touch icon come from app/icon.png and app/apple-icon.png
  // (Next file convention) — the square skeleton-coder brand avatar.
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=JetBrains+Mono:wght@400;700&family=Barlow+Condensed:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="grain" aria-hidden="true" />
        <div className="scan" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
