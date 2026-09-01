/**
 * A deliberately imperfect agent, so `npm run example` shows a report worth
 * reading rather than a wall of green.
 *
 * It fails in three ways on purpose, one for each thing the harness is built to
 * catch that a turn-by-turn review would not:
 *
 *   - it piles on questions when the opening request is vague (rule layer)
 *   - it never converges on the case where the user keeps deflecting
 *     (convergence check)
 *   - it converges *sometimes* on one case and not others (variance)
 *
 * No API key, no network. Swap this for an adapter that calls your own agent.
 */

const ENOUGH =
  "I have enough information for an initial brief. If you submit the request, our team will pick it up.";

let coinFlips = 0;

export default async function mockAgent(messages) {
  const userTurns = messages.filter((m) => m.role === "user");
  const latest = userTurns.at(-1)?.content ?? "";
  const turn = userTurns.length;

  if (/reporting|dashboard|spreadsheet/i.test(latest) && turn === 1) {
    // Four questions in one breath. The rule layer catches this.
    return {
      reply:
        "Happy to help. Which reporting tool are you on? How many people use it? " +
        "How often does it refresh? And what breaks today?",
    };
  }

  if (/just looking|browsing|not sure yet|no thanks/i.test(latest)) {
    // Correctly stays exploratory and does not push a handoff.
    return {
      reply:
        "No problem at all. Plenty of people start by working out what they need. " +
        "If it helps, the usual starting point is a short description of what takes the most time today.",
    };
  }

  if (/never mind|maybe later|i'll think/i.test(latest)) {
    // Keeps circling. Never converges. Only visible across the transcript.
    return {
      reply: "Understood. Would it help if I described a couple of options first?",
    };
  }

  if (/how do we (?:get started|proceed)|next steps?/i.test(latest)) {
    coinFlips += 1;
    if (coinFlips % 2 === 0) {
      // Half the time it answers the question, half the time it stalls.
      // That is a flapping case, not a failing one, and the report says so.
      return { reply: "Could you tell me a little more about your timeline first?" };
    }
    return { reply: `Based on what you have described, this looks like a scoped one-off piece of work. ${ENOUGH}` };
  }

  if (turn >= 2) {
    return {
      reply: `Thanks — that is clear. From what you have described this looks like a repeatable workflow rather than a one-off. ${ENOUGH}`,
    };
  }

  return {
    reply:
      "Thanks for the detail. From what you describe, the slow part is likely the manual step in the middle. " +
      "What does that step involve today?",
  };
}
