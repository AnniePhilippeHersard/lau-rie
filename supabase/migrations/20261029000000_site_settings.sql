-- =====================================================================
--  Contenu du site éditable depuis l'administration
--  (textes, prestations, tarifs, avis, FAQ, coordonnées)
-- =====================================================================

create table public.site_settings (
  id         int primary key default 1 check (id = 1),   -- une seule ligne
  content    jsonb not null default '{}'::jsonb check (pg_column_size(content) < 200000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);

alter table public.site_settings enable row level security;

create policy site_settings_public_read on public.site_settings
  for select to anon, authenticated using (true);
create policy site_settings_admin_write on public.site_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.site_settings (id) values (1) on conflict do nothing;

-- Liste des administrateurs avec leur email (lecture réservée aux admins)
create or replace function public.list_admins()
returns table (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select a.user_id, u.email::text, a.created_at, u.last_sign_in_at
    from public.admins a
    join auth.users u on u.id = a.user_id
   where public.is_admin()
   order by a.created_at;
$$;
revoke execute on function public.list_admins() from public, anon;
grant execute on function public.list_admins() to authenticated;
