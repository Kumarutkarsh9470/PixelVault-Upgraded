# PixelVault threat model

PixelVault holds real USDC on behalf of players. This document lists what we protect, who might attack it, and how each attack is stopped — with the test or code that shows it.

## What must never break

1. **Every vault covers what it owes.** A game's USDC vault balance is always at least the total backing of its items in circulation.
2. **Redemption always works.** Burning an item returns exactly its backing, with no pause switch, no cap, and no dependency on the game's server or the studio.
3. **Backing never goes down.** A studio can raise an item class's backing (depositing the difference for every unit already in circulation) but can never lower it or withdraw it.
4. **The sponsor pays fees and rent, nothing else.** The relayer's fee payer cannot be drained through the transactions it co-signs.

## Actors

| Actor | Trust | Could want to |
|---|---|---|
| Player | Untrusted | Craft without earning materials, replay grants, redeem more than they paid, drain the sponsor |
| Studio (game authority) | Trusted with its own game only | Take backing, lower backing, pause redemption, mint unbacked items |
| Game server (grant signer) | Trusted to authorise crafts for its game | If compromised: authorise crafts without gameplay |
| Protocol admin | Trusted with fee and caps | Raise fees, freeze redemptions |
| Relayer | Trusted to sign only safe transactions | If misconfigured: pay for arbitrary transactions |

## Attacks and defences

### On backing

| Attack | Defence | Evidence |
|---|---|---|
| Studio withdraws backing | The vault is an associated token account owned by the game PDA; no instruction transfers out of it except `redeem`, which pays the redeeming holder exactly one unit's backing | `redeem.rs`; no other instruction signs for the vault |
| Studio lowers backing | `raise_backing` rejects any ratio not strictly higher than the current one | `raising_backing_tops_up_every_unit_in_circulation` |
| Studio sets a token backing ratio | Ratios outside the 50–95% band are rejected at class creation | `backing_ratio_outside_band_is_rejected` |
| Unbacked items minted | The item mint's only authority is the game PDA, which mints only inside `craft` after the backing transfer | `create_item_class.rs`, `craft.rs` |
| Accounting drift | Every craft, redeem and raise re-reads the vault and asserts `vault.amount >= game.total_backed` | `VaultUndercollateralized` checks |
| Admin or studio pauses redemption | Pausing (`update_game`, `update_protocol`) stops crafting only; `redeem` never reads a pause flag | `pause_stops_crafting_but_never_redemption` |
| Admin raises the fee without limit | The fee is a share of margin only, hard-capped at 25% by a constant | `MAX_PROTOCOL_FEE_BPS` |

### On crafting

| Attack | Defence | Evidence |
|---|---|---|
| Craft without a grant | `craft` requires the preceding instruction to be an Ed25519 precompile verification | `craft_without_grant_is_rejected` |
| Forge a grant | The precompile signature must come from the game's registered grant signer | `grant_from_wrong_signer_is_rejected` |
| Reuse a grant for another item or player | The signed digest binds program, game, class, player, sequence and expiry; any mismatch fails | `grant_for_another_class_is_rejected` |
| Replay a grant | Each player has an on-chain sequence number per game; a grant is valid only for the next one | `replayed_grant_is_rejected` |
| Use a stale grant | Grants carry an expiry checked against the cluster clock (180 s) | `expired_grant_is_rejected` |
| Point the precompile at unrelated data | All three data references in the precompile instruction must point inside itself | `grant.rs` (`SELF_INSTRUCTION` check) |
| Exceed launch limits | Per-player, per-game and global backing caps, plus per-class supply caps | `per_player_cap_is_enforced`, `supply_cap_is_enforced` |

### On the relayer

Rules are in `inspect` in `deploy/racer/api/sponsor.js`; the named tests are in `deploy/racer/test/sponsor.test.mjs` and run in CI. `tools/test-sponsor.mjs` repeats the main attacks against a live server on devnet.

