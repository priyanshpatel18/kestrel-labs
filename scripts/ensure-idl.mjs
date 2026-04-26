import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const idlPath = path.join(rootDir, "target", "idl", "kestrel.json");

if (existsSync(idlPath)) {
  process.stdout.write(`[ensure-idl] ok: ${path.relative(rootDir, idlPath)} exists\n`);
  process.exit(0);
}

process.stdout.write(
  `[ensure-idl] missing: ${path.relative(rootDir, idlPath)}; running 'anchor build'...\n`,
);

execSync("anchor build", {
  cwd: rootDir,
  stdio: "inherit",
});

if (!existsSync(idlPath)) {
  throw new Error(`[ensure-idl] expected IDL at ${idlPath} after anchor build`);
}
