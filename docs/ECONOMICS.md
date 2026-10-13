# Economics and incentive design

What PixelVault uses as units of value, why there is no token, how every participant is paid to behave well, what the protocol's parameters are and who can change them, and the exact conditions under which a token could ever be justified. Written for grant reviewers who have read a hundred tokenomics documents and would rather read a design.

## 1. Why there is no token

Every game economy we studied before building this died the same way: a per-game token became the product, its price became the game, and when liquidity left, the game and the players' money went with it. Our own earlier attempt (PixelVault on Initia: per-game tokens, an AMM, player accounts) was that design, and it taught us the lesson.

So PixelVault has no token, and its design is the reason:

- **The unit of value is USDC**, because a floor is only a floor if it is denominated in something that does not move with the game's popularity.
- **Items are claims on USDC**, with a backing ratio fixed at creation that can rise and never fall.
- **Materials and runes are not money**: they are off-chain, non-transferable, capped per day, and only unlock the right to buy. They cannot be sold, so there is no market to collapse.
- **Reputation is not money**: leaderboards and frames show status; they pay nothing.

A token would reintroduce the exact failure the product exists to remove. The only role a token could ever play is governance of protocol parameters, and section 8 lists the conditions under which that would be considered. It is not part of the plan a grant would fund.

## 2. The four units of value

| Unit | Where it lives | Transferable | Value from |
|---|---|---|---|
| USDC | player, studio and protocol token accounts; game vaults | yes | the issuer |
| Item (Token-2022 semi-fungible, one mint per item class) | player item accounts | yes, standard tokens; burn to redeem | its backing, plus whatever the game does with it |
| Material or rune | the game's database | no | nothing; a licence to craft |
| Leaderboard rank, verified time, frame | chain (verified runs) and database | no | status only |

## 3. The backing band: 50% to 95%

The program refuses any item class whose backing is below 5,000 or above 9,500 basis points. Both ends are failure modes:

- **Below 50%** the item is an ordinary purchase with a rebate; the guarantee stops meaning anything and the product has no reason to exist.
- **At 100%** crafting and redeeming is a free round trip. A player could craft, redeem and craft again forever, farming whatever the game attaches to crafting (materials, limited editions, leaderboard frames). At 95% the round trip costs 5% of the price every cycle, so farming always loses money.

The 25% ceiling on the protocol fee is the same idea from the other side: the fee is a share of the studio's margin, never of the backing, and no admin can raise it past the compiled ceiling.

## 4. Why each participant behaves

**Players.** Spending is reversible, so the usual reason not to spend in a web3 game disappears. Loss aversion works for us: a $1.00 item with $0.90 back feels like a ten-cent decision. Items are portable, so spending in one game is not stranded if the player moves to another. The attack a player could run is farming materials with bots; it is bounded by daily caps (12 materials per track per day in Neon Racer, 60 runes per day in Glyph Forge), by every craft still costing USDC, and in Neon Racer by the chain re-driving every race so a fake time is impossible.

**Studios.** They keep the margin, they can price higher than an ordinary purchase because the player's real cost is small, and raising backing is a credible signal they can send to players at any time. What a studio cannot do is the whole point: lower backing, take the vault, or stop redemption. A studio that wants to exit cleanly simply stops issuing grants; its players keep their refunds.

**The protocol.** It earns 12.5% of margin per craft and nothing on redemption, routing or withdrawal, so it earns only when studios sell and never from players leaving. It cannot earn from the backing, which is what keeps the vault fully reserved. Its switches (pause crafting, fee within the ceiling, caps) cannot touch money; the admin role moves to a multisig before mainnet with `transfer_admin`.

**The relayer.** It pays fees and rent so players never hold SOL. Its rules make it unprofitable to abuse: it pays only for craft, redeem, route, own-wallet withdrawals above ten cents, and race verification with a compute limit; it refuses priority fees, other programs and any use of its key except as payer or refund target; it rate-limits every wallet.

## 5. Parameters and who can change them

