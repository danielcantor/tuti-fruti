import type { NextConfig } from "next";

// Datos del deploy que se fijan al compilar, para no depender de qué
// variables ve cada hosting en tiempo de ejecución.
const hosting = process.env.NETLIFY ? "netlify" : process.env.VERCEL ? "vercel" : "";
const preview =
  process.env.VERCEL_ENV === "preview" ||
  (!!process.env.NETLIFY && ["deploy-preview", "branch-deploy"].includes(process.env.CONTEXT ?? ""));

const nextConfig: NextConfig = {
  env: {
    TF_HOSTING: hosting,
    TF_PREVIEW: preview ? "1" : "",
  },
  cacheComponents: true,
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
