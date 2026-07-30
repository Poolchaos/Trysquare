import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module: it must not be bundled by the server
  // compiler or the binding fails to load at runtime.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
