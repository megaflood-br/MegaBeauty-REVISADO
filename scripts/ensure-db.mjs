import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const cwd = process.cwd();
const envFilePath = path.resolve(cwd, ".env");
const defaultDbPath = path.resolve(cwd, "prisma/dev.db");
const defaultDbUrl = `file:${defaultDbPath}`;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function ensureLocalDevEnv() {
  if (process.env.NODE_ENV === "production") return;
  const existing = readEnvFile(envFilePath);
  const additions = [];
  if (!process.env.DATABASE_URL && !existing.DATABASE_URL) {
    additions.push('DATABASE_URL="file:./dev.db"');
  }
  if (!process.env.AUTH_SECRET && !existing.AUTH_SECRET) {
    const generated = crypto.randomBytes(32).toString("base64");
    additions.push(`AUTH_SECRET="${generated}"`);
  }
  if (additions.length === 0) return;
  const prefix = fs.existsSync(envFilePath) ? "\n" : "";
  fs.appendFileSync(envFilePath, `${prefix}${additions.join("\n")}\n`, "utf8");
}

function resolveDatabaseUrl() {
  const fileEnv = readEnvFile(envFilePath);
  const raw = (process.env.DATABASE_URL || fileEnv.DATABASE_URL || "").trim();
  if (!raw) return defaultDbUrl;
  if (raw.startsWith("file:./") || raw.startsWith("file:../")) {
    // Prisma resolves relative SQLite URLs relative to prisma/schema.prisma
    const rel = raw.slice("file:".length);
    return `file:${path.resolve(cwd, "prisma", rel)}`;
  }
  return raw;
}

async function hasTenantTable(databaseUrl) {
  const client = new PrismaClient({ datasourceUrl: databaseUrl, log: [] });
  try {
    const rows = await client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='Tenant'",
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  } finally {
    await client.$disconnect().catch(() => null);
  }
}

async function countTenants(databaseUrl) {
  const client = new PrismaClient({ datasourceUrl: databaseUrl, log: [] });
  try {
    return await client.tenant.count();
  } catch {
    return 0;
  } finally {
    await client.$disconnect().catch(() => null);
  }
}

async function main() {
  ensureLocalDevEnv();

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl.startsWith("file:")) {
    return;
  }

  const dbFilePath = databaseUrl.slice("file:".length);
  const needsPush =
    !fs.existsSync(dbFilePath) ||
    fs.statSync(dbFilePath).size === 0 ||
    !(await hasTenantTable(databaseUrl));

  if (!needsPush) {
    return;
  }

  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

  console.log("[ensure-db] Initializing SQLite database schema...");
  execFileSync(npxCmd, ["prisma", "db", "push", "--skip-generate"], {
    cwd,
    env,
    stdio: "inherit",
  });

  const existingTenants = await countTenants(databaseUrl);
  if (existingTenants === 0) {
    console.log("[ensure-db] Seeding initial MegaBeauty data...");
    execFileSync(npxCmd, ["tsx", "prisma/seed.ts"], {
      cwd,
      env,
      stdio: "inherit",
    });
  }
}

main().catch((err) => {
  console.error("[ensure-db] Failed to prepare database:", err);
  process.exit(1);
});
