import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Election overview | Primary Atlas",
  description: "Precinct-level results and turnout for the September 1, 2026 Suffolk and Middlesex Democratic primary.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
