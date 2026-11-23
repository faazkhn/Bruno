# Wind Tunnel

**Turns a team's repetitive clicks in Jira and Jira Service Management into automation rules, proven against what the team actually did.**

Codegeist 2026 · Apps for Business Teams · Atlassian Forge, Runs on Atlassian (no egress, no external services, no LLM decides anything).

> Automation rules proven on your team's past tickets, before they go live.
>
> Jira can suggest automations. Wind Tunnel finds the work your team repeats by hand, then proves a rule on past tickets it never learned from, before anyone turns it on.

## What it does

1. **Finds chores.** Reads a project's history (changelog + comments) and finds actions people repeat by hand — e.g. *set Request type to Billing*, *add the Network component*, *move to In Progress when the customer replies*. Deterministic mining, no AI guessing.
2. **Learns the rule.** For each chore it finds the trigger (created, customer commented, status changed, field changed) and up to three conditions that were true *at trigger time* — e.g. *summary mentions "invoice"*. Every rule reads as one sentence.
3. **Proves it on a holdout.** Learns on the first two thirds of the window and replays the rule on the last third, which it never saw — at **every** moment the rule could have acted, not just on items people changed: *"agreed with your team on N of the M times it would act"* (precision first), plus where people acted and it wouldn't (recall). Every number clicks through to the real Jira items. It measures agreement with what the team did, not proof the team was right.
4. **Knows when not to automate.** "Proven" needs ≥ 80% precision for low-risk changes (labels, components, request type) and ≥ 85% for priority, assignee and status moves; closing or resolving work is never recommended ("needs judgment"). Anything it can't model is inconclusive, never safe.
5. **Explains and fixes its own misses.** Groups the rule's mistakes **in the learning period** by one trigger-time fact (*"most are organisation Initech"*) and suggests an exclusion only if it explains ≥ 50% and improves the learning-period score. Accepting creates a new version, re-proved on the untouched holdout — so the improved number is still an unbiased test.
6. **Hands off.** Creates a Jira work item for the admin with the evidence, an implementation-ready Automation rule definition (JSON to import — it arrives **disabled** — or recreate by hand) and the steps. Forge apps can't create Automation rules directly, and Wind Tunnel doesn't try; an admin reviews and enables.
7. **Tracks live results.** Generated rules set an issue property (`windtunnel.run`) when they run; Wind Tunnel reports runs and *possible human corrections* (a person set the field back within 24 h of a signed run) every week.
8. **Nudges in the ticket.** Right after an agent does a proven chore by hand, the issue panel shows *"You and N teammates did this M times…"* with Open proof / Send to admin / Not a chore.
9. **Rovo agent + MCP.** Ask *"What do we do most by hand?"*, *"Prove the billing chore"*, *"Send it to our admin"*. Four actions (`list-chores`, `prove-chore`, `send-to-admin`, `replay-rule`); three read-only ones are also exposed through `rovo:mcp`.

Privacy: actors are stored as salted hashes; the only identity ever resolved is the viewer's own ("you and 3 teammates"). No per-person statistics or rankings.

Data: stored items are kept for the analysis window + 7 days, then purged nightly (simulated demo history is regenerated instead). Every example item, snapshot and timeline is shown only after a per-item permission check as the viewer (issue security included); counts stay complete. On uninstall, Forge deletes the app's storage (SQL + KVS): Atlassian keeps it soft-deleted for 28 days for recovery requests, then it is gone ([Forge storage docs](https://developer.atlassian.com/platform/forge/runtime-reference/storage-api/)).

## Accuracy (real runs, misses included — details in [docs/accuracy.md](docs/accuracy.md))

