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

## Demo video (2:50, live product only, every screen)

The form says: live product, not slides, not code. So the whole video is a screen recording of the Mini App on your phone, with one short desktop shot at the end. No title card, no slides, no editor. Narrate over the footage afterwards. Each row is one navigation; keep the on-screen time to the seconds given and it lands under three minutes.

Before recording: a fresh Telegram account or a wallet with no items, so the starter grant and the first craft show. Do Not Disturb on. Brightness high. Keep the Telegram top bar in frame.

| Time | Navigate to | Show | Say |
|---|---|---|---|
| 0:00 | Telegram chat with the bot, tap **Race** | The Mini App opens, boot screen with the spinner and tips, then the sign-in card. Tap Sign in. | "This is PixelVault, a Telegram Mini App on Solana. Login creates my wallet. No seed phrase, no SOL." |
| 0:12 | **Home** | The 3D track behind the panel. Swipe through the three track tabs, point at the medal targets and the USDC pill reading $2.00. | "Three tracks, each with medal times. New players get two test dollars. Everything is priced in dollars." |
| 0:24 | **Race against** row | Tap Nova, then Leader. | "I can race the calibrated rival, the current leader's recorded line, or my own best." |
| 0:30 | Tap **RACE** | Start lights, GO, then drive one full lap: drift a corner, boost out, overtake the ghost. Keep the HUD visible: lap ring, time, delta pill, speedometer. | "A real racing game first. Drift to charge a boost. The delta shows me against the ghost in real time." |
| 1:00 | Finish | Finish overlay with confetti, then the **Results** sheet: medal reveal, the medal ladder, sector bars, and the earned material chip. Scroll once. | "Medal. Where my time sits against gold, silver and bronze. Sector by sector against the rival. And I earned a material." |
| 1:15 | **Garage** (bottom nav) | The car on the turntable. Tap Underglow, tap Cyan Pulse: the car lights up. Point at price, locked share and refund on the backing meter. | "Every item shows two numbers before I pay: the price and what I get back. Seventy percent of this one is locked as USDC." |
| 1:30 | Tap **Craft** | No wallet popup. Balance drops, the item shows ×1, Equip appears. | "One tap. My wallet signs silently, a relayer pays the fee, and the backing goes into a vault the studio cannot touch." |
| 1:42 | **Vault** (bottom nav) | Refundable value counts up. The holding card with its backing meter. | "This is my money, held by the program. Refundable value: twenty-one cents." |
| 1:50 | Tap **Redeem** | Item disappears, USDC rises. | "Redeem. No buyer, no studio approval. The item burns and the USDC is back. This works even if the studio shuts down." |
| 2:00 | Craft one more in Garage, back to Vault, tap **Move to another game**, pick a Glyph Forge frame | The route options with the top-up amount; confirm. | "Or move the value to another game, at par, in one transaction." |
| 2:12 | Scroll to **Protocol, live from the chain** | The solvency bars for both games. | "Every vault, what it owes, read straight from Solana. Fully covered." |
| 2:20 | **Ranks** (bottom nav) | The podium and the list with gaps to the leader. | "Leaderboards, with the frame I just moved shown on my name." |
| 2:27 | Home → **Glyph Forge** link | Glyph Forge menu, tap **Run**, play ten seconds, crash, results with runes. Tap **Forge**, show the frames with their backing meters. | "A second game, from a second studio, built only on the public SDK. Same wallet. Every run is replayed on the server." |
| 2:42 | Desktop browser, pixelvault-racer.vercel.app | The showcase banner and the home screen on a laptop. | "Judges can open it in any browser in showcase mode. The code, the SDK on npm, and the tests are on GitHub." |
| 2:50 | End on the Vault screen in Telegram | | "PixelVault. In-game purchases you can refund." |

If a transaction takes a few seconds, keep rolling and trim the wait in the edit rather than cutting mid-animation. If you run long, cut the Ranks row and the desktop shot first; the race, craft and redeem are the ones that matter.

## Recording notes

- Phone: turn on Do Not Disturb, set brightness high, record in portrait.
- Keep the Telegram top bar visible in at least one shot so judges see it is a real Mini App.
- If a transaction takes a few seconds, keep rolling and trim later rather than cutting mid-animation.
- Export at 1080p. Upload both videos to YouTube as unlisted and paste the links into the form.
