import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { testEvolutionAuthAndWebhookBySlug } from "../src/lib/whatsapp-live";

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

async function main() {
  loadDotEnv();
  const slug = process.argv[2];
  const report = await testEvolutionAuthAndWebhookBySlug(slug);

  console.log(`\n=== Teste Evolution API · Salão: ${report.tenantSlug} (${report.instance}) ===`);
  for (const check of report.checks) {
    const badge = check.ok ? "[OK]  " : "[ERRO]";
    console.log(`${badge} ${check.label}: ${check.detail}`);
  }
  console.log(`\nResumo: ${report.summary}\n`);
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error("[ERRO] Falha ao executar teste da Evolution API:", error instanceof Error ? error.message : error);
  process.exit(1);
});
