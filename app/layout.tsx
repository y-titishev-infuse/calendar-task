import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Daily Task Sidebar",
  description: "Calendar-aware prep and task list for today.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
