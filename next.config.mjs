import os from "node:os";

const lanDevOrigins = Object.values(os.networkInterfaces())
  .flat()
  .filter((net) => net && net.family === "IPv4" && !net.internal)
  .flatMap((net) => [net.address, `${net.address}:3000`]);

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const basePath = rawBasePath
  ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
  : undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath,
  allowedDevOrigins: ["localhost", "127.0.0.1", ...lanDevOrigins],
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
