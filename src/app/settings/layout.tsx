import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Titles the tab. The page itself is a client component and cannot export
 * metadata, so the segment carries it.
 */
export const metadata: Metadata = {
  title: "Settings",
  description: "Data directory, model probes and run limits.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
