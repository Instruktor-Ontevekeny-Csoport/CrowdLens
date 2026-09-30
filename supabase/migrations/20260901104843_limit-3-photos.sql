create or replace function enforce_daily_limit()
returns trigger
security definer set search_path = public
as $$
declare
current_count int;
begin
  perform pg_advisory_xact_lock(hashtext(new.client_token));

select count(*) into current_count
from photos
where client_token = new.client_token
  and submitted_date = new.submitted_date;

-- Superseded by 20260930000000_admin_settings_roles.sql (limit read from app_settings).
if current_count >= 3 then
    raise exception 'Daily photo limit reached';
end if;

return new;
end;
$$ language plpgsql;
