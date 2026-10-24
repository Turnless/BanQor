# BanQor: overview

> **Let your agents live off your Bitcoin.**
> BanQor turns a Mezo trove into a **credit line for AI agents**. The owner's BTC stays locked as collateral. Agents borrow MUSD against it just in time, inside caps enforced on-chain. No one sells BTC, and no one funds a hot wallet by hand.
>
> Paying for APIs over x402 is what agents *do* with the credit line. It isn't the product. The product is the **trove-backed credit line**.

Built for the Mezo Buildathon (AKINDO). Tracks: **Track 2, Access and Distribution** (primary) and **Track 1, DeFi** (secondary).

---

## 1. The problem

### AI agents need money, but they can't hold it safely

AI agents now browse the web, call APIs and run tasks without a human in the loop. More and more of the services they use charge per request through **x402**, the HTTP-402 "payment required" standard. The server answers `402` with a price, and the client pays in a stablecoin and retries. There's no signup and no card on file.

On Mezo, the seller side of x402 already works:
- the `exact` scheme on `eip155:31611`
- the hosted facilitator `facilitator.vativ.io`
- the official `@x402/*` SDKs, with MUSD as the settlement asset

A developer can put a paywall in front of an API in minutes.

**The buyer side is missing.** For an agent to pay, someone has to:
1. Borrow MUSD against their BTC in the Mezo app.
2. Move that MUSD into a hot wallet whose private key the agent holds.
3. Watch the balance and top it up by hand.
4. Hope the agent doesn't overspend, loop, or leak its key and drain the wallet.

That leaves the owner with three bad options:

| Option | What goes wrong |
|---|---|
| Fund the agent wallet with a large balance | One bug or leaked key and the whole balance is gone |
| Fund it with a small balance | The agent stalls whenever it runs dry, so a human has to babysit it |
| Sell BTC for stablecoins to fund it | Defeats the purpose of Mezo ("live off your Bitcoin without selling it") |

There is also no link between the agent's spending and the owner's Bitcoin position. Nothing stops the agent from spending when the owner's loan is close to liquidation.

### Why this matters to Mezo

- **MUSD needs organic demand.** Every MUSD comes from someone borrowing against BTC. New reasons to borrow mean more MUSD supply and more borrowing revenue for the protocol.
- **Mezo's x402 rail needs buyers.** Sellers can paywall APIs today, but without funded buyers there is no volume.
- **Agent payment rails are on Mezo's roadmap.** Only half of that rail exists today.

---

## 2. The solution

BanQor connects **Mezo Borrow → MUSD → x402** into one automated, guarded loop.

```
   Owner's BTC                BanQor Vault                      Agent                      Any x402 API on Mezo
 ┌────────────┐  deposit   ┌───────────────────────┐  draw()  ┌──────────────┐  pay 0.01  ┌──────────────────────┐
 │  BTC       │──────────▶│ owns a Mezo trove      │────────▶│ small MUSD   │──────────▶│ price data, research, │
 │            │           │ enforces agent policy  │  MUSD   │ float only   │  (x402)   │ inference, tools ...  │
 └────────────┘           │ guards the trove's ICR │         └──────────────┘           └──────────────────────┘
                          └───────────────────────┘
```

1. **The owner opens a line.** They deposit BTC. The vault contract opens a Mezo trove in its own name and borrows the initial MUSD.
2. **The owner registers agents and sets rules for each one:**
   - a daily spending cap
   - a maximum float the agent can hold at once
   - a maximum single draw
   - an expiry time
   - an ICR floor for the trove (for example, never borrow if the collateral ratio would drop below 200%)
3. **The agent spends.** When its MUSD float runs low, the BanQor SDK calls `draw()`. The vault checks the rules. If it has too little MUSD, it borrows more from the trove, but only while the trove stays above the ICR floor. Then it sends MUSD to the agent.
4. **The agent pays APIs** using the official x402 `exact` flow and facilitator. Payments are gasless permit signatures, so no custom protocol is involved.
5. **The owner keeps control.** They can pause everything instantly, change rules, repay debt, add collateral or close the line. A keeper can call `rebalance()` to repay debt with idle MUSD when the trove's health drops.

### What each party gets

