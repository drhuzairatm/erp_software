-- Phase 4: employee task management, by extending the existing tasks table. No second task system, no existing row changed.
-- Existing statuses stay: not_started shows as Pending; waiting_external and cancelled keep working. "submitted" is added. Overdue is computed from the
-- deadline, and its first breach is recorded so a late completion or an extension can't erase it.

alter table tasks drop constraint tasks_status_check;
alter table tasks add constraint tasks_status_check check (status in ('not_started', 'in_progress', 'waiting_external', 'submitted', 'completed', 'cancelled'));
alter table tasks
  add column due_at                  timestamptz,
  add column start_date              date,
  add column completion_instructions text check (completion_instructions is null or length(completion_instructions) <= 4000),
  add column evidence_required       boolean not null default false,
  add column requires_review         boolean not null default false,
  add column progress_percent        int not null default 0 check (progress_percent between 0 and 100),
  add column assigned_at             timestamptz,
  add column assigned_by             uuid references user_profiles(id),
  add column original_due_at         timestamptz,
  add column original_due_date       date,
  add column overdue_at              timestamptz,
  add column completed_late          boolean not null default false,
  add column submitted_at            timestamptz,
  add column submitted_by            uuid references user_profiles(id),
  add column correction_count        int not null default 0;
create index tasks_open_deadline_idx on tasks (due_at, due_date) where status not in ('completed', 'cancelled');
grant select (due_at, start_date, completion_instructions, evidence_required, requires_review, progress_percent, assigned_at, assigned_by, original_due_at, original_due_date,
              overdue_at, completed_late, submitted_at, submitted_by, correction_count) on tasks to erp_app;
grant insert (due_at, start_date, completion_instructions, evidence_required, requires_review) on tasks to erp_app;
grant update (due_at, start_date, completion_instructions, evidence_required, requires_review, progress_percent) on tasks to erp_app;

-- The moment a task becomes overdue: its deadline, or the end of its due date in India time for tasks that have only a date.
create or replace function app.task_deadline(p_due_at timestamptz, p_due_date date) returns timestamptz
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_due_at, ((p_due_date + 1)::timestamp at time zone 'Asia/Kolkata'))
$$;

create table task_deadline_extensions (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references tasks(id),
  previous_due timestamptz,
  new_due      timestamptz,
  reason       text not null check (length(btrim(reason)) between 3 and 1000),
  extended_by  uuid references user_profiles(id),
  extended_at  timestamptz not null default now()
);
create index task_deadline_extensions_task on task_deadline_extensions (task_id, extended_at);

create table task_reviews (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id),
  decision   text not null check (decision in ('submitted', 'approved', 'corrections')),
  note       text check (note is null or length(note) <= 2000),
  actor_id   uuid references user_profiles(id),
  created_at timestamptz not null default now()
);
create index task_reviews_task on task_reviews (task_id, created_at);

create table task_reminder_settings (
  org_id         uuid primary key references organizations(id),
  before_minutes int[] not null default '{1440,360,180,120,60}',
  at_deadline    boolean not null default true,
  after_overdue  boolean not null default true,
  escalate       boolean not null default true,
  updated_at     timestamptz not null default now()
);

alter table task_deadline_extensions enable row level security;
alter table task_reviews enable row level security;
alter table task_reminder_settings enable row level security;
create policy task_deadline_extensions_select on task_deadline_extensions for select to erp_app using (exists (select 1 from tasks t where t.id = task_id));
create policy task_reviews_select on task_reviews for select to erp_app using (exists (select 1 from tasks t where t.id = task_id));
create policy task_reminder_settings_select on task_reminder_settings for select to erp_app using (app.is_member(org_id));
create policy task_reminder_settings_insert on task_reminder_settings for insert to erp_app with check (app.has_perm(org_id, 'settings.manage'));
create policy task_reminder_settings_update on task_reminder_settings for update to erp_app using (app.has_perm(org_id, 'settings.manage')) with check (app.has_perm(org_id, 'settings.manage'));
grant select on task_deadline_extensions, task_reviews to erp_app;
grant select, insert, update on task_reminder_settings to erp_app;
create trigger task_reminder_settings_audit after insert or update on task_reminder_settings for each row execute function app.audit_row('org_id', '');

create or replace function app.task_can_review(p_task uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from tasks t where t.id = p_task
     and t.assigned_to is distinct from app.current_user_id()
     and (t.created_by = app.current_user_id() or app.has_perm(t.org_id, 'tasks.update.all') or app.has_perm(t.org_id, 'tasks.assign')))
$$;

