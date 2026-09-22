//! Integration tests for the PixelVault program, run against litesvm.
//!
//! The central case is the production path: a player holding zero SOL crafts
//! with a server-signed material grant, the sponsor pays fees and rent, and
//! redemption returns exactly the backing. The rest are adversarial checks,
//! each asserting the program's specific error code.

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
    pixelvault::{error::PixelVaultError, grant::grant_message, PROTOCOL_ADMIN},
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
const FEE_BPS: u16 = 1_250;
const EXPECTED_BACKING: u64 = 800_000;
const EXPECTED_PROTOCOL_FEE: u64 = 25_000; // 12.5% of the 200_000 margin
const EXPECTED_STUDIO_CUT: u64 = 175_000;
const NEVER_EXPIRES: i64 = i64::MAX;

struct World {
    svm: LiteSVM,
    admin: Keypair,
    studio: Keypair,
    grant_signer: Keypair,
    player: Keypair,
    sponsor: Keypair,
    usdc_mint: Pubkey,
    protocol: Pubkey,
    protocol_treasury: Pubkey,
    studio_treasury: Pubkey,
    studio_usdc: Pubkey,
    game: Pubkey,
    vault: Pubkey,
    player_usdc: Pubkey,
}

struct ItemClassRefs {
    class: Pubkey,
    mint: Pubkey,
    player_item: Pubkey,
}

fn custom(error: PixelVaultError) -> String {
    format!("Custom({})", error as u32 + 6000)
}

/// Reads the local Solana CLI keypair; it must be the hard-coded protocol admin.
fn admin_keypair() -> Keypair {
    let home = std::env::var("HOME").expect("HOME is not set");
    let raw = std::fs::read_to_string(format!("{home}/.config/solana/id.json"))
        .expect("~/.config/solana/id.json is required: it must match PROTOCOL_ADMIN");
    let bytes: Vec<u8> = raw
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(|b| b.trim().parse().expect("keypair file is not a JSON byte array"))
        .collect();
    let admin = Keypair::try_from(bytes.as_slice()).expect("invalid keypair bytes");
    assert_eq!(admin.pubkey(), PROTOCOL_ADMIN, "local keypair is not PROTOCOL_ADMIN");
    admin
}

fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    signers: &[&Keypair],
    ixs: &[Instruction],
) -> Result<(), String> {
    // A fresh blockhash each time, so a deliberately repeated transaction is
    // judged by the program rather than dropped as a duplicate.
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers)
        .map_err(|e| e.to_string())?;
    svm.send_transaction(tx).map(|_| ()).map_err(|e| {
        let anchor_error = e
            .meta
            .logs
            .iter()
            .filter(|l| l.contains("AnchorError") || l.contains("Error Message"))
            .cloned()
            .collect::<Vec<_>>()
            .join(" | ");
        format!("{:?} {}", e.err, anchor_error)
    })
}

fn expect_error(result: Result<(), String>, error: PixelVaultError) {
    let err = result.expect_err("transaction should have failed");
    assert!(
        err.contains(&custom(error)),
        "expected {} but got {err}",
        custom(error)
    );
}

fn token_amount(svm: &LiteSVM, address: &Pubkey) -> u64 {
    let account = svm.get_account(address).expect("token account missing");
    spl_token::state::Account::unpack(&account.data)
        .expect("not a token account")
        .amount
}

/// Token-2022 accounts created by the ATA program carry the ImmutableOwner
/// extension, so a plain unpack would fail here.
fn item_amount(svm: &LiteSVM, address: &Pubkey) -> u64 {
    match svm.get_account(address) {
        None => 0,
        Some(account) => spl_token_2022::extension::StateWithExtensions::<
            spl_token_2022::state::Account,
        >::unpack(&account.data)
        .expect("not a token-2022 account")
        .base
        .amount,
    }
}

fn load<T: AccountDeserialize>(svm: &LiteSVM, address: &Pubkey) -> T {
    let account = svm.get_account(address).expect("account missing");
    let mut data: &[u8] = &account.data;
    T::try_deserialize(&mut data).expect("failed to deserialize")
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &pixelvault::id()).0
}

