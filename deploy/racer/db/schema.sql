-- PixelVault backend schema (Neon Postgres). Idempotent: safe to re-run.

create table if not exists players (
  telegram_id     bigint primary key,
  username        text,
  first_name      text,
  wallet          text,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  starter_granted_at timestamptz
);

-- Off-chain, non-transferable crafting inputs earned by racing.
create table if not exists materials (
  telegram_id bigint not null references players (telegram_id),
  material    text   not null,
  amount      int    not null default 0 check (amount >= 0),
  primary key (telegram_id, material)
);

create table if not exists runs (
  id            bigserial primary key,
  telegram_id   bigint  not null references players (telegram_id),
  track_id      text    not null,
  total_ms      int     not null,
  respawns      int     not null default 0,
  medal         text,
  valid         boolean not null,
  reject_reason text,
  splits        int[]   not null,
  reward        int     not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists runs_by_player on runs (telegram_id, created_at desc);

create table if not exists best_times (
  telegram_id bigint not null references players (telegram_id),
  track_id    text   not null,
  total_ms    int    not null,
  run_id      bigint not null references runs (id),
  achieved_at timestamptz not null default now(),
  primary key (telegram_id, track_id)
);
create index if not exists best_times_leaderboard on best_times (track_id, total_ms);

-- v2: the recorded line of each personal best, so others can race against it.
alter table best_times add column if not exists ghost jsonb;
alter table best_times add column if not exists splits int[];

-- Material grants the game server has signed. Materials are reserved when a
-- grant is issued and settled against the chain: the player's on-chain grant
-- sequence tells us whether the craft happened.
create table if not exists grants (
  id          bigserial primary key,
  telegram_id bigint  not null references players (telegram_id),
  wallet      text    not null,
  game_id     int     not null,
  class_id    int     not null,
  seq         bigint  not null,
  expires_at  bigint  not null,
  recipe      jsonb   not null,
  status      text    not null default 'issued' check (status in ('issued', 'used', 'refunded')),
  created_at  timestamptz not null default now()
);
create index if not exists grants_open on grants (telegram_id) where status = 'issued';

-- Every transaction the relayer co-signed, for rate limits and spend tracking.
create table if not exists sponsored_txs (
  signature  text primary key,
  wallet     text not null,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists sponsored_by_wallet on sponsored_txs (wallet, created_at desc);
