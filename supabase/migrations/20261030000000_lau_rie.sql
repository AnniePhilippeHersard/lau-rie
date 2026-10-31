-- =====================================================================
--  lau.rie : galerie à deux accès (mariés / invités), notes pour la retouche,
--  photos masquées aux invités, avis clients relus avant publication,
--  rappel avant fermeture, formulaire de contact protégé.
--  À exécuter après les deux migrations précédentes.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Galeries
-- ---------------------------------------------------------------------
alter table public.galleries
  add column if not exists kind        text check (kind is null or char_length(kind) <= 40),
  -- Codes d'accès : lisibles par l'administratrice seulement (RLS), pour pouvoir
  -- les renvoyer aux clients. Normalisés en majuscules, sans espaces.
  add column if not exists owner_code  text check (owner_code is null or owner_code ~ '^[A-Z0-9-]{8,40}$'),
  add column if not exists guest_code  text check (guest_code is null or guest_code ~ '^[A-Z0-9-]{8,40}$'),
  add column if not exists guest_hd    boolean not null default false,   -- les invités voient aussi le lien HD
  add column if not exists notify      boolean not null default true,    -- e-mail à la photographe à chaque sélection
  add column if not exists remind      boolean not null default true,    -- rappel aux clients avant la fermeture
  add column if not exists remind_days int not null default 30 check (remind_days between 1 and 120),
  add column if not exists reminded_at timestamptz,
  add column if not exists visits      int not null default 0,
  add column if not exists treated_at  timestamptz;                     -- sélection traitée par la photographe

create unique index if not exists galleries_owner_code_key on public.galleries (owner_code);
create unique index if not exists galleries_guest_code_key on public.galleries (guest_code);

-- Un code ne peut servir qu'une fois, toutes galeries et tous accès confondus
create or replace function public.galleries_check_codes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.owner_code := nullif(upper(regexp_replace(coalesce(new.owner_code, ''), '\s', '', 'g')), '');
  new.guest_code := nullif(upper(regexp_replace(coalesce(new.guest_code, ''), '\s', '', 'g')), '');
  if new.owner_code is not null and new.owner_code = new.guest_code then
    raise exception 'Le code des invités doit être différent de celui des clients' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.galleries g
     where g.id <> new.id
       and (g.owner_code in (new.owner_code, new.guest_code) or g.guest_code in (new.owner_code, new.guest_code))
  ) then
    raise exception 'Ce code est déjà utilisé par une autre galerie' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists galleries_check_codes on public.galleries;
create trigger galleries_check_codes
  before insert or update of owner_code, guest_code on public.galleries
  for each row execute function public.galleries_check_codes();

-- Nouvelles colonnes lisibles par l'administratrice (le hash de l'ancien code reste caché)
grant select (kind, owner_code, guest_code, guest_hd, notify, remind, remind_days, reminded_at, visits, treated_at)
  on public.galleries to authenticated;

-- ---------------------------------------------------------------------
--  Photos, sélections
-- ---------------------------------------------------------------------
alter table public.photos
  add column if not exists hidden_from_guests boolean not null default false,
  add column if not exists collection text check (collection is null or char_length(collection) <= 60);

alter table public.selections
  add column if not exists notes jsonb
    check (notes is null or (jsonb_typeof(notes) = 'object' and pg_column_size(notes) < 100000));

-- ---------------------------------------------------------------------
--  Avis clients
-- ---------------------------------------------------------------------
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  gallery_id  uuid references public.galleries on delete set null,   -- avis écrit depuis une galerie
  who         text not null check (char_length(who) between 1 and 120),
  ctx         text check (ctx is null or char_length(ctx) <= 160),
  body        text not null check (char_length(body) between 1 and 600),
  image_path  text check (image_path is null or char_length(image_path) <= 500),  -- photo du portfolio
  status      text not null default 'pending' check (status in ('pending', 'published', 'hidden')),
  is_private  boolean not null default false,                       -- « juste pour Laurie » : jamais publié
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint reviews_private_never_published check (not (is_private and status = 'published'))
);
create unique index if not exists reviews_one_per_gallery on public.reviews (gallery_id) where gallery_id is not null;

alter table public.reviews enable row level security;
drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews
  for select to anon, authenticated using (status = 'published' and not is_private);
drop policy if exists reviews_admin on public.reviews;
create policy reviews_admin on public.reviews
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
--  Contact : passe désormais par la fonction « gallery » (limite anti-spam)
-- ---------------------------------------------------------------------
drop policy if exists booking_public_insert on public.booking_requests;
alter table public.booking_requests
  add column if not exists kind text check (kind is null or char_length(kind) <= 40);

-- ---------------------------------------------------------------------
--  Accès client par code seul
--  Renvoie la galerie, le rôle (owner = les clients, guest = leurs invités) et son état.
--  Appelée uniquement par l'Edge Function (service_role).
-- ---------------------------------------------------------------------
create or replace function public.gallery_by_code(p_code text)
returns table (gallery_id uuid, role text, state text)
language sql stable security definer
set search_path = ''
as $$
  with c as (select upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) as code)
  select g.id,
         case when g.owner_code = c.code then 'owner' else 'guest' end,
         case when g.status <> 'published' then 'draft'
              when g.expires_at is not null and g.expires_at <= now() then 'expired'
              else 'ok' end
    from public.galleries g, c
   where char_length(c.code) >= 8
     and (g.owner_code = c.code or g.guest_code = c.code)
   limit 1;
$$;
revoke execute on function public.gallery_by_code(text) from public, anon, authenticated;
grant execute on function public.gallery_by_code(text) to service_role;

-- Les tentatives servent aussi au formulaire de contact : purge au bout de 24 h
create or replace function public.purge_access_attempts()
returns void language sql security definer set search_path = '' as $$
  delete from public.access_attempts where created_at < now() - interval '24 hours';
$$;
revoke execute on function public.purge_access_attempts() from public, anon, authenticated;
grant execute on function public.purge_access_attempts() to service_role;

-- Purge quotidienne (3 h du matin) si l'extension pg_cron est disponible.
-- Sinon (ou en cas d'erreur), rien n'est bloqué : la purge peut être lancée à la main.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-tentatives';
  perform cron.schedule('purge-tentatives', '0 3 * * *', 'select public.purge_access_attempts()');
exception when others then
  raise notice 'pg_cron indisponible : purge automatique non programmée (%)', sqlerrm;
end;
$$;

-- Comptage rapide des tentatives (limites par adresse et globale)
create index if not exists access_attempts_slug_idx on public.access_attempts (slug, success, created_at desc);
