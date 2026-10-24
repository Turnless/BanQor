# BanQor: build plan

| Wave | Build window | Deliverable | Pool |
|---|---|---|---|
| **Wave 1** | now → **Mon Oct 26, 2026, 16:00** (AKINDO deadline) | **MVP + owner dashboard**, live on Mezo testnet | $2,000 MEZO |
| **Wave 2** | Nov 2 → Nov 15, 2026 (judging Nov 16–22, demo day Nov 23) | Depth: zero-BTC agents, Claude agent, keeper, auto-repay, analytics | $5,000 MEZO |

Related docs: [OVERVIEW.md](OVERVIEW.md) · [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md)

> Plan to submit by **Oct 26 at 12:00**, leaving a 4-hour buffer before the 16:00 deadline. Check the deadline's time zone on the AKINDO page countdown.

---

## Wave 1: MVP + dashboard

### Definition of done

- [ ] `BanQorFactory` + `BanQorVault` deployed and **verified** on Mezo testnet
- [ ] A demo vault with a **real Mezo trove** (BTC collateral, MUSD debt) visible on the explorer
- [ ] `forge test` green: unit + fuzz + fork test against real Mezo contracts
- [ ] `@banqor/sdk` with `createBanQorFetch()` working against the official facilitator
- [ ] Demo x402 API running (`/price`, `/funding`, `/sentiment`)
- [ ] Agent scripts: `setup`, `run` (100+ paid calls, automatic draws), `breach` (cap, pause, unknown agent all revert)
- [ ] **Owner dashboard live at a public URL:** create/open line, line health panel, agents table + policy editor, pause, activity feed, read-only vault view
- [ ] README, a 2-minute pitch video, a short deck, and the AKINDO form filled in

### Day 0: Fri Oct 23 (tonight): setup and risk removal

| # | Task | Output |
|---|---|---|
| 0.1 | Create the repo (pnpm workspaces), Foundry project (`solc 0.8.28`, `evm_version = "london"`), `deployments/31611.json` | Repo skeleton pushed to GitHub (public) |
| 0.2 | Create owner and agent wallets. Get BTC from `faucet.test.mezo.org` for both. Check whether the BTC is enough for a 1,800 MUSD trove at ≥200% ICR | Funded wallets. If short, ask in the Mezo Discord **tonight** |
| 0.3 | **Interface spike:** pull the ABIs for BorrowerOperations, TroveManager, HintHelpers, SortedTroves and PriceFeed from the testnet explorer. Write the Solidity interfaces | `src/interfaces/*.sol` |
| 0.4 | **Fork test spike:** from a contract, open a trove, call `withdrawMUSD`, then `repayMUSD` on a testnet fork | Confirms a contract can be the borrower and pins the exact signatures and fees |

> If 0.4 fails, that's the biggest risk. Fix the interfaces before writing any vault logic.

### Day 1: Sat Oct 24: contracts

| # | Task | Output |
|---|---|---|
| 1.1 | `BanQorVault`: state, `openLine`, owner collateral and debt functions, `setAgent`/`revokeAgent`, `pause`/`unpause`, `setIcrFloor` | Compiles |
| 1.2 | `draw()` with the full policy checks + ICR-floor borrow logic + on-chain hints | Core logic |
| 1.3 | `rebalance()`, `sweep()`, `closeLine()`, and the `lineStatus()` / `agentStatus()` / `maxDrawable()` views | Complete contract |
| 1.4 | `BanQorFactory` | Complete |
| 1.5 | Mocks (BorrowerOperations, TroveManager, PriceFeed, MUSD) + unit tests for every function and error | `forge test` green |
| 1.6 | Fuzz tests: the daily cap invariant, the ICR floor invariant, owner-only access | Green |
| 1.7 | Fork test: full `createVault → openLine → setAgent → draw (triggers borrow) → repay` on a testnet fork | Green |
| 1.8 | `Deploy.s.sol`, deploy to testnet, verify on the explorer, write addresses to `deployments/31611.json` | **Contracts live** |

### Day 2: Sun Oct 25: SDK, API, agent, dashboard core

| # | Task | Output |
|---|---|---|
| 2.1 | `@banqor/sdk`: config loader, ABIs, `ensureFloat()` + draw lock, `createBanQorFetch()` on `@x402/fetch` + `exact` client, price and payee guard, error decoding, `onEvent` | Package builds |
| 2.2 | `apps/api`: Express + `@x402/express` (official quickstart pattern), 3 paid endpoints + `/health`, data cache with fallback | API runs on `:4021` |
| 2.3 | `apps/agent`: `setup.ts` (create vault, open line, register agent, fund agent gas), `run.ts` (N calls with a live console), `breach.ts` | **End-to-end on testnet** |
| 2.4 | Run the full demo once on testnet. Check payments and draws on the explorer | Proof that it works |
| 2.5 | Dashboard scaffold: Vite + React + wagmi (Mezo testnet chain config), connect + network guard, read-only `?vault=` view | Skeleton |
| 2.6 | Dashboard **Line panel** (collateral, debt, ICR gauge, liquidation and floor prices, float) + **Agents table** (spend vs cap bars) | Reads working |

### Day 3: Sun Oct 25 (night) → Mon Oct 26 (until 12:00): dashboard actions, ship, submit

