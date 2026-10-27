# Plan — terminal agent as the teacher ("external driver")

Status: **proposal, awaiting owner approval** (2026-10-26). Nothing here is implemented.

Owner decisions already made: the terminal agent drives the harness; API-key/subscription engines stay as an
untouched fallback; one check per explanation (replaces "one check per reasoning step", methodology §9);
Claude Code, Codex CLI, Gemini CLI, opencode and Antigravity (`agy`) supported from day one.

## 1. The idea in one paragraph

The connected agent becomes a **model provider** (`provider: "external"`), not a replacement for the harness's
loops. Every place the harness already calls a model — prober, teacher, practice, research, extraction,
compaction — and the new roles below produce a **request** (role, system prompt, tool schemas, message delta)
parked in one queue. The terminal agent pulls requests over MCP, answers each one (text and/or tool calls), and
the harness carries on exactly as if an API had replied: same tool validation, plan tree, question UI,
persistence, single writers. Agents with sub-agents (Claude Code, opencode) fan requests out in parallel;
agents without them answer sequentially. No API key, no per-agent adapter beyond a config file.

```
learner ⇄ browser UI ⇄ harness (orchestration, stores, prompts, tool validation)
                          │ request queue (role-tagged)
                          ▼
              lh-mcp (stdio, per agent) ⇄ terminal agent ⇄ its sub-agents
```

## 2. Components

### 2.1 External engine — `src/agent/external-engine.ts` (new)
- A `StreamFunction` (same shape as `subscription-stream.ts`) that parks `{requestId, chatId, role, systemPrompt,
  tools, messages}` in a `globalThis` registry (the `turn-liveness` pattern) and resolves with an
  `AssistantMessage` built from the agent's reply. Abort resolves the parked request as `aborted`.
- If no agent has polled within 20 s the stream errors with "no agent connected — ask your terminal agent to
  launch LearnHarness" (shown in the UI by the existing error path).
- Wired in `piEngineForSpec` (`src/agent/models.ts:100`) as one more provider branch. Thinking level "off",
  usage zero (prices render absent — honest).
- Model id = the connected client's MCP `clientInfo.name` (e.g. `claude-code`), so the existing Claude-specific
  `send_to_user` switch (`teacher-agent.ts:205`) keeps working.
- Selecting it: "External agent" in the model picker / slots. Setting the strong *and* cheap slots to it routes
  all background work (research, extraction, grading) through the agent too. Vision slot likewise if the agent
  is multimodal.

### 2.2 Driver routes — `app/api/driver/*` (thin, over the server barrel)
| Route | In | Out |
|---|---|---|
| `GET /api/driver/next?timeoutMs=` | — | oldest parked request, or 204 on timeout |
| `POST /api/driver/respond` | `{requestId, text?, toolCalls?:[{name, arguments}]}` | `{ok}`; 409 if stale |
| `GET /api/driver/status` | — | connected client, queue length, open sessions |

`messages` in `next` is the delta since that chat's last answered request plus, on first contact or
`?full=1`, the whole context — the agent's own context stays small. Server mints tool-call ids.

### 2.3 MCP server — `scripts/lh-mcp.mjs` (new, dependency-free)
Hand-rolled JSON-RPC over stdio (initialize, tools/list, tools/call, ping) — no SDK dependency for ~150 lines.
Tools:
- `lh_launch` — starts the app if not running (`next dev`/`next start` in the repo), waits for health, opens the
  browser, returns the URL.
