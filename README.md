# BanQor

**Let your agents live off your Bitcoin.** BanQor turns a Mezo trove into a credit line for AI agents. Your BTC stays locked as collateral. Agents borrow MUSD against it just in time, inside caps the contract enforces, and spend it on any x402 API on Mezo. Nobody sells BTC, and nobody tops up a hot wallet by hand.

> **Testnet, unaudited.** Mezo testnet (chain 31611) only. Do not use real funds.

Built for the Mezo Buildathon (AKINDO). Track 2, Access and Distribution (primary), and Track 1, DeFi.

## Why it matters to Mezo

- **New MUSD demand.** Every dollar an agent spends is MUSD borrowed against Bitcoin.
- **Buyers for Mezo's x402 rail.** Sellers can already paywall APIs on Mezo. BanQor funds the buyers.
- **Extends Mezo, doesn't fork it.** It uses Mezo's own BorrowerOperations and TroveManager, MUSD, the official facilitator and the `@x402/*` SDKs. BanQor only adds the policy layer between them.

## How it works

```
 Owner's BTC ──deposit──▶ BanQorVault ──draw()──▶ Agent float ──x402 (exact, MUSD)──▶ Any paid API
                          owns a Mezo trove         small, capped     facilitator.vativ.io
                          enforces agent policy
                          guards the trove's ICR
```

1. **Open a line.** The owner deposits BTC. The vault opens a Mezo trove in its own name, and the minted MUSD stays in the vault.
2. **Set rules per agent:** a daily cap, a max float, a max single draw, an expiry, and an ICR floor for the trove (at least 150%, 200% by default).
3. **The agent spends.** When its float runs low, the SDK calls `draw()`. If the vault is short, it borrows more from the trove, but only while the trove stays at or above the floor.
4. **The agent pays APIs** with the standard x402 `exact` flow, using MUSD via Permit2 with EIP-2612 gas sponsoring.
5. **The owner stays in control:** pause, edit or revoke agents, repay, add or withdraw BTC, sweep, or close. If Mezo redeems or liquidates the trove, `claimCollateral()` recovers any surplus BTC. Anyone can call `rebalance()` when the trove gets close to its floor. It repays from idle MUSD only what brings the ICR back to floor + buffer, so it can't be used to drain the agents' float.

**Worst case if an agent key leaks:** the attacker gets that agent's current float plus whatever is left of today's cap, until the owner hits pause. An agent key can never touch the collateral or call owner functions.

## Repository

| Path | What |
|---|---|
| `contracts/` | Foundry project: `BanQorFactory`, `BanQorVault`, Mezo interfaces, unit, fuzz, invariant and fork tests |
| `packages/sdk` | `@banqor/sdk`: `createBanQorFetch()`, a vault client, typed errors, hints and preview math |
| `apps/api` | Demo paid API using the official `@x402/express` middleware (`/price`, `/funding`, `/sentiment`, plus a free `/health`) |
| `apps/agent` | `setup`, `run` and `breach` scripts |
| `apps/dashboard` | Landing page (`index.html`) and owner dashboard (`app.html`: Overview, Agents, Activity, Open a line; Vite, React, wagmi) |
| `deployments/31611.json` | The single source of addresses for every package |
| `PRD.md`, `ARCHITECTURE.md`, `OVERVIEW.md`, `PLAN.md` | Product and design docs |

## Addresses

All addresses (the Mezo MUSD system and BanQor) live in [`deployments/31611.json`](deployments/31611.json), the single source every package reads.