| # | Task | Output |
|---|---|---|
| 3.1 | Dashboard writes: create vault + open line form (ICR preview), add/edit/revoke agent modal, **Pause/Unpause**, add/withdraw collateral, repay, sweep. Transaction status toasts with explorer links | Full owner flow |
| 3.2 | Activity feed from vault logs | Done |
| 3.3 | Responsive pass (mobile width), empty and error states, dark/light | UX polish |
| 3.4 | Deploy the dashboard (Vercel or GitHub Pages) | **Public URL** |
| 3.5 | README: what it is, why it matters to Mezo, architecture diagram, addresses, how to run, "testnet, unaudited" | README |
| 3.6 | Record the 2-minute video (script below) | Video |
| 3.7 | 7–9 slide deck: problem → **the credit line (headline)** → how it works → landscape (vs Mezo Agent Toolkit, Mezher, paywalls, trove guards; see OVERVIEW §3) → demo → why Mezo → architecture (safety as a sub-point) → roadmap → team | Deck |
| 3.8 | Fill in the AKINDO form and submit **by 12:00** | ✅ Submitted |

### Cut list if time runs short (cut in this order)

1. Dashboard dark/light theme and mobile polish
2. Activity feed (link to the explorer instead)
3. `rebalance()` in the dashboard (keep it in the contract and tests)
4. Dashboard collateral withdraw/sweep actions (keep open line, agents, pause and repay)

**Never cut:** the trove-backed draw (an agent borrowing from a real Mezo trove; this is the differentiator), verified contracts, the fork test, the end-to-end agent run, the pause demo, the public dashboard URL and the video.

### 2-minute video script

| Time | Shot |
|---|---|
| 0:00–0:15 | Hook: "Your AI agent needs money. Today you sell Bitcoin or babysit a hot wallet. What if your agent could borrow against your Bitcoin instead?" |
| 0:15–0:40 | **The credit line:** in the dashboard, deposit BTC and open a line, which creates a real Mezo trove owned by the vault (show it on the explorer). Register an agent with a 20 MUSD/day cap |
| 0:40–1:15 | **The agent borrowing:** `pnpm agent run`. Paid calls stream in, the float runs low, `draw` fires, and the trove's MUSD debt goes up live on the dashboard. "That MUSD was just borrowed against my Bitcoin, by my agent, automatically." |
| 1:15–1:35 | **Caps enforced on-chain:** `pnpm agent breach` shows the daily-cap revert. Click Pause, and the next draw reverts. (One sentence: "and it can never borrow past my collateral-ratio floor.") |
| 1:35–1:50 | Why it's new: "Agents can already pay per call on Mezo. Nobody gave them a credit line backed by Bitcoin." |
| 1:50–2:00 | Why Mezo: "Every agent dollar is new MUSD borrowed against Bitcoin." Logo + links |

### AKINDO submission fields (draft)

| Field | Draft |
|---|---|
| Project name | BanQor |
| Category | Agent credit line, BTC-backed borrowing, agent payments |
| TL;DR | BanQor turns your Mezo trove into a credit line for AI agents: they borrow MUSD against your BTC on demand, within caps enforced on-chain, and spend it on any x402 API. |
| How it works | See [OVERVIEW.md](OVERVIEW.md) §2 |
| Target group | Builders and BTC holders running AI agents. Developer-first, desktop. Global |
| Tech stack | Solidity 0.8.28 + Foundry, TypeScript, viem, wagmi, React/Vite, `@x402/*` 2.16.0, Mezo BorrowerOperations/TroveManager/MUSD, x402 facilitator |
| Track | Track 2 (Access & Distribution) + Track 1 (DeFi) |
| Chain | Mezo testnet |
| Status | Entirely new |
| Readiness | Testnet deployment |
| Future milestones | (1) Wave 2: zero-BTC agents, keeper, Claude agent (Nov 15) · (2) Security review + mainnet beta (Dec 2026) · (3) SDK integrations with x402 sellers on Mezo (Q1 2027) |

---

## Wave 2: depth (Nov 2 → Nov 15)

Builds on Wave 1 judge feedback. The resubmission must state clearly what changed.

| Week | Feature | Detail |
|---|---|---|
| **Week 1 (Nov 2–8)** | **Zero-BTC agents** | `drawWithSig` (EIP-712 `DrawRequest`) + relayer service. The agent needs no BTC at all |
| | **Keeper bot + alerts** | Watches vault ICR, calls `rebalance()`, sends Telegram/webhook alerts near the floor |
| | **Claude research agent** | `smart-agent.ts` using `claude-sonnet-5-5` tool calling. Each paid endpoint is a tool and the vault policy is the budget |
| **Week 2 (Nov 9–15)** | **Auto-repay from revenue** | Agents that sell x402 services route MUSD income to the vault to repay the owner's debt |
| | **Idle-float yield (research + prototype)** | Put the vault's idle MUSD to work (for example, the Stability Pool) and withdraw on demand |
| | **Multi-agent analytics** | Indexer (Ponder or Envio), spend history, per-endpoint breakdown, "MUSD borrowed via agents" metric on the dashboard |
| | **Hardening** | More invariant tests, a Slither pass, updated threat model, gas review (clones for vaults, off-chain hints) |
| | **Materials** | Updated video, deck and README with the Wave 1 → Wave 2 changelog |

### Wave 2 definition of done

- [ ] An agent with **0 BTC** completes 100+ paid calls through the relayer
- [ ] The keeper rebalances a vault after a simulated price drop (fork test + live demo)
- [ ] The Claude agent answers a research question by buying data within its budget
- [ ] At least one agent repays debt from its own x402 revenue
- [ ] The dashboard shows historical analytics from the indexer
- [ ] Submission explicitly lists changes since Wave 1

---

## Post-hackathon roadmap

1. **Dec 2026:** external security review, then a mainnet beta with low caps.
2. **Q1 2027:** SDK integrations with x402 sellers on Mezo, and Python/Go SDK ports.
3. **Q2 2027:** organization vaults (multisig owners, many agents), spend reports for teams.
