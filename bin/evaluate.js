#!/usr/bin/env node
/**
 * agent-eval --cases <dir> --agent <module> [--runs N] [--report out.md] [--judge <module>]
 *
 * The agent module default-exports `async (messages) => ({ reply })`.
 * The judge module, if given, default-exports `async (prompt) => judgement`.
 * Without a judge the rule and convergence layers still run, with no API key
 * and no network — which is the configuration to put in CI.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { loadCases } from "../src/cases.js";
import { evaluateSuite } from "../src/evaluate.js";
import { renderConsole, renderMarkdown } from "../src/report.js";

/** Accepts both `--key=value` and `--key value`. A bare `--flag` is "true". */
export function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith("--")) continue;
    const [key, ...rest] = entry.slice(2).split("=");
    if (rest.length > 0) {
      args.set(key, rest.join("="));
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, "true");
    }
  }
  return args;
}

async function loadDefaultExport(specifier, what) {
  const resolved = pathToFileURL(path.resolve(specifier)).href;
  const module = await import(resolved);
  const fn = module.default;
  if (typeof fn !== "function") {
    throw new Error(`${what} module ${specifier} must default-export a function`);
  }
  return fn;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const casesDir = args.get("cases");
  const agentPath = args.get("agent");
  if (!casesDir || !agentPath) {
    console.error(
      "usage: agent-eval --cases <dir> --agent <module> [--runs N] [--report out.md] [--judge <module>]",
    );
    return 2;
  }

  const runs = Math.max(1, Number.parseInt(args.get("runs") ?? "1", 10) || 1);
  const cases = await loadCases(casesDir);
  const agent = await loadDefaultExport(agentPath, "agent");
  const judge = args.get("judge")
    ? await loadDefaultExport(args.get("judge"), "judge")
    : null;

  if (!judge) {
    console.error("no --judge given: running the rule and convergence layers only");
  }
  console.error(`${cases.length} cases x ${runs} run(s)`);

  // One line per case rather than a redrawn progress bar. It survives being
  // piped to a file, and a CI log is the usual destination.
  const summary = await evaluateSuite(agent, cases, {
    runs,
    judge,
    onCase: (result, done, total) => {
      console.error(`  [${done}/${total}] ${result.id} ${result.verdict}`);
    },
  });
  console.error("");

  console.log(renderConsole(summary));

  const reportPath = args.get("report");
  if (reportPath) {
    await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
    await writeFile(reportPath, renderMarkdown(summary), "utf8");
    console.log(`\nwrote ${reportPath}`);
  }

  // Flapping counts as failure for the exit code. It is not a pass.
  return summary.counts.fail + summary.counts.flaps > 0 ? 1 : 0;
}

// Only run when invoked directly. Importing this module — a test does — must
// not start the CLI and exit the process.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error?.stack ?? String(error));
      process.exit(2);
    },
  );
}
