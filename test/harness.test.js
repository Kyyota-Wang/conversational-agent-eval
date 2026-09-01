import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCases, parseExpectedConvergence } from "../src/cases.js";
import {
  DEFAULT_SENSITIVE_PATTERNS,
  assistantTurns,
  countQuestions,
  findViolations,
} from "../src/deterministic.js";
import { checkConvergence, firstConvergenceTurn } from "../src/convergence.js";
import { MAX_TOTAL, normalizeJudge, parseJudgeResponse } from "../src/judge.js";
import { evaluateCase, evaluateSuite, runConversation } from "../src/evaluate.js";
import { renderConsole, renderMarkdown } from "../src/report.js";

const user = (content) => ({ role: "user", content });
const bot = (content) => ({ role: "assistant", content });

// ------------------------------------------------------------------- cases

test("parses a case with turns, must-do, must-not-do and convergence", () => {
  const [testCase] = parseCases(`
## C01 - A title

### Turns
1. First thing.
2. Second thing.

### Must Do
- Restate the request.

### Must Not Do
- Promise a price.

### Expected Convergence
turns 2-3
`);
  assert.equal(testCase.id, "C01");
  assert.equal(testCase.title, "A title");
  assert.deepEqual(testCase.turns, ["First thing.", "Second thing."]);
  assert.deepEqual(testCase.mustDo, ["Restate the request."]);
  assert.deepEqual(testCase.mustNotDo, ["Promise a price."]);
  assert.deepEqual(testCase.expectedConvergence, { required: true, minTurn: 2, maxTurn: 3 });
});

test("a case with no turns is an error, not an empty run", () => {
  assert.throws(() => parseCases("## C01 - Title\n\n### Must Do\n- something\n"), /no numbered turns/);
});

test("convergence spec accepts a single turn, a range, and none", () => {
  assert.deepEqual(parseExpectedConvergence("turn 2", "C1"), { required: true, minTurn: 2, maxTurn: 2 });
  assert.deepEqual(parseExpectedConvergence("turns 1-4", "C1"), { required: true, minTurn: 1, maxTurn: 4 });
  assert.deepEqual(parseExpectedConvergence("none", "C1"), { required: false });
  assert.deepEqual(parseExpectedConvergence(undefined, "C1"), { required: false });
});

test("an unreadable convergence spec names the case", () => {
  assert.throws(() => parseExpectedConvergence("soonish", "C07"), /C07/);
});

// ----------------------------------------------------------- deterministic

test("counts both ASCII and full-width question marks", () => {
  assert.equal(countQuestions("Which one? And when？"), 2);
});

test("flags a turn that asks more questions than the limit", () => {
  const violations = findViolations([user("hi"), bot("Which? How many? When? Why?")]);
  assert.equal(violations.filter((v) => v.rule === "max-questions").length, 1);
  assert.equal(violations[0].turn, 1);
});

test("two questions is allowed, three is not", () => {
  assert.equal(findViolations([user("hi"), bot("Which? When?")]).length, 0);
  assert.equal(
    findViolations([user("hi"), bot("Which? When? Why?")]).filter(
      (v) => v.rule === "max-questions",
    ).length,
    1,
  );
});

test("flags raw markdown leaking into a plain-text surface", () => {
  const violations = findViolations([user("hi"), bot("Here is **bold** text.")]);
  assert.equal(violations.some((v) => v.rule === "markdown-leak"), true);
});

test("flags a request for credentials or sensitive records", () => {
  for (const reply of [
    "Please send your password so we can check.",
    "Could you provide your credit card number?",
    "Share your medical records with us.",
  ]) {
    const violations = findViolations([user("hi"), bot(reply)]);
    assert.equal(
      violations.some((v) => v.rule === "sensitive-request"),
      true,
      `expected a sensitive-request violation for: ${reply}`,
    );
  }
});