/// Builds the Ed25519 precompile instruction a game server's grant rides in.
fn ed25519_ix(signer: &Keypair, message: &[u8]) -> Instruction {
    let signature = signer.sign_message(message);
    let pubkey_offset: u16 = 16; // 2-byte header + 14-byte offsets struct
    let signature_offset = pubkey_offset + 32;
    let message_offset = signature_offset + 64;

    let mut data = vec![1u8, 0u8];
    for value in [
        signature_offset,
        u16::MAX,
        pubkey_offset,
        u16::MAX,
        message_offset,
        message.len() as u16,
        u16::MAX,
    ] {
        data.extend_from_slice(&value.to_le_bytes());
    }
    data.extend_from_slice(signer.pubkey().as_ref());
    data.extend_from_slice(signature.as_ref());
    data.extend_from_slice(message);

    Instruction {
        program_id: solana_sdk_ids::ed25519_program::ID,
        accounts: vec![],
        data,
    }
}

fn setup(max_backed_per_player: u64) -> World {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/pixelvault.so"
    ));
    svm.add_program(pixelvault::id(), bytes).unwrap();

    let admin = admin_keypair();
    let studio = Keypair::new();
    let grant_signer = Keypair::new();
    let player = Keypair::new(); // deliberately never funded with SOL
    let sponsor = Keypair::new();
    let protocol_owner = Keypair::new();
    for key in [&admin, &studio, &sponsor] {
        svm.airdrop(&key.pubkey(), 10_000_000_000).unwrap();
    }

    // Mock USDC: a classic SPL Token mint with 6 decimals.
    let usdc = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(spl_token::state::Mint::LEN);
    send(
        &mut svm,
        &admin,
        &[&admin, &usdc],
        &[
            system_instruction::create_account(
                &admin.pubkey(),
                &usdc.pubkey(),
                rent,
                spl_token::state::Mint::LEN as u64,
                &TOKEN_ID,
            ),
            spl_token::instruction::initialize_mint2(
                &TOKEN_ID,
                &usdc.pubkey(),
                &admin.pubkey(),
                None,
                6,
            )
            .unwrap(),
        ],
    )
    .unwrap();

    let ata = |owner: &Pubkey| {
        get_associated_token_address_with_program_id(owner, &usdc.pubkey(), &TOKEN_ID)
    };
    let mut ixs = vec![];
    for owner in [&player.pubkey(), &studio.pubkey(), &protocol_owner.pubkey()] {
        ixs.push(
            spl_associated_token_account::instruction::create_associated_token_account(
                &admin.pubkey(),
                owner,
                &usdc.pubkey(),
                &TOKEN_ID,
            ),
        );
    }
    for owner in [&player.pubkey(), &studio.pubkey()] {
        ixs.push(
            spl_token::instruction::mint_to(
                &TOKEN_ID,
                &usdc.pubkey(),
                &ata(owner),
                &admin.pubkey(),
                &[],
                100 * PRICE,
            )
            .unwrap(),
        );
    }
    send(&mut svm, &admin, &[&admin], &ixs).unwrap();

    let protocol = pda(&[b"protocol"]);
    let game = pda(&[b"game", &GAME_ID.to_le_bytes()]);
    let world = World {
        usdc_mint: usdc.pubkey(),
        protocol,
        protocol_treasury: ata(&protocol_owner.pubkey()),
        studio_treasury: ata(&studio.pubkey()),
        studio_usdc: ata(&studio.pubkey()),
        game,
        vault: ata(&game),
        player_usdc: ata(&player.pubkey()),
        svm,
        admin,
        studio,
        grant_signer,
        player,
        sponsor,
    };
    let mut world = world;
    init_protocol(&mut world, max_backed_per_player);
    register_game(&mut world);
    world
}