| Attack | Defence | Evidence |
|---|---|---|
| Use the relayer anonymously | Every sponsored transaction needs Telegram launch data, verified like every other endpoint | `tools/test-sponsor.mjs` (no Telegram login) |
| Pay for someone else's transactions | The only signer besides the sponsor must be the wallet linked to the caller's Telegram account | `refuses signers other than the caller's linked wallet` |
| Drain the sponsor with a transfer | Only PixelVault, the Ed25519 precompile, SPL Memo and SPL Token may appear | `refuses draining the sponsor with a transfer` |
| Attach a large priority fee | The Compute Budget program is not allowed | `refuses a priority fee the sponsor would pay` |
| Use the sponsor as an account | The sponsor may appear only as `craft`'s rent payer (account index 1), identified by discriminator | `refuses the sponsor in any role but craft's rent payer` |
| Have the sponsor pay for studio operations | Of PixelVault's instructions, only `craft` and `redeem` are sponsored | `refuses anything that is not craft or redeem in PixelVault` |
| Abuse withdrawals | Only USDC `TransferChecked`, authorised by the caller's own wallet, at least $0.10, alone in its transaction; destinations must already have a USDC account, so the sponsor never pays rent for one | `withdrawals: USDC only, TransferChecked only, at least the minimum, on their own` |
| Burn fees by spamming valid transactions | At most 20 sponsored transactions per wallet per 10 minutes and 150 per day, each recorded in `sponsored_txs` | `RATE_LIMITS` in `sponsor.js` |
| Hide accounts in a lookup table | Address lookup tables are rejected | `deploy/racer/api/sponsor.js` |

### On the game backend

| Attack | Defence |
|---|---|
| Impersonate another player | Every endpoint verifies Telegram's HMAC over the Mini App init data with the bot token, and rejects init data older than 24 hours |
| Submit an impossible time | Lap count, a minimum time derived from top speed, the exact number of checkpoint splits, monotonic splits and a per-segment speed limit are all checked server-side |
| Farm materials by replaying | Material rewards are capped per track per day |
| Spend the same materials twice | Materials are reserved and the grant recorded in one serializable statement |
| Lose materials to a failed transaction | Unused grants are refunded once they expire, settled against the player's on-chain sequence number |

### On Glyph Forge runs

Glyph Forge replays every run instead of judging it. The rules are `deploy/racer/api/glyph/_lib/runner.js` (server) and `RunnerSim.cs` (client), kept identical by `glyph/level/vectors.*`; the tests named below are in `deploy/racer/test/glyph-judge.test.mjs` and `glyph-runner.test.mjs`.

| Attack | Defence | Evidence |
|---|---|---|
| Claim runes that were never reached | The client sends only its inputs; the server replays them on the run's seed and pays exactly the runes the replay collected | `a played run earns exactly the runes its replay collected` |
| Report surviving longer than you did | The replay decides when the run ended, whatever the client claims | `the replay, not the client, decides how the run ended` |
| Compute perfect inputs offline and submit instantly | A run cannot be longer than the wall-clock time since its seed was issued (3 s slack) | `a run cannot be longer than the time since its seed was issued` |
| Shop for an easy seed | The server picks the seed; starting a new run abandons the last one, and starts are limited to 120 an hour | `api/glyph/start.js` |
| Submit the same run twice | Submission flips `finished_at` in a single conditional update | `api/glyph/run.js` |
| Farm with a perfect bot | Runes are capped at 60 per player per 24 hours, and every item still costs USDC | `rewards stop at the daily cap, in collection order` |
| Malformed or oversized input logs | Strictly increasing ticks within the run, known actions only, at most one input per three ticks on average | `malformed input logs are refused before replay` |
| Client and server rules drift apart | CI compiles the C# simulation with Mono and checks it against vectors generated from the server's rules | `tools/glyph-verify.sh` |

### Between studios

| Attack | Defence | Evidence |
|---|---|---|
| One studio's server authorises crafts in another's game | Each game registers its own grant signer on-chain, and each server signs only for its own game id | `grant_from_wrong_signer_is_rejected`; `api/grant.js` and `api/glyph/grant.js` |
| A leaked grant key keeps working | The studio rotates it with `update_game`; grants from the old key are then rejected | SDK test `a studio rotates its grant signer with update_game, and the old key's grants stop working` |
| Showing a frame you don't own on a leaderboard | Each game's server checks on-chain ownership (`itemBalance`) before storing the frame it shows | `verifiedFrame` in `api/_lib/chain.js` and `api/glyph/_lib/studio.js` |

## Known limitations

- **Neon Racer runs are verified by plausibility, not replay.** A skilled cheater who produces realistic checkpoint times can earn materials they didn't drive for. Materials only unlock the right to buy; every item is still paid for in USDC, so this cannot extract value. Glyph Forge already replays every run; the racer's physics would need the same deterministic rewrite.
- **A compromised grant signer** could authorise crafts without gameplay, but not free items: crafting still requires the player's USDC. Studios can rotate the signer with `update_game`.
- **The admin key is a single key** on devnet. Mainnet will use a fresh key, with a multisig as the next step.
- **Not audited.** Launch caps (per player $25, plus per-game and global caps) bound the loss from any undiscovered bug.
