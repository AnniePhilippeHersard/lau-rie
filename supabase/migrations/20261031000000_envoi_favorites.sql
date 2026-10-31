-- =====================================================================
--  lau.rie : envoi de la galerie par e-mail et « photos les plus aimées ».
--  À exécuter après les trois migrations précédentes.
-- =====================================================================

-- Date du dernier envoi du lien aux clients depuis l'espace photographe
alter table public.galleries add column if not exists link_sent_at timestamptz;
grant select (link_sent_at) on public.galleries to authenticated;

-- ---------------------------------------------------------------------
--  Cœurs des visiteurs, comptés de façon anonyme
--  visitor : identifiant aléatoire créé par le navigateur (aucune donnée personnelle).
--  Écrit uniquement par l'Edge Function « gallery » (service_role).
-- ---------------------------------------------------------------------
create table if not exists public.photo_favs (
  gallery_id uuid not null references public.galleries on delete cascade,
  photo_id   uuid not null references public.photos on delete cascade,
  visitor    text not null check (visitor ~ '^[a-z0-9-]{16,64}$'),
  role       text not null check (role in ('owner', 'guest')),
  created_at timestamptz not null default now(),
  primary key (photo_id, visitor)
);
create index if not exists photo_favs_gallery_idx on public.photo_favs (gallery_id, visitor);

alter table public.photo_favs enable row level security;
drop policy if exists photo_favs_admin_read on public.photo_favs;
create policy photo_favs_admin_read on public.photo_favs
  for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.photo_favs from anon, authenticated;

-- Nombre de cœurs par photo d'une galerie (administratrices seulement)
create or replace function public.fav_counts(p_gallery uuid)
returns table (photo_id uuid, hearts int, owners int)
language sql stable security definer
set search_path = ''
as $$
  select f.photo_id, count(*)::int, count(*) filter (where f.role = 'owner')::int
    from public.photo_favs f
   where f.gallery_id = p_gallery and public.is_admin()
   group by f.photo_id
   order by 2 desc, 3 desc;
$$;
revoke execute on function public.fav_counts(uuid) from public, anon;
grant execute on function public.fav_counts(uuid) to authenticated;
