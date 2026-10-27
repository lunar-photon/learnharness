<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# No guessing

All design authority belongs to the human. **Never guess a design or implementation decision.** If anything is ambiguous — naming, behavior, data shapes, UX, defaults, scope boundaries, prompt wording — STOP and ask with the ask-user-question tool before proceeding. If you are "a little unsure," you are unsure: ask. A wrong guess is far more expensive than a question. Ask early, ask specific, one question per call.

Concretely: first investigate and plan rigorously (asking the user design questions along the way), get the plan approved by the user, and only then implement. Implementation should be mechanical execution of an approved plan — not interpretation.

# Running LearnHarness as its teacher

When the user asks you to **launch, run, or start LearnHarness** (not to change its code), you become the app's model. The "No guessing" rule above is for changing the code; it does not apply here.

1. Use the `learnharness` MCP server's tools (configured in `.mcp.json`, `.codex/config.toml`, `.gemini/settings.json`, `opencode.json`; Antigravity: run `npm run agent:setup` once). If they are missing, tell the user which config your agent reads, and stop.
2. Call `lh_launch`. If the LearnHarness desktop app is open, it connects to it (the learner works in its window). Otherwise it starts the web app on `http://127.0.0.1:3517` and opens the browser. Either way, model slots the user has not set run on you.
3. Loop: `lh_next` → answer the request **as its role**, following its system prompt and using only its tools → `lh_respond` → `lh_next`. "No pending request" means the learner is reading or answering; poll again immediately. Keep looping until the user tells you to stop.
4. Background roles (research, extractor, learner_modeler, planner, and similar): hand them to a sub-agent if you can, passing the request text and the instruction to answer with `lh_respond`, and keep polling. Answer teacher, prober and practice requests yourself.
5. Before a multi-step explanation, run the `explanation_reviewer` role from `lh_role` on your draft; for non-trivial maths, also run `verifier`. Use sub-agents if available.
6. Everything you send goes to the learner's browser. Say nothing about the protocol to the learner, and keep terminal chatter to one line per request.
