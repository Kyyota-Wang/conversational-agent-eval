/**
 * The report leads with what is wrong.
 *
 * Failures first, then flapping cases, then the rule tally, and the passing
 * cases last as a single line. A report that opens with a green summary gets
 * skimmed; one that opens with the failures gets read.
 */

const VERDICT_MARK = { pass: "PASS ", fail: "FAIL ", flaps: "FLAPS" };

function formatViolation(violation) {
  const where = violation.turn ? `turn ${violation.turn}` : "transcript";
  return `${violation.rule} (${where}): ${violation.detail}`;
}

export function renderMarkdown(summary) {
  const { counts, total, runsPerCase, meanScore, worstSpread } = summary;
  const lines = [
    "# Evaluation report",
    "",
    `${total} cases, ${runsPerCase} run(s) each.`,
    "",
    `- passed every run: **${counts.pass}**`,
    `- failed every run: **${counts.fail}**`,
    `- flapped: **${counts.flaps}**`,
  ];
  if (meanScore != null) {
    lines.push(`- mean judged score: **${meanScore.toFixed(2)}**`);
    lines.push(`- widest score spread within one case: **${worstSpread}**`);
  }
  lines.push("");

  const failures = summary.results.filter((r) => r.verdict === "fail");
  if (failures.length > 0) {
    lines.push("## Failed", "");
    for (const result of failures) {
      lines.push(`### ${result.id} — ${result.title}`, "");
      const seen = new Set();
      for (const run of result.runs) {
        for (const violation of run.violations) {
          const text = formatViolation(violation);
          if (!seen.has(text)) {
            seen.add(text);
            lines.push(`- ${text}`);
          }
        }
        for (const item of run.judgement?.mustNotViolations ?? []) {
          const text = `must-not-do: ${item}`;
          if (!seen.has(text)) {
            seen.add(text);
            lines.push(`- ${text}`);
          }
        }
      }
      lines.push("");
    }
  }

  const flapping = summary.results.filter((r) => r.verdict === "flaps");
  if (flapping.length > 0) {
    lines.push("## Flapped", "");
    lines.push(
      "These passed some runs and failed others. A case that passes most of the",
      "time is not a passing case.",
      "",
    );
    for (const result of flapping) {
      const spread = result.scoreSpread != null ? `, score spread ${result.scoreSpread}` : "";
      lines.push(`- **${result.id}** — passed ${result.passes}/${result.runCount}${spread}`);
    }
    lines.push("");
  }

  if (summary.violationsByRule.length > 0) {
    lines.push("## Rule violations across all runs", "");
    for (const [rule, count] of summary.violationsByRule) {
      lines.push(`- ${rule}: ${count}`);
    }
    lines.push("");
  }

  const passed = summary.results.filter((r) => r.verdict === "pass");
  if (passed.length > 0) {
    lines.push("## Passed", "", passed.map((r) => r.id).join(", "), "");
  }

  return lines.join("\n");
}

export function renderConsole(summary) {
  const lines = [];
  for (const result of summary.results) {
    const spread = result.scoreSpread ? ` spread=${result.scoreSpread}` : "";
    const score = result.meanScore != null ? ` score=${result.meanScore.toFixed(1)}` : "";
    lines.push(
      `${VERDICT_MARK[result.verdict]}  ${result.id.padEnd(6)} ${result.passes}/${result.runCount}${score}${spread}  ${result.title}`,
    );
    if (result.verdict !== "pass") {
      const seen = new Set();
      for (const run of result.runs) {
        for (const violation of run.violations) {
          const text = formatViolation(violation);
          if (!seen.has(text)) {
            seen.add(text);
            lines.push(`         ${text}`);
          }
        }
      }
    }
  }
  const { counts, total, runsPerCase } = summary;
  lines.push(
    "",
    `${total} cases x ${runsPerCase} runs -> ${counts.pass} pass, ${counts.fail} fail, ${counts.flaps} flapping`,
  );
  return lines.join("\n");
}
