/**
 * Convergence: does the conversation ever finish?
 *
 * The failure this exists to catch is specific and common. An intake agent that
 * is helpful, well-mannered and correct on every individual turn can still be
 * useless, because it asks one more clarifying question forever and never says
 * "I have enough — here is the next step." Every turn passes review. The
 * conversation fails.
 *
 * Turn-level quality metrics cannot see this. It is a property of the
 * transcript, so it has to be measured over the transcript.
 *
 * A turn converges when it does two things at once: signals that enough has
 * been gathered, and offers a concrete handoff. Either alone is not
 * convergence — "I think I understand" that asks another question has not
 * converged, and "contact us any time" without the first half is a brush-off.
 *
 * The patterns are the configurable part. They are deliberately narrow: a
 * missed convergence shows up as a violation you can read and fix, whereas a
 * pattern loose enough to match politeness reports success that is not there.
 */

export const DEFAULT_CONVERGENCE_PATTERNS = {
  /** "I have enough to act on." */
  sufficiency:
    /\benough (?:information|detail|context)\b|\b(?:information|scope|request)\b.{0,55}\b(?:clear enough|sufficient)\b|(?:信息|需求|范围).{0,32}(?:足够|足以|已经清楚)/i,
  /** "Here is the concrete next step." */
  handoff:
    /\bcontact form\b|\bsubmit\b.{0,45}\b(?:request|summary|brief)\b|\b(?:send|share)\b.{0,45}\b(?:request|summary|brief)\b.{0,30}\bteam\b|(?:联系表单|联系方式).{0,36}(?:提交|发送|团队)|(?:提交|发送).{0,36}(?:需求|摘要|简报)/i,
  /** The user explicitly asking to move on — after this, stalling is a failure. */
  explicitNextStep:
    /\b(?:how (?:do|can|should) (?:we|i) (?:proceed|move forward|get started)|what (?:are )?(?:the )?next steps?|what should (?:we|i) do next|ready to (?:proceed|move forward|get started)|please have someone (?:contact|help))\b|(?:下一步|怎么继续|如何继续|怎么开始|如何开始)/i,
};

/**
 * Turns at which the assistant both signalled sufficiency and offered a handoff.
 */
export function convergenceTurns(transcript, patterns = {}) {
  const p = { ...DEFAULT_CONVERGENCE_PATTERNS, ...patterns };
  const turns = [];
  let latestUser = "";
  let index = 0;
  for (const message of transcript) {
    if (message.role === "user") {
      latestUser = message.content;
      continue;
    }
    if (message.role !== "assistant") continue;
    index += 1;
    if (p.sufficiency.test(message.content) && p.handoff.test(message.content)) {
      turns.push(index);
    }
    void latestUser;
  }
  return turns;
}

export function firstConvergenceTurn(transcript, patterns) {
  return convergenceTurns(transcript, patterns)[0] ?? 0;
}

/**
 * Compare observed convergence against what a case expects.
 *
 * `expected` is either `{required: false}` — an exploratory case that should
 * *not* be pushed toward a handoff — or `{required: true, minTurn, maxTurn}`.
 *
 * Converging too early is as much a failure as never converging. An agent that
 * offers the handoff on turn one has not understood anything; it has pattern
 * matched on the presence of a customer.
 */
export function checkConvergence(transcript, expected, patterns = {}) {
  const violations = [];
  if (!expected) return violations;

  const p = { ...DEFAULT_CONVERGENCE_PATTERNS, ...patterns };
  const actual = firstConvergenceTurn(transcript, p);

  if (expected.required === false) {
    if (actual !== 0) {
      violations.push({
        rule: "premature-convergence",
        turn: actual,
        detail: "this case should not converge to a handoff, but it did",
      });
    }
    return violations;
  }

  const min = expected.minTurn ?? 1;
  const max = expected.maxTurn ?? Number.POSITIVE_INFINITY;
  if (actual === 0) {
    violations.push({
      rule: "no-convergence",
      turn: 0,
      detail: `never signalled sufficiency and a handoff together; expected by turn ${max}`,
    });
  } else if (actual < min || actual > max) {
    const window = min === max ? `turn ${min}` : `turns ${min}-${max}`;
    violations.push({
      rule: "convergence-window",
      turn: actual,
      detail: `converged on turn ${actual}, expected within ${window}`,
    });
  }

  // Once the user has asked outright how to proceed, the next reply has to answer.
  let assistantIndex = 0;
  let userAskedToProceed = false;
  for (const message of transcript) {
    if (message.role === "user") {
      userAskedToProceed = p.explicitNextStep.test(message.content);
      continue;
    }
    if (message.role !== "assistant") continue;
    assistantIndex += 1;
    if (!userAskedToProceed) continue;
    const answered =
      p.sufficiency.test(message.content) && p.handoff.test(message.content);
    if (!answered) {
      violations.push({
        rule: "ignored-next-step-request",
        turn: assistantIndex,
        detail: "user asked how to proceed and the reply did not give a complete handoff",
      });
    }
    userAskedToProceed = false;
  }

  return violations;
}
