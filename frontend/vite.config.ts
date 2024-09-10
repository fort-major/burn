import path from "path";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import viteCompression from "vite-plugin-compression";

export default defineConfig({
  plugins: [solidPlugin(), viteCompression()],
  build: {
    target: "esnext",
  },
  resolve: {
    alias: {
      "@dfinity/agent": path.resolve(
        __dirname,
        "./node_modules/@fort-major/agent-js-fork"
      ),
      "@components": path.resolve(__dirname, "./src/components"),
      "@utils": path.resolve(__dirname, "./src/utils"),
      "@store": path.resolve(__dirname, "./src/store"),
      "@pages": path.resolve(__dirname, "./src/pages"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 8000,
    cors: true,
  },
});
