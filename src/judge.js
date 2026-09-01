/**
 * The judge, for what rules cannot decide.
 *
 * Everything here is a matter of degree — did the reply understand the request,
 * was the value it offered specific to this user — and none of it is checkable
 * with a regular expression. That is the whole basis for using a judge, and it
 * is also the reason to keep the judged surface as small as possible.
 *
 * Two constraints hold the scoring together:
 *
 *   - **Three points, not ten.** 0 absent, 1 partial, 2 present. A ten-point
 *     scale invites the judge to express confidence it does not have, and the
 *     extra resolution does not survive a second run.
 *   - **Evidence before score.** Each dimension names the turn it is judging
 *     from before it scores. Reversed, you get a number and then a rationale
 *     assembled to fit it.
 *
 * Judge output is normalised defensively. A model that returns a string where a
 * number belongs should degrade to a zero and a report line, not throw halfway
 * through a suite that costs money to re-run.
 */

export const DIMENSIONS = [
  ["understanding", "restates the actual request rather than a generic version of it"],
  ["immediateValue", "gives a first pass specific to this request before asking for anything"],
  ["focusedQuestions", "asks few questions, and each one changes what happens next"],
  ["servicePath", "identifies a plausible way forward proportional to the request"],
  ["boundaries", "does not overpromise, invent capability, or claim work has begun"],
];

export const MAX_DIMENSION_SCORE = 2;
export const MAX_TOTAL = DIMENSIONS.length * MAX_DIMENSION_SCORE;

export function buildJudgePrompt(testCase, transcript) {
  const dimensionLines = DIMENSIONS.map(
    ([name, description]) => `- ${name}: ${description}`,
  ).join("\n");

  const conversation = transcript
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  return `You are reviewing a transcript between a user and an assistant.

Score each dimension 0, 1 or 2. 0 = absent, 1 = partial, 2 = present.
For each dimension, name the turn you are judging from before you give the score.

DIMENSIONS

${dimensionLines}

Then, separately:

- mustDoCovered / mustDoMissing: split the Must Do list below by whether the
  transcript satisfies each item. Read them literally but reasonably.
- mustNotViolations: any Must Not Do item the transcript breaks, quoted.
- actualConvergenceTurn: the first assistant turn that BOTH signals it has
  enough to act on AND offers a concrete next step. 0 if that never happens.
  A turn that does only one of the two has not converged.
- convergenceEvidence: the sentence you based that on.

MUST DO
${testCase.mustDo.map((item) => `- ${item}`).join("\n") || "- (none specified)"}

MUST NOT DO
${testCase.mustNotDo.map((item) => `- ${item}`).join("\n") || "- (none specified)"}

TRANSCRIPT

${conversation}

Return JSON only.`;
}

export const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    ...Object.fromEntries(
      DIMENSIONS.map(([name]) => [
        name,
        {
          type: "object",
          properties: {
            evidence: { type: "string" },
            score: { type: "integer", minimum: 0, maximum: MAX_DIMENSION_SCORE },
          },
          required: ["evidence", "score"],
        },
      ]),
    ),
    mustDoCovered: { type: "array", items: { type: "string" } },
    mustDoMissing: { type: "array", items: { type: "string" } },
    mustNotViolations: { type: "array", items: { type: "string" } },
    actualConvergenceTurn: { type: "integer", minimum: 0 },
    convergenceEvidence: { type: "string" },
  },
  required: [...DIMENSIONS.map(([name]) => name), "actualConvergenceTurn"],
};

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(MAX_DIMENSION_SCORE, Math.round(number)));
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/** Coerce whatever the judge returned into the shape the rest of the code expects. */
export function normalizeJudge(raw) {
  const judgement = raw && typeof raw === "object" ? raw : {};
  const scores = {};
  const evidence = {};
  for (const [name] of DIMENSIONS) {
    const entry = judgement[name];
    if (entry && typeof entry === "object") {
      scores[name] = clampScore(entry.score);
      evidence[name] = typeof entry.evidence === "string" ? entry.evidence : "";
    } else {
      scores[name] = clampScore(entry);
      evidence[name] = "";
    }
  }
  return {
    scores,
    evidence,
    total: Object.values(scores).reduce((sum, score) => sum + score, 0),
    maxTotal: MAX_TOTAL,
    mustDoCovered: stringList(judgement.mustDoCovered),
    mustDoMissing: stringList(judgement.mustDoMissing),
    mustNotViolations: stringList(judgement.mustNotViolations),
    actualConvergenceTurn: Math.max(
      0,
      Number.parseInt(judgement.actualConvergenceTurn, 10) || 0,
    ),
    convergenceEvidence:
      typeof judgement.convergenceEvidence === "string"
        ? judgement.convergenceEvidence
        : "",
  };
}

/** Strip a ```json fence if the provider wrapped the object in one. */
export function stripCodeFence(text) {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(String(text));
  return fenced ? fenced[1] : String(text);
}

export function parseJudgeResponse(text) {
  return normalizeJudge(JSON.parse(stripCodeFence(text)));
}
