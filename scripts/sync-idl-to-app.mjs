/**
 * Copies `target/idl/kestrel.json` → `app/lib/idl/kestrel.json` after `anchor build`.
 * Run from repo root: `pnpm sync-idl`
 * Commit the JSON so Vercel (and any CI without Anchor) can build the Next app.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const src = path.join(rootDir, "target", "idl", "kestrel.json");
const destDir = path.join(rootDir, "app", "lib", "idl");
const dest = path.join(destDir, "kestrel.json");

if (!existsSync(src)) {
  console.error(`[sync-idl] missing ${path.relative(rootDir, src)} — run \`anchor build\` first.`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[sync-idl] copied → ${path.relative(rootDir, dest)}`);
