-- =====================================================================
--  Site photographe — schéma initial
--  Galeries privées, sélection client, portfolio public, demandes de réservation.
--  À appliquer sur un projet Supabase vierge (SQL Editor ou `supabase db push`).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
--  Administrateur (le photographe)
-- ---------------------------------------------------------------------
create table public.admins (
  user_id    uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
--  Galeries clients
-- ---------------------------------------------------------------------
create table public.galleries (
  id               uuid primary key default gen_random_uuid(),
  -- identifiant public non devinable (18 caractères hex = 72 bits)
  slug             text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  title            text not null check (char_length(title) between 1 and 160),
  client_name      text check (char_length(client_name) <= 160),
  client_email     text check (char_length(client_email) <= 200),
  event_date       date,
  access_code_hash text,                        -- bcrypt, jamais le code en clair
  allow_download   boolean not null default true,  -- téléchargement des aperçus (qualité web)
  -- Fichiers HD hébergés ailleurs (SwissTransfer, WeTransfer, Drive…) : simple lien
  delivery_url     text check (delivery_url is null or (delivery_url ~ '^https://' and char_length(delivery_url) <= 1000)),
  delivery_expires_at date,
  allow_selection  boolean not null default true,
  selection_limit  int check (selection_limit is null or selection_limit > 0),
  status           text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  expires_at       timestamptz,
  cover_photo_id   uuid,
  created_at       timestamptz not null default now()
);

create table public.photos (
  id            uuid primary key default gen_random_uuid(),
  gallery_id    uuid not null references public.galleries on delete cascade,
  preview_path  text not null,                 -- aperçu web ; les originaux HD ne sont pas stockés ici
  filename      text not null check (char_length(filename) <= 255),  -- nom du fichier d'origine
  width         int,
  height        int,
  position      int not null default 0,
  created_at    timestamptz not null default now()
);
create index photos_gallery_position_idx on public.photos (gallery_id, position);

alter table public.galleries
  add constraint galleries_cover_fk foreign key (cover_photo_id)
  references public.photos (id) on delete set null;

create table public.selections (
  id           uuid primary key default gen_random_uuid(),
  gallery_id   uuid not null references public.galleries on delete cascade,
  client_name  text not null check (char_length(client_name) between 1 and 120),
  client_email text check (char_length(client_email) <= 200),
  comment      text check (char_length(comment) <= 2000),
  photo_ids    uuid[] not null,
  created_at   timestamptz not null default now()
);
create index selections_gallery_idx on public.selections (gallery_id, created_at desc);

-- Journal des tentatives d'accès (anti brute-force, écrit par l'Edge Function)
create table public.access_attempts (
  id         bigint generated always as identity primary key,
  ip         text not null,
  slug       text,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index access_attempts_ip_idx on public.access_attempts (ip, created_at desc);

-- ---------------------------------------------------------------------
--  Portfolio public et demandes de réservation
-- ---------------------------------------------------------------------
create table public.portfolio (
  id           uuid primary key default gen_random_uuid(),
  storage_path text not null,
  width        int,
  height       int,
  caption      text check (char_length(caption) <= 200),
  category     text check (char_length(category) <= 60),
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

create table public.booking_requests (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 120),
  email          text not null check (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone          text check (char_length(phone) <= 40),
  service        text check (char_length(service) <= 120),
  preferred_date date,
  message        text check (char_length(message) <= 3000),
  status         text not null default 'new' check (status in ('new', 'contacted', 'booked', 'declined')),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------
alter table public.admins           enable row level security;
alter table public.galleries        enable row level security;
alter table public.photos           enable row level security;
alter table public.selections       enable row level security;
alter table public.access_attempts  enable row level security;  -- aucune policy : service_role uniquement
alter table public.portfolio        enable row level security;
alter table public.booking_requests enable row level security;

create policy admins_self_read on public.admins
  for select to authenticated using (user_id = auth.uid());

create policy galleries_admin on public.galleries
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy photos_admin on public.photos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy selections_admin on public.selections
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy portfolio_admin on public.portfolio
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy booking_admin on public.booking_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Le public lit le portfolio et peut seulement déposer une demande de réservation
create policy portfolio_public_read on public.portfolio
  for select to anon, authenticated using (true);
create policy booking_public_insert on public.booking_requests
  for insert to anon, authenticated with check (status = 'new');

-- Le hash du code d'accès n'est jamais lisible côté client, même par l'admin
-- (privilège colonne : on retire le SELECT table puis on regranter colonne par colonne)
revoke select on public.galleries from anon, authenticated;
grant select (id, slug, title, client_name, client_email, event_date, allow_download, allow_selection,
              selection_limit, status, expires_at, cover_photo_id, delivery_url, delivery_expires_at, created_at)
  on public.galleries to authenticated;

-- ---------------------------------------------------------------------
--  Fonctions
-- ---------------------------------------------------------------------

-- Définit le code d'accès d'une galerie (admin uniquement), stocké en bcrypt
create or replace function public.set_gallery_code(p_gallery uuid, p_code text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_code is null or char_length(p_code) < 6 or char_length(p_code) > 128 then
    raise exception 'Le code doit faire entre 6 et 128 caractères';
  end if;
  update public.galleries
     set access_code_hash = extensions.crypt(p_code, extensions.gen_salt('bf', 10))
   where id = p_gallery;
end;
$$;
revoke execute on function public.set_gallery_code(uuid, text) from public, anon;
grant execute on function public.set_gallery_code(uuid, text) to authenticated;

-- Vérifie slug + code ; renvoie l'id de la galerie si l'accès est valide
-- Appelée uniquement par l'Edge Function (service_role)
create or replace function public.verify_gallery_access(p_slug text, p_code text)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select g.id
    from public.galleries g
   where g.slug = p_slug
     and g.status = 'published'
     and g.access_code_hash is not null
     and (g.expires_at is null or g.expires_at > now())
     and g.access_code_hash = extensions.crypt(p_code, g.access_code_hash);
$$;
revoke execute on function public.verify_gallery_access(text, text) from public, anon, authenticated;
grant execute on function public.verify_gallery_access(text, text) to service_role;

-- Purge des tentatives de plus de 7 jours (à planifier via pg_cron si souhaité)
create or replace function public.purge_access_attempts()
returns void language sql security definer set search_path = '' as $$
  delete from public.access_attempts where created_at < now() - interval '7 days';
$$;
revoke execute on function public.purge_access_attempts() from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  Stockage
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('galleries', 'galleries', false, 10485760,  array['image/jpeg', 'image/webp']),
  ('portfolio', 'portfolio', true,  20971520,  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Seul l'admin écrit/lit les buckets ; les clients passent par des URL signées
-- délivrées par l'Edge Function, le portfolio est servi par URL publique.
create policy storage_admin_all on storage.objects
  for all to authenticated
  using (bucket_id in ('galleries', 'portfolio') and public.is_admin())
  with check (bucket_id in ('galleries', 'portfolio') and public.is_admin());
