/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API also serves the server-rendered /links page, /go/<id> click redirects and SEO files.
const target = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8010";
const apiProxy = Object.fromEntries(
  ["/api", "^/links($|/|\\?)", "/go/", "/sitemap.xml", "/robots.txt"].map((p) => [p, { target }]),
);

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5174,
    // Same-origin API in development so the HttpOnly session cookie just works.
    proxy: apiProxy,
  },
  preview: {
    port: 4174,
    proxy: apiProxy,
  },
  // The API reads the manifest to preload the code each server-rendered page needs.
  build: { manifest: true },
  test: { environment: "jsdom", globals: true },
});