create or replace function app.tasks_lifecycle_before() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id(); v_old timestamptz; v_new timestamptz; v_reason text;
begin
  if new.due_at is not null and (tg_op = 'INSERT' or new.due_at is distinct from old.due_at) then
    new.due_date := (new.due_at at time zone 'Asia/Kolkata')::date;
  elsif tg_op = 'UPDATE' and new.due_date is distinct from old.due_date and new.due_at is not distinct from old.due_at then
    new.due_at := null; -- the date was changed on its own: the earlier time no longer applies
  end if;
  if tg_op = 'INSERT' then
    new.original_due_at := new.due_at; new.original_due_date := new.due_date;
    if new.assigned_to is not null then new.assigned_at := now(); new.assigned_by := v_me; end if;
    return new;
  end if;
  if new.assigned_to is distinct from old.assigned_to then new.assigned_at := now(); new.assigned_by := v_me; end if;

  -- Every deadline change is kept, with who and why. The first deadline stays on the task.
  v_old := app.task_deadline(old.due_at, old.due_date); v_new := app.task_deadline(new.due_at, new.due_date);
  if v_old is distinct from v_new and v_old is not null then
    if old.original_due_date is null then new.original_due_at := old.due_at; new.original_due_date := old.due_date; end if;
    v_reason := coalesce(nullif(current_setting('app.task_extension_reason', true), ''), 'Changed on the task form');
    insert into task_deadline_extensions (task_id, previous_due, new_due, reason, extended_by) values (old.id, v_old, v_new, v_reason, v_me);
    -- A breach before the change stays on record.
    if old.overdue_at is null and v_old < now() and old.status not in ('completed', 'cancelled') then new.overdue_at := v_old; end if;
  end if;

  if new.status = 'submitted' and old.status <> 'submitted' and new.submitted_at is null then
    raise exception 'Use Submit for review.' using errcode = '23514';
  end if;
  if new.status = 'completed' and old.status <> 'completed' then
    if old.requires_review and v_me is not null and not app.task_can_review(old.id) then
      raise exception 'This task needs a manager''s approval. Submit it for review.' using errcode = '42501';
    end if;
    if v_new is not null and v_new < now() then
      new.completed_late := true;
      if new.overdue_at is null then new.overdue_at := v_new; end if;
    end if;
  end if;
  return new;
end $$;
-- Runs after tasks_before_write (triggers run in name order).
create trigger tasks_lifecycle_before before insert or update on tasks for each row execute function app.tasks_lifecycle_before();

