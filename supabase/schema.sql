create table if not exists public.price_history (
  id text primary key,
  source_id text not null,
  store text not null,
  url text not null,
  checked_at timestamptz not null,
  price numeric(12, 2) not null,
  currency text not null default 'BRL',
  stock_status text,
  title text,
  match_status text,
  match_confidence integer,
  accepted boolean not null default true,
  error text,
  kind text not null default 'br',
  created_at timestamptz not null default now()
);

create index if not exists price_history_checked_at_idx
  on public.price_history (checked_at desc);

create index if not exists price_history_kind_checked_at_idx
  on public.price_history (kind, checked_at desc);

create index if not exists price_history_source_checked_at_idx
  on public.price_history (source_id, checked_at desc);
