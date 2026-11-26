-- =====================================================================
--  lau.rie : droits d'accès explicites pour l'API de Supabase.
--  Utile si le projet a été créé sans « exposer automatiquement les nouvelles
--  tables » : sans ces droits, le site ne voit pas les tables (erreur 404 ou 401).
--  Sans danger à exécuter plusieurs fois. Les règles RLS restent la vraie protection.
-- =====================================================================

grant usage on schema public to anon, authenticated, service_role;

-- Les fonctions serveur (Edge Functions) travaillent avec la clé service_role
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Visiteurs : seulement le contenu public (filtré par RLS)
grant select on public.site_settings, public.portfolio, public.reviews to anon;

-- Administratrices connectées (filtré par RLS : is_admin())
grant select, insert, update, delete on public.site_settings, public.portfolio, public.reviews,
  public.photos, public.selections, public.booking_requests to authenticated;
grant insert, update, delete on public.galleries to authenticated;   -- lecture : colonnes choisies (migrations 1, 3 et 4)
grant select on public.admins, public.photo_favs to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- L'API relit la liste des tables
notify pgrst, 'reload schema';
