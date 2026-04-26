/**
 * Run `anchor build` then sync bundled IDLs (same as a successful local test flow).
 * From repo root: `pnpm anchor-build` — extra args are forwarded, e.g. `pnpm anchor-build -- --no-idl`.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extra = process.argv.slice(2);

const anchor = spawnSync("anchor", ["build", ...extra], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env,
});
if (anchor.error) {
  console.error(anchor.error);
  process.exit(1);
}
if (anchor.status !== 0 && anchor.status !== null) {
  process.exit(anchor.status);
}

const sync = spawnSync(process.execPath, [path.join(rootDir, "scripts", "sync-idl.mjs")], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env,
});
if (sync.error) {
  console.error(sync.error);
  process.exit(1);
}
process.exit(sync.status ?? 0);
