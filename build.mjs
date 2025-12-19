import { build } from "esbuild";
import fs from "fs";

const OUTDIR = "dist";

// 1) Bundle src/index.js + deps (d3)
await build({
  entryPoints: ["src/index.js"],
  outfile: `${OUTDIR}/bundle.js`,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2018"]
});

// 2) Looker Studio: un seul fichier JS final.
// => concat dscc.min.js + bundle.js => dist/viz.js
const dsccPath = "public/dscc.min.js";
if (!fs.existsSync(dsccPath)) {
  console.error("❌ public/dscc.min.js manquant.");
  console.error("➡️ Télécharge la helper library DSCC (dscc.min.js) et mets-la dans public/ puis relance npm run build");
  process.exit(1);
}

const dscc = fs.readFileSync(dsccPath, "utf8");
const bundle = fs.readFileSync(`${OUTDIR}/bundle.js`, "utf8");

// Petit séparateur + ; pour éviter collisions
fs.writeFileSync(`${OUTDIR}/viz.js`, `${dscc}\n;\n${bundle}\n`);

console.log("✅ Build ok: dist/viz.js");
console.log("➡️ À uploader dans GCS:");
console.log("   - dist/viz.js (renommer en viz.js dans le bucket)");
console.log("   - public/viz.css");
console.log("   - public/viz-config.json");
console.log("   - public/manifest.json");
console.log("   - public/logo.png / public/icon.png (optionnel)");
