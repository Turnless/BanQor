# BanQor: Product Requirements Document

| | |
|---|---|
| **Product** | BanQor: a Bitcoin-backed credit line for AI agents |
| **Chain** | Mezo testnet (chain ID `31611`). Mainnet (`31612`) after the hackathon |
| **Assets** | MUSD (core), BTC (collateral and gas) |
| **Event** | Mezo Buildathon on AKINDO, Track 2 (primary) and Track 1 |
| **Status** | Draft v1, Oct 23, 2026 |
| **Team** | Solo builder |

---

## 1. Summary

BanQor lets a BTC holder give AI agents a **capped, self-refilling MUSD budget backed by their Bitcoin**, without selling BTC and without handing agents a large hot wallet.
- A vault contract owns a Mezo trove.
- Agents draw small MUSD floats under rules enforced on-chain.
- They spend the MUSD on x402 APIs using Mezo's existing facilitator and SDKs.

Problem background is in [OVERVIEW.md](OVERVIEW.md).

### 1.1 Differentiation (drives every priority below)

| Rank | Element | Role in the product | Already in the gallery? |
|---|---|---|---|
| 1 | **Trove-backed credit line for agents**: the owner's BTC in a vault-owned trove, agents borrow MUSD on demand | **Headline / the product** | **No.** No entry combines these |
| 2 | Caps enforced on-chain per agent (daily cap, max float, max draw, expiry, pause) | Makes it safe to hand an agent a credit line | Partly (Mezo Agent Toolkit has operator spend caps, set off-chain) |
| 3 | Pay per call over x402 | What agents use the credit line for. Built on Mezo's official facilitator and SDKs | Yes (Mezo Agent Toolkit, Liqvera, many paywalls) |
| 4 | ICR floor + `rebalance()` | Safety detail so agents can't cause a liquidation | Yes (Lifeline, Trove Guardian, Vigil, Pylon, Lockwatch) |

**Rule for scope and pitch:** when time is short, protect rank 1 first. Pitch materials lead with rank 1, mention ranks 2–3 as supporting points, and treat rank 4 as a safety footnote, never the headline.

## 2. Goals

| # | Goal | How we measure it |
|---|---|---|
| G1 | An agent can pay for x402 APIs on Mezo with no manual top-ups | Demo: 100+ paid calls in a row with automatic draws and zero human steps |
| G2 | An agent can never spend beyond the owner's rules | Every policy breach reverts on-chain (shown by tests and a live demo) |
| G3 | Agent spending can never push the owner's trove below a safe collateral ratio | `draw()` reverts once a borrow would drop ICR below the floor (tests + fork test) |
| G4 | Integrating takes one line for an agent developer | `createBanQorFetch()` replaces `fetch` in the demo agent |
| G5 | The owner can see and control everything from one screen | Dashboard shows the line, agents and activity, with a working pause |
| G6 | It extends Mezo's own stack instead of replacing it | Uses Mezo BorrowerOperations, MUSD, the official facilitator and `@x402/*` with no forks |

## 3. Non-goals (for the hackathon)

- Running our own x402 facilitator or a custom payment scheme. We use `exact` through the official facilitator.
- Mainnet deployment or an audit. This is testnet only and clearly labelled unaudited.
- Collateral other than BTC, and chains other than Mezo.
- A general-purpose smart wallet or account abstraction.
- Fiat on/off ramps.

## 4. Users and personas

| Persona | Description | Main need |
|---|---|---|
| **Owner**: BTC holder or builder running agents | Holds BTC, uses Mezo Borrow, runs one or more AI agents (research bots, trading assistants, automation scripts) | Fund agents without selling BTC, with hard limits and a kill switch |
| **Agent developer** | Writes the agent code (TypeScript) | A drop-in fetch wrapper that pays automatically |
| **x402 seller** (secondary) | Runs a paid API on Mezo (for example, BTC market data) | Buyers that can always pay |
| **Keeper** (secondary) | Anyone running a bot | Calls `rebalance()` to keep vault troves healthy |
| **Mezo** (stakeholder) | Protocol team | More MUSD borrowed, more x402 volume, a showcase of Mezo for agents |

