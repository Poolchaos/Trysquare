import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopBar } from "@/components/topbar";
import "./globals.css";

export const metadata: Metadata = {
  // Each segment sets its own title and this suffixes it, so four open tabs
  // are four different labels rather than four copies of the app's name.
  title: { default: "Trysquare", template: "%s - Trysquare" },
  description: "Local protocol-driven code review of git branches.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/* A column, not a row: navigation sits along the top so the
            content owns the full width and the drafting-board ground runs
            edge to edge (D-81). */}
        <div className="flex min-h-screen flex-col">
          <TopBar />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
