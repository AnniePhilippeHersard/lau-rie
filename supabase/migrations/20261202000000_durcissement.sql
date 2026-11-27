-- Durcissement (audit de sécurité du 27/11/2026)
-- is_admin() ne sert qu'aux règles des administratrices (rôle authenticated) et aux
-- fonctions SECURITY DEFINER : les visiteurs anonymes n'ont pas à pouvoir l'appeler
-- (/rest/v1/rpc/is_admin). Les lectures publiques (portfolio, avis, contenu du site)
-- n'utilisent pas cette fonction.
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated, service_role;
