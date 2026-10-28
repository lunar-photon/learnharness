# Question principles — what a teach-phase check must be

These govern `type: "check"` questions (and explain). Predictions have their own doctrine — the predict/check cycle file — and deliberately violate the first two principles: they are about the untaught next step, and guessing IS the point.

Every check exists to answer one question: did the idea actually **take** — not whether he can read it back. The principles:

- **Answerable by reasoning from the session.** Every check must be answerable by reasoning from what the session has covered — never require anything he couldn't have gotten from the lesson itself. A check he has no route to is not a check, it's a coin flip.
- **Never just reciting your words back.** A check that only asks him to parrot the sentence just above it is copywork, not evidence.
- **Prefer problems that apply the knowledge.** The strongest evidence that an idea took is seeing it USED — applied to a new case, used to predict something, extended somewhere it hasn't been. Reach for applied questions first; when the idea genuinely can't be applied, an honest recall check is fine — but it's the fallback, not the habit.
- **Catch confusion early, and make it nameable.** Design checks so a miss TELLS you which wrong model he holds — in a multiple-choice check each wrong option is the answer he’d give under a specific wrong model; in a free-recall check his own words reveal it. Diagnose and repair before building anything on top of it.
- **Test the key link.** One check per explanation, so make it count: aim it at the transition the whole explanation turns on (the step a wrong model would get wrong), not at its first or easiest fact.
- **A miss names the broken link.** Read the answer and thinking for which link failed: the starting point (the familiar concept wasn't actually held), a step (a transition didn't follow for them), or the notation (they couldn't read the representation). Repair that link, not the whole explanation.
- **His answer is signal, not verdict.** A lucky right answer is nothing; a wrong answer on an honest check is gold — confusion caught early is cheap to fix.

## Options that can only be picked by knowing

A multiple-choice check is worthless if the right option can be found without the idea: by its length, by its being the only one in the session's notation, by echoing the question, or by being the only "reasonable-sounding" one. So:

- **Every wrong option is a real mistake with a name** — the answer a learner holding one specific wrong model would choose: a sign error, \(\mathbf K\) where \(\mathbf K^{\mathsf T}\) belongs, a dropped term, the inverse applied on the wrong side, `i <= n` for `i < n`, a mutation where a copy was meant. Know which misconception each one stands for, and write it into that option's `misconception` field: a miss then returns it to you to refute.
- **All options share one form**: the same length, notation, structure and level of detail. No option is the only one with a boxed result, a hedge, a unit, or a familiar phrase from your teaching.
- **The question text never contains the answer**, and no option is ruled out by the question's own wording.
- **Before you send it, cover the question and read only the options.** If someone who doesn't know the topic could pick the right one from the options alone, rewrite them. The verifier role runs the same test when you check a non-trivial question.

## Tap formats for derivations and code

Writing a derivation or a program on screen is slow; choosing is fast. The `quiz` tool's `format` turns a check into a Duolingo/Mimo-style exercise built from `lines` (displayed maths or code; set `language` for code). The options hold the candidate pieces, and the rules above apply to them in full:

- **`next_step`** — `lines` is the derivation or program so far; the options are candidate next lines; `correctAnswer` is the right one. Best for "what follows from this?".
- **`fill_blank`** — `lines` contain exactly one `___`; the options are what could fill it (tiles that look alike: \(\mathbf K\) vs \(\mathbf K^{\mathsf T}\) vs \((\mathbf I+\mathbf K)^{-1}\)).
- **`order`** — the options are the lines of a correct derivation or function **in the correct order** (the app shuffles them); the learner taps them into order. `lines` (optional) is the fixed setup above them. Every line must be needed and the order must be forced by the logic, not by numbering or prose cues.
- **`spot_error`** — the options are the lines of a worked derivation or snippet, in order, with exactly one wrong; `correctAnswer` is the wrong line. The error must be a plausible one (a misconception, not a typo).

**Fade the worked example within a node** (worked examples first, then completion problems, then solving alone; Renkl & Atkinson): teach a method with one fully worked example; the node's next check is that method on a new case with one step blank (`fill_blank` or `next_step`); the one after leaves more to the learner (`order`, `spot_error`); and the node closes on a check with no worked lines at all. A miss steps back one rung, never to the start. The app's spaced reviews fade the same way across days.

Choose the format that tests the key link of the explanation; plain multiple choice stays the default. Climb Bloom's levels across a node's checks where the topic allows: recall and explain first, then apply (next step, fill the blank), then analyse (spot the error, order the steps), then evaluate.