| Contract (Mezo testnet) | Address | Source verified |
|---|---|---|
| BanQorFactory | [`0x036cEDfaA78eC84Ae52ecefe0d27D7D42Daac5ab`](https://explorer.test.mezo.org/address/0x036cEDfaA78eC84Ae52ecefe0d27D7D42Daac5ab) | [Sourcify, exact match](https://repo.sourcify.dev/31611/0x036cEDfaA78eC84Ae52ecefe0d27D7D42Daac5ab) |
| Demo BanQorVault (owns a live Mezo trove) | [`0xcDa3Cb64aEd90C2A77981434d66AD3F3197fC791`](https://explorer.test.mezo.org/address/0xcDa3Cb64aEd90C2A77981434d66AD3F3197fC791) | [Sourcify, exact match](https://repo.sourcify.dev/31611/0xcDa3Cb64aEd90C2A77981434d66AD3F3197fC791) |

Verification on the Mezo testnet explorer was submitted too, but the explorer's verification queue hasn't processed any contract since Oct 21, 2026. The Sourcify matches are exact, covering source, compiler settings and metadata.

## For agent developers

Replace `fetch` with one line:

```ts
import { createBanQorFetch } from "@banqor/sdk";

const fetchPaid = createBanQorFetch({
  agentKey: process.env.AGENT_KEY as `0x${string}`,
  vault: "0xYourVault",
  network: "eip155:31611",
  rpcUrl: "https://rpc.test.mezo.org",
  minFloat: "0.20",        // draw when the float falls below this
  topUp: "1.00",           // MUSD per draw
  maxPricePerCall: "0.10", // refuse anything pricier, before signing
  allowedPayees: ["0xApi…"],
  onEvent: (e) => console.log(e), // draw | payment | refused
});

const res = await fetchPaid("http://localhost:4021/price");
```

Refusals arrive as a `BanQorError` with a `code`: `Paused`, `DailyCapExceeded`, `FloatExceeded`, `DrawTooLarge`, `IcrTooLow`, `AgentExpired`, `NotAgent`, `PriceTooHigh`, `PayeeNotAllowed`, and so on.

## Run it

Requirements: Node 22, pnpm 10, Foundry.

```bash
pnpm install
```

```bash
cp .env.example .env
```

Fill in `OWNER_KEY`, `AGENT_KEY` and `PAY_TO` in `.env`. Fund the owner with testnet BTC from https://faucet.test.mezo.org. A 1,800 MUSD line at about 300% ICR needs roughly 0.07 BTC.

```bash
pnpm contracts:test
```

```bash
pnpm contracts:test:fork
```

```bash
pnpm contracts:deploy
```

This deploys and verifies the factory, then records its address in `deployments/31611.json` once its code is confirmed on-chain.

```bash
pnpm build
```

```bash
pnpm agent:setup
```

```bash
pnpm api
```

In a second terminal:

```bash
pnpm agent:run
```

```bash
pnpm agent:breach
```

```bash
pnpm dashboard
```

The landing page is at http://localhost:5173 and the dashboard at http://localhost:5173/app.html. Connect the owner wallet to manage your line, or add `?vault=0x…` to any page (for example `app.html#/overview?vault=0x…`) to view a vault read-only.

## Tests

| Suite | Command | Covers |
|---|---|---|
| Contract unit, fuzz and invariant | `pnpm contracts:test` | Every function and custom error, the daily-cap and ICR-floor invariants, owner-only access, MUSD conservation, reentrancy |
| Contract fork | `pnpm contracts:test:fork` | The full flow against the real Mezo contracts on a testnet fork |
| SDK | `pnpm --filter @banqor/sdk test` | Error decoding, plus the vault client and `ensureFloat` on a local anvil fork of Mezo |
| API | `pnpm --filter @banqor/api test` | 402 requirements (exact, MUSD, amounts), data cache and fallback |
| End-to-end | `pnpm --filter @banqor/agent test` | Agent, SDK, demo API and vault on a Mezo fork: paid calls with automatic draws that borrow from the trove, price and payee guards, pause |

On a local fork, Mezo's PriceFeed can't run because it reads an oracle precompile. The tests fetch the live price from the real RPC and mock `fetchPrice()` with that value.

## Security notes

- Every state-changing function is `nonReentrant`. `draw()` records spend before any external call. MUSD moves through `SafeERC20`.
- No proxies and no upgradability. The Mezo addresses are immutable per vault.
- Known limits: Wave 1 agents need a little BTC for `draw()` gas (a relayer arrives in Wave 2). Interest accrues on idle vault MUSD, so `repay()` or `sweep()` it if you don't need it.
