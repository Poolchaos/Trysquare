import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module: it must not be bundled by the server
  // compiler or the binding fails to load at runtime.
  serverExternalPackages: ["better-sqlite3"],
  // Otherwise `next dev` (16.3.8) appends its own rules to the repository's
  // CLAUDE.md on every start, the charter every session loads, with an em
  // dash the charter forbids, and asks to be committed (D-178).
  agentRules: false,
};

export default nextConfig;
