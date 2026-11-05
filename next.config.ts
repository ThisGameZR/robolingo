import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Embedded Postgres for local dev ships a WASM binary; load it from node_modules as-is.
  serverExternalPackages: ["@electric-sql/pglite"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
