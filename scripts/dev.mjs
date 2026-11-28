import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ensureLocalDevEnv,
  getDbSetupPlan,
  resolveLocalBin,
} from "./ensure-db.mjs";

const cwd = process.cwd();
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const ensureDbScriptPath = path.join(scriptsDir, "ensure-db.mjs");

// Ensure .env exists before Next.js boots and loads environment variables.
ensureLocalDevEnv();

const plan = getDbSetupPlan();

// Only block before Next.js if @prisma/client has never been generated yet.
if (plan.needsGenerate) {
  const prismaBin = resolveLocalBin("prisma");
  execFileSync(prismaBin.cmd, [...prismaBin.prefixArgs, "generate"], {
    cwd,
    env: { ...process.env, DATABASE_URL: plan.databaseUrl },
    stdio: "inherit",
  });
}

// Start Next.js immediately so port 3000 binds without waiting on DB push/seed.
const nextBin = resolveLocalBin("next");
const nextEnv = {
  ...process.env,
  NODE_OPTIONS: process.env.NODE_OPTIONS
    ? process.env.NODE_OPTIONS
    : "--max-old-space-size=1024",
};

const nextChild = spawn(
  nextBin.cmd,
  [...nextBin.prefixArgs, "dev", "--turbopack", "-p", "3000", "-H", "0.0.0.0"],
  {
    cwd,
    env: nextEnv,
    stdio: "inherit",
  },
);

let dbChild = null;
if (plan.needsPush) {
  dbChild = spawn(process.execPath, [ensureDbScriptPath], {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  dbChild.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[dev] Background database setup exited with code ${code}`);
    }
    dbChild = null;
  });
}

function forwardSignal(signal) {
  if (dbChild && !dbChild.killed) {
    dbChild.kill(signal);
  }
  if (!nextChild.killed) {
    nextChild.kill(signal);
  }
}

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

nextChild.on("exit", (code, signal) => {
  if (dbChild && !dbChild.killed) {
    dbChild.kill("SIGTERM");
  }
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
