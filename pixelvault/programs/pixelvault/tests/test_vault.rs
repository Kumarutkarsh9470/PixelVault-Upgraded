//! End-to-end proof of the backed-item mechanic:
//! craft splits the mint price into backing (vault) and margin (studio + protocol),
//! redeem burns the unit and returns exactly the backing.

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{
            instruction::Instruction, program_pack::Pack, system_instruction, system_program,
        },
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::{
            get_associated_token_address_with_program_id, spl_associated_token_account,
            ID as ASSOCIATED_TOKEN_ID,
        },
        token::{spl_token, ID as TOKEN_ID},
        token_2022::{spl_token_2022, ID as TOKEN_2022_ID},
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const GAME_ID: u64 = 1;
const CLASS_ID: u64 = 1;
/// 1 USDC at 6 decimals.
const PRICE: u64 = 1_000_000;
const BACKING_BPS: u16 = 8_000;
const EXPECTED_BACKING: u64 = 800_000;
const EXPECTED_PROTOCOL_FEE: u64 = 25_000; // 12.5% of the 200_000 margin
const EXPECTED_STUDIO_CUT: u64 = 175_000;

struct Ctx {
    svm: LiteSVM,
    authority: Keypair,
    player: Keypair,
    usdc_mint: Pubkey,
    game: Pubkey,
    item_class: Pubkey,
    item_mint: Pubkey,
    vault: Pubkey,
    treasury: Pubkey,
    protocol_treasury: Pubkey,
    player_usdc: Pubkey,
    player_item: Pubkey,
}

fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    signers: &[&Keypair],
    ixs: &[Instruction],
) -> Result<(), String> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
        .map_err(|e| e.to_string())?;
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?}", e.err))
}

fn token_amount(svm: &LiteSVM, address: &Pubkey) -> u64 {
    let account = svm.get_account(address).expect("token account missing");
    spl_token::state::Account::unpack(&account.data)
        .expect("not a token account")
        .amount
}

/// Token-2022 accounts created by the ATA program carry the ImmutableOwner
/// extension, so a plain unpack would fail here.
fn token_2022_amount(svm: &LiteSVM, address: &Pubkey) -> u64 {
    let account = svm.get_account(address).expect("token account missing");
    spl_token_2022::extension::StateWithExtensions::<spl_token_2022::state::Account>::unpack(
        &account.data,
    )
    .expect("not a token-2022 account")
    .base
    .amount
}

fn setup() -> Ctx {
    let program_id = pixelvault::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/pixelvault.so"
    ));
    svm.add_program(program_id, bytes).unwrap();

    let authority = Keypair::new();
    let player = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&player.pubkey(), 10_000_000_000).unwrap();

    // Mock USDC: a classic SPL Token mint with 6 decimals.
    let usdc = Keypair::new();
    let mint_len = spl_token::state::Mint::LEN;
    let rent = svm.minimum_balance_for_rent_exemption(mint_len);
    let create_mint = system_instruction::create_account(
        &authority.pubkey(),
        &usdc.pubkey(),
        rent,
        mint_len as u64,
        &TOKEN_ID,
    );
    let init_mint = spl_token::instruction::initialize_mint2(
        &TOKEN_ID,
        &usdc.pubkey(),
        &authority.pubkey(),
        None,
        6,
    )
    .unwrap();
    send(
        &mut svm,
        &authority,
        &[&authority, &usdc],
        &[create_mint, init_mint],
    )
    .unwrap();

    // USDC accounts for the player, the studio treasury and the protocol treasury.
    let protocol = Keypair::new();
    let mut ixs = vec![];
    for owner in [&player.pubkey(), &authority.pubkey(), &protocol.pubkey()] {
        ixs.push(
            spl_associated_token_account::instruction::create_associated_token_account(
                &authority.pubkey(),
                owner,
                &usdc.pubkey(),
                &TOKEN_ID,
            ),
        );
    }
    let player_usdc =
        get_associated_token_address_with_program_id(&player.pubkey(), &usdc.pubkey(), &TOKEN_ID);
    ixs.push(
        spl_token::instruction::mint_to(
            &TOKEN_ID,
            &usdc.pubkey(),
            &player_usdc,
            &authority.pubkey(),
            &[],
            10 * PRICE,
        )
        .unwrap(),
    );
    send(&mut svm, &authority, &[&authority], &ixs).unwrap();

    let game = Pubkey::find_program_address(&[b"game", &GAME_ID.to_le_bytes()], &program_id).0;
    let item_class = Pubkey::find_program_address(
        &[b"class", game.as_ref(), &CLASS_ID.to_le_bytes()],
        &program_id,
    )
    .0;

    Ctx {
        svm,
        usdc_mint: usdc.pubkey(),
        vault: get_associated_token_address_with_program_id(&game, &usdc.pubkey(), &TOKEN_ID),
        treasury: get_associated_token_address_with_program_id(
            &authority.pubkey(),
            &usdc.pubkey(),
            &TOKEN_ID,
        ),
        protocol_treasury: get_associated_token_address_with_program_id(
            &protocol.pubkey(),
            &usdc.pubkey(),
            &TOKEN_ID,
        ),
        player_usdc,
        // Both are filled in once the item class exists.
        player_item: Pubkey::default(),
        item_mint: Pubkey::default(),
        game,
        item_class,
        authority,
        player,
    }
}

