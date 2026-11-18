-- ============================================================
-- Categories: run this ONCE in Supabase > SQL Editor
-- (run it BEFORE using the new code, or right after: the app keeps working either way)
-- Each user has their own categories. A product can be in one category.
-- ============================================================

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);

-- the same user cannot have two categories with the same name (Drinks = drinks)
create unique index if not exists categories_user_name_uq
  on public.categories (user_id, lower(name));

alter table public.categories enable row level security;

drop policy if exists "approved users manage own categories" on public.categories;
create policy "approved users manage own categories" on public.categories
  for all to authenticated
  using      (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

-- products get a category (deleting a category keeps the products, they become "No category")
alter table public.products
  add column if not exists category_id uuid references public.categories(id) on delete set null;

create index if not exists products_category_idx on public.products (category_id);

-- safety: a product can only use a category that belongs to the same user
create or replace function public.check_product_category()
returns trigger
language plpgsql
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c where c.id = new.category_id and c.user_id = new.user_id
  ) then
    raise exception 'Invalid category';
  end if;
  return new;
end $$;

drop trigger if exists products_check_category on public.products;
create trigger products_check_category
  before insert or update of category_id on public.products
  for each row execute function public.check_product_category();
