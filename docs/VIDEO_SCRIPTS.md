# Video scripts

Colosseum asks for two videos: a presentation of two to three minutes, which judges watch first, and a product demo of at most three minutes. Record the demo on your phone inside Telegram with screen recording, then record the pitch over slides or over the demo footage. Speak slowly. Each block below is about fifteen seconds.

## Pitch video (target 2:30)

**0:00 Problem.**
"Web3 games have mostly died, and they took their players' money with them. Tokens went to zero. NFTs found no buyers. When a studio shut down, every item it sold was worth nothing. Players learned the lesson: never put money into a web3 game."

**0:15 The idea.**
"PixelVault makes a game item a claim on real money. When you craft an item, most of its price is locked as USDC in a vault that the PixelVault program owns, not the studio. Burn the item any time and the USDC comes back to you. In-game purchases you can refund."

**0:30 Why the studio cannot cheat.**
"The studio picks the backing for each item inside a band of fifty to ninety-five percent. That band is compiled into the program. The studio can raise the backing, never lower it. It cannot withdraw from the vault and it cannot pause redemption. If the studio disappears, redemption still works, because it needs no server."

**0:50 Why the studio wants this.**
"Studios keep the unbacked margin on every sale, and they can charge more, because the player's real cost is only that margin. A one-dollar item with ninety percent backing costs the player ten cents. The protocol takes twelve and a half percent of the margin, and nothing on redemption."

**1:05 What we built.**
"This is live on Solana devnet as a Telegram Mini App. Neon Racer is a Unity racing game: win medals, earn materials, craft chassis and underglow, see the refund value before you pay, and redeem in one tap. You never hold SOL. Telegram login creates an embedded wallet and a relayer pays every fee."

**1:25 Proof of portability.**
"Then we built a second game, Glyph Forge, the way an outside studio would: only through the SDK, with its own backend and its own on-chain key. Move an item from one game to the other in a single transaction, at par. One wallet, two studios, one guarantee."

**1:45 Security.**
"The program has twelve adversarial tests, each asserting the exact error code. The relayer has a test for every rule in its threat model. The threat model maps every attack we considered to the test that stops it. All of it runs in CI on every push."

**2:00 What is next.**
"Next is mainnet with real USDC and launch caps, the first outside studios on the SDK, and a public solvency dashboard. We have also started verifying races on-chain: the program re-drives the player's inputs and derives the time itself, so no game server has to be trusted. That branch has thirty-seven passing tests today."

**2:20 Close.**
"PixelVault. In-game purchases you can refund. [your name], building from India."

## Demo video (target 2:45, no slides, phone screen recording)

Record in Telegram with a fresh account if you can, so the starter USDC and the first craft show up. Narrate over the recording afterwards.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Open t.me/pixelvault_racer_bot, tap Race. Login completes with no seed phrase. | "Telegram login. The wallet is created for you. You hold no SOL, ever." |
| 0:15 | Home: three tracks, USDC pill shows 2.00 after the starter grant. | "New players get two test dollars. Every price on this screen is in dollars." |
| 0:25 | Race one lap on Neon Harbor against the Nova ghost. Drift, boost, cross the line. | "A real game first. Drift to charge a boost, race the rival's ghost." |
| 0:55 | Results: medal and materials awarded. | "A medal pays materials. Materials only unlock crafting; they are not money." |
| 1:05 | Garage: hover an item, point at the price and the refund value. | "Every card shows two numbers. The price, and what you get back if you redeem." |
| 1:15 | Craft Cyan Pulse. No wallet popup. The car shows the underglow. | "One tap. The server signs a grant, the wallet signs silently, the relayer pays the fee." |
| 1:30 | Vault: holdings and Refundable value. Scroll to the live solvency panel. | "This panel reads every vault from the chain, not from our database. Every vault covers what it owes." |
| 1:45 | Press Redeem. The item burns and USDC rises. | "Redeem. The item is gone and the backing is back in my wallet. No buyer, no studio approval." |
| 2:00 | Vault: Move to another game on an item, pick a Glyph Forge frame, confirm. | "Or move the value to another game. One transaction, at par." |
| 2:15 | Open Glyph Forge. The frame shows on the name. Play a short run. | "Glyph Forge is a second studio's game. It knows I own the frame because it reads the chain." |
| 2:35 | Explorer: the program address and a craft transaction. | "Everything you saw is on Solana devnet. The repository has the tests and the threat model." |

## Recording notes

- Phone: turn on Do Not Disturb, set brightness high, record in portrait.
- Keep the Telegram top bar visible in at least one shot so judges see it is a real Mini App.
- If a transaction takes a few seconds, keep rolling and trim later rather than cutting mid-animation.
- Export at 1080p. Upload both videos to YouTube as unlisted and paste the links into the form.