test("mentioning a password without asking for one is not a violation", () => {
  const violations = findViolations([
    user("hi"),
    bot("We never ask for a password by email."),
  ]);
  assert.equal(violations.some((v) => v.rule === "sensitive-request"), false);
});

test("every default sensitive pattern is anchored on an ask verb", () => {
  for (const pattern of DEFAULT_SENSITIVE_PATTERNS) {
    assert.match(pattern.source, /send\|share\|provide\|enter\|give\|type/);
  }
});

test("turn numbering follows assistant replies, not raw message index", () => {
  const turns = assistantTurns([user("a"), bot("1"), user("b"), bot("2")]);
  assert.deepEqual(turns.map((t) => t.turn), [1, 2]);
  assert.equal(turns[1].user, "b");
});

// ------------------------------------------------------------- convergence

const CONVERGED = "I have enough information for an initial brief. Submit the request and our team will pick it up.";

test("a turn converges only when it signals sufficiency AND offers a handoff", () => {
  assert.equal(firstConvergenceTurn([user("a"), bot(CONVERGED)]), 1);
  assert.equal(firstConvergenceTurn([user("a"), bot("I have enough information.")]), 0);
  assert.equal(firstConvergenceTurn([user("a"), bot("Submit the request any time.")]), 0);
});

test("never converging is a violation when the case requires it", () => {
  const issues = checkConvergence(
    [user("a"), bot("And what else?"), user("b"), bot("And after that?")],
    { required: true, minTurn: 1, maxTurn: 2 },
  );
  assert.equal(issues.some((v) => v.rule === "no-convergence"), true);
});

test("converging outside the expected window is a violation", () => {
  const issues = checkConvergence([user("a"), bot(CONVERGED)], {
    required: true,
    minTurn: 2,
    maxTurn: 3,
  });
  assert.equal(issues.some((v) => v.rule === "convergence-window"), true);
});

test("converging on an exploratory case is a violation", () => {
  const issues = checkConvergence([user("just looking"), bot(CONVERGED)], { required: false });
  assert.equal(issues.some((v) => v.rule === "premature-convergence"), true);
});

test("staying exploratory on an exploratory case is clean", () => {
  const issues = checkConvergence(
    [user("just looking"), bot("No problem, take your time.")],
    { required: false },
  );
  assert.deepEqual(issues, []);
});

test("stalling right after the user asks how to proceed is a violation", () => {
  const issues = checkConvergence(
    [user("How do we get started?"), bot("Could you tell me your timeline first?")],
    { required: true, minTurn: 1, maxTurn: 2 },
  );
  assert.equal(issues.some((v) => v.rule === "ignored-next-step-request"), true);
});

// ------------------------------------------------------------------- judge

test("judge scores are clamped into range and totalled", () => {
  const judged = normalizeJudge({
    understanding: { score: 2, evidence: "turn 1" },
    immediateValue: { score: 9 },
    focusedQuestions: { score: -4 },
    servicePath: { score: "not a number" },
    boundaries: { score: 1 },
    actualConvergenceTurn: "3",
  });
  assert.equal(judged.scores.immediateValue, 2);
  assert.equal(judged.scores.focusedQuestions, 0);
  assert.equal(judged.scores.servicePath, 0);
  assert.equal(judged.total, 5);
  assert.equal(judged.maxTotal, MAX_TOTAL);
  assert.equal(judged.actualConvergenceTurn, 3);
});

test("a malformed judge response degrades to zeros rather than throwing", () => {
  const judged = normalizeJudge(null);
  assert.equal(judged.total, 0);
  assert.deepEqual(judged.mustNotViolations, []);
});

test("a fenced JSON judge response is parsed", () => {
  const judged = parseJudgeResponse('```json\n{"understanding":{"score":2},"actualConvergenceTurn":1}\n```');
  assert.equal(judged.scores.understanding, 2);
  assert.equal(judged.actualConvergenceTurn, 1);
});

// ---------------------------------------------------------------- evaluate

