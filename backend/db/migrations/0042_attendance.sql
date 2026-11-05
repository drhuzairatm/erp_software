-- Phase 3: attendance. New tables and functions only, plus the 'attendance' context for secure files.
--
-- Signals (browser GPS, public IP, QR, camera photo) can all be wrong or spoofed, so none of them decides anything alone: a failed or missing
-- signal raises a flag and sends the record to manual review. Nothing here marks a person absent or rejects a check-in automatically.
-- The server's clock is the only source of time. Face matching and liveness are deliberately not implemented.

insert into permissions (key, category, description, is_sensitive) values
  ('attendance.view',   'Attendance', 'View attendance of all staff in the company, and attendance reports', true),
  ('attendance.review', 'Attendance', 'Decide manual reviews, correction requests and leave requests', true),
  ('attendance.manage', 'Attendance', 'Configure offices, IP allowlists, working hours and office QR kiosks', true)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key)
  select r.id, p.key from roles r cross join (values ('attendance.view'), ('attendance.review')) as p(key) where r.key in ('md', 'manager') on conflict do nothing;
insert into role_permissions (role_id, permission_key)
  select r.id, 'attendance.view' from roles r where r.key = 'ceo' on conflict do nothing;
insert into role_permissions (role_id, permission_key)
  select r.id, 'attendance.manage' from roles r where r.key in ('md', 'system_admin') on conflict do nothing;

create table attendance_offices (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id),
  name       text not null check (length(btrim(name)) between 2 and 120),
  latitude   double precision check (latitude between -90 and 90),
  longitude  double precision check (longitude between -180 and 180),
  radius_m   int not null default 150 check (radius_m between 10 and 5000),
  allowed_ips cidr[] not null default '{}',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index attendance_offices_org_name on attendance_offices (org_id, lower(name));

-- One per company. The defaults are placeholders until the company confirms its working hours.
create table attendance_policies (
  org_id             uuid primary key references organizations(id),
  timezone           text not null default 'Asia/Kolkata',
  work_start         time not null default '09:30',
  work_end           time not null default '18:00',
  grace_minutes      int not null default 10 check (grace_minutes between 0 and 240),
  half_day_minutes   int not null default 240 check (half_day_minutes between 0 and 720),
  max_gps_accuracy_m int not null default 200 check (max_gps_accuracy_m between 10 and 5000),
  require_gps        boolean not null default true,
  require_ip         boolean not null default false,
  require_qr         boolean not null default false,
  require_photo      boolean not null default true,
  weekly_off         int[] not null default '{0}', -- days with no expected attendance; 0 = Sunday
  leave_types        text[] not null default '{Casual leave,Sick leave,Paid leave,Unpaid leave}',
  updated_at         timestamptz not null default now()
);

create table attendance_records (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id),
  user_id        uuid not null references user_profiles(id),
  work_date      date not null,
  office_id      uuid references attendance_offices(id),
  status         text not null default 'present' check (status in ('present', 'late', 'half_day', 'leave', 'field_duty', 'official_visit', 'absent')),
  check_in_at    timestamptz,
  check_out_at   timestamptz,
  late_minutes   int not null default 0,
  early_minutes  int not null default 0,
  break_minutes  int not null default 0,
  on_break_since timestamptz,
  review_status  text not null default 'none' check (review_status in ('none', 'pending', 'accepted', 'not_accepted')),
  review_note    text,
  reviewed_by    uuid references user_profiles(id),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, user_id, work_date)
);
create index attendance_records_date on attendance_records (org_id, work_date desc);
create index attendance_records_review on attendance_records (org_id, work_date desc) where review_status = 'pending';
create trigger attendance_records_touch before update on attendance_records for each row execute function app.touch_updated_at();

-- Append-only log of every attempt: what the device reported and what the server checked.
create table attendance_events (
  id            uuid primary key default gen_random_uuid(),
  record_id     uuid not null references attendance_records(id),
  org_id        uuid not null references organizations(id),
  user_id       uuid not null references user_profiles(id),
  event_type    text not null check (event_type in ('check_in', 'check_out', 'break_start', 'break_end')),
  occurred_at   timestamptz not null default now(),
  method        text not null check (method in ('mobile', 'kiosk')),
  latitude      double precision,
  longitude     double precision,
  accuracy_m    double precision,
  distance_m    int,
  office_id     uuid references attendance_offices(id),
  client_ip     text,
  device_info   text,
  qr_verified   boolean not null default false,
  photo_file_id uuid references secure_files(id),
  flags         text[] not null default '{}'
);
create index attendance_events_record on attendance_events (record_id, occurred_at);
create index attendance_events_flagged on attendance_events (org_id, occurred_at desc) where flags <> '{}';