| Party | Before | With BanQor |
|---|---|---|
| **Owner (BTC holder)** | Sells BTC, or tops up hot wallets by hand | BTC stays in Mezo. Agents get spending power automatically, inside hard limits. |
| **Agent developer** | Writes custom wallet top-up logic | Changes one line: `createBanQorFetch(...)` replaces `fetch` |
| **x402 sellers on Mezo** | Few funded buyers | Agents that can always pay |
| **Mezo** | MUSD demand from humans only | A new, always-on class of borrowers: agents. More MUSD minted, more borrowing revenue, real x402 volume. |

### Safety model in one paragraph

An agent key can never touch the BTC collateral or the trove. It can only call `draw()`, and the vault caps that by daily spend, float size and single-draw size. If an agent key leaks, the attacker gets at most the agent's current float plus what's left of today's cap, until the owner presses pause. As a built-in safeguard, draws also stop if borrowing would push the trove below the owner's ICR floor. That keeps the owner well above Mezo's 110% liquidation line. This is a safety feature, not a selling point: dedicated trove-protection tools already exist on Mezo, and BanQor only needs enough protection that an agent can't be the cause of a liquidation.

---

## 3. Positioning: what's new here

The Wave 1 gallery has 39 submissions. BanQor sits next to three groups of them but overlaps none:

| Neighbor in the gallery | What it does | How BanQor differs |
|---|---|---|
| **Mezo Agent Toolkit** | Agents read Mezo over MCP and pay per call in MUSD, with operator spend caps | It assumes the agent already holds MUSD. BanQor is where that MUSD comes from: borrowed against the owner's BTC, on demand, inside caps enforced on-chain |
| **Mezher** | Checkout that borrows the rest from your trove | Same idea of spending from a trove, but for a human at checkout. BanQor is for autonomous agents, with standing policies instead of one-off approvals |
| **Paywalls and pay links** (Liqvera, PayLink, Pay Links, SettleTag and others) | Sellers charge MUSD per request or per purchase | These are the *sellers*. BanQor funds the *buyers*, so it adds demand for all of them |
| **Trove guards** (Lifeline, Trove Guardian, Vigil, Pylon, Lockwatch) | Protect troves from liquidation and redemption | BanQor only has a minimal guard (the ICR floor) so agents can't cause a liquidation. It doesn't compete here |

**The differentiator in one line:** no other entry lets a BTC holder hand an AI agent a **credit line borrowed from their own trove**, with caps enforced on-chain. Paying per call and setting spend caps already exist. Funding the agent from Bitcoin collateral does not.

**How to pitch it:** lead with the credit line ("your agent borrows against your Bitcoin"). Present x402 payments as what it plugs into, and the ICR floor as a safety detail. Don't lead with "agents pay per call": on its own, that pitch gets lost among the paywall entries.

---

## 4. Why on Mezo, and why now

- **Bitcoin-native credit.** Mezo is the only place where a BTC holder can borrow a dollar stablecoin (MUSD) against BTC in the same EVM environment where x402 payments settle. BanQor composes those two pieces directly.
- **The rails already exist.** MUSD, troves, the x402 facilitator and the SDKs are live on testnet. BanQor is the missing buyer-side layer, not a parallel stack. That fits Mezo's "extend, don't detour" principle.
- **Agents are the fastest-growing type of API consumer**, and they can't fill in payment forms or hold credit cards. They can hold a capped MUSD float backed by Bitcoin.

---

## 5. Scope at a glance

| | Wave 1 (due Oct 26, 2026) | Wave 2 (Nov 2–15, 2026) |
|---|---|---|
| Vault + factory contracts on Mezo testnet | ✅ | hardening, multi-vault |
| Agent SDK (`createBanQorFetch`) | ✅ | relayer support |
| Demo x402 API + demo agent scripts | ✅ | Claude-powered research agent |
| Owner dashboard | ✅ | analytics, multi-agent views |
| Zero-BTC agents (signed draws + relayer) | | ✅ |
| Keeper bot for `rebalance()` | | ✅ |
| Auto-repay from agent revenue | | ✅ |
| Idle-float yield | | ✅ (to research) |

See [PRD.md](PRD.md) for requirements, [ARCHITECTURE.md](ARCHITECTURE.md) for the technical design, and [PLAN.md](PLAN.md) for the build schedule.

## 6. Pitch in one line

**"Agents don't have credit cards, but they can have a credit line backed by your Bitcoin. BanQor lets an AI agent borrow MUSD from your Mezo trove, within limits it can't break."**
