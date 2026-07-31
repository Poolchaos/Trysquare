import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Rail } from "@/components/rail";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trysquare",
  description: "Local protocol-driven code review of git branches.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen">
          <Rail />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