| Test | Proves | Data | Result | Bar |
|---|---|---|---|---|
| A Reconstruction | Past states of an item are rebuilt correctly | 500 public Apache Jira issues (the Public Jira Dataset's source) | **99.90%** (3,056 / 3,059 checks), 3 misses listed | ≥ 99% |
| B Miner recovery | The miner finds planted chores with the right trigger and conditions | 90 days generated from the published history-bot config (4 agents, VIP exception, 7% noise, bulk edits) | **4 / 4** planted chores recovered. Billing: 70.5% → *not yet*; after the exclusion learned on the learning period: **85.3%, proven** on the untouched holdout. Outage stays *not yet* (68.7%, no qualifying exclusion). | ≥ 90% |
| C Live execution | Generated rules behave as predicted on a live site | Demo site, rules imported + enabled | *pending — needs rules imported on the site (see docs/HUMAN_TODO.md)* | per-rule table |
| D Import round-trip | Generated JSON imports without edits | Second project / site | *offline round-trip passes (golden file + parse ↔ generate); live import pending* | 100% |

Reproduce A and B: `pnpm --filter benchmark test-a` and `pnpm --filter benchmark test-b`.

## Judge instructions

**Install:** use the installation link on the Devpost page (Jira, any Jira or JSM Cloud site). Then in any Jira / JSM project: sidebar → **Autopilot**.

**Quickest look (2 minutes), on a project with real history:**
1. Project sidebar → **Autopilot** → **Analyse the last 90 days**. Progress shows by phase (listing → fetching history → finding chores → proving).
2. Click a chore → proof card (learned / proved dates, matches N of M, agreement bar) → click any number → the cases → click an item for the snapshot at trigger time, each condition true/false and the item's own history.
3. If there's a suggested exclusion: **Apply and re-prove**.
4. **Send to admin** → a work item with the rule JSON appears. Import it via Settings → System → Global automation → Import rules (it arrives disabled).

**Project without history?** Two options:
- *Older or imported projects:* ⚙ Settings → Marketplace apps → **Wind Tunnel** (admin page) → enter the project key → tick *End the window at the project's last activity* → save → Analyse.
- *New project, no history:* Autopilot → **Load simulated demo history** (90 simulated days, clearly labelled).
- *Replay an existing rule:* admin page → paste a rule exported from Automation → see what it would have done versus what people did.
- *Grow history:* the history bot (below) runs against your site and plants known chores every 15 minutes.

**Rovo:** open Rovo chat → agent **Wind Tunnel** → "What do we do most by hand in WT?".

## How it works

```
Jira/JSM history ─► [1 Ingest] ─► [2 Mine chores] ─► [3 Prove on holdout] ─► [4 Hand off & track] ─► Autopilot page
                     async queue    candidates         replay, metrics,          work item + rule JSON    Issue panel nudge
                     bulk changelog trigger finder      exceptions               signatures, reversals    Rovo agent / MCP
                     Forge SQL      learner (≤3 clauses)                                                   Admin page
```

- `packages/engine` — pure TypeScript, zero Forge imports, 86 unit tests (TDD): event model, Jira adapter, snapshot builder, JQL subset with three-valued logic (unknown is never "safe"), candidates (bulk edits collapsed), trigger finder, greedy conjunctive learner with keyword widening, holdout replay, exceptions, sentences, native rule JSON generator + parser.
- `apps/forge` — Forge app: manifest, ingest/analyse consumer (async events, `Retry-After`), Forge SQL + KVS storage, resolvers, triggers, scheduled jobs, Rovo agent + actions, MCP. `apps/forge/static/ui` — Custom UI with the Atlassian Design System (`@atlaskit/*`, ADS tokens, light and dark).
- `tools/history-bot` — grows honest demo history on a dev site; its behaviour is published in [`packages/engine/src/sim/config.ts`](packages/engine/src/sim/config.ts) and [tools/history-bot/README.md](tools/history-bot/README.md).
- `tools/benchmark` — tests A and B.
- Design: [docs/superpowers/specs/2026-11-23-wind-tunnel-design.md](docs/superpowers/specs/2026-11-23-wind-tunnel-design.md) · decisions: [docs/decisions.md](docs/decisions.md) · glossary: [docs/glossary.md](docs/glossary.md).

Rules the engine keeps: only facts known at trigger time become conditions; vocabulary and candidate selection use the learning period only; anything that can't be modelled is *inconclusive* and lowers coverage — coverage under 80% blocks hand-off; a proof needs ≥ 10 holdout cases where people acted.

## Develop

```bash
pnpm install
pnpm -r test                  # engine, history bot, forge backend
pnpm lint                     # eslint + typecheck
pnpm --filter forge build     # bundles backend (with engine) + Custom UI
cd apps/forge && forge lint && forge deploy -e development
```

Known limits (honest): the rule JSON format is built from Atlassian's documented export shape and is marked *unverified* until checked against a real export (test D live); time-in-status triggers (C5, e.g. SLA or escalation rules) are out of scope: Wind Tunnel proves rules triggered by events (created, commented, status or field changed), not by elapsed time; the description field's history isn't stored, so description conditions on items whose description changed later are inconclusive.
