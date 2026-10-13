# Video scripts

Colosseum asks for two videos: a presentation of two to three minutes, which judges watch first, and a product demo of at most three minutes. Record the demo on your phone inside Telegram with screen recording, then record the pitch over slides or over the demo footage. Speak slowly. Each block below is about fifteen seconds.

## Pitch video (2:40, you on camera plus product footage)

Judges watch this one first and judge it as a startup pitch: team, insight, product, market, viability. Record yourself with the phone camera for the open and close, and lay product footage from the demo recording under the middle. Six simple slides, text below, cover the numbers; everything else is the live product on screen. One row per block, with the seconds, what is on screen, and the words.

| Time | On screen | Say |
|---|---|---|
| 0:00 | You, on camera. | "I'm [name], from [city]. I build games, and I've watched web3 games kill their own economies. PixelVault fixes the one thing players never forgave: losing their money." |
| 0:12 | Slide 1: PROBLEM. | "Every web3 game economy has died the same way. Tokens to zero. NFTs with no buyers. A studio shuts down and every item it sold is worth nothing. Players learned: never put money into a web3 game." |
| 0:27 | Footage: Garage, the backing meter on an item (price, locked share, refund). | "PixelVault makes a game item a claim on real money. When you craft an item, most of its price is locked as USDC in a vault owned by the program, not the studio. Burn the item any time and the USDC comes back. In-game purchases you can refund." |
| 0:45 | Slide 2: THE GUARANTEE. | "The studio picks the backing inside a band of fifty to ninety-five percent, compiled into the program. It can raise backing, never lower it. It cannot withdraw from the vault and it cannot pause redemption. If the studio disappears, redemption still works, because it needs no server." |
| 1:03 | Slide 3: THE MODEL. | "Studios keep the unbacked margin and can charge more, because the player's real cost is only that margin. A one-dollar item with ninety percent backing costs the player ten cents. The protocol takes twelve and a half percent of the margin, nothing on redemption. We earn only when studios sell." |
| 1:20 | Footage: Telegram launch, a race lap, the finish, Results with the medal and the earned material. | "It's live on Solana devnet as a Telegram Mini App. Neon Racer is a real racing game: win medals, earn materials, craft cosmetics. You never hold SOL. Telegram login creates an embedded wallet and a relayer pays every fee." |
| 1:38 | Footage: Vault, Redeem, then Move to another game into a Glyph Forge frame, then Glyph Forge running. | "Then we built a second game the way an outside studio would: only through the SDK, its own backend, its own on-chain key. Move an item from one game to the other in one transaction, at par. One wallet, two studios, one guarantee." |
| 1:55 | Slide 4: FOR STUDIOS. | "A studio integrates with one command. The SDK is on npm; npx pixelvault setup registers a game and its items from a catalog file; the fee-payer relayer ships as a library with its safety rules tested. A third game went on devnet this way in two transactions." |
| 2:10 | Slide 5: PROOF. | "Twelve adversarial program tests asserting exact error codes. SDK tests against the compiled program. Every relayer rule tested on real transactions. A threat model that maps each attack to the test that stops it. All in CI." |
| 2:22 | Slide 6: NEXT. | "Next: mainnet with real USDC and launch caps, the first outside studios on the SDK, a public solvency dashboard, and races the chain verifies itself, which already has thirty-seven passing tests on a branch." |
| 2:34 | You, on camera. | "Players get their money back. Studios get paid more. PixelVault. [name], building from India." |

### The six slides

Plain dark background, one headline, three to four short lines, no logos. Ten minutes in any slide tool.

1. **PROBLEM**: Tokens to zero · NFTs with no buyers · Studio gone, items worth nothing · Players stopped trusting
2. **THE GUARANTEE**: Backing 50–95%, compiled into the program · Can rise, never fall · No withdrawal, no pause · Redemption needs no server
3. **THE MODEL**: $1.00 item, 90% backing → player's real cost $0.10 · Studio keeps the margin · Protocol: 12.5% of margin · Redemption free
4. **FOR STUDIOS**: npm install pixelvault-sdk · npx pixelvault setup · createSponsor: relayer with rules · Third game registered in two transactions
5. **PROOF**: 12 adversarial program tests · SDK tests vs the compiled program · Relayer rules tested on real transactions · Threat model → test, all in CI
6. **NEXT**: Mainnet, real USDC, launch caps · First outside studios · Public solvency dashboard · Chain-verified races (37 tests, in progress)

Record the on-camera open and close in one take each, in good light, phone at eye level. Export at 1080p, upload unlisted to YouTube, and paste the link into the presentation-video field. If you run long, shorten slide 5 to one sentence; never cut the footage rows.

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
