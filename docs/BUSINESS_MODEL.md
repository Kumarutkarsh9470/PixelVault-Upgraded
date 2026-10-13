# PixelVault business model

How PixelVault makes money, for whom, and what it costs to run. Every number from the program is exact; every projection is marked as an assumption and comes with the formula, so a reviewer can change the inputs.

## 1. In one paragraph

PixelVault is a payment layer for game items. A studio sells an item through PixelVault instead of an ordinary in-app purchase; most of the price is locked as USDC in a vault the program owns, and the player can burn the item and take that USDC back at any time, without the studio. The studio keeps the rest of the price as margin. The protocol takes 12.5% of that margin, on-chain, on every sale. Redemption, moving items between games, and cash-out are free. We earn only when studios sell, and we never touch the backing.

## 2. The customer and the problem

**Who pays:** game studios, starting with Telegram mini-game studios and Solana indie studios. They already have players, an in-game economy, and a payment problem: players have stopped spending in web3 games because every previous economy wiped them out, and ordinary in-app purchases convert poorly for the same reason.

**The job the studio hires PixelVault for:** sell items that players are willing to buy, at a higher price than before, with a guarantee the studio could not credibly make on its own.

**The player's job:** spend on a game without the risk of losing the money if the game dies or the player loses interest.

**What exists today and why it fails the studio:**

| Alternative | What the player gets | Why studios lose |
|---|---|---|
| Ordinary in-app purchase | nothing back | low conversion from burned players; platform takes 30% |
| NFT item | resale, if a buyer appears | prices collapse, reputational damage, no floor |
| Per-game token | resale into a pool | the token becomes the product; liquidity leaves; the game dies with it |
| PixelVault item | a fixed USDC refund, paid by the program | the studio keeps a margin and can charge more |

## 3. What is sold

| Product | Buyer | Price | State |
|---|---|---|---|
| Protocol: craft, redeem, route, verified runs | studios, through the program | 12.5% of the studio's margin per craft, enforced on-chain, capped at 25% by code | live on devnet |
| `pixelvault-sdk` and `npx pixelvault setup` | studios | free, open source (Apache 2.0) | published on npm |
| Reference games (Neon Racer, Glyph Forge) | players | item prices $0.25 to $1.00 | live on devnet |
| Hosted services (planned): relayer with fee sponsorship, grant server, analytics, fiat on-ramp, solvency pages per studio | studios that do not want to run servers | monthly tiers, see section 6 | after mainnet |

The protocol fee is the core model. Hosted services exist because most small studios will not run a relayer and a grant signer themselves; they are optional, and a studio that self-hosts pays only the protocol fee.

## 4. Unit economics of one craft

Exact program arithmetic (`splitPrice` in the SDK, `apply_bps` in the program; amounts round down to the base unit):

| Item | Price | Backing | Locked in vault | Studio margin | Protocol fee (12.5% of margin) | Studio keeps |
|---|---|---|---|---|---|---|
| Futura chassis | $1.00 | 90% | $0.900 | $0.100 | $0.0125 | $0.0875 |
| Street chassis | $0.60 | 80% | $0.480 | $0.120 | $0.015 | $0.105 |
| Cyan Pulse underglow | $0.30 | 70% | $0.210 | $0.090 | $0.01125 | $0.07875 |
| Genesis Gold trail (100 ever) | $1.00 | 95% | $0.950 | $0.050 | $0.00625 | $0.04375 |

The player's real cost is the margin: $0.10 for a one-dollar Futura. That is why studios can price higher than an ordinary purchase and still convert.

**On-chain costs per craft, paid by the relayer in SOL** (devnet measurements, mainnet prices at an assumed $150 per SOL):

| Cost | Amount | When |
|---|---|---|
| Transaction fee, two signers | 10,000 lamports ($0.0015) | every craft |
| Player's token account for the item class | 2,039,280 lamports ($0.31) | once per player per item class, the first time they hold it |
| Player's USDC account | 2,039,280 lamports ($0.31) | once per player |
| Run verification, one race | about 7 transactions, 70,000 lamports ($0.01); the 2.2 KB run buffer's rent is refunded when it closes | every verified race |

Rent is the dominant cost and it is a cost of acquisition, not of volume: it is paid once per player per item class. It is bounded by the per-player caps and by the relayer's rate limits, and section 6 prices it into hosting. A studio that pays its own relayer bears it directly.

## 5. Revenue model and projections

Revenue per month from the protocol fee:

```
protocol revenue = crafts × average price × (1 − average backing) × 12.5%
```

Three scenarios, all assumptions, with the formula above:

| Scenario | Studios | Monthly crafters | Crafts per crafter | Avg price | Avg backing | Monthly GMV | Protocol fee per month |
|---|---|---|---|---|---|---|---|
| Pilot (first 6 months) | 3 | 2,000 | 3 | $0.60 | 80% | $3,600 | $90 |
| Traction (month 12) | 25 | 40,000 | 3 | $0.80 | 80% | $96,000 | $2,400 |
| Scale (month 24) | 150 | 500,000 | 3 | $1.00 | 80% | $1,500,000 | $37,500 |

Two things a reviewer should see in that table. First, the protocol fee alone is small until the network is large; that is deliberate, because a higher fee would make studios price worse and would weaken the guarantee's credibility. Second, the backing is never a source of revenue: $1.2M of the scale scenario's GMV sits in vaults, and it earns nothing, because lending it out would turn the vault fractional and break the one promise the product makes. Grant reviewers who have seen "yield on user deposits" models should read that as the point, not a gap.

