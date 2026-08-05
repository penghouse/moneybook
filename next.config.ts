import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // CSV restore uploads the whole backup in one request. The default
      // 1MB caps out around 8,000 transactions — a few years of daily
      // use — so it is raised to cover a decade-plus ledger.
      //
      // This only lifts the framework's own limit. Serverless hosts
      // apply their own cap on the request body (Vercel: 4.5MB, not
      // configurable from application code); on those, a very large
      // restore has to be split into several files. Exports stream, so
      // they are not subject to it. See README.
      bodySizeLimit: "32mb",
    },
  },
};

export default nextConfig;
