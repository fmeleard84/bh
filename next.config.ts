import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["bullmq", "ioredis", "postgres"],
};

export default config;
