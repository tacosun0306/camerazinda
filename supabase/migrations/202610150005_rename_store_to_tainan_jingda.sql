begin;

update public.store_locations
set name = '台南晶大門市'
where name = '台北旗艦店';

update public.profiles
set store_name = '台南晶大門市'
where store_name = '台北旗艦店';

alter table public.profiles
alter column store_name set default '台南晶大門市';

commit;