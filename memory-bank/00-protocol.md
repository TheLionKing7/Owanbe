# 00 · Memory bank protocol (rules for every agent)

## A. Reading (start of every session)
1. Read `README.md`, this file, and `07-feature-status.md`.
2. If Sage 7 MCP is connected, call `get_answers` (owner answers) and `get_context_status`. Record anything new in `08-decisions.md` and `07-feature-status.md`.
3. Read the topic docs for your task (see the README read order). Open source files only after the map tells you which ones matter.
4. Trust order when sources disagree: **owner's latest instruction > Sage 7 confirmed decisions > `08-decisions.md` > memory-bank docs > `blueprint/` > code comments.** If memory and code disagree, the code is the fact. Fix the memory doc and log it in `10-changelog.md`.

## B. Updating (part of the definition of done, in the same commit as the code)
Do this for every change that adds, removes or alters a file, behaviour, rule or decision:

1. **Find the affected docs.** Run `npm run memory:check`. It lists the changed files and the docs that cover them (the coverage rules live in `index.json`).
2. **Edit those docs.** Facts only, present tense, no speculation. Keep every doc scannable (tables and bullets) and under about 300 lines; split a doc if it grows past that.
   - New or removed file: describe it in `03-codebase-map.md`. The row is added by step 3; you replace `TODO: describe`.
   - Migration: update `04-data-model.md` (table, constraints, RLS, functions).
   - Route, env var, service or flow: update `02-architecture.md`.
   - UI or token: update `05-design-system.md`.
   - New rule or pattern: update `06-conventions.md`.
   - Feature started, reported or audited: update `07-feature-status.md`.
   - Decision or owner answer: update `08-decisions.md` (and add an ADR in `docs/adr/` when it's architectural).
   - Gap, question or gotcha found or resolved: update `09-open-questions.md`.
3. **Run `npm run memory:update`.** It refreshes the map rows and file fingerprints. If it lists files still marked `TODO: describe`, describe them and run it again.
4. **Add one line per change at the top of `10-changelog.md`:** `- YYYY-MM-DD · <agent> · <F-code or chore> · <what changed in memory>`.
5. **Run `npm run memory:check`.** It must pass (it's also part of `npm run ci`).

## C. Writing rules
- Write for an agent with zero context. Name exact paths, functions, tables and routes.
- Record **why** next to **what** when the reason isn't obvious (one clause is enough).
- Never paste secrets, tokens, customer data or long code. Link to the file instead.
- Never record guesses as facts. Put unknowns in `09-open-questions.md`.
- Don't duplicate `blueprint/`. Summarize, and link to the section.
- Mark anything not yet verified against live services as **(unverified)**.
- Keep `index.json` machine-edited only, except for `docs` and `coverage`, which you edit by hand when you add a memory doc or a new top-level area.

## D. Adding a memory doc
Create `NN-topic.md` and add it to the README index table and to `index.json` → `docs`. Add `coverage` patterns that route files to it, then run `npm run memory:update`.
