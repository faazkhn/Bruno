<p align="center">
  <img src="assets/bruno.png" alt="Bruno" width="150" />
</p>

<h1 align="center">Bruno</h1>

<p align="center">
  <b>Your team already does the work. Bruno turns it into automation rules, and proves they work first.</b>
</p>

<p align="center">
  A Forge app for Jira and Jira Service Management · built for Codegeist 2026
</p>

<p align="center">
  <!-- TODO: swap in the real YouTube link once the video is up -->
  <a href="https://youtube.com/"><img src="assets/badges/youtube.svg" alt="Watch the demo on YouTube" /></a>
  <!-- TODO: swap in your Devpost profile link -->
  <a href="https://devpost.com/"><img src="assets/badges/devpost.svg" alt="Devpost profile" /></a>
  <a href="https://developer.atlassian.com/console/install/2ad9d0d3-0fa7-4710-9d84-7183729c9265?signature=AYABeE%2B5bagCWqQZy75SPKgZiGkAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBu8LIB5ww2gYJMGhVs1vcqAAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDOcxD3MHYFxA8HTU6AIBEIA73m1CX8klz%2BLrDldBCSMarZqCTXkAYiaxWeNOMijFh2u6C5CDOIJFkER3Y7vVm0X5DfumF7yzHc6APUMAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgFymBvMCse3sxW8jPHkrUWyAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQM0YndhuUZiWTbmPMCAgEQgDv%2FdqN7S3MMdz3%2BOLX29sTwJRyLDNFf2KJmfcqsDS6oWJjbuSbVCg13m8XnVXKyA0IHLyRWwnUL%2Fdb7pgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAXwe03c%2Fr3Ugq9Xn5qYaCxYAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAw2hyZm60ZoNTDwOMoCARCAO8zEDv%2Bl8EawzD%2Bc%2Ft8jDKB3tJOMVINn4qbPD22conNPCJGTHa9mc3%2BcPd41kgfEcNn2AQbqzzwYZJE2AgAAAAAMAAAQAAAAAAAAAAAAAAAAAHOqH1gzqpwt3p1Br%2FZyf8z%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLoSAVrqd%2FuZZFCEth8oYa5dcy2vFG%2FuUl%2BxQ%2ByreWhqJeBfnChk2Ue6pWoDIIlz3LbjVm5zAeWFDN4ZfAz1FAlytk%3D&product=jira"><img src="assets/badges/install.svg" alt="Install on Jira" /></a>
  <img src="assets/badges/runs-on-atlassian.svg" alt="Runs on Atlassian" />
</p>

---

## The problem

Every service desk has someone who reads "invoice" in a new request and sets the type to Billing. Someone else sees "VPN" and adds the Network component. They do this hundreds of times a month.

Those clicks should be automation rules. Nobody writes the rules, though, because Jira Cloud has no way to test one before it goes live. Once a bad rule has changed a few thousand tickets, you can't undo it.

## What Bruno does

Bruno reads a project's history and spots the things people keep doing by hand. For each one he writes the rule in plain English:

> When a work item is created, if the summary mentions *invoice* and the organization is not *Initech*, set Request type to *Billing*.

Then he tests it. He learns from the first 60 days of history and checks the rule against the last 30, which he never saw while learning. You get a straight answer like *"agreed with your team 557 of the 653 times it would have acted"*, along with the likely range.

If a rule isn't good enough, he shows you where it goes wrong ("most misses are Initech tickets"), suggests a fix, and tests again. If it is good enough, he hands it to your Jira admin as a work item with the rule file attached. Bruno never changes anything in Jira himself. A person always flips the switch.

You can also ask him things in Rovo: *"What do we do most by hand?"*, *"Why isn't the VPN rule ready?"*

## Does it actually work?

These numbers all come from real runs:

| Test | Result |
| --- | --- |
| Rebuild old ticket states from Jira history (500 public Apache issues) | **99.9%** of 3,059 field checks correct |
| Find chores planted in 90 days of simulated history | **4 / 4** found, right trigger and conditions |
| Fix a weak rule using Bruno's suggested exclusion | **70.5% → 85.3%**, on tickets it never saw |
| Import a generated rule into a real Jira site | Imported unchanged, ran live |

## Try it

1. [Install Bruno](https://developer.atlassian.com/console/install/2ad9d0d3-0fa7-4710-9d84-7183729c9265?signature=AYABeE%2B5bagCWqQZy75SPKgZiGkAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBu8LIB5ww2gYJMGhVs1vcqAAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDOcxD3MHYFxA8HTU6AIBEIA73m1CX8klz%2BLrDldBCSMarZqCTXkAYiaxWeNOMijFh2u6C5CDOIJFkER3Y7vVm0X5DfumF7yzHc6APUMAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgFymBvMCse3sxW8jPHkrUWyAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQM0YndhuUZiWTbmPMCAgEQgDv%2FdqN7S3MMdz3%2BOLX29sTwJRyLDNFf2KJmfcqsDS6oWJjbuSbVCg13m8XnVXKyA0IHLyRWwnUL%2Fdb7pgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAXwe03c%2Fr3Ugq9Xn5qYaCxYAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAw2hyZm60ZoNTDwOMoCARCAO8zEDv%2Bl8EawzD%2Bc%2Ft8jDKB3tJOMVINn4qbPD22conNPCJGTHa9mc3%2BcPd41kgfEcNn2AQbqzzwYZJE2AgAAAAAMAAAQAAAAAAAAAAAAAAAAAHOqH1gzqpwt3p1Br%2FZyf8z%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADLoSAVrqd%2FuZZFCEth8oYa5dcy2vFG%2FuUl%2BxQ%2ByreWhqJeBfnChk2Ue6pWoDIIlz3LbjVm5zAeWFDN4ZfAz1FAlytk%3D&product=jira) on any Jira or Jira Service Management Cloud site you admin.
2. In Jira, open **Apps → Bruno**.
3. Pick a project. Choose **Read real history** if it has a few weeks of work, or **Use sample data** to see a labelled 90-day demo. Sample data never writes to Jira.
4. Click any chore to see its proof and the tickets behind each number.
5. On a validated chore, hit **Review & hand off**. Your admin can import the rule under **Settings → System → Global automation → … → Import flows**. It arrives switched off.

## Under the hood

- **Engine:** pure TypeScript, built test-first, with no Forge code in it. It rebuilds any ticket at any point in the past, finds the chores, learns the conditions and replays the rule on held-out tickets.
- **App:** Forge, with Forge SQL and KVS for storage and an async queue for analysis. Everything runs on Atlassian and nothing leaves your site.
- **UI:** Custom UI with the Atlassian Design System, so it looks like the rest of Jira in light and dark mode.
- **Rovo agent and MCP:** read-only tools, plus one hand-off action that always asks first.
- **No AI makes decisions.** Finding chores is plain counting and statistics. Rovo only explains what the engine already worked out.
- **Privacy:** people are stored as salted hashes, there are no per-person stats, and every ticket shown is checked against the viewer's permissions.

## Run it locally

```bash
pnpm install
pnpm -r test
pnpm --filter forge build
cd apps/forge && forge lint && forge deploy -e development
```