create or replace function app.task_submit(p_task uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t tasks%rowtype; v_me uuid := app.current_user_id(); v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_t from tasks t where t.id = p_task for update;
  if v_t.id is null or not app.sf_task_read(p_task) then raise exception 'task not found' using errcode = 'P0002'; end if;
  if v_t.assigned_to is distinct from v_me then raise exception 'Only the person assigned to this task can submit it.' using errcode = '42501'; end if;
  if v_t.status in ('submitted', 'completed', 'cancelled') then raise exception 'This task cannot be submitted now.' using errcode = '23514'; end if;
  if v_t.evidence_required and not exists (select 1 from secure_files f where f.context_type = 'task' and f.context_id = p_task and f.removed_at is null and f.uploaded_by = v_me) then
    raise exception 'Attach your evidence before submitting.' using errcode = '23514';
  end if;
  update tasks set status = 'submitted', submitted_at = now(), submitted_by = v_me where id = p_task;
  insert into task_reviews (task_id, decision, note, actor_id) values (p_task, 'submitted', left(v_note, 2000), v_me);
  perform app.staff_notify(v_t.created_by, v_t.org_id, 'task_submitted', 'A task was submitted for your review', '/tasks/' || p_task, 'task', p_task, 'info', null, true);
end $$;

create or replace function app.task_review(p_task uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t tasks%rowtype; v_me uuid := app.current_user_id(); v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_t from tasks t where t.id = p_task for update;
  if v_t.id is null or not app.sf_task_read(p_task) then raise exception 'task not found' using errcode = 'P0002'; end if;
  if not app.task_can_review(p_task) then raise exception 'permission denied: task review' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'corrections') then raise exception 'invalid decision' using errcode = '22023'; end if;
  if v_t.status <> 'submitted' then raise exception 'This task is not waiting for review.' using errcode = '23514'; end if;
  if p_decision = 'corrections' and v_note is null then raise exception 'Say what needs correcting.' using errcode = '23514'; end if;
  insert into task_reviews (task_id, decision, note, actor_id) values (p_task, p_decision, left(v_note, 2000), v_me);
  if p_decision = 'approved' then
    update tasks set status = 'completed', progress_percent = 100 where id = p_task;
    perform app.staff_notify(v_t.assigned_to, v_t.org_id, 'task_approved', 'Your task was approved', '/tasks/' || p_task, 'task', p_task, 'info', null, false);
  else
    update tasks set status = 'in_progress', submitted_at = null, submitted_by = null, correction_count = correction_count + 1 where id = p_task;
    perform app.staff_notify(v_t.assigned_to, v_t.org_id, 'task_corrections', 'Corrections were requested on your task', '/tasks/' || p_task, 'task', p_task, 'warning', null, true);
  end if;
end $$;

create or replace function app.task_extend(p_task uuid, p_new_due timestamptz, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t tasks%rowtype; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_t from tasks t where t.id = p_task for update;
  if v_t.id is null or not app.sf_task_read(p_task) then raise exception 'task not found' using errcode = 'P0002'; end if;
  if not (app.has_perm(v_t.org_id, 'tasks.assign') or v_t.created_by = app.current_user_id()) then raise exception 'permission denied: task extension' using errcode = '42501'; end if;
  if v_t.status in ('completed', 'cancelled') then raise exception 'This task is closed.' using errcode = '23514'; end if;
  if length(v_reason) < 3 then raise exception 'Give the reason for the extension.' using errcode = '23514'; end if;
  if p_new_due is null or p_new_due <= now() then raise exception 'The new deadline must be in the future.' using errcode = '23514'; end if;
  perform set_config('app.task_extension_reason', v_reason, true);
  update tasks set due_at = p_new_due where id = p_task;
  perform set_config('app.task_extension_reason', '', true);
  perform app.staff_notify(v_t.assigned_to, v_t.org_id, 'task_extended', 'The deadline of your task changed', '/tasks/' || p_task, 'task', p_task, 'info', null, false);
end $$;

-- Scheduled every few minutes. Records breaches first; a reminder can't be lost because email or a person's settings fail.
create or replace function app.task_reminders_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_key text; v_offset int; v_epoch text; v_rem int := 0; v_breach int := 0; v_esc int := 0; v_mgr uuid;
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  for r in
    select t.id, t.org_id, t.assigned_to, t.created_by, t.overdue_at, t.due_date, app.task_deadline(t.due_at, t.due_date) as deadline,
           coalesce(s.before_minutes, '{1440,360,180,120,60}') as before_minutes, coalesce(s.at_deadline, true) as at_deadline, coalesce(s.after_overdue, true) as after_overdue, coalesce(s.escalate, true) as escalate
      from tasks t left join task_reminder_settings s on s.org_id = t.org_id
     where t.status not in ('completed', 'cancelled') and (t.due_at is not null or t.due_date is not null)
       and app.task_deadline(t.due_at, t.due_date) between now() - interval '3 days' and now() + interval '2 days'
  loop
    v_epoch := extract(epoch from r.deadline)::bigint::text;
    if r.deadline > now() then
      select min(m) into v_offset from unnest(r.before_minutes) m where r.deadline - make_interval(mins => m) <= now();
      if v_offset is not null then
        v_key := 'task_reminder:' || r.id || ':' || v_epoch || ':' || v_offset;
        if not exists (select 1 from staff_notifications n where n.user_id = r.assigned_to and n.dedupe_key = v_key) and r.assigned_to is not null then
          perform app.staff_notify(r.assigned_to, r.org_id, 'task_reminder', 'Task deadline: ' || case when v_offset >= 1440 then (v_offset / 1440) || ' day' else (v_offset / 60) || ' hour' end || ' left', '/tasks/' || r.id, 'task', r.id, 'info', v_key, false);
          v_rem := v_rem + 1;
        end if;
      end if;
    else
      if r.overdue_at is null then
        update tasks set overdue_at = r.deadline where id = r.id;
        insert into task_events (task_id, event_type, to_value) values (r.id, 'overdue', to_char(r.deadline at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'));
        v_breach := v_breach + 1;
      end if;
      if r.at_deadline then
        perform app.staff_notify(r.assigned_to, r.org_id, 'task_overdue', 'A task assigned to you is overdue', '/tasks/' || r.id, 'task', r.id, 'warning', 'task_overdue:' || r.id || ':' || r.due_date, true);
      end if;
      if r.after_overdue and now() - r.deadline > interval '1 day' then
        perform app.staff_notify(r.assigned_to, r.org_id, 'task_still_overdue', 'A task assigned to you is still overdue', '/tasks/' || r.id, 'task', r.id, 'warning', 'task_still_overdue:' || r.id || ':' || v_epoch, false);
      end if;
      if r.escalate then
        select u.reports_to into v_mgr from user_profiles u where u.id = r.assigned_to;
        v_mgr := coalesce(v_mgr, r.created_by);
        if v_mgr is distinct from r.assigned_to then
          v_key := 'task_escalated:' || r.id || ':' || v_epoch;
          if not exists (select 1 from staff_notifications n where n.user_id = v_mgr and n.dedupe_key = v_key) then
            perform app.staff_notify(v_mgr, r.org_id, 'task_escalated', 'An overdue task needs your attention', '/tasks/' || r.id, 'task', r.id, 'warning', v_key, true);
            v_esc := v_esc + 1;
          end if;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('reminders', v_rem, 'breachesRecorded', v_breach, 'escalated', v_esc);
end $$;

revoke execute on function app.task_deadline(timestamptz, date), app.task_can_review(uuid), app.tasks_lifecycle_before(), app.task_submit(uuid, text), app.task_review(uuid, text, text),
  app.task_extend(uuid, timestamptz, text), app.task_reminders_tick() from public;
grant execute on function app.task_deadline(timestamptz, date), app.task_can_review(uuid), app.task_submit(uuid, text), app.task_review(uuid, text, text),
  app.task_extend(uuid, timestamptz, text), app.task_reminders_tick() to erp_app;
