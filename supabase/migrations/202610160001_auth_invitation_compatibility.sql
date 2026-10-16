begin;

drop trigger if exists require_admin_invitation on auth.users;
drop function if exists public.reject_uninvited_auth_user();

commit;