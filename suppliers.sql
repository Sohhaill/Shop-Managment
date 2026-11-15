-- ============================================================
-- Suppliers tab: run this ONCE in Supabase > SQL Editor
-- Every user has their own suppliers (same rule as products and sales).
-- ============================================================

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  phone       text not null,
  company     text,
  city        text,
  items       text,          -- what they supply, in plain words
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists suppliers_user_idx on public.suppliers (user_id);

alter table public.suppliers enable row level security;

drop policy if exists "approved users manage own suppliers" on public.suppliers;

create policy "approved users manage own suppliers" on public.suppliers
  for all to authenticated
  using      (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());
