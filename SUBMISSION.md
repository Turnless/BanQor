# BanQor: AKINDO submission, Mezo Buildathon Wave 1

Copy-paste answers for the AKINDO form. Every number here is on-chain or in the test output; see the [README](README.md) for the evidence links.

## Form answers

| Field | Answer |
|---|---|
| Project name | BanQor |
| Tagline | Let your agents live off your Bitcoin. |
| Category | Agent credit line · BTC-backed borrowing · agent payments |
| Track | Track 2, Access & Distribution (primary) · Track 1, DeFi |
| Chain | Mezo testnet (chain 31611) |
| Status | Entirely new |
| Readiness | Live on Mezo testnet, with a public dashboard |
| Live app | https://getbanqor.vercel.app |
| Demo vault (read-only, no wallet) | https://getbanqor.vercel.app/app.html#/overview?vault=0xcDa3Cb64aEd90C2A77981434d66AD3F3197fC791 |
| Repository | https://github.com/Turnless/BanQor |
| Demo video | _add the link_ |
| Deck | _add the link_ |

### TL;DR

BanQor turns your Mezo trove into a credit line for AI agents. Your BTC stays locked as collateral; each agent borrows MUSD against it just in time, inside limits the contract enforces, and spends it on any x402 API on Mezo.

### The problem

Agents that pay per API call need money in their wallet at the moment they call. Today someone tops up a hot wallet by hand, with too much at risk if the key leaks, or a BTC holder sells Bitcoin to fund it. Mezo has borrowing against BTC and an x402 payment rail, but nothing gives an agent a bounded, revocable allowance drawn from your Bitcoin.

### How it works

1. The owner deposits BTC. A `BanQorVault` opens a Mezo trove in its own name; minted MUSD stays in the vault.
2. The owner sets per-agent rules: daily cap, max float, max single draw, expiry, and an ICR floor for the trove (≥150%, 200% by default).
3. When an agent's float runs low, the SDK calls `draw()`. If the vault is short it borrows from the trove, only while the trove stays at or above the floor.
4. The agent pays APIs with the standard x402 `exact` flow in MUSD, settled by the facilitator. The agent pays no gas for payments.
5. The owner can pause everything, edit or revoke agents, repay, add or withdraw BTC, sweep, or close, from the dashboard.

### Proof it works (Mezo testnet, Oct 24, 2026)

- A live trove: 0.07 BTC collateral, 2,001.80 MUSD debt, owned by the demo vault.
- 152 x402 payments by the demo agent, 4.03 MUSD in total, settled on-chain in 27 minutes.
- An agent `draw()` that borrowed 6 MUSD from the trove on its own.
- Owner pause and unpause on-chain; over-limit, revoked and unregistered draws refused by the contract.
- Factory and vault verified on Sourcify (exact match).
- 123 automated tests passing, including 4 fork tests against the real Mezo contracts.

### Why it matters for Mezo

Every dollar an agent spends is new MUSD borrowed against Bitcoin, so agent activity turns into MUSD demand. BanQor funds the buyer side of Mezo's x402 rail, where sellers can already charge per call. It builds on Mezo's own contracts and the official x402 SDKs rather than forking them.

### Target group

Builders and BTC holders running AI agents. Developer-first: integration is one line (`createBanQorFetch`). Global.

### Tech stack

Solidity 0.8.28 + Foundry · TypeScript · viem · wagmi · React + Vite · `@x402/*` 2.16 · Mezo BorrowerOperations, TroveManager, HintHelpers, SortedTroves, PriceFeed, MUSD · x402 facilitator `facilitator.vativ.io` · Vercel

### Future milestones

1. **Wave 2 (Nov 15, 2026):** zero-BTC agents via `drawWithSig` and a relayer, a keeper bot for `rebalance()` with alerts, a Claude-driven research agent, auto-repay from agent revenue, spend analytics.
2. **Dec 2026:** security review, then a mainnet beta.
3. **Q1 2027:** SDK integrations with x402 sellers on Mezo.

## Addresses (Mezo testnet, chain 31611)

| What | Address |
|---|---|
| BanQorFactory | `0x036cEDfaA78eC84Ae52ecefe0d27D7D42Daac5ab` |
| Demo BanQorVault | `0xcDa3Cb64aEd90C2A77981434d66AD3F3197fC791` |
| Owner wallet | `0xfcaadF018B4f734e632Ef15d2F547BB5BaCD7B57` |
| Demo agent | `0x60e149536aB20bBdBe4040c304Bd3387dBA4b26E` |
| Demo API payee | `0x92a8f22c435124F203DF0639d5e0764ae98e68B3` |
| MUSD (Mezo) | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |

## Key transactions

| What | Transaction |
|---|---|
| Line opened (0.07 BTC, 2,001.80 MUSD) | `0x380651df0a630a25902ac6cbf520f595f4988a6849c1e1f36eef0669e635fda5` |
| Agent draw that borrowed 6 MUSD from the trove | `0x7fc61371d7e4f31a58c68a40c6958d0ee2aeb564f8c88d8ed156473bfa22bf5c` |
| First x402 payment | `0x1937effb827faabc5170f07a396dbdc3b95b5f9958ed99c96696043c4e54dc8f` |
| Last x402 payment (152nd) | `0xc6e317474e259495ee7c06d7252d24052cb5a3b306c7a3a863891c6d911540cf` |
| Owner paused all agents | `0x77493bc3f798e093a870fdd3be1390d995260f4a8b13677ca64637d46e561383` |
| Owner unpaused | `0x0cecdd717447e12a3efaaf47d1db7b42d7b91b0b578293bd172d7bb51d5478f1` |

Explorer: https://explorer.test.mezo.org

## Before submitting

- [ ] Demo video recorded on the live app and linked above and in the README
- [ ] Deck linked above
- [ ] Live URL opens in a private window with no wallet
- [ ] Repo public, `.env` not committed (`git log -p | grep -i "_KEY="` finds nothing real)
- [ ] Submitted before Mon Oct 26, 16:00 (check the time zone on the AKINDO countdown)