create table attendance_qr_tokens (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id),
  office_id  uuid not null references attendance_offices(id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  issued_by  uuid not null references user_profiles(id),
  issued_at  timestamptz not null default now(),
  expires_at timestamptz not null
);
create index attendance_qr_tokens_expiry on attendance_qr_tokens (expires_at);
create table attendance_qr_uses (
  token_id   uuid not null references attendance_qr_tokens(id) on delete cascade,
  user_id    uuid not null references user_profiles(id),
  event_type text not null,
  used_at    timestamptz not null default now(),
  primary key (token_id, user_id, event_type)
);

create table attendance_corrections (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id),
  user_id         uuid not null references user_profiles(id),
  work_date       date not null,
  check_in_at     timestamptz,
  check_out_at    timestamptz,
  reason          text not null check (length(btrim(reason)) between 5 and 1000),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by      uuid references user_profiles(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  check (check_in_at is not null or check_out_at is not null)
);
create index attendance_corrections_org on attendance_corrections (org_id, created_at desc);

create table attendance_leaves (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id),
  user_id       uuid not null references user_profiles(id),
  kind          text not null check (kind in ('leave', 'field_duty', 'official_visit')),
  leave_type    text,
  from_date     date not null,
  to_date       date not null,
  reason        text not null check (length(btrim(reason)) between 3 and 1000),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid references user_profiles(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  check (to_date >= from_date and to_date - from_date <= 90)
);
create index attendance_leaves_org on attendance_leaves (org_id, from_date desc);

alter table attendance_offices enable row level security;
alter table attendance_policies enable row level security;
alter table attendance_records enable row level security;
alter table attendance_events enable row level security;
alter table attendance_qr_tokens enable row level security;
alter table attendance_qr_uses enable row level security;
alter table attendance_corrections enable row level security;
alter table attendance_leaves enable row level security;

-- Members can see office names; the IP allowlist is a separate, narrower grant through a function.
create policy attendance_offices_select on attendance_offices for select to erp_app using (app.is_member(org_id));
create policy attendance_offices_insert on attendance_offices for insert to erp_app with check (app.has_perm(org_id, 'attendance.manage'));
create policy attendance_offices_update on attendance_offices for update to erp_app using (app.has_perm(org_id, 'attendance.manage')) with check (app.has_perm(org_id, 'attendance.manage'));
grant select (id, org_id, name, is_active, radius_m, created_at) on attendance_offices to erp_app;
grant insert (org_id, name, latitude, longitude, radius_m, allowed_ips), update (name, latitude, longitude, radius_m, allowed_ips, is_active) on attendance_offices to erp_app;

create policy attendance_policies_select on attendance_policies for select to erp_app using (app.is_member(org_id));
create policy attendance_policies_insert on attendance_policies for insert to erp_app with check (app.has_perm(org_id, 'attendance.manage'));
create policy attendance_policies_update on attendance_policies for update to erp_app using (app.has_perm(org_id, 'attendance.manage')) with check (app.has_perm(org_id, 'attendance.manage'));
grant select, insert, update on attendance_policies to erp_app;

create policy attendance_records_select on attendance_records for select to erp_app
  using (app.is_member(org_id) and (user_id = app.current_user_id() or app.has_perm(org_id, 'attendance.view') or app.has_perm(org_id, 'attendance.review')));
grant select on attendance_records to erp_app;
create policy attendance_events_select on attendance_events for select to erp_app
  using (app.is_member(org_id) and (user_id = app.current_user_id() or app.has_perm(org_id, 'attendance.review')));
grant select on attendance_events to erp_app;
create policy attendance_corrections_select on attendance_corrections for select to erp_app
  using (app.is_member(org_id) and (user_id = app.current_user_id() or app.has_perm(org_id, 'attendance.review')));
grant select on attendance_corrections to erp_app;
create policy attendance_leaves_select on attendance_leaves for select to erp_app
  using (app.is_member(org_id) and (user_id = app.current_user_id() or app.has_perm(org_id, 'attendance.view') or app.has_perm(org_id, 'attendance.review')));