fn init_protocol(w: &mut World, max_backed_per_player: u64) {
    let ix = Instruction::new_with_bytes(
        pixelvault::id(),
        &pixelvault::instruction::InitProtocol {
            fee_bps: FEE_BPS,
            max_backed_per_player,
            global_backed_cap: 0,
        }
        .data(),
        pixelvault::accounts::InitProtocol {
            admin: w.admin.pubkey(),
            protocol: w.protocol,
            usdc_mint: w.usdc_mint,
            treasury: w.protocol_treasury,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let admin = w.admin.insecure_clone();
    send(&mut w.svm, &admin, &[&admin], &[ix]).expect("init_protocol failed");
}

fn register_game(w: &mut World) {
    let ix = Instruction::new_with_bytes(
        pixelvault::id(),
        &pixelvault::instruction::RegisterGame {
            game_id: GAME_ID,
            name: "Neon Racer".to_string(),
            grant_signer: w.grant_signer.pubkey(),
            backed_cap: 0,
        }
        .data(),
        pixelvault::accounts::RegisterGame {
            authority: w.studio.pubkey(),
            protocol: w.protocol,
            game: w.game,
            usdc_mint: w.usdc_mint,
            vault: w.vault,
            treasury: w.studio_treasury,
            usdc_token_program: TOKEN_ID,
            associated_token_program: ASSOCIATED_TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let studio = w.studio.insecure_clone();
    send(&mut w.svm, &studio, &[&studio], &[ix]).expect("register_game failed");
}

fn create_item_class(
    w: &mut World,
    class_id: u64,
    backing_bps: u16,
    max_supply: u64,
) -> Result<ItemClassRefs, String> {
    let mint = Keypair::new();
    let class = pda(&[b"class", w.game.as_ref(), &class_id.to_le_bytes()]);
    let ix = Instruction::new_with_bytes(
        pixelvault::id(),
        &pixelvault::instruction::CreateItemClass {
            class_id,
            price: PRICE,
            backing_bps,
            max_supply,
        }
        .data(),
        pixelvault::accounts::CreateItemClass {
            authority: w.studio.pubkey(),
            game: w.game,
            item_class: class,
            item_mint: mint.pubkey(),
            item_token_program: TOKEN_2022_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let studio = w.studio.insecure_clone();
    send(&mut w.svm, &studio, &[&studio, &mint], &[ix])?;
    Ok(ItemClassRefs {
        class,
        mint: mint.pubkey(),
        player_item: get_associated_token_address_with_program_id(
            &w.player.pubkey(),
            &mint.pubkey(),
            &TOKEN_2022_ID,
        ),
    })
}

fn craft_ix(w: &World, item: &ItemClassRefs, seq: u64, expires_at: i64) -> Instruction {
    Instruction::new_with_bytes(
        pixelvault::id(),
        &pixelvault::instruction::Craft {
            grant_seq: seq,
            expires_at,
        }
        .data(),
        pixelvault::accounts::Craft {
            player: w.player.pubkey(),
            rent_payer: w.sponsor.pubkey(),
            protocol: w.protocol,
            game: w.game,
            item_class: item.class,
            player_state: pda(&[b"player", w.game.as_ref(), w.player.pubkey().as_ref()]),
            usdc_mint: w.usdc_mint,
            player_usdc: w.player_usdc,
            vault: w.vault,
            treasury: w.studio_treasury,
            protocol_treasury: w.protocol_treasury,
            item_mint: item.mint,
            player_item: item.player_item,
            instructions: solana_sdk_ids::sysvar::instructions::ID,
            usdc_token_program: TOKEN_ID,
            item_token_program: TOKEN_2022_ID,
            associated_token_program: ASSOCIATED_TOKEN_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// A sponsored craft: the sponsor pays fees and rent, the player only signs.
fn craft_signed_by(
    w: &mut World,
    item: &ItemClassRefs,
    signer: &Keypair,
    grant_class_id: u64,
    seq: u64,
    expires_at: i64,
) -> Result<(), String> {
    let message = grant_message(&w.game, grant_class_id, &w.player.pubkey(), seq, expires_at);
    let ixs = [ed25519_ix(signer, &message), craft_ix(w, item, seq, expires_at)];
    let (sponsor, player) = (w.sponsor.insecure_clone(), w.player.insecure_clone());
    send(&mut w.svm, &sponsor, &[&sponsor, &player], &ixs)
}

fn craft(w: &mut World, item: &ItemClassRefs, seq: u64) -> Result<(), String> {
    let signer = w.grant_signer.insecure_clone();
    craft_signed_by(w, item, &signer, CLASS_ID, seq, NEVER_EXPIRES)
}

fn redeem(w: &mut World, item: &ItemClassRefs) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        pixelvault::id(),
        &pixelvault::instruction::Redeem {}.data(),
        pixelvault::accounts::Redeem {
            player: w.player.pubkey(),
            protocol: w.protocol,
            game: w.game,
            item_class: item.class,
            usdc_mint: w.usdc_mint,
            player_usdc: w.player_usdc,
            vault: w.vault,
            item_mint: item.mint,
            player_item: item.player_item,
            usdc_token_program: TOKEN_ID,
            item_token_program: TOKEN_2022_ID,
        }
        .to_account_metas(None),
    );
    let (sponsor, player) = (w.sponsor.insecure_clone(), w.player.insecure_clone());
    send(&mut w.svm, &sponsor, &[&sponsor, &player], &[ix])
}

fn set_crafting_paused(w: &mut World, paused: bool) {
    let ix = Instruction::new_with_bytes(
        pixelvault::id(),
        &pixelvault::instruction::UpdateGame {
            crafting_paused: Some(paused),
            grant_signer: None,
            backed_cap: None,
        }
        .data(),
        pixelvault::accounts::UpdateGame {
            authority: w.studio.pubkey(),
            game: w.game,
        }
        .to_account_metas(None),
    );
    let studio = w.studio.insecure_clone();
    send(&mut w.svm, &studio, &[&studio], &[ix]).expect("update_game failed");
}

fn raise_backing(w: &mut World, item: &ItemClassRefs, new_bps: u16) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        pixelvault::id(),
        &pixelvault::instruction::RaiseBacking { new_bps }.data(),
        pixelvault::accounts::RaiseBacking {
            authority: w.studio.pubkey(),
            protocol: w.protocol,
            game: w.game,
            item_class: item.class,
            usdc_mint: w.usdc_mint,
            authority_usdc: w.studio_usdc,
            vault: w.vault,
            usdc_token_program: TOKEN_ID,
        }
        .to_account_metas(None),
    );
    let studio = w.studio.insecure_clone();
    send(&mut w.svm, &studio, &[&studio], &[ix])
}

#[test]
fn craft_accounts_are_distinct() {
    let mut w = setup(0);
    let item = create_item_class(&mut w, CLASS_ID, BACKING_BPS, 0).unwrap();
    let ix = craft_ix(&w, &item, 0, NEVER_EXPIRES);
    let names = [
        "player", "rent_payer", "protocol", "game", "item_class", "player_state", "usdc_mint",
        "player_usdc", "vault", "treasury", "protocol_treasury", "item_mint", "player_item",
        "instructions", "usdc_token_program", "item_token_program", "associated_token_program",
        "system_program",
    ];
    let mut seen = std::collections::HashMap::new();
    for (meta, name) in ix.accounts.iter().zip(names) {
        if let Some(other) = seen.insert(meta.pubkey, name) {
            panic!("{name} and {other} are the same account {}", meta.pubkey);
        }
    }
}

#[test]
fn zero_sol_player_crafts_and_redeems_with_sponsor_paying() {
    let mut w = setup(0);
    let item = create_item_class(&mut w, CLASS_ID, BACKING_BPS, 0).unwrap();
    let player_usdc_before = token_amount(&w.svm, &w.player_usdc);

    craft(&mut w, &item, 0).expect("craft failed");

    // The price splits into backing, studio margin and protocol fee.
    assert_eq!(token_amount(&w.svm, &w.vault), EXPECTED_BACKING);
    assert_eq!(token_amount(&w.svm, &w.studio_treasury), 100 * PRICE + EXPECTED_STUDIO_CUT);
    assert_eq!(token_amount(&w.svm, &w.protocol_treasury), EXPECTED_PROTOCOL_FEE);
    assert_eq!(token_amount(&w.svm, &w.player_usdc), player_usdc_before - PRICE);
    assert_eq!(item_amount(&w.svm, &item.player_item), 1);
    // The player never held SOL: the sponsor paid fees and rent.
    assert_eq!(w.svm.get_balance(&w.player.pubkey()).unwrap_or(0), 0);

    let game: pixelvault::Game = load(&w.svm, &w.game);
    assert_eq!(game.total_backed, EXPECTED_BACKING);
    assert_eq!(game.total_crafted, 1);
    let protocol: pixelvault::Protocol = load(&w.svm, &w.protocol);
    assert_eq!(protocol.total_backed, EXPECTED_BACKING);

    // Redemption returns exactly the backing and burns the unit.
    redeem(&mut w, &item).expect("redeem failed");
    assert_eq!(item_amount(&w.svm, &item.player_item), 0);
    assert_eq!(token_amount(&w.svm, &w.vault), 0);
    assert_eq!(
        token_amount(&w.svm, &w.player_usdc),
        player_usdc_before - PRICE + EXPECTED_BACKING
    );
    let game: pixelvault::Game = load(&w.svm, &w.game);
    assert_eq!(game.total_backed, 0);
    assert_eq!(game.total_redeemed, 1);
    // The studio keeps its margin either way: that is the business model.
    assert_eq!(token_amount(&w.svm, &w.studio_treasury), 100 * PRICE + EXPECTED_STUDIO_CUT);
}

#[test]
fn backing_ratio_outside_band_is_rejected() {
    let mut w = setup(0);
    expect_error(
        create_item_class(&mut w, CLASS_ID, 9_900, 0).map(|_| ()),
        PixelVaultError::BackingRatioOutOfBand,
    );
    expect_error(
        create_item_class(&mut w, CLASS_ID, 1_000, 0).map(|_| ()),
        PixelVaultError::BackingRatioOutOfBand,
    );
    assert!(create_item_class(&mut w, CLASS_ID, 5_000, 0).is_ok());
}

#[test]
fn replayed_grant_is_rejected() {
    let mut w = setup(0);
    let item = create_item_class(&mut w, CLASS_ID, BACKING_BPS, 0).unwrap();
    craft(&mut w, &item, 0).expect("first craft failed");
    expect_error(craft(&mut w, &item, 0), PixelVaultError::GrantAlreadyUsed);
    craft(&mut w, &item, 1).expect("next sequence should succeed");
    expect_error(craft(&mut w, &item, 5), PixelVaultError::GrantAlreadyUsed);
}

#[test]
fn expired_grant_is_rejected() {
    let mut w = setup(0);
    let item = create_item_class(&mut w, CLASS_ID, BACKING_BPS, 0).unwrap();
    let signer = w.grant_signer.insecure_clone();
    expect_error(
        craft_signed_by(&mut w, &item, &signer, CLASS_ID, 0, -1),
        PixelVaultError::GrantExpired,
    );
}

#[test]
fn grant_from_wrong_signer_is_rejected() {
    let mut w = setup(0);
    let item = create_item_class(&mut w, CLASS_ID, BACKING_BPS, 0).unwrap();
    let impostor = Keypair::new();
    expect_error(
        craft_signed_by(&mut w, &item, &impostor, CLASS_ID, 0, NEVER_EXPIRES),
        PixelVaultError::InvalidGrant,
    );
}

#[test]
fn grant_for_another_class_is_rejected() {
    let mut w = setup(0);
    let item = create_item_class(&mut w, CLASS_ID, BACKING_BPS, 0).unwrap();
    let signer = w.grant_signer.insecure_clone();
    expect_error(
        craft_signed_by(&mut w, &item, &signer, CLASS_ID + 1, 0, NEVER_EXPIRES),
        PixelVaultError::InvalidGrant,
    );
}

#[test]
fn craft_without_grant_is_rejected() {
    let mut w = setup(0);
    let item = create_item_class(&mut w, CLASS_ID, BACKING_BPS, 0).unwrap();
    let ix = craft_ix(&w, &item, 0, NEVER_EXPIRES);
    let (sponsor, player) = (w.sponsor.insecure_clone(), w.player.insecure_clone());
    expect_error(
        send(&mut w.svm, &sponsor, &[&sponsor, &player], &[ix]),
        PixelVaultError::MissingGrant,
    );
}

#[test]
fn pause_stops_crafting_but_never_redemption() {
    let mut w = setup(0);
    let item = create_item_class(&mut w, CLASS_ID, BACKING_BPS, 0).unwrap();
    craft(&mut w, &item, 0).expect("craft failed");

    set_crafting_paused(&mut w, true);
    expect_error(craft(&mut w, &item, 1), PixelVaultError::CraftingPaused);
    redeem(&mut w, &item).expect("redemption must work while crafting is paused");
    assert_eq!(token_amount(&w.svm, &w.vault), 0);
}

#[test]
fn raising_backing_tops_up_every_unit_in_circulation() {
    let mut w = setup(0);
    let item = create_item_class(&mut w, CLASS_ID, BACKING_BPS, 0).unwrap();
    craft(&mut w, &item, 0).unwrap();
    craft(&mut w, &item, 1).unwrap();
    assert_eq!(token_amount(&w.svm, &w.vault), 2 * EXPECTED_BACKING);

    expect_error(raise_backing(&mut w, &item, 7_000), PixelVaultError::BackingMustIncrease);
    raise_backing(&mut w, &item, 9_000).expect("raise_backing failed");

    // Two units each topped up from 0.80 to 0.90 USDC.
    assert_eq!(token_amount(&w.svm, &w.vault), 2 * 900_000);
    let player_usdc_before = token_amount(&w.svm, &w.player_usdc);
    redeem(&mut w, &item).unwrap();
    assert_eq!(token_amount(&w.svm, &w.player_usdc), player_usdc_before + 900_000);
}

#[test]
fn per_player_cap_is_enforced() {
    let mut w = setup(1_000_000);
    let item = create_item_class(&mut w, CLASS_ID, BACKING_BPS, 0).unwrap();
    craft(&mut w, &item, 0).expect("first craft is under the cap");
    expect_error(craft(&mut w, &item, 1), PixelVaultError::PlayerCapReached);
}

#[test]
fn supply_cap_is_enforced() {
    let mut w = setup(0);
    let item = create_item_class(&mut w, CLASS_ID, BACKING_BPS, 1).unwrap();
    craft(&mut w, &item, 0).expect("first unit is within supply");
    expect_error(craft(&mut w, &item, 1), PixelVaultError::SupplyCapReached);
}
