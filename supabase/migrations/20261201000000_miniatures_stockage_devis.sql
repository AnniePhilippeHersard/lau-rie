-- =====================================================================
--  lau.rie : miniatures des photos (galeries et site), suivi de l'espace
--  de stockage, archivage des galeries fermées, devis.
--  À exécuter après les six migrations précédentes. Sans danger à relancer.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Miniatures : la grille charge une petite image, le plein écran la grande
-- ---------------------------------------------------------------------
alter table public.photos    add column if not exists thumb_path text check (thumb_path is null or char_length(thumb_path) <= 400);
alter table public.portfolio add column if not exists thumb_path text check (thumb_path is null or char_length(thumb_path) <= 400);
alter table public.portfolio add column if not exists thumb_width int;

-- Galerie fermée depuis longtemps : ses aperçus sont supprimés pour libérer
-- de la place (la fiche, les noms de fichiers et la sélection restent)
alter table public.galleries add column if not exists archived_at timestamptz;

-- ---------------------------------------------------------------------
--  Espace de stockage utilisé, par dossier (administratrices seulement)
-- ---------------------------------------------------------------------
-- folder : pour le dossier des galeries, l'identifiant de la galerie (taille de chacune)
drop function if exists public.storage_usage();
create or replace function public.storage_usage()
returns table (bucket text, folder text, bytes bigint, files bigint)
language sql stable security definer
set search_path = ''
as $$
  select o.bucket_id::text,
         case when o.bucket_id = 'galleries' then split_part(o.name, '/', 1) end,
         coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint,
         count(*)::bigint
    from storage.objects o
   where public.is_admin()
   group by 1, 2;
$$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;

-- ---------------------------------------------------------------------
--  Devis : numéro unique (D-2026-001), contenu figé au moment de l'envoi
-- ---------------------------------------------------------------------
create table if not exists public.quotes (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique check (number ~ '^D-\d{4}-\d{3,}$'),
  request_id  uuid references public.booking_requests on delete set null,
  client_name text not null check (char_length(client_name) between 1 and 160),
  total       numeric(10, 2) not null default 0 check (total >= 0),
  status      text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined')),
  data        jsonb not null default '{}'::jsonb check (pg_column_size(data) < 60000),
  created_at  timestamptz not null default now()
);
create index if not exists quotes_request_idx on public.quotes (request_id);
alter table public.quotes enable row level security;
drop policy if exists quotes_admin on public.quotes;
create policy quotes_admin on public.quotes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.quotes to authenticated;
grant all on public.quotes to service_role;

notify pgrst, 'reload schema';