| Parameter | Value | Set by | Changeable by | Bound |
|---|---|---|---|---|
| Backing band | 50–95% | compiled | nobody | constant |
| Protocol fee ceiling | 25% of margin | compiled | nobody | constant |
| Protocol fee | 12.5% of margin | admin at init | admin (multisig) | the ceiling |
| Per-player backing cap | $25 per game | admin | admin | none; launch value |
| Global backing cap | set at launch | admin | admin | none |
| Per-game backing cap | set by the studio at registration | studio | studio | none |
| Item price and backing | per class, by the studio | studio | backing up only; price fixed | the band |
| Supply cap | per class | studio at creation | nobody | fixed |
| Grant signer | per game | studio | studio, `update_game` | none |
| Daily material caps | per game, off-chain | studio server | studio | none |

Policy: parameter changes are announced on the solvency page before they take effect, and the fee is never raised without a public reason. The compiled constants are the promises; the admin parameters are the dials.

## 6. Sustainability without yield

The protocol's revenue is the fee on sales. The backing float, which grows with every craft and shrinks with every redeem, is never lent, staked or invested, so it earns nothing. We are explicit about this because it is the first "improvement" anyone suggests, and it would convert a fully reserved vault into a fractional one: any yield strategy that can lose money makes some redemption impossible, and the product is the promise that none is.

What that means for the model: revenue scales with sales, costs scale with players (rent) and transactions (fees), and the middle period is bridged by hosted services that studios pay for instead of running infrastructure (see the business model, section 5). The protocol treasury is spent on the audit, infrastructure, sponsored fees for pilot studios and the team, under a published policy.

## 7. Attack economics

| Attack | Cost to attacker | Gain | Bound |
|---|---|---|---|
| Farm crafts with bots | USDC price of every craft; at 95% backing, 5% lost per cycle | materials, limited editions | daily caps; materials are worthless outside the game |
| Fake a race time | impossible in Neon Racer: the chain replays the inputs | materials | verified runs |
| Wash crafting to inflate a studio's apparent sales | 12.5% of margin to the protocol, 5–50% of price lost per cycle | vanity | loses money every cycle |
| Drain the relayer | rate-limited; only fees and rent, never USDC | SOL | per-wallet limits, caps |
| Sybil the faucet (devnet) | new wallets are free, new IPs are not | test USDC | per-wallet, per-network, global caps; devnet only |
| Steal a studio's grant key | compromise their server | crafts the studio did not approve, each still paid for by a player | rotate with `update_game` |
| Steal the admin key | compromise a multisig | pause crafting, fee to 25%, caps | cannot touch money |

## 8. If a token were ever considered

Not planned, not funded, not in the roadmap. The conditions under which the question would even be opened:

1. The protocol has at least twenty studios live on mainnet for a year and a solvency record with zero days under 100%.
2. The admin role has already moved from the founding multisig to a council of studios, and the parameters they govern (fee within the ceiling, caps) are worth decentralising further.
3. The token's only function would be to vote on those parameters and on the protocol treasury's spending.

Hard rules, whatever happens: a token is never used as backing, never paid as a reward for playing, never required to craft or redeem, and never sold to players inside a game. Those are the four ways tokens killed the games this product was built to replace.

## 9. The numbers we track

| Metric | Why it matters | Target |
|---|---|---|
| Vault coverage (vault balance ÷ owed), per game, daily | the promise | 100%, every day, forever |
| Backing locked | the size of the guarantee | grows with GMV |
| Redemption rate (units redeemed ÷ units crafted, trailing 30 days) | whether items are worth keeping; a healthy game sits well below 50% | 15–35% |
| Crafts per paying player per month | engagement with the economy | 3 |
| Net player retention, 7 and 30 days | whether the game is worth playing | game-specific |
| Protocol fee per month | revenue | per the business model |
| Rent sponsored per new player | the dominant cost | under $0.70 |
| Verified runs per day | anti-cheat in use | all competitive runs |
