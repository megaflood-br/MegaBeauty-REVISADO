import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(process.cwd(), "src");

const IMPORT_RE =
  /(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;

const SERVER_ONLY_MODULES = new Set([
  "@prisma/client",
  "@/lib/db",
  "bcryptjs",
  "next/headers",
  "openai",
  "xlsx",
  "jose",
  "fs",
  "path",
  "crypto",
  "async_hooks",
  "os",
  "child_process",
  "http",
  "https",
  "net",
  "tls",
  "zlib",
  "stream",
  "buffer",
  "url",
  "util",
]);

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTsFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function resolveLocal(fromFile: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) {
    base = path.join(SRC_ROOT, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), spec);
  }
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function getValueImports(source: string): string[] {
  const result: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const full = match[0];
    const spec = match[1] || match[2];
    if (!spec) continue;
    const named = full.match(/\{([^}]+)\}/);
    if (named && !full.includes("* as") && !/^import\s+[A-Za-z_$]/.test(full.trim())) {
      const items = named[1]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (items.length > 0 && items.every((item) => /^type\s+/.test(item))) continue;
    }
    result.push(spec);
  }
  return result;
}

describe("client/server module boundary", () => {
  it("prevents any 'use client' module from transitively importing Prisma or Node server modules", () => {
    const files = walkTsFiles(SRC_ROOT);
    const cache = new Map<string, string>();
    const read = (file: string) => {
      let cached = cache.get(file);
      if (cached === undefined) {
        cached = fs.readFileSync(file, "utf8");
        cache.set(file, cached);
      }
      return cached;
    };
    const isUseClient = (file: string) => /^\s*["']use client["']/.test(read(file));
    const isUseServer = (file: string) => /^\s*["']use server["']/.test(read(file));

    const leaks: string[] = [];

    for (const startFile of files) {
      if (!isUseClient(startFile)) continue;
      const visited = new Set<string>([startFile]);
      const queue: { file: string; chain: string[] }[] = [
        { file: startFile, chain: [path.relative(process.cwd(), startFile)] },
      ];

      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const spec of getValueImports(read(current.file))) {
          if (SERVER_ONLY_MODULES.has(spec) || spec.startsWith("node:")) {
            leaks.push([...current.chain, spec].join(" -> "));
            continue;
          }
          const resolved = resolveLocal(current.file, spec);
          if (!resolved || isUseServer(resolved) || visited.has(resolved)) continue;
          visited.add(resolved);
          queue.push({
            file: resolved,
            chain: [...current.chain, path.relative(process.cwd(), resolved)],
          });
        }
      }
    }

    expect(leaks).toEqual([]);
  });
});
