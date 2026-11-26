-- =====================================================================
--  lau.rie : agenda des séances, historique des textes du site (annuler),
--  corbeille de 30 jours, point important des photos, ordre par glisser-déposer.
--  À exécuter après les cinq migrations précédentes. Sans danger à relancer.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Agenda des séances (administratrices seulement)
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,
  start_time  text check (start_time is null or start_time ~ '^\d{2}:\d{2}$'),
  title       text not null check (char_length(title) between 1 and 160),
  kind        text check (kind is null or char_length(kind) <= 40),
  place       text check (place is null or char_length(place) <= 200),
  notes       text check (notes is null or char_length(notes) <= 2000),
  client_email text check (client_email is null or char_length(client_email) <= 200),
  gallery_id  uuid references public.galleries on delete set null,
  request_id  uuid references public.booking_requests on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists bookings_day_idx on public.bookings (day);
alter table public.bookings enable row level security;
drop policy if exists bookings_admin on public.bookings;
create policy bookings_admin on public.bookings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.bookings to authenticated;

-- ---------------------------------------------------------------------
--  Historique des textes du site : chaque enregistrement garde la version
--  précédente (30 dernières), pour pouvoir revenir en arrière
-- ---------------------------------------------------------------------
create table if not exists public.site_history (
  id        bigint generated always as identity primary key,
  content   jsonb not null,
  saved_at  timestamptz not null default now(),
  saved_by  uuid
);
alter table public.site_history enable row level security;
drop policy if exists site_history_admin on public.site_history;
create policy site_history_admin on public.site_history
  for select to authenticated using (public.is_admin());
grant select on public.site_history to authenticated;

create or replace function public.site_settings_keep_history()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (old.content - 'backupAt') is distinct from (new.content - 'backupAt') then
    insert into public.site_history (content, saved_at, saved_by)
    values (old.content, coalesce(old.updated_at, now()), old.updated_by);
    delete from public.site_history
     where id not in (select id from public.site_history order by id desc limit 30);
  end if;
  return new;
end;
$$;
drop trigger if exists site_settings_keep_history on public.site_settings;
create trigger site_settings_keep_history
  before update on public.site_settings
  for each row execute function public.site_settings_keep_history();

-- ---------------------------------------------------------------------
--  Corbeille : une galerie ou une photo supprimée y reste 30 jours
--  (ses fichiers d'aperçu ne sont effacés qu'à la purge)
-- ---------------------------------------------------------------------
create table if not exists public.trash (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('gallery', 'photo')),
  label       text not null check (char_length(label) <= 300),
  gallery_id  uuid,
  payload     jsonb not null,
  files       text[] not null default '{}',
  deleted_at  timestamptz not null default now()
);
create index if not exists trash_deleted_idx on public.trash (deleted_at);
alter table public.trash enable row level security;
drop policy if exists trash_admin on public.trash;
create policy trash_admin on public.trash
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, delete on public.trash to authenticated;

-- ---------------------------------------------------------------------
--  Point important d'une photo (0 à 100 %), pour que le recadrage
--  ne coupe jamais l'essentiel
-- ---------------------------------------------------------------------
alter table public.portfolio
  add column if not exists focus_x smallint check (focus_x between 0 and 100),
  add column if not exists focus_y smallint check (focus_y between 0 and 100);
alter table public.photos
  add column if not exists focus_x smallint check (focus_x between 0 and 100),
  add column if not exists focus_y smallint check (focus_y between 0 and 100);

-- ---------------------------------------------------------------------
--  Ordre par glisser-déposer : une seule requête pour toute la liste
-- ---------------------------------------------------------------------
create or replace function public.reorder_photos(p_gallery uuid, p_ids uuid[])
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.photos p set position = o.n - 1
    from unnest(p_ids) with ordinality as o(id, n)
   where p.id = o.id and p.gallery_id = p_gallery;
end;
$$;
revoke execute on function public.reorder_photos(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_photos(uuid, uuid[]) to authenticated;

create or replace function public.reorder_portfolio(p_ids uuid[])
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.portfolio p set position = o.n - 1
    from unnest(p_ids) with ordinality as o(id, n)
   where p.id = o.id;
end;
$$;
revoke execute on function public.reorder_portfolio(uuid[]) from public, anon;
grant execute on function public.reorder_portfolio(uuid[]) to authenticated;

notify pgrst, 'reload schema';