fn init_game(ctx: &mut Ctx) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        pixelvault::id(),
        &pixelvault::instruction::InitGame { game_id: GAME_ID }.data(),
        pixelvault::accounts::InitGame {
            authority: ctx.authority.pubkey(),
            game: ctx.game,
            usdc_mint: ctx.usdc_mint,
            vault: ctx.vault,
            treasury: ctx.treasury,
            usdc_token_program: TOKEN_ID,
            associated_token_program: ASSOCIATED_TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let authority = ctx.authority.insecure_clone();
    send(&mut ctx.svm, &authority, &[&authority], &[ix])
}

fn create_item_class(ctx: &mut Ctx, backing_bps: u16) -> Result<Keypair, String> {
    let item_mint = Keypair::new();
    let ix = Instruction::new_with_bytes(
        pixelvault::id(),
        &pixelvault::instruction::CreateItemClass {
            class_id: CLASS_ID,
            price: PRICE,
            backing_bps,
        }
        .data(),
        pixelvault::accounts::CreateItemClass {
            authority: ctx.authority.pubkey(),
            game: ctx.game,
            item_class: ctx.item_class,
            item_mint: item_mint.pubkey(),
            item_token_program: TOKEN_2022_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let authority = ctx.authority.insecure_clone();
    send(&mut ctx.svm, &authority, &[&authority, &item_mint], &[ix])?;
    Ok(item_mint)
}

fn craft(ctx: &mut Ctx) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        pixelvault::id(),
        &pixelvault::instruction::Craft {}.data(),
        pixelvault::accounts::Craft {
            player: ctx.player.pubkey(),
            game: ctx.game,
            item_class: ctx.item_class,
            usdc_mint: ctx.usdc_mint,
            player_usdc: ctx.player_usdc,
            vault: ctx.vault,
            treasury: ctx.treasury,
            protocol_treasury: ctx.protocol_treasury,
            item_mint: ctx.item_mint,
            player_item: ctx.player_item,
            usdc_token_program: TOKEN_ID,
            item_token_program: TOKEN_2022_ID,
            associated_token_program: ASSOCIATED_TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let player = ctx.player.insecure_clone();
    send(&mut ctx.svm, &player, &[&player], &[ix])
}

fn redeem(ctx: &mut Ctx) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        pixelvault::id(),
        &pixelvault::instruction::Redeem {}.data(),
        pixelvault::accounts::Redeem {
            player: ctx.player.pubkey(),
            game: ctx.game,
            item_class: ctx.item_class,
            usdc_mint: ctx.usdc_mint,
            player_usdc: ctx.player_usdc,
            vault: ctx.vault,
            item_mint: ctx.item_mint,
            player_item: ctx.player_item,
            usdc_token_program: TOKEN_ID,
            item_token_program: TOKEN_2022_ID,
        }
        .to_account_metas(None),
    );
    let player = ctx.player.insecure_clone();
    send(&mut ctx.svm, &player, &[&player], &[ix])
}

