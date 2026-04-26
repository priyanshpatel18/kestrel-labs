/**
 * Copies `target/idl/kestrel.json` into app, scheduler, and agents (no runtime dependency on `target/`).
 * Run from repo root: `pnpm sync-idl` (also runs automatically after `pnpm anchor-build`).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const src = path.join(rootDir, "target", "idl", "kestrel.json");

if (!existsSync(src)) {
  console.error(`[sync-idl] missing ${path.relative(rootDir, src)} — run \`anchor build\` first.`);
  process.exit(1);
}

const copies = [
  path.join(rootDir, "app", "lib", "idl", "kestrel.json"),
  path.join(rootDir, "scheduler", "src", "idl", "kestrel.json"),
  path.join(rootDir, "agents", "src", "idl", "kestrel.json"),
];

for (const dest of copies) {
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`[sync-idl] copied → ${path.relative(rootDir, dest)}`);
}