## 5. User stories

### Owner
- **O1.** As an owner, I can deposit BTC and open a credit line (a vault-owned Mezo trove) in one transaction.
- **O2.** As an owner, I can register an agent address with a daily cap, max float, max single draw and expiry.
- **O3.** As an owner, I can set an ICR floor so agents can never push my trove below it.
- **O4.** As an owner, I can pause all agents instantly, and unpause.
- **O5.** As an owner, I can edit or revoke a single agent's policy.
- **O6.** As an owner, I can add collateral, withdraw collateral (staying above the floor), repay debt, sweep idle MUSD and close the line.
- **O7.** As an owner, I can see collateral, debt, ICR, liquidation price, the vault's MUSD float, each agent's spend today against its cap, and a feed of draws.

### Agent developer
- **A1.** As a developer, I can wrap `fetch` with `createBanQorFetch({ agentKey, vault, ... })`. Any x402-protected URL is then paid for automatically.
- **A2.** As a developer, the SDK draws more MUSD only when the agent's balance falls below a threshold I choose.
- **A3.** As a developer, I can set a max price per call and an allowlist of payees, so the SDK refuses unexpected charges before signing.
- **A4.** As a developer, I get clear typed errors (`CapExceeded`, `Paused`, `IcrTooLow`, and so on) when a draw is refused.

### Keeper
- **K1.** As a keeper, I can call `rebalance()` on any vault whose ICR is below floor + buffer. It repays debt from the vault's idle MUSD.

## 6. Functional requirements

### 6.1 Smart contracts (Wave 1)

| ID | Requirement |
|---|---|
| FR-C1 | `BanQorFactory.createVault()` deploys one `BanQorVault` per owner and emits `VaultCreated(owner, vault)` |
| FR-C2 | `openLine(debtAmount, upperHint, lowerHint)` is payable and owner-only. It opens a trove on Mezo `BorrowerOperations` with the vault as borrower. The minted MUSD stays in the vault. |
| FR-C3 | `setAgent(agent, Policy)` and `revokeAgent(agent)` are owner-only. A policy has `dailyCap`, `maxFloat`, `maxDrawPerTx`, `expiry` and `active`. |
| FR-C4 | `draw(amount)` can only be called by a registered agent. It checks, in order: not paused, active, not expired, `amount ≤ maxDrawPerTx`, `spentToday + amount ≤ dailyCap`, and `agentBalance + amount ≤ maxFloat` |
| FR-C5 | If the vault holds less MUSD than `amount`, `draw` borrows the difference (plus a configurable buffer) through `withdrawMUSD`. It does this only if the trove's ICR after borrowing is ≥ `icrFloor`, and reverts with `IcrTooLow` otherwise. |
| FR-C6 | The daily window resets 24h after the agent's current window started (a per-agent `windowStart`) |
| FR-C7 | Owner-only functions: `pause()`/`unpause()`, `setIcrFloor(bps)` (minimum 150%, default 200%), `addCollateral()` (payable), `withdrawCollateral(amount)` (ICR after ≥ floor), `repay(amount)`, `sweep(to, amount)`, `closeLine()` |
| FR-C8 | `rebalance()` can be called by anyone. If ICR < floor + buffer, it repays debt with the vault's idle MUSD (keeping the debt at or above the protocol minimum) |
| FR-C9 | Events: `LineOpened`, `AgentSet`, `AgentRevoked`, `Drawn(agent, amount, borrowed)`, `Borrowed`, `Repaid`, `CollateralAdded`, `CollateralWithdrawn`, `Paused`, `Unpaused`, `Rebalanced`, `IcrFloorSet` |
| FR-C10 | View functions: `lineStatus()` (collateral, debt, ICR, price, vault float), `agentStatus(agent)` (policy, spent today, window reset time, balance), `maxDrawable(agent)` |
| FR-C11 | Custom errors for every refusal: `NotOwner`, `NotAgent`, `Paused`, `AgentInactive`, `AgentExpired`, `DrawTooLarge`, `DailyCapExceeded`, `FloatExceeded`, `IcrTooLow`, `LineNotOpen`, `LineAlreadyOpen` |