Hosted services close the gap in the middle period:

| Tier | Monthly | Includes | Assumed take-up |
|---|---|---|---|
| Self-hosted | $0 | SDK, CLI, reference relayer | most hobby studios |
| Studio | $99 | hosted relayer and grant server, 5,000 sponsored transactions, solvency page, analytics | small studios |
| Growth | $499 + metered rent | 50,000 sponsored transactions, fee and rent sponsorship billed at cost + 20%, priority support | studios with real traffic |

At the traction scenario, 25 studios with 15 on paid tiers at an average of $250 yields about $3,750 per month on top of the protocol fee. At scale, 150 studios with 100 paying at an average of $350 yields about $35,000 per month. These are assumptions; the mechanism is the point: studios pay for not running infrastructure, and rent and fee sponsorship are passed through at a margin rather than absorbed.

## 6. Cost structure

| Cost | Pilot | Traction | Scale |
|---|---|---|---|
| Relayer fees and rent sponsored for our own games | $300 per month | $1,500 per month | passed through to studios |
| RPC, hosting, database, monitoring | $100 | $600 | $3,000 |
| Audit and re-audit | $20,000 once | $10,000 per major release | $10,000 per major release |
| Engineering | founder | 2 engineers | 5 engineers |
| Studio pilot incentives (sponsored fees for their first players) | $2,000 | $5,000 | none |

Break-even on infrastructure alone arrives in the traction scenario with paid tiers; break-even on a two-engineer team needs the scale scenario or a second revenue line. We are not claiming otherwise.

## 7. Go-to-market

**Wedge:** Telegram mini-game studios. They have players, sign-in, and the payment problem, and PixelVault already ships as a Telegram Mini App with embedded wallets, so their players never see a seed phrase or hold SOL. The integration is a server that signs grants and a client that builds two instructions, which is what the SDK packages; `npx pixelvault setup` registers a game in two transactions.

**Sequence:**
1. Devnet pilot with three studios: we cover their relayer fees and their first hundred players' starter USDC; they give us signed feedback and on-chain crafts. This is the traction a grant application needs and the proof the SDK works for a stranger.
2. Mainnet launch under caps ($25 per player per game, $2,500 per game, $10,000 global) with our two games and the pilot studios.
3. Hosted tiers, then outreach through Superteam, the Solana games community, and Telegram game studio directories.

**Why a studio switches:** higher prices at better conversion, a public solvency page they can point their players at, and a redemption promise they could not make themselves.

## 8. Competition and position

| | Enjin (ENJ infusion) | Collector Crypt | Ordinary IAP (Apple, Google, Telegram Stars) | PixelVault |
|---|---|---|---|---|
| Backing asset | ENJ, volatile | physical cards, redeemable | none | USDC, fixed |
| Who guarantees redemption | protocol | company | nobody | program, no server |
| Chain | Ethereum, Enjin | Solana | none | Solana |
| Studio margin control | limited | n/a | platform takes 30% | studio sets price and backing in a band |
| Items move between games | within Enjin | no | no | one transaction, at par |

Our position: the only design where the floor is stable money, enforced by code the studio cannot change, with an integration a stranger can finish in an afternoon.

## 9. Moat

- **Code-enforced guarantees** that competitors with a company in the loop cannot match without becoming the same thing.
- **Network effects of the shared wallet:** every game on the protocol adds items a player can carry into every other game, and adds players who already hold USDC-backed items.
- **Public solvency:** every vault is readable by anyone, every minute; the transparency compounds trust across all games at once.
- **The SDK as the integration standard:** grants, craft, redeem, route, sponsor rules; once a studio's server speaks it, switching costs are real.

## 10. Milestones, KPIs and use of funds

| Milestone | Evidence | KPI |
|---|---|---|
| Devnet pilot complete | three outside studios integrated, 50+ testers, metrics page | crafts, redemptions, 7-day retention, backing locked |
| Audit complete | report in `docs/audit/`, findings closed | zero open high or medium |
| Mainnet under caps | first real craft and redeem receipts, solvency page on mainnet | vault coverage 100%, every day |
| Ten studios live | registrations on chain | GMV, protocol fee, paid tiers |

Proposed use of a first grant (assumption, to be sized to the program):

| Line | Share |
|---|---|
| Independent audit of the program | 40% |
| Relayer fee and rent sponsorship for pilot studios and the closed beta | 20% |
| Engineering: hosted relayer, studio dashboard, fiat on-ramp integration | 30% |
| Legal review of the non-custodial model in launch markets | 10% |

## 11. Risks

| Risk | Mitigation |
|---|---|
| A bug in the program loses backing | audit before mainnet; launch caps bound exposure; solvency check in every craft and redeem; admin can pause crafting but never redemption |
| Rent cost per player makes small items unprofitable | per-player caps; rent passed through in hosted tiers; closing empty item accounts to reclaim rent is on the roadmap |
| Studios do not integrate | the pilot program funds their first players; integration is one command; reference games prove it |
| USDC depeg or issuer action | backing is denominated in the issuer's token; this is disclosed to players; a multi-stablecoin option is on the roadmap |
| Regulatory treatment of holding user funds | the vault is program-owned and non-custodial by construction; legal review is a launch gate |
| Telegram platform changes | the web app runs in any browser; Telegram is a channel, not a dependency of the protocol |

## 12. Team

**[you]** Founder: name, background, prior work (the Initia hackathon project that led to this design), and why you are the person to build it. One paragraph.