- `lh_next` — long-polls `/api/driver/next` for up to 5 min (`LH_POLL_MS`), then returns "nothing yet, call again" (sidesteps every
  client's tool timeout).
- `lh_respond` — posts the reply.
- `lh_role(name)` — returns a role's instructions (for agent-side roles, §3).
- `lh_status`.
One generic `next/respond` pair rather than one MCP tool per app tool: app tool schemas travel inside the
request, so the MCP surface never changes when app tools do.

### 2.4 Launch and per-agent config
- `npm run agent` = `lh_launch` from the shell.
- Project config pointing at `node scripts/lh-mcp.mjs`: `.mcp.json` (Claude Code), `.codex/config.toml`
  (Codex), `.gemini/settings.json` (Gemini CLI), `opencode.json` (opencode).
- Antigravity (`agy`) has only a global MCP config (`~/.gemini/config/mcp_config.json`), so
  `npm run agent:setup` registers it once: `agy mcp add learnharness node <repo>/scripts/lh-mcp.mjs`.
  Stdio (not an HTTP MCP route inside the app) so the agent can start the app itself via `lh_launch`.
- `AGENTS.md` gains a "Run LearnHarness as teacher" section (the loop: launch → `lh_next` → answer the request
  in its role, using sub-agents for parallel/background roles if available → `lh_respond` → repeat until the
  learner ends). `CLAUDE.md` and `GEMINI.md` import it.
- Usage: open the agent in the repo, say "launch learnharness".

## 3. Roles (multi-agent)

| Role | Scheduled by | Writes | New? |
|---|---|---|---|
| prober | harness (existing) | chat record | no |
| teacher | harness (existing) | chat record, plan tree | prompts rewritten (§4) |
| planner | harness: at `probe_done`, and when the learner-modeler flags a plan-relevant change | plan tree (existing plan ops) | yes — split from teacher's first turn |
| learner-modeler | harness: background after each learner answer / thinking / feedback | learner profile (§5) | yes |
| explanation-reviewer | agent-side, before a multi-step explanation is sent | nothing (returns fixes) | yes |
| verifier | agent-side, when an explanation contains non-trivial maths | nothing (CAS check) | yes |
| research, extraction, practice, compaction | harness (existing) | as today | no |

**As built (2026-10-27):** the planner is *not* a separate agent. The teacher already owns planning
(`teacher/10-planning.md`, `plan_init`); instead the learner profile is appended to the teacher's system prompt
every turn with the rule "when it contradicts the current plan, revise the plan with `plan_init`", so planning
updates as the learner-modeler learns. A separate planner would duplicate the planning doctrine.

Harness-scheduled roles are queue requests. Agent-side roles are instructions from `lh_role`, run as a
sub-agent where the agent has them, inline otherwise. Every role file lives in `src/agent/prompts/roles/` so
the same text serves the internal engines too.

## 4. Teaching doctrine from the owner's guide

- `shared/10-voice.md` and `teacher/20-teaching.md` rewritten from the guide (§§1, 2, 4, 6, 7): bridge from what
  the learner holds, nearest starting point, representation from current context, shortest sufficient chain,
  claim status, stop at the right point, never narrate the pedagogy.
- **Example library** `src/agent/prompts/examples/NN-slug.md`, one file per example (generic answer → preferred
  construction → teaching lesson → accuracy constraint). The prompt carries a compact index (title + lesson);
  a new teacher tool `example(id)` fetches the full text for the 1–2 closest cases.
- Check policy: `teacher/30-question-principles.md` and `docs/teaching-methodology.md` §9 changed to one check
  per explanation, testing the key link, with a broken-link diagnosis on failure.
- Guide improvements accepted by the owner (§7) folded into the same fragments.

## 5. Learner profile and feedback

- Store `data/learner/profile.jsonl` (append-only, one writer: the learner-modeler endpoint). Entry:
  `{kind: knowledge|fluency|preference|relationship|outcome, statement, evidence:{chatId, messageId}, date,
  confidence}`. "Context-dependent fluency" is derived from recency at read time, not stored.
- Feedback control on each teacher explanation: **landed / didn't land + why** (reason chips: wrong starting
  point · skipped step · unfamiliar notation · misleading analogy · too much). Stored in the chat record,
  consumed by the learner-modeler; "save as example" promotes an explanation into the example library.
- The teacher and planner prompts receive the profile summary at session start (same injection point as the
  graph context).
- **Explanation pairs** (owner, 2026-10-26): when a discussion around an explanation settles — the learner
  marks a later explanation "landed" after an earlier one did not, or accepts a re-explanation — the session's
  *first* explanation and the one the learner *liked* are recorded as a pair (message ids + topic). The
  explanation-reviewer role reads each pair, names what changed (starting point, representation/notation,
  added step, analogy and its limit, length), writes that as a dated `preference` entry with the pair as
  evidence, and adds the pair to the example library as a learner-sourced generic-vs-preferred example. The
  reviewer thus has two jobs: pre-send review of drafts (agent-side) and post-hoc style extraction
  (harness-scheduled).

## 6. Order of work and gates

1. **Engine + routes + MCP + configs + launch.** Gate: a full probe → teach session in the browser driven by
   Claude Code, opencode and Antigravity `agy` (all installed here), existing prompts unchanged.
2. **Doctrine + example library + check policy.** Gate: same topic taught before/after; the after-run follows
   the preferred pattern of the closest example.
