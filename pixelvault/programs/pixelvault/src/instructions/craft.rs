use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        mint_to, transfer_checked, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
    },
};
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::{
    constants::*,
    error::PixelVaultError,
    events::ItemCrafted,
    grant::{grant_message, verify_grant},
    math::{add, apply_bps, exceeds_cap, sub},
    state::{Game, ItemClass, PlayerState, Protocol},
};

#[derive(Accounts)]
pub struct Craft<'info> {
    pub player: Signer<'info>,

    /// Pays rent for the player's first-time accounts. The relayer fills this
    /// with its fee payer so players never need SOL. Kept at a fixed position
    /// (index 1) so the relayer can verify that is its only role.
    #[account(mut)]
    pub rent_payer: Signer<'info>,

    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,

    #[account(
        mut,
        seeds = [GAME_SEED, &game.game_id.to_le_bytes()],
        bump = game.bump
    )]
    pub game: Box<Account<'info, Game>>,

    #[account(
        mut,
        has_one = game,
        seeds = [CLASS_SEED, game.key().as_ref(), &item_class.class_id.to_le_bytes()],
        bump = item_class.bump
    )]
    pub item_class: Box<Account<'info, ItemClass>>,

    #[account(
        init_if_needed,
        payer = rent_payer,
        space = 8 + PlayerState::INIT_SPACE,
        seeds = [PLAYER_SEED, game.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub player_state: Box<Account<'info, PlayerState>>,

    #[account(address = protocol.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = usdc_mint, token::authority = player)]
    pub player_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = game,
        associated_token::token_program = usdc_token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = game.treasury)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = protocol.treasury)]
    pub protocol_treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, address = item_class.mint)]
    pub item_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = rent_payer,
        associated_token::mint = item_mint,
        associated_token::authority = player,
        associated_token::token_program = item_token_program,
    )]
    pub player_item: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: address-constrained to the instructions sysvar; read to find the grant signature.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions: UncheckedAccount<'info>,

    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub item_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_craft(ctx: Context<Craft>, grant_seq: u64, expires_at: i64) -> Result<()> {
    require!(
        !ctx.accounts.protocol.crafting_paused && !ctx.accounts.game.crafting_paused,
        PixelVaultError::CraftingPaused
    );
    require!(
        Clock::get()?.unix_timestamp <= expires_at,
        PixelVaultError::GrantExpired
    );

    let game_key = ctx.accounts.game.key();
    let player_key = ctx.accounts.player.key();

    // First craft in this game: fill in the freshly created player state.
    {
        let state = &mut ctx.accounts.player_state;
        if state.player == Pubkey::default() {
            state.game = game_key;
            state.player = player_key;
            state.next_grant_seq = 0;
            state.total_backed_crafted = 0;
            state.bump = ctx.bumps.player_state;
        }
        require!(
            grant_seq == state.next_grant_seq,
            PixelVaultError::GrantAlreadyUsed
        );
    }

    // The game server must have authorised exactly this craft.
    let message = grant_message(
        &game_key,
        ctx.accounts.item_class.class_id,
        &player_key,
        grant_seq,
        expires_at,
    );
    verify_grant(
        &ctx.accounts.instructions.to_account_info(),
        &ctx.accounts.game.grant_signer,
        &message,
    )?;

    let class = &ctx.accounts.item_class;
    if class.max_supply != 0 {
        require!(
            class.total_crafted < class.max_supply,
            PixelVaultError::SupplyCapReached
        );
    }
    let price = class.price;
    let backing = class.backing_per_unit;

    let player_total = add(ctx.accounts.player_state.total_backed_crafted, backing)?;
    require!(
        !exceeds_cap(player_total, ctx.accounts.protocol.max_backed_per_player),
        PixelVaultError::PlayerCapReached
    );
    let game_total = add(ctx.accounts.game.total_backed, backing)?;
    require!(
        !exceeds_cap(game_total, ctx.accounts.game.backed_cap),
        PixelVaultError::GameCapReached
    );
    let protocol_total = add(ctx.accounts.protocol.total_backed, backing)?;
    require!(
        !exceeds_cap(protocol_total, ctx.accounts.protocol.global_backed_cap),
        PixelVaultError::ProtocolCapReached
    );

    // The backing is the player's money held on their behalf; the rest is revenue.
    let margin = sub(price, backing)?;
    let protocol_fee = apply_bps(margin, ctx.accounts.protocol.fee_bps)?;
    let studio_cut = sub(margin, protocol_fee)?;

    let decimals = ctx.accounts.usdc_mint.decimals;
    let payouts = [
        (ctx.accounts.vault.to_account_info(), backing),
        (ctx.accounts.treasury.to_account_info(), studio_cut),
        (ctx.accounts.protocol_treasury.to_account_info(), protocol_fee),
    ];
    for (to, amount) in payouts {
        if amount == 0 {
            continue;
        }
        transfer_checked(
            CpiContext::new(
                ctx.accounts.usdc_token_program.key(),
                TransferChecked {
                    from: ctx.accounts.player_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to,
                    authority: ctx.accounts.player.to_account_info(),
                },
            ),
            amount,
            decimals,
        )?;
    }

    let game_id_bytes = ctx.accounts.game.game_id.to_le_bytes();
    let game_bump = [ctx.accounts.game.bump];
    let game_seeds: &[&[u8]] = &[GAME_SEED, &game_id_bytes, &game_bump];
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.item_token_program.key(),
            MintTo {
                mint: ctx.accounts.item_mint.to_account_info(),
                to: ctx.accounts.player_item.to_account_info(),
                authority: ctx.accounts.game.to_account_info(),
            },
            &[game_seeds],
        ),
        1,
    )?;

    let game = &mut ctx.accounts.game;
    game.total_backed = game_total;
    game.total_crafted = add(game.total_crafted, 1)?;

    let class = &mut ctx.accounts.item_class;
    class.backed_supply = add(class.backed_supply, 1)?;
    class.total_crafted = add(class.total_crafted, 1)?;

    let state = &mut ctx.accounts.player_state;
    state.next_grant_seq = add(state.next_grant_seq, 1)?;
    state.total_backed_crafted = player_total;

    ctx.accounts.protocol.total_backed = protocol_total;

    // The vault must always cover everything the game owes its holders.
    ctx.accounts.vault.reload()?;
    require!(
        ctx.accounts.vault.amount >= ctx.accounts.game.total_backed,
        PixelVaultError::VaultUndercollateralized
    );

    emit!(ItemCrafted {
        game: game_key,
        item_class: ctx.accounts.item_class.key(),
        player: player_key,
        price,
        backing,
        studio_cut,
        protocol_fee,
        grant_seq,
        game_total_backed: game_total,
    });
    Ok(())
}
