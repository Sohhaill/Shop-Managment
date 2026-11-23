-- ============================================================
-- Balance history: run this ONCE in Supabase > SQL Editor
-- Every Send / Receive (actual amount, amount added to sale, time,
-- balance before and after) is saved here, one row per action.
-- Nothing existing is changed or deleted: this only ADDS a table
-- and copies old balance sales into it.
-- Rows can be read and added, but never edited or deleted from the app.
-- ============================================================

create table if not exists public.balance_history (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  balance_id     text not null,            -- id of the balance entry (kept as text; the row stays even if the entry is deleted)
  balance_title  text not null,            -- title at that time
  tx_type        text not null
                 check (tx_type in ('send', 'receive', 'undo_send', 'undo_receive', 'edit')),
  actual_amount  numeric not null default 0,   -- the real money that moved
  sale_amount    numeric not null default 0,   -- the part added to sale (negative when a sale was removed)
  balance_before numeric,
  balance_after  numeric,
  description    text,
  tx_date        date not null default current_date,
  sale_id        text,                     -- the sales row made by this action (if any)
  created_at     timestamptz not null default now()
);

create index if not exists balance_history_user_date_idx on public.balance_history (user_id, tx_date);
create index if not exists balance_history_balance_idx   on public.balance_history (user_id, balance_id, tx_date);

alter table public.balance_history enable row level security;

drop policy if exists "approved users read own balance history" on public.balance_history;
drop policy if exists "approved users add own balance history"  on public.balance_history;

create policy "approved users read own balance history" on public.balance_history
  for select to authenticated
  using (user_id = auth.uid() and public.is_approved());

create policy "approved users add own balance history" on public.balance_history
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved());

-- ------------------------------------------------------------
-- Copy the old Send / Receive sales into the history (safe to run again).
-- Old actions that had NO sale amount were never saved anywhere, so they cannot be recovered.
-- ------------------------------------------------------------
insert into public.balance_history
  (user_id, balance_id, balance_title, tx_type, actual_amount, sale_amount, description, tx_date, sale_id, created_at)
select
  s.user_id,
  s.balance_id::text,
  coalesce(b.title, s.product_name),
  s.balance_type,
  s.balance_amount,
  s.total,
  s.description,
  s.sale_date,
  s.id::text,
  s.created_at
from public.sales s
left join public.balances b on b.id::text = s.balance_id::text
where s.balance_id is not null
  and s.balance_amount is not null
  and s.balance_type in ('send', 'receive')
  and not exists (
    select 1 from public.balance_history h where h.sale_id = s.id::text
  );