### 6.2 Agent SDK, `@banqor/sdk` (Wave 1)

| ID | Requirement |
|---|---|
| FR-S1 | `createBanQorFetch(opts)` returns a `fetch`-compatible function built on `@x402/fetch` `wrapFetchWithPayment` with the `exact` EVM client scheme for `eip155:31611` |
| FR-S2 | Before each request, it reads the agent's MUSD balance (cached briefly). If the balance is below `minFloat`, it sends `vault.draw(topUp)` and waits for confirmation. |
| FR-S3 | It refuses a payment requirement whose price is over `maxPricePerCall` or whose `payTo` isn't on `allowedPayees` (when set) |
| FR-S4 | It exposes `onEvent` hooks (`draw`, `payment`, `refused`) for logging and the demo console |
| FR-S5 | It turns contract custom errors into typed SDK errors |
| FR-S6 | A read-only helper `getLineStatus(vault)` is used by both the agent scripts and the dashboard |

### 6.3 Demo x402 API (Wave 1)

| ID | Requirement |
|---|---|
| FR-D1 | An Express server using the official `@x402/express` `paymentMiddleware`, `ExactEvmScheme` and `HTTPFacilitatorClient` (`https://facilitator.vativ.io`), network `eip155:31611` |
| FR-D2 | Endpoints: `GET /price` ($0.01), `GET /funding` ($0.02), `GET /sentiment` ($0.05). Data comes from a public source, with a cached fallback so the demo never breaks |
| FR-D3 | `GET /health` is free |

### 6.4 Demo agent scripts (Wave 1)

| ID | Requirement |
|---|---|
| FR-A1 | `setup`: the owner creates a vault, opens a line and registers the agent with demo limits (20 MUSD/day, 2 MUSD max float, 1 MUSD max draw) |
| FR-A2 | `run`: makes N (default 100) paid calls across the endpoints and prints a live log of calls, draws, spend today and ICR |
| FR-A3 | `breach`: tries a draw over the cap, a draw after pause and a draw from an unregistered key, and prints each revert reason |

### 6.5 Owner dashboard (Wave 1)

| ID | Requirement |
|---|---|
| FR-UI1 | Connect a wallet on Mezo testnet (injected wallets via wagmi). Show a network-switch prompt on the wrong chain |
| FR-UI2 | **No vault yet:** a create-vault and open-line form. It takes BTC collateral and the initial MUSD debt, and shows a live preview of ICR and liquidation price |
| FR-UI3 | **Line panel:** BTC collateral, MUSD debt, ICR (color-coded against the floor and 110%), BTC price, liquidation price, vault MUSD float. Actions: add or withdraw collateral, repay, sweep, set ICR floor |
| FR-UI4 | **Agents panel:** a table of agents with today's spend against the cap (progress bar), float against max, expiry and status. Add or edit an agent in a modal, and revoke |
| FR-UI5 | **Kill switch:** a prominent Pause/Unpause button |
| FR-UI6 | **Activity feed:** recent `Drawn`, `Borrowed`, `Repaid` and policy events from contract logs, with explorer links |
| FR-UI7 | Read-only mode: paste any vault address to view its status without connecting |
| FR-UI8 | Deployed to a public URL (Vercel or GitHub Pages), which the submission requires |

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Security:** agent keys can't move collateral, change policy or call owner functions. Reentrancy guards on all state-changing functions. Follows checks-effects-interactions. `SafeERC20` for MUSD |
| NFR-2 | **Tests:** unit tests for every function and error, fuzz tests for cap and ICR invariants, and a fork test against real Mezo testnet contracts |
| NFR-3 | **Compatibility:** Solidity `0.8.28` with `evm_version = "london"` (Mezo requirement). `@x402/*` pinned to `2.16.0` |
| NFR-4 | **Performance:** an agent call that needs no draw adds no extra on-chain transaction. A draw happens at most once per `topUp` worth of spend |
| NFR-5 | **UX:** the dashboard works on desktop and mobile widths. Every transaction shows pending, confirmed and failed states with explorer links |
| NFR-6 | **Transparency:** all contracts verified on the Mezo testnet explorer. The README states "testnet, unaudited" |
| NFR-7 | **Config:** all addresses live in one `deployments/31611.json`, shared by the SDK, scripts and dashboard |

