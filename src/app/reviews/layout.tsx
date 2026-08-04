import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Titles the tab. The page itself is a client component and cannot export
 * metadata, so the segment carries it.
 */
export const metadata: Metadata = {
  title: "Reviews",
  description: "Every review this app has run.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