const CLEAN_CASE = {
  id: "T1",
  title: "clean",
  turns: ["hello"],
  mustDo: [],
  mustNotDo: [],
  expectedConvergence: { required: true, minTurn: 1, maxTurn: 1 },
};

test("the conversation carries the whole history to the agent each turn", async () => {
  const seen = [];
  const agent = async (messages) => {
    seen.push(messages.length);
    return { reply: "ok" };
  };
  await runConversation(agent, { ...CLEAN_CASE, turns: ["a", "b", "c"] });
  assert.deepEqual(seen, [1, 3, 5]);
});

test("a case that passes every run is a pass", async () => {
  const result = await evaluateCase(async () => ({ reply: CONVERGED }), CLEAN_CASE, { runs: 3 });
  assert.equal(result.verdict, "pass");
  assert.equal(result.passes, 3);
});

test("a case that fails every run is a fail", async () => {
  const result = await evaluateCase(async () => ({ reply: "And what else?" }), CLEAN_CASE, { runs: 3 });
  assert.equal(result.verdict, "fail");
});

test("a case that passes some runs and fails others is reported as flapping", async () => {
  let call = 0;
  const agent = async () => {
    call += 1;
    return { reply: call % 2 === 0 ? "And what else?" : CONVERGED };
  };
  const result = await evaluateCase(agent, CLEAN_CASE, { runs: 4 });
  assert.equal(result.verdict, "flaps");
  assert.equal(result.passes, 2);
});

test("one run cannot distinguish flapping from passing, which is the point of many", async () => {
  let call = 0;
  const agent = async () => {
    call += 1;
    return { reply: call % 2 === 0 ? "And what else?" : CONVERGED };
  };
  const single = await evaluateCase(agent, CLEAN_CASE, { runs: 1 });
  assert.equal(single.verdict, "pass");
});

test("judge failure is recorded without failing the run outright", async () => {
  const result = await evaluateCase(async () => ({ reply: CONVERGED }), CLEAN_CASE, {
    runs: 1,
    judge: async () => {
      throw new Error("provider timeout");
    },
  });
  assert.match(result.runs[0].judgeError, /provider timeout/);
  assert.equal(result.verdict, "pass");
});

test("a must-not-do violation from the judge fails the run", async () => {
  const result = await evaluateCase(async () => ({ reply: CONVERGED }), CLEAN_CASE, {
    runs: 1,
    judge: async () => ({ mustNotViolations: ["promised a delivery date"] }),
  });
  assert.equal(result.verdict, "fail");
});

test("the suite tallies verdicts and rule violations", async () => {
  const cases = [CLEAN_CASE, { ...CLEAN_CASE, id: "T2" }];
  const summary = await evaluateSuite(async () => ({ reply: "Which? When? Why?" }), cases, {
    runs: 2,
  });
  assert.equal(summary.total, 2);
  assert.equal(summary.counts.fail, 2);
  assert.equal(summary.violationsByRule.find(([rule]) => rule === "max-questions")[1], 4);
});

// ------------------------------------------------------------------ report

test("the report names failing cases and lists flapping separately", async () => {
  let call = 0;
  const summary = await evaluateSuite(
    async () => {
      call += 1;
      return { reply: call % 2 === 0 ? "And what else?" : CONVERGED };
    },
    [CLEAN_CASE],
    { runs: 2 },
  );
  const markdown = renderMarkdown(summary);
  assert.match(markdown, /## Flapped/);
  assert.match(markdown, /T1/);
  assert.match(renderConsole(summary), /FLAPS/);
});

// --------------------------------------------------------------------- cli

test("argument parsing accepts both --key=value and --key value", async () => {
  const { parseArgs } = await import("../bin/evaluate.js");
  const args = parseArgs(["--cases", "examples/cases", "--runs=3", "--verbose"]);
  assert.equal(args.get("cases"), "examples/cases");
  assert.equal(args.get("runs"), "3");
  assert.equal(args.get("verbose"), "true");
});
