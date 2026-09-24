import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Modular CRM",
  description: "A calmer way to run a service business.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