3. **Planner + learner-modeler + profile store + feedback UI.** Gate: profile entries appear with evidence;
   plan revises after a contradicting answer.
4. **Agent-side reviewer + verifier role files.**
5. **Exam preparation** (owner, 2026-10-26; design questions pending, see §6a).

## 6a. Exam preparation (draft — awaiting owner answers)

Purpose: if the agents ever pose a past-year-question (PYQ)-level question, the learner answers it without
difficulty. Everything in this part serves that one goal.

- **PYQ bank first.** Before planning, a research job collects the exam's PYQs (year, section, question,
  official key/solution where published, source URL) into `data/exams/<exam>/pyq.jsonl`, tags each with the
  propositions it needs and a difficulty estimate, and derives the topic weightage. Some PYQs are **held out**
  and never used for teaching or generation — they are the readiness benchmark.
- **Planning from the bank.** The planner orders topics by weightage × weakness; teaching sessions target the
  propositions PYQs actually use.
- **Timed tests (computer-based-test UI).** Question palette (answered / marked for review / not visited),
  countdown timer, the exam's question types and marking (e.g. MCQ/MSQ/NAT, negative marking), submit →
  analysis (score, accuracy and time per topic, wrong-answer review with solutions). Every test is freshly
  generated, at or above PYQ difficulty, weighted toward the learner's weak topics, with each new question
  solved and verified by the agent before it is posed.
- **Answers feed the plan.** Right/wrong + time + confidence per question update a per-topic mastery estimate
  in the learner profile; misses become plan nodes or practice retests (spaced, fresh surface).
- **Learning science, kept motivating.** Short adaptive quizzes ride Practice's ~85% band (desirable
  difficulty without despair); full mocks run at real-exam difficulty, spaced across days; feedback is
  error-specific and framed as progress against the learner's own past, not a verdict on them; every miss is
  retested; confidence calibration is reported. Readiness = performance on held-out PYQs, tracked over time.
- **Calibrated, not comforted** (owner, 2026-10-27). Difficulty is never lowered to make the learner feel
  good. Each answer carries a confidence rating; the report shows confidence vs. actual accuracy per topic, and
  the next quiz targets both overconfident topics (high confidence, wrong) and underconfident ones (low
  confidence, right), so the learner ends neither over- nor under-confident. After every test the learner is
  told plainly that the coming lessons are being planned from these results, with the one goal of raising
  their exam score, and shown which topics those lessons will target.
