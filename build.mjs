// Build: three entry points, bundled separately because each runs in a
// different extension context (service worker, popup document, options
// document) and must not share module state by accident.
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await build({
  entryPoints: {
    background: "src/background.ts",
    popup: "src/popup.ts",
    options: "src/options.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome120",
  sourcemap: false,
  minify: false, // store reviewers read this; readable beats small at this size
});

cpSync("public", "dist", { recursive: true });
console.log("built to dist/");
