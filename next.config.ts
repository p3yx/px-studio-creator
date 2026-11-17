import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["firebase", "@firebase/app", "@firebase/auth", "@firebase/util", "@firebase/component", "@firebase/logger"],
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "firebase/app": path.join(process.cwd(), "node_modules/firebase/app/dist/esm/index.esm.js"),
      "firebase/auth": path.join(process.cwd(), "node_modules/firebase/auth/dist/esm/index.esm.js"),
    };
    return config;
  },
};

export default nextConfig;
