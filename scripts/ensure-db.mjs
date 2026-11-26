import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = process.cwd();
const envFilePath = path.resolve(cwd, ".env");
const schemaFilePath = path.resolve(cwd, "prisma/schema.prisma");
const defaultDbPath = path.resolve(cwd, "prisma/dev.db");
const defaultDbUrl = `file:${defaultDbPath}`;
const prismaClientEntryPath = path.resolve(cwd, "node_modules/.prisma/client/index.js");
const stampFilePath = path.resolve(cwd, ".next/.ensure-db-stamp");

export function readEnvFile(filePath = envFilePath) {
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function ensureLocalDevEnv() {
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

export function resolveDatabaseUrl() {
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

export function resolveLocalBin(binName) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const localPath = path.resolve(cwd, "node_modules/.bin", `${binName}${suffix}`);
  if (fs.existsSync(localPath)) {
    return { cmd: localPath, prefixArgs: [] };
  }
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  return { cmd: npxCmd, prefixArgs: [binName] };
}

function runLocalBin(binName, args, env) {
  const { cmd, prefixArgs } = resolveLocalBin(binName);
  execFileSync(cmd, [...prefixArgs, ...args], {
    cwd,
    env,
    stdio: "inherit",
  });
}

function computeSchemaHash() {
  if (!fs.existsSync(schemaFilePath)) return "";
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(schemaFilePath))
    .digest("hex")
    .slice(0, 16);
}

function expectedStamp(dbFilePath) {
  return `${dbFilePath}\n${computeSchemaHash()}`;
}

function hasCurrentStamp(dbFilePath) {
  try {
    if (!fs.existsSync(stampFilePath)) return false;
    return fs.readFileSync(stampFilePath, "utf8").trim() === expectedStamp(dbFilePath);
  } catch {
    return false;
  }
}

function writeStamp(dbFilePath) {
  try {
    fs.mkdirSync(path.dirname(stampFilePath), { recursive: true });
    fs.writeFileSync(stampFilePath, `${expectedStamp(dbFilePath)}\n`, "utf8");
  } catch {
    // Non-fatal: .next may not be writable in some environments
  }
}

export function getDbSetupPlan() {
  const needsGenerate = !fs.existsSync(prismaClientEntryPath);
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl.startsWith("file:")) {
    return {
      databaseUrl,
      dbFilePath: null,
      needsGenerate,
      needsPush: false,
      isFreshDb: false,
    };
  }

  const dbFilePath = databaseUrl.slice("file:".length);
  const dbExists = fs.existsSync(dbFilePath) && fs.statSync(dbFilePath).size > 0;
  if (!dbExists) {
    return {
      databaseUrl,
      dbFilePath,
      needsGenerate,
      needsPush: true,
      isFreshDb: true,
    };
  }

  if (!needsGenerate && hasCurrentStamp(dbFilePath)) {
    return {
      databaseUrl,
      dbFilePath,
      needsGenerate: false,
      needsPush: false,
      isFreshDb: false,
    };
  }

  return {
    databaseUrl,
    dbFilePath,
    needsGenerate,
    needsPush: true,
    isFreshDb: false,
  };
}

async function countTenants(databaseUrl) {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ datasourceUrl: databaseUrl, log: [] });
  try {
    return await client.tenant.count();
  } catch {
    return 0;
  } finally {
    await client.$disconnect().catch(() => null);
  }
}

export async function ensureDb() {
  ensureLocalDevEnv();

  const plan = getDbSetupPlan();
  const env = { ...process.env, DATABASE_URL: plan.databaseUrl };

  if (plan.needsGenerate) {
    console.log("[ensure-db] Generating Prisma client...");
    runLocalBin("prisma", ["generate"], env);
  }

  if (!plan.dbFilePath || !plan.needsPush) {
    return;
  }

  fs.mkdirSync(path.dirname(plan.dbFilePath), { recursive: true });

  console.log("[ensure-db] Syncing SQLite database schema...");
  runLocalBin("prisma", ["db", "push", "--skip-generate"], env);

  const shouldSeed = plan.isFreshDb || (await countTenants(plan.databaseUrl)) === 0;
  if (shouldSeed) {
    console.log("[ensure-db] Seeding initial MegaBeauty data...");
    runLocalBin("tsx", ["prisma/seed.ts"], env);
  }

  writeStamp(plan.dbFilePath);
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  ensureDb().catch((err) => {
    console.error("[ensure-db] Failed to prepare database:", err);
    process.exit(1);
  });
}
