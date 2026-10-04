-- 在 Supabase 控制台 → SQL Editor 中执行一次即可
-- 每个用户一行，整个工作区数据（简历库 / 看板 / 日程 / 备战结果 / 复盘）以 JSON 存储

create table if not exists public.user_workspace (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    data       jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.user_workspace enable row level security;

-- 行级安全：每个用户只能读写自己的那一行
drop policy if exists "workspace_select_own" on public.user_workspace;
create policy "workspace_select_own" on public.user_workspace
    for select using (auth.uid() = user_id);

drop policy if exists "workspace_insert_own" on public.user_workspace;
create policy "workspace_insert_own" on public.user_workspace
    for insert with check (auth.uid() = user_id);

drop policy if exists "workspace_update_own" on public.user_workspace;
create policy "workspace_update_own" on public.user_workspace
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "workspace_delete_own" on public.user_workspace;
create policy "workspace_delete_own" on public.user_workspace
    for delete using (auth.uid() = user_id);