grant select on attendance_leaves to erp_app;
-- attendance_qr_tokens and attendance_qr_uses: no grant, no policy. Only the functions below touch them.

create trigger attendance_offices_audit after insert or update on attendance_offices for each row execute function app.audit_row('org_id', '');
create trigger attendance_policies_audit after insert or update on attendance_policies for each row execute function app.audit_row('org_id', '');
create trigger attendance_records_audit after update of status, check_in_at, check_out_at, review_status on attendance_records for each row execute function app.audit_row('org_id', '');
create trigger attendance_corrections_audit after insert or update on attendance_corrections for each row execute function app.audit_row('org_id', '');
create trigger attendance_leaves_audit after insert or update on attendance_leaves for each row execute function app.audit_row('org_id', '');

-- Great-circle distance in metres.
create or replace function app.distance_m(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision) returns int
language sql immutable set search_path = public, pg_temp as $$
  select round(2 * 6371000 * asin(least(1, sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))))::int
$$;

create or replace function app.attendance_notify_reviewers(p_org uuid, p_event text, p_title text, p_href text, p_subject uuid, p_dedupe text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select distinct m.user_id from organization_memberships m where m.org_id = p_org and m.is_active and app.role_has_perm(m.role_id, 'attendance.review') loop
    perform app.staff_notify(r.user_id, p_org, p_event, p_title, p_href, 'attendance', p_subject, 'warning', p_dedupe, false);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Marking attendance. Sequence errors are refused; verification problems never are: they raise flags for review.
-- ---------------------------------------------------------------------------
create or replace function app.attendance_mark(p_org uuid, p_type text, p_method text, p_lat double precision, p_lng double precision, p_accuracy double precision,
                                                p_ip text, p_device text, p_qr_hash text, p_has_photo boolean)
returns table (record_id uuid, event_id uuid, status text, flags text[], needs_review boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me uuid := app.current_user_id(); v_pol attendance_policies%rowtype; v_rec attendance_records%rowtype; v_date date; v_now timestamptz := now();
  v_flags text[] := '{}'; v_office uuid; v_dist int; v_radius int; v_qr attendance_qr_tokens%rowtype; v_qr_ok boolean := false; v_any_allowlist boolean; v_ip_ok boolean := false;
  v_off_site boolean; v_event uuid; v_local time; v_status text; v_new uuid; v_worked int; v_uses int;
begin
  if v_me is null or not app.is_member(p_org) then raise exception 'permission denied: attendance' using errcode = '42501'; end if;
  if p_type not in ('check_in', 'check_out', 'break_start', 'break_end') then raise exception 'invalid attendance action' using errcode = '22023'; end if;
  if p_method not in ('mobile', 'kiosk') then raise exception 'invalid attendance method' using errcode = '22023'; end if;
  insert into attendance_policies (org_id) values (p_org) on conflict (org_id) do nothing;
  select * into v_pol from attendance_policies where org_id = p_org;
  v_date := (v_now at time zone v_pol.timezone)::date;
  v_local := (v_now at time zone v_pol.timezone)::time;

  perform pg_advisory_xact_lock(hashtextextended('attendance:' || v_me || ':' || v_date, 0));
  select * into v_rec from attendance_records r where r.org_id = p_org and r.user_id = v_me and r.work_date = v_date for update;

  if p_type = 'check_in' then
    if v_rec.check_in_at is not null then raise exception 'You have already checked in today.' using errcode = '23514'; end if;
  else
    if v_rec.check_in_at is null then raise exception 'Check in first.' using errcode = '23514'; end if;
    if v_rec.check_out_at is not null then raise exception 'You have already checked out today. Ask for a correction if this is wrong.' using errcode = '23514'; end if;
    if p_type = 'break_start' and v_rec.on_break_since is not null then raise exception 'You are already on a break.' using errcode = '23514'; end if;
    if p_type = 'break_end' and v_rec.on_break_since is null then raise exception 'You are not on a break.' using errcode = '23514'; end if;
  end if;

  -- Approved field duty or an official visit: being away from the office is expected.
  select exists (select 1 from attendance_leaves l where l.org_id = p_org and l.user_id = v_me and l.status = 'approved'
                  and l.kind in ('field_duty', 'official_visit') and v_date between l.from_date and l.to_date) into v_off_site;

  -- QR: server-side, short-lived, and each person can use a token once per action.
  if p_qr_hash is not null then
    select * into v_qr from attendance_qr_tokens t where t.token_hash = p_qr_hash and t.org_id = p_org;
    if v_qr.id is null then v_flags := v_flags || 'qr_invalid'::text;
    elsif v_qr.expires_at < v_now then v_flags := v_flags || 'qr_expired'::text;
    else
      insert into attendance_qr_uses (token_id, user_id, event_type) values (v_qr.id, v_me, p_type) on conflict do nothing;
      get diagnostics v_uses = row_count;
      if v_uses = 0 then v_flags := v_flags || 'qr_replayed'::text; else v_qr_ok := true; v_office := v_qr.office_id; end if;
    end if;
  elsif v_pol.require_qr and not v_off_site then v_flags := v_flags || 'qr_missing'::text;
  end if;

  -- GPS: nearest active office with coordinates.
  if p_lat is not null and p_lng is not null then
    select o.id, app.distance_m(p_lat, p_lng, o.latitude, o.longitude), o.radius_m into v_new, v_dist, v_radius
      from attendance_offices o where o.org_id = p_org and o.is_active and o.latitude is not null and o.longitude is not null
     order by app.distance_m(p_lat, p_lng, o.latitude, o.longitude) limit 1;
    if v_new is null then
      if v_pol.require_gps and not v_off_site then v_flags := v_flags || 'no_office_configured'::text; end if;
    else
      if v_office is null then v_office := v_new; end if;
      if v_dist > v_radius and v_pol.require_gps and not v_off_site then v_flags := v_flags || 'outside_geofence'::text; end if;
      if p_accuracy is not null and p_accuracy > v_pol.max_gps_accuracy_m and v_pol.require_gps and not v_off_site then v_flags := v_flags || 'low_gps_accuracy'::text; end if;
    end if;
  elsif v_pol.require_gps and not v_off_site then v_flags := v_flags || 'no_gps'::text;
  end if;

  -- Office public IP.
  select exists (select 1 from attendance_offices o where o.org_id = p_org and o.is_active and cardinality(o.allowed_ips) > 0) into v_any_allowlist;
  if v_any_allowlist then
    begin
      select exists (select 1 from attendance_offices o where o.org_id = p_org and o.is_active and p_ip::inet <<= any(o.allowed_ips)) into v_ip_ok;
    exception when others then v_ip_ok := false;
    end;
    if not v_ip_ok and v_pol.require_ip and not v_off_site then v_flags := v_flags || 'ip_not_allowed'::text; end if;
  end if;

  if v_pol.require_photo and p_type in ('check_in', 'check_out') and not coalesce(p_has_photo, false) then v_flags := v_flags || 'photo_missing'::text; end if;

  if p_type = 'check_in' then
    v_status := case when v_local > v_pol.work_start + make_interval(mins => v_pol.grace_minutes) then 'late' else 'present' end;
    insert into attendance_records (org_id, user_id, work_date, office_id, status, check_in_at, late_minutes)
    values (p_org, v_me, v_date, v_office, v_status, v_now, case when v_status = 'late' then ceil(extract(epoch from v_local - v_pol.work_start) / 60)::int else 0 end)
    on conflict (org_id, user_id, work_date) do update set office_id = excluded.office_id, status = case when attendance_records.status in ('leave', 'field_duty', 'official_visit') then attendance_records.status else excluded.status end,
      check_in_at = excluded.check_in_at, late_minutes = excluded.late_minutes
    returning * into v_rec;
  elsif p_type = 'break_start' then
    update attendance_records r set on_break_since = v_now where r.id = v_rec.id returning * into v_rec;
  elsif p_type = 'break_end' then
    update attendance_records r set break_minutes = r.break_minutes + ceil(extract(epoch from v_now - r.on_break_since) / 60)::int, on_break_since = null where r.id = v_rec.id returning * into v_rec;
  else
    -- An open break ends with the check-out.
    update attendance_records r set break_minutes = r.break_minutes + coalesce(ceil(extract(epoch from v_now - r.on_break_since) / 60)::int, 0), on_break_since = null,
      check_out_at = v_now, early_minutes = greatest(0, ceil(extract(epoch from v_pol.work_end - v_local) / 60)::int)
     where r.id = v_rec.id returning * into v_rec;
    v_worked := ceil(extract(epoch from v_now - v_rec.check_in_at) / 60)::int - v_rec.break_minutes;
    if v_worked < v_pol.half_day_minutes and v_rec.status in ('present', 'late') then
      update attendance_records r set status = 'half_day' where r.id = v_rec.id returning * into v_rec;
    end if;
  end if;

  insert into attendance_events (record_id, org_id, user_id, event_type, method, latitude, longitude, accuracy_m, distance_m, office_id, client_ip, device_info, qr_verified, flags)
  values (v_rec.id, p_org, v_me, p_type, p_method, p_lat, p_lng, p_accuracy, v_dist, v_office, left(p_ip, 64), left(p_device, 300), v_qr_ok, v_flags)
  returning id into v_event;

  if cardinality(v_flags) > 0 and v_rec.review_status <> 'pending' then
    update attendance_records r set review_status = 'pending', review_note = null, reviewed_by = null, reviewed_at = null where r.id = v_rec.id returning * into v_rec;
    perform app.attendance_notify_reviewers(p_org, 'attendance_review_needed', 'An attendance record needs manual review', '/attendance/manage', v_rec.id, 'attendance_review:' || v_rec.id || ':' || v_event);
  end if;

  return query select v_rec.id, v_event, v_rec.status, v_flags, v_rec.review_status = 'pending';
end $$;

create or replace function app.attendance_attach_photo(p_event uuid, p_file uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_e attendance_events%rowtype;
begin
  select * into v_e from attendance_events e where e.id = p_event for update;
  if v_e.id is null or v_e.user_id <> app.current_user_id() then raise exception 'permission denied: attendance photo' using errcode = '42501'; end if;
  if not exists (select 1 from secure_files f where f.id = p_file and f.context_type = 'attendance' and f.context_id = v_e.record_id and f.uploaded_by = app.current_user_id()) then
    raise exception 'permission denied: attendance photo' using errcode = '42501';
  end if;
  update attendance_events set photo_file_id = p_file where id = p_event;
end $$;

-- The photo upload failed after the event was stored: flag it for review. The attendance itself stands.
create or replace function app.attendance_flag_event(p_event uuid, p_flag text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_e attendance_events%rowtype;
begin
  select * into v_e from attendance_events e where e.id = p_event for update;
  if v_e.id is null or v_e.user_id <> app.current_user_id() then raise exception 'permission denied: attendance event' using errcode = '42501'; end if;
  if p_flag not in ('photo_failed') then raise exception 'invalid flag' using errcode = '22023'; end if;
  update attendance_events set flags = flags || p_flag where id = p_event;
  update attendance_records set review_status = 'pending' where id = v_e.record_id and review_status <> 'pending';
  perform app.attendance_notify_reviewers(v_e.org_id, 'attendance_review_needed', 'An attendance record needs manual review', '/attendance/manage', v_e.record_id, 'attendance_review:' || v_e.record_id || ':' || p_event);
end $$;

-- ---------------------------------------------------------------------------
-- Office QR kiosk: a holder of attendance.manage opens the kiosk page; the token is random and short-lived. Only its hash is kept.
-- ---------------------------------------------------------------------------
create or replace function app.attendance_issue_qr(p_office uuid, p_hash text, p_ttl_seconds int) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_expires timestamptz := now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 45), 10), 120));
begin
  select o.org_id into v_org from attendance_offices o where o.id = p_office and o.is_active;
  if v_org is null or not app.has_perm(v_org, 'attendance.manage') then raise exception 'permission denied: attendance kiosk' using errcode = '42501'; end if;
  insert into attendance_qr_tokens (org_id, office_id, token_hash, issued_by, expires_at) values (v_org, p_office, p_hash, app.current_user_id(), v_expires);
  delete from attendance_qr_tokens where expires_at < now() - interval '1 day';
  return v_expires;
