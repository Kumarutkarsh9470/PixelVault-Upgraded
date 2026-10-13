# Launch runbook: devnet to mainnet

What has to be true before real USDC touches this program, in the order it has to happen. Each step names the command or the owner. Nothing here is optional.

## 0. Gates that must be green first

| Gate | How we know |
|---|---|
| Program tests | `tools/wsl/test-program.sh`: vault, verified-runs and shipped-data suites all pass |
| SDK tests against the compiled program | `tools/wsl/test-sdk.sh` |
| Relayer rules | `node --test deploy/racer/test/*.test.mjs` |
| Independent audit of `pixelvault/programs/pixelvault` | report in `docs/audit/`, every high and medium finding closed and re-tested |
| Closed beta on devnet | two weeks, 50+ players, metrics in `docs/BETA.md` |
| Legal review of the non-custodial vault model for the markets we launch in | written opinion on file |

## 1. Keys

Four keys, four jobs, none shared:

| Key | Holds | Where it lives |
|---|---|---|
| Upgrade authority of the program | the ability to change the code | Squads multisig, 2 of 3, hardware signers |
| Protocol admin (`Protocol.admin`) | pause crafting, fee (capped at 25% of margin), launch caps | the same multisig, set with `transfer_admin` right after `init_protocol` |
| Studio key per game | register items, rotate grant signer, pause its own crafting | studio's own custody |
| Grant signer per game, sponsor fee payer, funder | hot keys on the server | secrets manager (Vercel encrypted env), rotated quarterly; the grant signer is rotated on-chain with `update_game` |

The deployer key that runs `init_protocol` is the one compiled into `constants.rs` as `PROTOCOL_ADMIN`. Replace it with the mainnet deployer before the mainnet build, deploy, initialise, then hand the admin role to the multisig with `transfer_admin` and verify with `update_protocol` from the multisig.

## 2. Mainnet build and deploy

```bash
# constants.rs: PROTOCOL_ADMIN = <mainnet deployer>
tools/wsl/build-program.sh
solana program deploy pixelvault/target/deploy/pixelvault.so --program-id <new mainnet program keypair> --url mainnet-beta --upgrade-authority <deployer>
solana program set-upgrade-authority <program id> --new-upgrade-authority <squads vault> --url mainnet-beta
```

Then `init_protocol` with the real USDC mint (`EPjFWdd5AuFqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`), the protocol treasury (a USDC account the multisig controls), the 12.5% fee, and the launch caps below. Then `transfer_admin` to the multisig.

## 3. Launch caps (day one values)

| Cap | Value | Why |
|---|---|---|
| Per player per game (`max_backed_per_player`) | 25 USDC | bounds any one wallet's exposure to an undiscovered bug |
| Per game (`backed_cap` at `register_game`) | 2,500 USDC | bounds one studio's vault |
| Global (`global_backed_cap`) | 10,000 USDC | bounds the protocol until the audit has aged a month in production |

Raise them with `update_protocol` and `update_game` from the multisig as volume and confidence grow. The 50–95% backing band and the 25% fee ceiling are compiled in and cannot be raised by anyone.

## 4. Deployment and configuration

- `web/src/data/chain.json` becomes the mainnet deployment file written by `npx pixelvault setup --deployment mainnet.json`; `tools/sync-data.mjs` copies it into the API functions.
- The faucet (`/api/faucet`) and the starter grant (`/api/starter`) refuse to run off devnet; keep them deployed, they answer 404.
- Vercel Pro: lifts the twelve-function cap and the ten-second function timeout that shaped the devnet layout.
- Environment on Vercel: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `GRANT_SIGNER_SECRET`, `GLYPH_GRANT_SIGNER_SECRET`, `SPONSOR_SECRET_KEY`, `RPC_URL` (a paid RPC, not the public endpoint), `SPONSOR_WARN_SOL`.
- Telegram: a production bot with the Mini App URL set in BotFather, separate from the devnet bot.

## 5. Operations

- `/api/health` is the uptime check: database, RPC, program, sponsor and funder balances, grant signers configured. Point an external monitor at it with a 5-minute interval and alert on 503.
- Sponsor wallet: start with 5 SOL; at devnet traffic one verified race costs about 0.00005 SOL in fees plus refunded rent. Top up when `/api/health` reports below `SPONSOR_WARN_SOL`.
- Database: Neon with point-in-time recovery enabled; the schema is self-applying and idempotent.
- Logs: every function logs errors to Vercel; forward them to an error tracker before launch.
- Rate limits: the relayer allows 60 sponsored transactions per wallet per 10 minutes and 400 per day; the faucet is devnet only.

## 6. Day-one checklist

1. `/solvency.html` shows every vault covered, read from mainnet.
2. One real craft and one real redeem from a fresh wallet, receipts in the launch notes.
3. One cross-game route.
4. One verified race on each track.
5. Relayer attack script (`tools/test-sponsor.mjs`) against production returns the expected refusals.
6. Pause and unpause crafting from the multisig once, to prove the switches work and redemption stays open throughout.