fn load_game(ctx: &Ctx) -> pixelvault::state::Game {
    let account = ctx.svm.get_account(&ctx.game).unwrap();
    let mut data: &[u8] = &account.data;
    pixelvault::state::Game::try_deserialize(&mut data).unwrap()
}

fn load_class(ctx: &Ctx) -> pixelvault::state::ItemClass {
    let account = ctx.svm.get_account(&ctx.item_class).unwrap();
    let mut data: &[u8] = &account.data;
    pixelvault::state::ItemClass::try_deserialize(&mut data).unwrap()
}

#[test]
fn craft_splits_price_and_redeem_returns_backing() {
    let mut ctx = setup();
    init_game(&mut ctx).expect("init_game failed");

    let item_mint = create_item_class(&mut ctx, BACKING_BPS).expect("create_item_class failed");
    ctx.item_mint = item_mint.pubkey();
    ctx.player_item = get_associated_token_address_with_program_id(
        &ctx.player.pubkey(),
        &ctx.item_mint,
        &TOKEN_2022_ID,
    );

    let class = load_class(&ctx);
    assert_eq!(class.backing_per_unit, EXPECTED_BACKING);
    assert_eq!(class.backed_supply, 0);

    let player_usdc_before = token_amount(&ctx.svm, &ctx.player_usdc);
    craft(&mut ctx).expect("craft failed");

    // The price splits into backing, studio margin and protocol fee.
    assert_eq!(token_amount(&ctx.svm, &ctx.vault), EXPECTED_BACKING);
    assert_eq!(token_amount(&ctx.svm, &ctx.treasury), EXPECTED_STUDIO_CUT);
    assert_eq!(
        token_amount(&ctx.svm, &ctx.protocol_treasury),
        EXPECTED_PROTOCOL_FEE
    );
    assert_eq!(
        token_amount(&ctx.svm, &ctx.player_usdc),
        player_usdc_before - PRICE
    );
    assert_eq!(token_2022_amount(&ctx.svm, &ctx.player_item), 1);

    let game = load_game(&ctx);
    assert_eq!(game.total_backed, EXPECTED_BACKING);
    assert_eq!(load_class(&ctx).backed_supply, 1);

    // Redemption returns exactly the backing and burns the unit.
    redeem(&mut ctx).expect("redeem failed");
    assert_eq!(token_2022_amount(&ctx.svm, &ctx.player_item), 0);
    assert_eq!(token_amount(&ctx.svm, &ctx.vault), 0);
    assert_eq!(
        token_amount(&ctx.svm, &ctx.player_usdc),
        player_usdc_before - PRICE + EXPECTED_BACKING
    );
    assert_eq!(load_game(&ctx).total_backed, 0);
    assert_eq!(load_class(&ctx).backed_supply, 0);

    // The studio keeps its margin either way: that is the whole business model.
    assert_eq!(token_amount(&ctx.svm, &ctx.treasury), EXPECTED_STUDIO_CUT);
}

#[test]
fn backing_ratio_outside_band_is_rejected() {
    let mut ctx = setup();
    init_game(&mut ctx).expect("init_game failed");

    // Above the 95% ceiling: mint and redeem round trips would be costless.
    assert!(create_item_class(&mut ctx, 9_900).is_err());
    // Below the 50% floor: not meaningfully refundable.
    assert!(create_item_class(&mut ctx, 1_000).is_err());
    // Inside the band: accepted.
    assert!(create_item_class(&mut ctx, 5_000).is_ok());
}
