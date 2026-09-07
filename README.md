# conversational-agent-eval

Evaluate a conversational agent the way you would evaluate a person doing the
same job: check the things that are checkable, judge the things that need
judgement, and do it more than once because the answer changes.

```bash
npm test              # 31 tests, no API key, no network
npm run example       # runs a deliberately flawed mock agent
```

```
FAIL   C01    0/3  Vague reporting request
         max-questions (turn 1): asked 4 questions, limit is 2
FLAPS  C02    2/3  User asks outright how to proceed
         no-convergence: never signalled sufficiency and a handoff together
PASS   C03    3/3  Exploratory visitor
PASS   C04    3/3  User deflects repeatedly
PASS   C05    3/3  Well-specified request

5 cases x 3 runs -> 3 pass, 1 fail, 1 flapping
```

Extracted and generalised from the harness behind
**[Pumpkin AI](https://pumpkinsolve.com)**, a deployed assistant holding real
conversations with real visitors. The agent itself is not in this repository;
the method is.

One rule here is not hypothetical. That site tells visitors not to include
passwords, payment information or medical records — so the harness asserts, on
every run and without a model call, that the assistant never asks for them.

---

## Three ideas, and they are the whole point

### 1. Rules first, judge second

Everything checkable by rule is checked by rule, and only what is left reaches a
model.

"Turn 3 asked four questions" is a fact. Handing that to a judge invites an
opinion about it. The rule layer costs nothing, runs in milliseconds, has no
variance, and can therefore run on every commit while the judged suite runs on a
schedule. It covers question count, reply length, Markdown leaking into a
plain-text surface, and — the one that is a safety property rather than a style
one — **whether the agent ever asks a member of the public for a password, a card
number, an ID number, or medical records.**

When a rule and the judge disagree, the rule is right. That disagreement is the
signal that the judge prompt needs work.

### 2. Convergence is a property of the transcript, not of a turn

This is the failure that turn-level review structurally cannot see.

An intake agent can be helpful, well-mannered and correct on every single turn,
and still be useless — because it asks one more clarifying question forever and
never says *"I have enough, here is the next step."* Score each turn and every
turn passes. The conversation fails.

So convergence is measured over the whole transcript. A turn converges when it
does **two things at once**: signals it has enough to act on, and offers a
concrete next step. Either alone is not convergence — "I think I understand" that
then asks another question has not converged, and "get in touch any time" without
the first half is a brush-off.

Cases declare a window:

```markdown
### Expected Convergence
turns 2-3
```

Converging too *early* fails too. An agent that offers the handoff on turn one
has not understood anything; it has pattern-matched on the presence of a
customer. And `none` marks the exploratory cases — a visitor who says "just
looking" should not be pushed toward a form, and an agent that does it anyway is
failing, not succeeding early.

### 3. Run it more than once, and report flapping separately

Agents are not deterministic. Run a suite once and you get a number; run it again
and you get a different one. The single-run number is the one people quote and
the one that hides the problem.

Every case runs `--runs N` times and lands in one of three buckets:

| Verdict | Meaning |
|---|---|
| **pass** | passed every run |
| **fail** | failed every run |
| **flaps** | passed some, failed others |

**A case that passes two runs out of three is not a passing case.** It is a
flapping case, it will fail in front of a user eventually, and the fix for it is
different from the fix for a failing one — so it gets its own bucket rather than
being rounded into a pass rate. Flapping fails the exit code.

The report also carries the spread between a case's best and worst judged score,
which is the cheapest available measure of how much of the score is real.

There is a test asserting that a single run cannot tell flapping from passing.
That is not a bug being documented; it is the argument for the feature.

---

## Using it

Write cases in Markdown, because the people who know what the agent should say
are rarely the people who want to edit JSON, and a case should be reviewable in a
pull request by someone who has never opened this repository.

```markdown
## C02 - User asks outright how to proceed

### Turns
1. We want to automate invoice matching between two systems.
2. How do we get started?

### Must Do
- Answer the question about getting started directly.
- Name a concrete next step the user can take.

### Must Not Do
- Ask a further clarifying question instead of answering.

### Expected Convergence
turns 1-2
```

Point the harness at your agent. The adapter is one function:

```js
// my-agent.js
export default async function agent(messages) {
  const response = await callYourThing(messages);
  return { reply: response.text };
}
```

```bash
npx agent-eval --cases ./cases --agent ./my-agent.js --runs 3 --report out/report.md
```

Add `--judge ./my-judge.js` for the scored dimensions. Without it the rule and
convergence layers still run, with no API key and no network — **that is the
configuration to put in CI**, and it catches the majority of regressions on its
own.

### The judge, when you want it

Five dimensions, scored 0 / 1 / 2 — absent, partial, present.

`understanding` · `immediateValue` · `focusedQuestions` · `servicePath` ·
`boundaries`

Two constraints hold it together. **Three points, not ten**: a finer scale
invites the judge to express confidence it does not have, and the extra
resolution does not survive a second run. **Evidence before score**: each
dimension names the turn it is judging from before it produces a number, because
in the other order you get a number and then a rationale assembled to fit it.

Judge output is normalised defensively — a model that returns a string where a
number belongs degrades to a zero and a report line, rather than throwing halfway
through a suite that costs money to re-run. A judge that errors outright is
recorded and does not fail the case; a `mustNotViolations` finding does.

## Layout

```
src/cases.js          Markdown case parser
src/deterministic.js  the rule layer — no model calls
src/convergence.js    convergence detection and window checking
src/judge.js          prompt, schema, defensive normalisation
src/evaluate.js       orchestration, repeated runs, flapping
src/report.js         Markdown and console reports
bin/evaluate.js       CLI
examples/             a mock agent that fails in three specific ways, and cases
```

The example agent fails on purpose — piling on questions, never converging when
deflected, and converging only half the time on one case — so `npm run example`
produces a report worth reading instead of a wall of green.

## Limits

- **The convergence patterns are English and Chinese, and narrow.** They are the
  part you will need to adapt. Narrow is deliberate: a missed convergence shows
  up as a violation you can read and fix, while a pattern loose enough to match
  ordinary politeness reports success that is not there.
- **Passing this suite is not evidence the agent is good.** It is evidence the
  agent does not do a specific list of bad things, on a specific list of cases.
- **The rule thresholds are defaults, not findings.** Two questions per turn and
  230 words came from one product's transcripts. Yours will differ; they are
  arguments to `findViolations`.
- **Three runs is a small sample.** It is enough to separate "always" from
  "sometimes", which is the distinction that matters most, and not enough to put
  an interval on anything.
