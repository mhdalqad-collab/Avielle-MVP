import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Avielle — A wardrobe worth sharing",
    template: "%s | Avielle",
  },
  description:
    "Discover pieces to rent, share the wardrobe you love, and make more of every occasion. Avielle is a peer-to-peer fashion rental community.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
