/**
 * Orchestration, and the reason this harness runs each case more than once.
 *
 * A conversational agent is not deterministic. Run a suite once and you get a
 * number; run it again and you get a different one. The single-run number is the
 * one people quote, and it is the one that hides the problem: a case that passes
 * two runs out of three is not a passing case, it is a flapping case, and it
 * will fail in front of a user eventually.
 *
 * So every case runs `runs` times and the report carries three things per case:
 * whether it passed every run, the spread between its best and worst judged
 * score, and whether the verdict flipped. Flapping is reported as its own
 * category rather than rounded into a pass rate, because the fix for a flapping
 * case is different from the fix for a failing one.
 *
 * Order of work per run: drive the conversation, apply the rule layer, apply the
 * convergence check, and only then call the judge. If the rules already found a
 * violation the judge still runs — you want to know whether it agrees — but a
 * run is failed by rules alone regardless of what the judge says.
 */

import { findViolations } from "./deterministic.js";
import { checkConvergence } from "./convergence.js";
import { buildJudgePrompt } from "./judge.js";

/**
 * @typedef {(messages: {role: string, content: string}[]) => Promise<{reply: string, meta?: object}>} Agent
 * @typedef {(prompt: string) => Promise<object>} Judge
 */

/** Drive one conversation to completion, returning the transcript. */
export async function runConversation(agent, testCase) {
  const transcript = [];
  const meta = [];
  for (const userMessage of testCase.turns) {
    transcript.push({ role: "user", content: userMessage });
    const response = await agent(transcript.slice());
    const reply = typeof response === "string" ? response : response.reply;
    transcript.push({ role: "assistant", content: String(reply ?? "") });
    if (typeof response === "object" && response?.meta) meta.push(response.meta);
  }
  return { transcript, meta };
}

/** One run of one case. */
export async function runOnce(agent, testCase, options = {}) {
  const { rules, convergencePatterns, judge } = options;
  const { transcript, meta } = await runConversation(agent, testCase);

  const ruleViolations = findViolations(transcript, rules);
  const convergenceIssues = checkConvergence(
    transcript,
    testCase.expectedConvergence,
    convergencePatterns,
  );
  const violations = [...ruleViolations, ...convergenceIssues];

  let judgement = null;
  let judgeError = null;
  if (judge) {
    try {
      judgement = await judge(buildJudgePrompt(testCase, transcript));
    } catch (error) {
      judgeError = error instanceof Error ? error.message : String(error);
    }
  }

  const mustNotViolations = judgement?.mustNotViolations ?? [];
  const passed = violations.length === 0 && mustNotViolations.length === 0;

  return { transcript, meta, violations, judgement, judgeError, passed };
}

function spread(values) {
  const numbers = values.filter((v) => typeof v === "number");
  if (numbers.length === 0) return null;
  return Math.max(...numbers) - Math.min(...numbers);
}

/**
 * Run one case `runs` times and summarise stability across the runs.
 *
 * `verdict` is one of:
 *   - "pass"  — passed every run
 *   - "fail"  — failed every run
 *   - "flaps" — passed some and failed others. Reported separately on purpose.
 */
export async function evaluateCase(agent, testCase, options = {}) {
  const runs = Math.max(1, options.runs ?? 1);
  const results = [];
  for (let index = 0; index < runs; index += 1) {
    results.push(await runOnce(agent, testCase, options));
  }

  const passes = results.filter((result) => result.passed).length;
  const verdict = passes === runs ? "pass" : passes === 0 ? "fail" : "flaps";
  const totals = results.map((result) => result.judgement?.total ?? null);

  return {
    id: testCase.id,
    title: testCase.title,
    runs: results,
    passes,
    runCount: runs,
    verdict,
    scoreSpread: spread(totals),
    meanScore:
      totals.filter((t) => typeof t === "number").length > 0
        ? totals.filter((t) => typeof t === "number").reduce((a, b) => a + b, 0) /
          totals.filter((t) => typeof t === "number").length
        : null,
  };
}

export async function evaluateSuite(agent, cases, options = {}) {
  const { onCase } = options;
  const results = [];
  for (const testCase of cases) {
    const result = await evaluateCase(agent, testCase, options);
    results.push(result);
    if (onCase) onCase(result, results.length, cases.length);
  }

  const counts = { pass: 0, fail: 0, flaps: 0 };
  for (const result of results) counts[result.verdict] += 1;

  const scored = results.filter((r) => typeof r.meanScore === "number");
  const violationsByRule = new Map();
  for (const result of results) {
    for (const run of result.runs) {
      for (const violation of run.violations) {
        violationsByRule.set(violation.rule, (violationsByRule.get(violation.rule) ?? 0) + 1);
      }
    }
  }

  return {
    results,
    counts,
    total: results.length,
    runsPerCase: Math.max(1, options.runs ?? 1),
    meanScore:
      scored.length > 0
        ? scored.reduce((sum, r) => sum + r.meanScore, 0) / scored.length
        : null,
    worstSpread: Math.max(0, ...results.map((r) => r.scoreSpread ?? 0)),
    violationsByRule: [...violationsByRule.entries()].sort((a, b) => b[1] - a[1]),
  };
}