end $$;

-- IP allowlists and coordinates, for those who configure them. Other members see only name and status.
create or replace function app.attendance_office_settings(p_org uuid)
returns table (id uuid, name text, latitude double precision, longitude double precision, radius_m int, allowed_ips text[], is_active boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_perm(p_org, 'attendance.manage') then raise exception 'permission denied: attendance settings' using errcode = '42501'; end if;
  return query select o.id, o.name, o.latitude, o.longitude, o.radius_m, o.allowed_ips::text[], o.is_active from attendance_offices o where o.org_id = p_org order by o.name;
end $$;

-- ---------------------------------------------------------------------------
-- Manual review, corrections, leave. Each decision is by a person, recorded and notified. Nobody decides their own.
-- ---------------------------------------------------------------------------
create or replace function app.attendance_decide_review(p_record uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r attendance_records%rowtype;
begin
  select * into v_r from attendance_records r where r.id = p_record for update;
  if v_r.id is null or not app.has_perm(v_r.org_id, 'attendance.review') or v_r.user_id = app.current_user_id() then raise exception 'permission denied: attendance review' using errcode = '42501'; end if;
  if p_decision not in ('accepted', 'not_accepted') then raise exception 'invalid decision' using errcode = '22023'; end if;
  if v_r.review_status <> 'pending' then raise exception 'This record is not waiting for review.' using errcode = '23514'; end if;
  if p_decision = 'not_accepted' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Give a reason.' using errcode = '23514'; end if;
  update attendance_records set review_status = p_decision, review_note = nullif(btrim(coalesce(p_note, '')), ''), reviewed_by = app.current_user_id(), reviewed_at = now() where id = p_record;
  perform app.staff_notify(v_r.user_id, v_r.org_id, 'attendance_review_decided', 'Your attendance review was decided', '/attendance', 'attendance', p_record, 'info', null, false);
end $$;

-- A status set on purpose by a reviewer (for example absent). This is the only path to "absent".
create or replace function app.attendance_set_status(p_org uuid, p_user uuid, p_date date, p_status text, p_note text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not app.has_perm(p_org, 'attendance.review') or p_user = app.current_user_id() then raise exception 'permission denied: attendance status' using errcode = '42501'; end if;
  if not app.user_is_active_member(p_user, p_org) then raise exception 'This person is not an active member of the company.' using errcode = '23514'; end if;
  if p_status not in ('present', 'late', 'half_day', 'leave', 'field_duty', 'official_visit', 'absent') then raise exception 'invalid status' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Give a reason.' using errcode = '23514'; end if;
  insert into attendance_records (org_id, user_id, work_date, status, review_note, reviewed_by, reviewed_at) values (p_org, p_user, p_date, p_status, btrim(p_note), app.current_user_id(), now())
  on conflict (org_id, user_id, work_date) do update set status = excluded.status, review_note = excluded.review_note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at
  returning id into v_id;
  perform app.staff_notify(p_user, p_org, 'attendance_status_set', 'Your attendance status was updated', '/attendance', 'attendance', v_id, 'info', null, false);
  return v_id;
end $$;

create or replace function app.attendance_request_correction(p_org uuid, p_date date, p_in timestamptz, p_out timestamptz, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_tz text;
begin
  if not app.is_member(p_org) then raise exception 'permission denied: attendance' using errcode = '42501'; end if;
  select coalesce((select timezone from attendance_policies where org_id = p_org), 'Asia/Kolkata') into v_tz;
  if p_date > (now() at time zone v_tz)::date then raise exception 'A correction cannot be for a future date.' using errcode = '23514'; end if;
  if p_in is not null and p_out is not null and p_out <= p_in then raise exception 'Check-out must be after check-in.' using errcode = '23514'; end if;
  insert into attendance_corrections (org_id, user_id, work_date, check_in_at, check_out_at, reason) values (p_org, app.current_user_id(), p_date, p_in, p_out, btrim(p_reason)) returning id into v_id;
  perform app.attendance_notify_reviewers(p_org, 'attendance_correction_requested', 'An attendance correction needs a decision', '/attendance/manage', v_id, 'attendance_correction:' || v_id);
  return v_id;
end $$;

create or replace function app.attendance_decide_correction(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c attendance_corrections%rowtype; v_pol attendance_policies%rowtype; v_in timestamptz; v_local time; v_rec uuid;
begin
  select * into v_c from attendance_corrections c where c.id = p_id for update;
  if v_c.id is null or not app.has_perm(v_c.org_id, 'attendance.review') or v_c.user_id = app.current_user_id() then raise exception 'permission denied: attendance correction' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision' using errcode = '22023'; end if;
  if v_c.status <> 'pending' then raise exception 'This request has already been decided.' using errcode = '23514'; end if;
  if p_decision = 'rejected' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Give a reason.' using errcode = '23514'; end if;
  update attendance_corrections set status = p_decision, decided_by = app.current_user_id(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_id;
  if p_decision = 'approved' then
    insert into attendance_policies (org_id) values (v_c.org_id) on conflict (org_id) do nothing;
    select * into v_pol from attendance_policies where org_id = v_c.org_id;
    insert into attendance_records (org_id, user_id, work_date, check_in_at, check_out_at) values (v_c.org_id, v_c.user_id, v_c.work_date, v_c.check_in_at, v_c.check_out_at)
    on conflict (org_id, user_id, work_date) do update set check_in_at = coalesce(excluded.check_in_at, attendance_records.check_in_at), check_out_at = coalesce(excluded.check_out_at, attendance_records.check_out_at)
    returning id, check_in_at into v_rec, v_in;
    if v_in is not null then
      v_local := (v_in at time zone v_pol.timezone)::time;
      update attendance_records r set late_minutes = case when v_local > v_pol.work_start + make_interval(mins => v_pol.grace_minutes) then ceil(extract(epoch from v_local - v_pol.work_start) / 60)::int else 0 end,
        status = case when r.status in ('present', 'late', 'absent') then (case when v_local > v_pol.work_start + make_interval(mins => v_pol.grace_minutes) then 'late' else 'present' end) else r.status end
       where r.id = v_rec;
    end if;
    perform app.audit('attendance_corrected', 'attendance_records', v_rec::text, v_c.org_id, null, null, jsonb_build_object('correction', p_id, 'check_in_at', v_c.check_in_at, 'check_out_at', v_c.check_out_at));
  end if;
  perform app.staff_notify(v_c.user_id, v_c.org_id, 'attendance_correction_decided', 'Your attendance correction was ' || p_decision, '/attendance', 'attendance', p_id, 'info', null, false);
end $$;

create or replace function app.attendance_request_leave(p_org uuid, p_kind text, p_type text, p_from date, p_to date, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_me uuid := app.current_user_id();
begin
  if not app.is_member(p_org) then raise exception 'permission denied: attendance' using errcode = '42501'; end if;
  if exists (select 1 from attendance_leaves l where l.org_id = p_org and l.user_id = v_me and l.status in ('pending', 'approved') and daterange(l.from_date, l.to_date, '[]') && daterange(p_from, p_to, '[]')) then
    raise exception 'You already have a request covering these dates.' using errcode = '23514';
  end if;
  insert into attendance_leaves (org_id, user_id, kind, leave_type, from_date, to_date, reason) values (p_org, v_me, p_kind, nullif(btrim(coalesce(p_type, '')), ''), p_from, p_to, btrim(p_reason)) returning id into v_id;
  perform app.attendance_notify_reviewers(p_org, 'attendance_leave_requested', 'A leave or field duty request needs a decision', '/attendance/manage', v_id, 'attendance_leave:' || v_id);
  return v_id;
end $$;

create or replace function app.attendance_decide_leave(p_id uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_l attendance_leaves%rowtype; d date;
begin
  select * into v_l from attendance_leaves l where l.id = p_id for update;
  if v_l.id is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  if p_decision = 'cancelled' then
    if v_l.user_id <> app.current_user_id() or v_l.status <> 'pending' then raise exception 'Only your own pending request can be cancelled.' using errcode = '42501'; end if;
  else
    if not app.has_perm(v_l.org_id, 'attendance.review') or v_l.user_id = app.current_user_id() then raise exception 'permission denied: attendance leave' using errcode = '42501'; end if;
    if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision' using errcode = '22023'; end if;
    if v_l.status <> 'pending' then raise exception 'This request has already been decided.' using errcode = '23514'; end if;
    if p_decision = 'rejected' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Give a reason.' using errcode = '23514'; end if;
  end if;
  update attendance_leaves set status = p_decision, decided_by = app.current_user_id(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_id;
  if p_decision = 'approved' then
    for d in select generate_series(v_l.from_date, v_l.to_date, interval '1 day')::date loop
      insert into attendance_records (org_id, user_id, work_date, status) values (v_l.org_id, v_l.user_id, d, v_l.kind)
      on conflict (org_id, user_id, work_date) do update set status = excluded.status;
    end loop;
  end if;
  if p_decision <> 'cancelled' then
    perform app.staff_notify(v_l.user_id, v_l.org_id, 'attendance_leave_decided', 'Your request was ' || p_decision, '/attendance', 'attendance', p_id, 'info', null, false);
  end if;
end $$;

-- Daily job: yesterday's records with no check-out are flagged for review and the person is told. Nobody is marked absent.
create or replace function app.attendance_daily() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  for r in select a.id, a.org_id, a.user_id from attendance_records a left join attendance_policies p on p.org_id = a.org_id
            where a.check_in_at is not null and a.check_out_at is null and a.review_status <> 'pending'
              and a.work_date < (now() at time zone coalesce(p.timezone, 'Asia/Kolkata'))::date and a.work_date > (now() at time zone coalesce(p.timezone, 'Asia/Kolkata'))::date - 8 loop
    update attendance_records set review_status = 'pending' where id = r.id;
    perform app.staff_notify(r.user_id, r.org_id, 'attendance_missing_checkout', 'You did not check out. Ask for a correction if needed.', '/attendance', 'attendance', r.id, 'warning', 'attendance_missing_checkout:' || r.id, false);
    perform app.attendance_notify_reviewers(r.org_id, 'attendance_review_needed', 'An attendance record needs manual review', '/attendance/manage', r.id, 'attendance_review:' || r.id || ':no_checkout');
    n := n + 1;
  end loop;
  delete from attendance_qr_tokens where expires_at < now() - interval '1 day';
  return jsonb_build_object('missingCheckouts', n);
end $$;

-- ---------------------------------------------------------------------------
-- Secure files: attendance photos. The person's own record, read also by reviewers.
-- ---------------------------------------------------------------------------
alter table secure_files drop constraint secure_files_context_type_check;
alter table secure_files add constraint secure_files_context_type_check check (context_type in ('task', 'employee', 'attendance'));

create or replace function app.sf_attendance_org(p_context uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$ select org_id from attendance_records where id = p_context $$;
create or replace function app.sf_attendance_read(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from attendance_records r where r.id = p_context and (r.user_id = app.current_user_id() or app.has_perm(r.org_id, 'attendance.review')))
$$;
create or replace function app.sf_attendance_write(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from attendance_records r where r.id = p_context and r.user_id = app.current_user_id())
$$;
create or replace function app.sf_org(p_type text, p_context uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_type when 'task' then app.sf_task_org(p_context) when 'employee' then app.sf_employee_org(p_context) when 'attendance' then app.sf_attendance_org(p_context) end;
end $$;
create or replace function app.secure_file_can_read(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_read(p_context) when 'employee' then app.sf_employee_read(p_context) when 'attendance' then app.sf_attendance_read(p_context) end, false);
end $$;
create or replace function app.secure_file_can_write(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_write(p_context) when 'employee' then app.sf_employee_write(p_context) when 'attendance' then app.sf_attendance_write(p_context) end, false);
end $$;

revoke execute on function app.distance_m(double precision, double precision, double precision, double precision),
  app.attendance_notify_reviewers(uuid, text, text, text, uuid, text),
  app.attendance_mark(uuid, text, text, double precision, double precision, double precision, text, text, text, boolean),
  app.attendance_attach_photo(uuid, uuid), app.attendance_flag_event(uuid, text), app.attendance_issue_qr(uuid, text, int), app.attendance_office_settings(uuid),
  app.attendance_decide_review(uuid, text, text), app.attendance_set_status(uuid, uuid, date, text, text),
  app.attendance_request_correction(uuid, date, timestamptz, timestamptz, text), app.attendance_decide_correction(uuid, text, text),
  app.attendance_request_leave(uuid, text, text, date, date, text), app.attendance_decide_leave(uuid, text, text), app.attendance_daily(),
  app.sf_attendance_org(uuid), app.sf_attendance_read(uuid), app.sf_attendance_write(uuid) from public;
grant execute on function app.attendance_mark(uuid, text, text, double precision, double precision, double precision, text, text, text, boolean),
  app.attendance_attach_photo(uuid, uuid), app.attendance_flag_event(uuid, text), app.attendance_issue_qr(uuid, text, int), app.attendance_office_settings(uuid),
  app.attendance_decide_review(uuid, text, text), app.attendance_set_status(uuid, uuid, date, text, text),
  app.attendance_request_correction(uuid, date, timestamptz, timestamptz, text), app.attendance_decide_correction(uuid, text, text),
  app.attendance_request_leave(uuid, text, text, date, date, text), app.attendance_decide_leave(uuid, text, text), app.attendance_daily() to erp_app;
