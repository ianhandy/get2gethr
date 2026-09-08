import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const database = process.argv[2] ?? process.env.TURSO_DATABASE_NAME;
const outputArgument = process.argv[3] ?? process.env.TURSO_BACKUP_DIR;

if (!database || !outputArgument) {
  console.error(
    "Usage: npm run db:backup -- <database-name> <secure-output-directory>"
  );
  process.exit(2);
}

const outputDirectory = path.resolve(outputArgument);
fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

const dumped = spawnSync("turso", ["db", "shell", database, ".dump"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
});
if (dumped.error) throw dumped.error;
if (dumped.status !== 0) {
  throw new Error(dumped.stderr || `turso exited with status ${dumped.status}`);
}
if (!dumped.stdout.includes("CREATE TABLE")) {
  throw new Error("Turso dump did not contain the expected schema");
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "get2gethr-restore-"));
try {
  const restoredPath = path.join(temporaryDirectory, "restore.db");
  const restored = spawnSync("sqlite3", [restoredPath], {
    input: dumped.stdout,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (restored.error) throw restored.error;
  if (restored.status !== 0) {
    throw new Error(restored.stderr || "SQLite restore failed");
  }

  const checked = spawnSync(
    "sqlite3",
    [restoredPath, "PRAGMA integrity_check; SELECT COUNT(*) FROM sqlite_master WHERE type='table';"],
    { encoding: "utf8" }
  );
  if (checked.error) throw checked.error;
  const lines = checked.stdout.trim().split(/\r?\n/);
  if (checked.status !== 0 || lines[0] !== "ok" || Number(lines[1]) < 1) {
    throw new Error(`Restored backup failed integrity verification: ${checked.stderr}`);
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const archive = gzipSync(dumped.stdout, { level: 9 });
const filename = `${database}-${timestamp}.sql.gz`;
const archivePath = path.join(outputDirectory, filename);
fs.writeFileSync(archivePath, archive, { mode: 0o600, flag: "wx" });

const sha256 = crypto.createHash("sha256").update(archive).digest("hex");
fs.writeFileSync(`${archivePath}.sha256`, `${sha256}  ${filename}\n`, {
  mode: 0o600,
  flag: "wx",
});

console.log(`Verified backup written to ${archivePath}`);
