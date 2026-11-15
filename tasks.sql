-- ============================================================
-- Task Reminder: run this ONCE in Supabase > SQL Editor
-- Every user has their own tasks (same rule as products and sales).
-- ============================================================

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  priority    text not null default 'medium'
              check (priority in ('low', 'medium', 'high', 'very_high')),
  due_date    date,            -- optional: the day this task must be done
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists tasks_user_due_idx on public.tasks (user_id, due_date);

alter table public.tasks enable row level security;

drop policy if exists "approved users manage own tasks" on public.tasks;

create policy "approved users manage own tasks" on public.tasks
  for all to authenticated
  using      (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());
