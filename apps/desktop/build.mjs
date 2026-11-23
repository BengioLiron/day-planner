// Bundles the Electron main process (with the API server inside) and the preload script.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
  legalComments: "none",
};

await Promise.all([
  build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs" }),
  build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs", sourcemap: false }),
]);
