import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Titles the tab. The page itself is a client component and cannot export
 * metadata, so the segment carries it.
 * The name of the thing itself is not in the title: it would need a
 * database read per navigation to say something the page states in its
 * own header a moment later.
 */
export const metadata: Metadata = {
  title: "Review",
  description: "A review while it runs, and what it found.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
