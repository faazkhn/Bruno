<img src="assets/bruno.png" alt="Bruno, a smiling cartoon man with curly hair, round glasses and a beard" width="120" align="right" />

# Bruno

**Automation rules proven on your team's past tickets, before they go live.**

## Inspiration

It started with a question that sounds simple: how do you test a Jira Automation rule before you switch it on?

You mostly can't. Atlassian's own docs say Cloud automation has no test mode; the usual workaround is to run the rule by hand on one ticket and hope. "Preview or dry run a rule" has been a feature request for years. And once a rule has changed tickets, there is no undo. We read about a stale-ticket rule that closed around 2,000 live tickets and emailed every reporter. Nobody wanted that rule to be wrong. They just had no way to see it coming.

The first version of this project was a replay engine for rules people had already written. While building it we kept noticing the other half of the problem: most teams don't have a pile of rules waiting to be tested. They have a pile of clicks. Someone reads "invoice" in a request and sets the request type to Billing. Someone sees a VPN ticket and adds the Network component. Hundreds of times a month, by hand, because writing a rule feels risky and nobody has time to check it properly.

So we flipped it around. Instead of asking people to write a rule and trust it, Bruno looks at what the team already does, writes the rule for them, and proves it on tickets it has never seen. Only then does anyone have to decide whether to switch it on.

We called him Bruno because he is the colleague who has quietly watched how your team works for years, and finally says: "You've done this one 1,988 times. Want me to take it?"

## What it does

Bruno lives inside Jira and Jira Service Management. Open **Apps → Bruno** and he will:

- **Find the chores.** He reads a project's history (changelogs and comments) and counts the actions people repeat by hand, like setting a request type, adding a component or moving a ticket to In Progress when a customer replies. Counting, not guessing.
- **Write the rule.** For each chore he finds the trigger and up to three conditions that were true *at the moment the trigger happened*, and says it as one sentence: *"When a work item is created, if summary mentions invoice and Organization is not Initech, set Request type to Billing."*
- **Prove it on tickets he never learned from.** He learns on the first two thirds of the history and tests on the last third. The headline is honest: *"agreed with your team on 557 of the 653 times it would act"*, with the likely range next to it (82–88%), because 17 out of 20 is not the same thing as 557 out of 653. A rule is only called *Validated* when even the cautious end of that range clears the bar.
- **Know when not to automate.** Labels and categories need 80% agreement, priority and status moves need 85%, and closing or resolving work is never recommended. Anything he can't model counts against the rule, never for it.
- **Explain his misses.** When a rule falls short he shows why, for example *"most of the mistakes are organisation Initech"*, suggests one exclusion, and re-tests the new version on the same untouched tickets.
- **Hand it to your admin.** He creates a work item with a short review checklist, the evidence and a rule file your admin imports through Global automation. It arrives switched off. Bruno never changes anything in Jira on his own.
- **Keep watching.** Rules that aren't switched on yet run in *shadow mode* on new tickets. Rules that are live tag every run, so the weekly view shows what automation did and where a person quietly undid it.
- **Talk.** Ask the Bruno agent in Rovo *"What do we do most by hand?"*, *"Why isn't the VPN chore validated?"* or *"What if we left out Initech?"*. The same read-only tools are available to outside agents over MCP.

Every number on every screen comes from a real run of the engine, and every number clicks through to the tickets behind it.

## How we built it

Bruno is built entirely on Forge and Runs on Atlassian. No data leaves your site, there are no outside services, and no AI decides anything.

- **A pure TypeScript engine** with no Forge code in it, built test-first. It rebuilds any ticket's fields at any past moment, evaluates a small subset of JQL with three-valued logic (unknown is never treated as safe), finds chores, picks triggers, learns conditions, replays rules on held-out tickets and writes the native rule file.
- **A Forge app** around it: ingestion and analysis run on an async queue, history is stored in Forge SQL, settings in KVS, triggers keep it up to date, and a nightly job re-analyses and clears out old data.
- **Custom UI with the Atlassian Design System**, so it looks like the rest of Jira in light and dark mode. A global page for the home, a project page, an admin page and a small panel inside tickets.
- **A Rovo agent with five actions** (four read-only, one that creates the hand-off and always asks first) and an MCP server exposing the read-only ones.
- **Permissions everywhere.** Before any ticket key, snapshot or history leaves the backend, Bruno checks that the person looking can actually browse that ticket. Actors are stored as salted hashes, and there are no per-person stats.

