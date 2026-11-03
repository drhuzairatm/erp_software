-- =============================================================================
-- 0005 Tasks and staff accountability
-- =============================================================================

create table tasks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id),
  student_id    uuid references students(id),
  title         text not null check (length(btrim(title)) between 2 and 200),
  description   text check (description is null or length(description) <= 4000),
  task_type     text not null default 'general'
                  check (task_type in ('general', 'followup', 'documentation', 'attestation', 'apostille', 'translation',
                                       'university_application', 'visa', 'finance', 'travel')),
  assigned_to   uuid references user_profiles(id),
  created_by    uuid not null references user_profiles(id),
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status        text not null default 'not_started'
                  check (status in ('not_started', 'in_progress', 'waiting_external', 'completed', 'cancelled')),
  due_date      date,
  delay_reason  text check (delay_reason in ('internal_staff', 'student', 'university', 'embassy', 'provider', 'finance', 'other_external')),
  delay_note    text,
  completed_at  timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_by    uuid references user_profiles(id),
  updated_at    timestamptz not null default now(),
  check (status <> 'waiting_external' or delay_reason is not null),
  check ((status = 'completed') = (completed_at is not null))
);
create index tasks_org_status_idx on tasks (org_id, status, due_date);
create index tasks_assignee_idx on tasks (assigned_to, status);
create index tasks_student_idx on tasks (student_id);

create table task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id),
  author_id   uuid not null default app.current_user_id() references user_profiles(id),
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index task_comments_task_idx on task_comments (task_id, created_at);

create table task_events (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references tasks(id),
  event_type  text not null,
  from_value  text,
  to_value    text,
  actor_id    uuid references user_profiles(id),
  occurred_at timestamptz not null default now()
);
create index task_events_task_idx on task_events (task_id, occurred_at);

create or replace function app.tasks_before_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id();
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_me, new.created_by);
    new.completed_at := case when new.status = 'completed' then now() end;
  else
    new.updated_at := now();
    new.updated_by := coalesce(v_me, new.updated_by);
    if new.org_id is distinct from old.org_id or new.created_by is distinct from old.created_by then
      raise exception 'task company and creator cannot be changed' using errcode = '42501';
    end if;
    if new.student_id is distinct from old.student_id and coalesce(current_setting('app.merging', true), 'off') <> 'on' then
      raise exception 'task student cannot be changed' using errcode = '42501';
    end if;
    -- Reassignment / due-date changes need tasks.assign (managers), unless the
    -- user created the task.
    if (new.assigned_to is distinct from old.assigned_to or new.due_date is distinct from old.due_date)
       and v_me is not null and not app.has_perm(new.org_id, 'tasks.assign') and old.created_by <> v_me then
      raise exception 'permission denied: tasks.assign' using errcode = '42501';
    end if;
    if new.status = 'completed' and old.status <> 'completed' then new.completed_at := now(); end if;
    if new.status <> 'completed' then new.completed_at := null; end if;
    if new.status = 'cancelled' and old.status <> 'cancelled' then new.cancelled_at := now(); end if;
    if new.status <> 'cancelled' then new.cancelled_at := null; end if;
  end if;
  if new.student_id is not null and not app.student_has_org(new.student_id, new.org_id) then
    raise exception 'the task company does not have access to this student' using errcode = '23514';
  end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not app.user_is_active_member(new.assigned_to, new.org_id) then
    raise exception 'assignee is not an active member of the task company' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger tasks_before_write before insert or update on tasks
  for each row execute function app.tasks_before_write();

create or replace function app.tasks_after_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id();
begin
  if tg_op = 'INSERT' then
    insert into task_events (task_id, event_type, to_value, actor_id) values (new.id, 'created', new.status, v_me);
    if new.assigned_to is not null then
      insert into task_events (task_id, event_type, to_value, actor_id) values (new.id, 'assigned', new.assigned_to::text, v_me);
    end if;
    if new.student_id is not null then
      perform app.add_event_internal(new.student_id, new.org_id, 'task', 'created', 'Task created: ' || new.title, 'tasks', new.id::text);
    end if;
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into task_events (task_id, event_type, from_value, to_value, actor_id) values (new.id, 'status', old.status, new.status, v_me);
    if new.student_id is not null and new.status in ('completed', 'cancelled', 'waiting_external') then
      perform app.add_event_internal(new.student_id, new.org_id, 'task', new.status,
                            'Task ' || replace(new.status, '_', ' ') || ': ' || new.title, 'tasks', new.id::text);
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into task_events (task_id, event_type, from_value, to_value, actor_id)
    values (new.id, 'reassigned', old.assigned_to::text, new.assigned_to::text, v_me);
    if new.student_id is not null then
      perform app.add_event_internal(new.student_id, new.org_id, 'task', 'reassigned', 'Task reassigned: ' || new.title, 'tasks', new.id::text);
    end if;
  end if;
  if new.due_date is distinct from old.due_date then
    insert into task_events (task_id, event_type, from_value, to_value, actor_id)
    values (new.id, 'due_date', old.due_date::text, new.due_date::text, v_me);
  end if;
  if new.priority is distinct from old.priority then
    insert into task_events (task_id, event_type, from_value, to_value, actor_id) values (new.id, 'priority', old.priority, new.priority, v_me);
  end if;
  if new.delay_reason is distinct from old.delay_reason then
    insert into task_events (task_id, event_type, from_value, to_value, actor_id)
    values (new.id, 'delay_reason', old.delay_reason, new.delay_reason, v_me);
  end if;
  return null;
end $$;
create trigger tasks_after_write after insert or update on tasks
  for each row execute function app.tasks_after_write();

create trigger tasks_audit after insert or update or delete on tasks
  for each row execute function app.audit_row('org_id', 'student_id');

create or replace function app.task_comments_after_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into task_events (task_id, event_type, actor_id) values (new.task_id, 'comment', new.author_id);
  return null;
end $$;
create trigger task_comments_after_insert after insert on task_comments
  for each row execute function app.task_comments_after_insert();
