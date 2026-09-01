/**
 * Test cases are Markdown, on purpose.
 *
 * The people who know what an intake agent should say are rarely the people who
 * want to edit JSON. A case written in Markdown can be reviewed in a pull
 * request by someone who has never opened the harness, and the diff is readable.
 *
 * Format — one case per `##` heading:
 *
 *     ## C01 - Ambiguous request
 *
 *     ### Turns
 *     1. I need help with our reporting.
 *     2. How do we get started?
 *
 *     ### Must Do
 *     - Restate the request before asking anything.
 *     - Offer one concrete observation before requesting contact details.
 *
 *     ### Must Not Do
 *     - Promise a price or delivery date.
 *
 *     ### Expected Convergence
 *     turns 2-3
 *
 * `Expected Convergence` accepts `turns N-M`, `turn N`, or `none` for cases that
 * should stay exploratory.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const HEADING = /^##\s+(?<id>[A-Za-z0-9_.-]+)\s*[-–—:]?\s*(?<title>.*)$/;

function sections(block) {
  const found = new Map();
  const pattern = /^###\s+(.+?)\s*$/gm;
  const matches = [...block.matchAll(pattern)];
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : block.length;
    found.set(match[1].trim().toLowerCase(), block.slice(start, end).trim());
  });
  return found;
}

function bullets(text) {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line && !/^\d+\.\s/.test(line));
}

function numbered(text) {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => /^\s*\d+\.\s+(.*)$/.exec(line)?.[1]?.trim())
    .filter(Boolean);
}

export function parseExpectedConvergence(text, id) {
  const value = (text ?? "").trim().toLowerCase();
  if (!value || value === "none" || value === "not required") {
    return { required: false };
  }
  const range = /turns?\s+(\d+)\s*(?:[-–—]\s*(\d+))?/.exec(value);
  if (!range) {
    throw new Error(
      `case ${id}: could not read "Expected Convergence" from ${JSON.stringify(text)}. ` +
        `Use "turn N", "turns N-M", or "none".`,
    );
  }
  const minTurn = Number(range[1]);
  const maxTurn = range[2] ? Number(range[2]) : minTurn;
  if (maxTurn < minTurn) {
    throw new Error(`case ${id}: convergence window ends before it starts`);
  }
  return { required: true, minTurn, maxTurn };
}

export function parseCases(markdown, source = "<inline>") {
  const blocks = markdown.split(/^##\s/m).slice(1).map((block) => `## ${block}`);
  return blocks.map((block) => {
    const heading = HEADING.exec(block.split("\n", 1)[0]);
    if (!heading) throw new Error(`${source}: a "##" heading is not a case id`);
    const { id, title } = heading.groups;
    const found = sections(block);

    const turns = numbered(found.get("turns"));
    if (turns.length === 0) {
      throw new Error(`case ${id}: no numbered turns under "### Turns"`);
    }

    return {
      id,
      title: title.trim(),
      source,
      turns,
      mustDo: bullets(found.get("must do")),
      mustNotDo: bullets(found.get("must not do")),
      expectedConvergence: parseExpectedConvergence(
        found.get("expected convergence"),
        id,
      ),
    };
  });
}

export async function loadCases(directory) {
  const entries = (await readdir(directory)).filter((name) => name.endsWith(".md")).sort();
  const cases = [];
  for (const entry of entries) {
    const full = path.join(directory, entry);
    cases.push(...parseCases(await readFile(full, "utf8"), entry));
  }
  const seen = new Set();
  for (const testCase of cases) {
    if (seen.has(testCase.id)) throw new Error(`duplicate case id ${testCase.id}`);
    seen.add(testCase.id);
  }
  return cases;
}