- **Gamified like Duolingo** (owner, 2026-10-27): daily goal and streak (with a streak freeze), XP for
  attempts, accurate answers *and* well-calibrated confidence (so guessing doesn't pay), a per-topic mastery
  level that rises only on spaced, fresh-surface retests, and a readiness meter driven by held-out PYQ
  performance. Rewards track effort and real progress, never difficulty avoidance.

## 6b. Exam preparation — detailed design (awaiting owner approval)

**Material.** `PYQ/<exam>/` (repo root, contents git-ignored; `PATHS.pyq`) holds the learner's papers, keys and
notes. `PYQ/CGL/` ships on this machine: MPSC Combined Group B & C papers + keys 2017–2026 (bilingual scans) and
`RESOURCES.md`. Question papers have no text layer, so extraction is vision-based.

**Session kind `exam`.** "Exam prep" on the new-session screen opens a chat with an exam agent
(`prompts/exam/`), like Practice. The agent:
1. Settles the exam: name, folder in `PYQ/`, pattern (sections, question types MCQ/MSQ/numeric, count, duration,
   marking incl. negative marking), syllabus topics — from the folder's notes, asking only for what's missing.
   Tool `exam_define` writes `data/exams/<id>/exam.json`.
2. Builds the PYQ bank: one background `pyq_extract` job per paper (paired with its key by name) renders pages,
   reads them with the vision model, and submits items `{year, paper, number, question (English; Marathi kept
   as a second field when present), options, answer from the key ("#" = cancelled → skipped), topics,
   difficulty 1–5, source file + page}` to `data/exams/<id>/pyq.jsonl`. Cached: a paper is extracted once.
   With web search on, the agent may also look for more PYQs (source URL kept).
   **Held out:** a deterministic 20% of items (by id hash) are never shown in teaching or generation; they are
   the readiness probes.
3. Shows the dashboard card and launches tests (`exam_start_test {kind: "quiz" | "mock"}`).

**Tests** (`data/exams/<id>/tests/<testId>.json`).
- *Quick quiz*: 10–20 questions, 10–25 min, weighted to weak topics, overconfident topics and retests of past
  misses (fresh surface, ≥1 day later).
- *Full mock*: the real pattern, length and timer; topic mix follows PYQ topic frequency; includes 2–3
  held-out PYQs as readiness probes (each used once).
- Generation (`test_generator` role, background): from the pattern, per-topic mastery, calibration gaps and
  non-held-out PYQ exemplars for the chosen topics. Every question is at or above the matching PYQ's difficulty,
  solved by the generator before it is posed (verifier role for numeric answers), and never a copy of a PYQ.
  Difficulty is never lowered for a struggling learner: support comes from the lessons planned after the test.
- **CBT page** `/exam/<id>/test/<testId>`: countdown timer (auto-submit at zero), question palette (not
  visited / answered / marked for review / answered + marked), MCQ radio, MSQ checkboxes, numeric input, a
  confidence choice per answer (50/70/90/100%), Save & next, Mark for review, Clear, Submit with confirmation.
  Keyboard-operable; answers saved as they are given, so a reload resumes with the remaining time.

**After submitting** — result page: score with the exam's marking, accuracy and time per topic, a calibration
table (stated confidence vs actual accuracy, flagging over- and under-confidence), every question with the
correct answer and worked solution, XP earned, streak, and the message: *"Your next lessons are being planned
from these results, with one goal: raising your score in the real exam,"* listing the topics they will target
with a "Start a lesson" button per topic (opens a teaching session seeded with the missed questions). Attempts
feed the learner profile (misconceptions) and the next quiz's retests.

**Progress, all derived from `attempts.jsonl` (nothing stored that can be recomputed):**
- *Daily goal*: questions answered per day (default 20, settable). *Streak*: consecutive days meeting it; one
  missed day per rolling 7 days is covered automatically (the freeze).
- *XP* per answer: 1 for attempting + 2 if correct + up to 2 for calibration, `2·(1 − (c − y)²)` with
  confidence c and correctness y. Confident-and-right earns most, honest "unsure" beats a confident wrong
  answer, and guessing earns less on average than knowing.
- *Topic mastery* 0–5: a recency-weighted Beta estimate of accuracy at PYQ level, mapped to levels. A level
  rises only if the last rise was at least a day earlier (spaced) and on questions the learner has not seen.
  A miss can lower it.
- *Readiness meter*: estimated score on held-out PYQs (first attempts only), with its uncertainty, tracked
  over time. Until enough probes exist it says "not enough evidence yet".

**As built after the live run on PYQ/CGL (2026-10-27):** the exam agent has no `pdf` tool (it kept choosing
the prose summary over `exam_extract_pyqs`) and composes only the shared fragments for tools it holds; papers
finishing extraction wake the session (`exam-update`, `papers-read`) so it offers the quiz itself; extraction
sends the key as images only and keeps the extractor's notes (e.g. a disputed official answer); per-topic
results count each question once, under its main topic. Live result: the 2023 Prelim (40-page bilingual
scan) gave 98 questions whose answers all match the official final key, series A; Q19 and Q74, cancelled in
the key, were dropped.

**Build order:** core contracts + pure progress maths (tests first) → exam store → exam agent + tools + PYQ
extraction job → test generator role → CBT page → result page → dashboard + gamification → live run on CGL with
a real agent.

Owner decisions (2026-10-27): generic exam patterns (the learner describes types/time/marking once); PYQs
from both agent collection and learner-supplied files; both short adaptive timed quizzes and full mocks;
built right after phase 3.

Each phase: `npm run typecheck`, `npm run lint`, `npm test` green, plus new tests — a faux-driver round trip
(`chat-flow.test.ts` style), an MCP stdio smoke test, the profile store.

## 7. Out of scope for v1 / risks
- **Electron desktop**: its per-launch API secret (`proxy.ts`, `desktop-access.ts`) blocks the MCP process. v1
  is browser mode only.
- **Codex and Gemini CLI** are not installed here: their configs ship untested until the owner runs them.
- Demo/visual builders verify with headless Chrome locally; they work through the queue but are slow.
- The teacher's answer quality now depends on the connected agent following the role prompt; the
  reviewer role is the guard.
- This is a fork of upstream AGPL LearnHarness; work goes on a branch to keep upstream merges possible.