We also built a small history bot that files realistic support requests on a demo site every 15 minutes, with chores planted in it, so we could check that Bruno finds what we know is there.

## Challenges we ran into

**Jira's history is messier than it looks.** Ids that change after a site migration, fields that log a delta in one place and a full list in another, timestamps in two formats. Our reconstruction test caught every one of these. It went from 97.7% to 99.9% once we learned to resolve renamed values by name.

**The obvious trigger is usually wrong.** "Work item created" comes before almost everything, so a naive search picks it for every chore. We had to choose triggers by how well they predict the action, not just how often they appear.

**The rule file format isn't really documented.** Our first generated rule failed to import with a vague error. We built the same step by hand in the rule editor, read it back, and found the right component name. Then the importer rejected the file again, so we removed fields from a real export one at a time until we found the two it actually requires. The generated rule now imports unchanged and arrives switched off.

**Forge apps can't create automation rules.** So Bruno hands the rule to an admin instead. That turned out to be the right design anyway: a human always decides.

**Small numbers lie.** 85% from 20 cases and 85% from 653 cases are very different claims. Switching every verdict to the lower end of a 95% interval changed one of our own results from "ready" to "not yet", and we kept it that way.

## Accomplishments that we're proud of

- 99.9% of 3,059 field checks rebuilt correctly on 500 public Apache Jira issues.
- All 4 chores we planted in 90 days of simulated history found, with the right trigger and conditions.
- A billing rule that went from 70.5% to a validated 85.3% after one exclusion Bruno found on his own, tested on tickets he never saw.
- A generated rule imported into a real Jira site without edits, switched on, and running live on real tickets, tagging every run.
- An agent that never invents a number. Rovo only repeats what the engine computed, and says plainly when something isn't proven.

## What we learned

- Honest numbers are more convincing than big ones. Showing the misses next to the matches made people trust the matches.
- Testing on tickets the rule never saw changes everything. A lot of rules look great on the data they were learned from.
- "Inconclusive" is a feature. When the engine can't tell, saying so is better than guessing in either direction.
- Building close to Jira's real formats means you learn where the edges are by hitting them. Most of our best fixes came from trying the real thing, not reading about it.

## What's next for Bruno

- Rules based on time, like "waiting for customer for 3 days", which teams ask for constantly.
- More action types and more checks that imported rules behave exactly as predicted over weeks, not days.
- A Confluence page per chore with its proof, so the evidence lives where teams already write things down.
- Working with a few real service desks to see which chores they hand to Bruno first, and which ones they never will.

## Onboarding experience (please read)

1. Install Bruno with the installation link on the Devpost page (any Jira or Jira Service Management Cloud site).
2. In the Jira sidebar open **Apps → Bruno**. Bruno says hello.
3. Pick a project and choose how to start:
   - **Read real history** if the project has a few weeks of work. Bruno reads the last 90 days in the background.
   - **Use sample data** for a first look or an empty project. This loads 90 simulated days with planted chores, a VIP exception and some noise, clearly labelled as sample data. Nothing is written to Jira.
4. Click any chore to see its proof, the tickets behind each number, and a step-by-step replay of any single case. Try **See the fix** on a chore that isn't ready yet.
5. On a validated chore choose **Review & hand off**. Bruno creates a work item for your admin with the rule file attached. To try it, import that file in **Settings → System → Global automation → … → Import flows**. It arrives switched off.
6. In Rovo, mention **@Bruno** and ask *"What do we do most by hand in WT?"* (use your project key).

Each project also gets an **Autopilot** page in its own sidebar with the same view.

## Running it yourself

```bash
pnpm install
pnpm -r test                  # engine, history bot, forge backend
pnpm lint
pnpm --filter forge build
cd apps/forge && forge lint && forge deploy -e development
```
