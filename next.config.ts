import type { NextConfig } from "next";

// Next records usage from `next dev` and `next build` unless this is set by
// the time it has read this file, and it hands the value to the processes
// it starts. Set here and not in package.json's scripts, where `VAR=1 next`
// does not run on Windows and a bare `npx next` would go around it (D-233).
process.env.NEXT_TELEMETRY_DISABLED = "1";

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
