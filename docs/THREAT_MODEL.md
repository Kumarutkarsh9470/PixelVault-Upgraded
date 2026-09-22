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

| Attack | Defence | Evidence |
|---|---|---|
| Drain the sponsor with a transfer | Only the PixelVault program, the Ed25519 precompile and SPL Memo may appear | `tools/test-sponsor.mjs` (drain attempt) |
| Attach a large priority fee | The Compute Budget program is not allowed | `tools/test-sponsor.mjs` (priority-fee attempt) |
| Use the sponsor as an account | The sponsor may appear only as `craft`'s rent payer (account index 1), identified by discriminator | `tools/test-sponsor.mjs` (sponsor-as-account attempt) |
| Hide accounts in a lookup table | Address lookup tables are rejected | `deploy/racer/api/sponsor.js` |

### On the game backend

| Attack | Defence |
|---|---|
| Impersonate another player | Every endpoint verifies Telegram's HMAC over the Mini App init data with the bot token, and rejects init data older than 24 hours |
| Submit an impossible time | Lap count, a minimum time derived from top speed, the exact number of checkpoint splits, monotonic splits and a per-segment speed limit are all checked server-side |
| Farm materials by replaying | Material rewards are capped per track per day |
| Spend the same materials twice | Materials are reserved and the grant recorded in one serializable statement |
| Lose materials to a failed transaction | Unused grants are refunded once they expire, settled against the player's on-chain sequence number |

## Known limitations

- **Gameplay is verified by plausibility, not replay.** A skilled cheater who produces realistic checkpoint times can earn materials they didn't drive for. Materials only unlock the right to buy; every item is still paid for in USDC, so this cannot extract value. Verifiable replays are on the roadmap.
- **A compromised grant signer** could authorise crafts without gameplay, but not free items: crafting still requires the player's USDC. Studios can rotate the signer with `update_game`.
- **The admin key is a single key** on devnet. Mainnet will use a fresh key, with a multisig as the next step.
- **Not audited.** Launch caps (per player $25, plus per-game and global caps) bound the loss from any undiscovered bug.