## 8. Success metrics for Wave 1

- Contracts deployed and verified on Mezo testnet, with a public vault address that shows real trove debt.
- Recorded demo: 100+ x402 calls paid automatically, at least 3 automatic draws, 1 cap breach blocked, 1 pause blocking draws.
- `forge test` all green, including the fork test.
- Dashboard live at a public URL, showing the demo vault.
- All AKINDO submission items delivered (see [PLAN.md](PLAN.md)).

## 9. Wave 2 scope (after Oct 26)

1. **Zero-BTC agents:** `drawWithSig` (an EIP-712 draw request signed by the agent) plus a small relayer, so agents need no BTC for gas.
2. **Claude-powered research agent** (`claude-sonnet-5-5`) that decides which paid endpoints to call within its budget.
3. **Keeper bot** for `rebalance()`, plus alerts when ICR approaches the floor.
4. **Auto-repay from agent revenue:** agents that sell x402 services route their income back to repay the owner's debt.
5. **Idle-float yield:** research putting the vault's idle MUSD to work (for example, Mezo's Stability Pool) to offset interest.
6. **Multi-vault and analytics:** spend history, per-endpoint breakdown, and an "MUSD borrowed via agents" metric.
7. Security pass: an internal review checklist, more invariant tests, and documented threat-model updates.

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Mezo trove function signatures differ from the Liquity-style ones we expect | Blocks the contracts | Day-1 fork test against `BorrowerOperations` on testnet. Adapt the interface before writing vault logic |
| 1,800 MUSD minimum debt needs a lot of testnet BTC as collateral | Can't open the demo line | Get faucet BTC early. Ask in the Mezo Discord if the faucet limit is too low. Fall back to a mock trove for local demos only |
| Interest accrues on the idle 1,800 MUSD float | Cost to the owner | Document it. Keep `sweep()` and `repay()` available. Wave 2 idle-yield research |
| Redemptions hit low-ICR troves first | The vault's trove could be partly redeemed | Default ICR floor of 200% keeps the trove away from the bottom. Redemptions only lower debt and collateral, so no funds are lost |
| x402 facilitator downtime | Demo calls fail | Retry with backoff. Record the demo video when the facilitator is healthy |
| Agent EOA needs BTC for gas in Wave 1 | Extra setup step | `setup` script funds the agent with a small amount of BTC. Wave 2 relayer removes this |
| Dashboard scope in a 3-day window | Late delivery | Use plain Vite + wagmi with no design system. Read data straight from contract views and logs, with no indexer |

## 11. Open questions

1. What are the exact `openTrove` and `withdrawMUSD` signatures, and the gas-compensation rules, on Mezo's MUSD contracts? (Confirm on day 1.)
2. What borrowing fee and interest rate apply to new troves on testnet? (Read from chain and show in the dashboard.)
3. Does the testnet faucet give enough BTC to collateralize a 1,800 MUSD trove at 200%+?
4. Can a contract be the trove borrower without restriction? (Expected yes. Verify in the fork test.)
