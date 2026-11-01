-- =============================================================================
-- 0027 Student passport photographs (Nov 2026)
--
-- Three private files per photo version (never public URLs):
--   original  – the uploaded image, auto-rotated and with ALL metadata (EXIF/GPS) removed
--   portrait  – the passport-format crop chosen by staff (35:45), full quality – used for downloads
--   thumb     – 256 × 256 avatar derived from the portrait
-- One current photo per student. Replacing or removing keeps the record (history) and
-- the application deletes the superseded files from storage. Upload/replace/remove need
-- students.update on the student; viewing and downloading need access to the student.
-- =============================================================================

create table student_photos (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students(id),
  version        int not null,
  original_key   text not null,
  original_mime  text not null check (original_mime in ('image/jpeg', 'image/png')),
  portrait_key   text not null,
  thumb_key      text not null,
  width          int not null check (width > 0),
  height         int not null check (height > 0),
  bytes          int not null check (bytes > 0),
  is_current     boolean not null default true,
  uploaded_by    uuid not null references user_profiles(id),
  uploaded_at    timestamptz not null default now(),
  ended_at       timestamptz,
  ended_by       uuid references user_profiles(id),
  end_reason     text check (end_reason in ('replaced', 'removed')),
  files_purged   boolean not null default false,
  unique (student_id, version)
);
create unique index student_photos_current on student_photos (student_id) where is_current;
create trigger student_photos_audit after insert or update on student_photos
  for each row execute function app.audit_row('', 'student_id', 'original_key', 'portrait_key', 'thumb_key');

create or replace function app.guard_student_photos() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or coalesce(current_setting('app.photo_change', true), 'off') <> 'on' then
    raise exception 'student photos change only through the photo functions' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger student_photos_guard before update or delete on student_photos for each row execute function app.guard_student_photos();

-- Store a new current photo; returns the storage keys of the replaced version (to delete)
create or replace function app.set_student_photo(p_student uuid, p_original text, p_mime text, p_portrait text, p_thumb text,
                                                 p_width int, p_height int, p_bytes int) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old student_photos%rowtype; v_org uuid; v_version int;
begin
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'students.update') then raise exception 'permission denied: students.update' using errcode = '42501'; end if;
  perform 1 from students where id = p_student for update;
  select * into v_old from student_photos where student_id = p_student and is_current;
  select coalesce(max(version), 0) + 1 into v_version from student_photos where student_id = p_student;
  perform set_config('app.photo_change', 'on', true);
  if v_old.id is not null then
    update student_photos set is_current = false, ended_at = now(), ended_by = app.current_user_id(), end_reason = 'replaced', files_purged = true
     where id = v_old.id;
  end if;
  insert into student_photos (student_id, version, original_key, original_mime, portrait_key, thumb_key, width, height, bytes, uploaded_by)
  values (p_student, v_version, p_original, p_mime, p_portrait, p_thumb, p_width, p_height, p_bytes, app.current_user_id());
  perform set_config('app.photo_change', 'off', true);
  select originating_org_id into v_org from students where id = p_student;
  perform app.add_event_internal(p_student, v_org, 'student', case when v_old.id is null then 'photo_uploaded' else 'photo_replaced' end,
    case when v_old.id is null then 'Student photo uploaded' else 'Student photo replaced' end || ' (version ' || v_version || ')', 'student_photos', p_student::text);
  return case when v_old.id is null then '{}'::text[] else array[v_old.original_key, v_old.portrait_key, v_old.thumb_key] end;
end $$;

create or replace function app.remove_student_photo(p_student uuid) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old student_photos%rowtype; v_org uuid;
begin
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'students.update') then raise exception 'permission denied: students.update' using errcode = '42501'; end if;
  select * into v_old from student_photos where student_id = p_student and is_current for update;
  if not found then raise exception 'there is no photo to remove' using errcode = '23514'; end if;
  perform set_config('app.photo_change', 'on', true);
  update student_photos set is_current = false, ended_at = now(), ended_by = app.current_user_id(), end_reason = 'removed', files_purged = true where id = v_old.id;
  perform set_config('app.photo_change', 'off', true);
  select originating_org_id into v_org from students where id = p_student;
  perform app.add_event_internal(p_student, v_org, 'student', 'photo_removed', 'Student photo removed (version ' || v_old.version || ')', 'student_photos', p_student::text);
  return array[v_old.original_key, v_old.portrait_key, v_old.thumb_key];
end $$;

-- Authorised access to the current photo. 'download' (portrait as a file) is audited.
create or replace function app.student_photo_file(p_student uuid, p_variant text)
returns table (storage_key text, mime_type text, version int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p student_photos%rowtype; v_org uuid;
begin
  if p_variant not in ('thumb', 'portrait', 'download') then return; end if;
  if not app.can_read_student(p_student) then
    if p_variant = 'download' then
      perform app.audit('photo_download', 'student_photos', p_student::text, null, p_student, null, null, 'denied', null);
    end if;
    return;
  end if;
  select * into v_p from student_photos where student_id = p_student and is_current;
  if not found then return; end if;
  if p_variant = 'download' then
    select originating_org_id into v_org from students where id = p_student;
    perform app.audit('photo_download', 'student_photos', v_p.id::text, v_org, p_student, null, jsonb_build_object('version', v_p.version));
    perform app.add_event_internal(p_student, v_org, 'student', 'photo_downloaded', 'Passport photo downloaded (version ' || v_p.version || ')', 'student_photos', p_student::text);
  end if;
  return query select case p_variant when 'thumb' then v_p.thumb_key else v_p.portrait_key end,
                      case p_variant when 'thumb' then 'image/jpeg' else 'image/jpeg' end, v_p.version;
end $$;

alter table student_photos enable row level security;
create policy student_photos_select on student_photos for select to erp_app using (app.can_read_student(student_id));
grant select (id, student_id, version, original_mime, width, height, bytes, is_current, uploaded_by, uploaded_at, ended_at, ended_by, end_reason)
  on student_photos to erp_app;
grant execute on function app.set_student_photo(uuid, text, text, text, text, int, int, int), app.remove_student_photo(uuid),
  app.student_photo_file(uuid, text) to erp_app;
