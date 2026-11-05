-- Chat governance. Nobody gains general access to private conversations: there is no permission for this that a role could hold.
-- Reading archived or private messages needs a specific request, authorised by the MD or an authority the MD named, for one named reader, for a limited time. Every read is logged.
-- Nothing is purged until the MD configures and approves a retention policy for the company. No retention period is set or implied here.

alter table chat_message_history drop constraint chat_message_history_action_check;
alter table chat_message_history add constraint chat_message_history_action_check check (action in ('edited', 'deleted', 'retention_archived'));
create index chat_message_history_message on chat_message_history (message_id, acted_at);

create table chatgov_retention_policies (
  org_id                 uuid primary key references organizations(id),
  retention_days         int check (retention_days is null or retention_days >= 1),
  archive_retention_days int check (archive_retention_days is null or archive_retention_days >= 1),
  purge_enabled          boolean not null default false,
  approval_reference     text check (approval_reference is null or length(btrim(approval_reference)) between 3 and 300),
  approved_by            uuid references user_profiles(id),
  approved_at            timestamptz,
  check (not purge_enabled or (retention_days is not null and approved_by is not null and approval_reference is not null))
);

create table chatgov_retention_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id),
  ran_at        timestamptz not null default now(),
  archived      int not null,
  purged        int not null,
  held_skipped  int not null
);

create table chatgov_delegates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id),
  user_id     uuid not null references user_profiles(id),
  capability  text not null check (capability in ('requester', 'approver', 'reader')),
  reason      text not null check (length(btrim(reason)) between 3 and 500),
  granted_by  uuid not null references user_profiles(id),
  granted_at  timestamptz not null default now(),
  revoked_by  uuid references user_profiles(id),
  revoked_at  timestamptz
);
create unique index chatgov_delegates_active on chatgov_delegates (org_id, user_id, capability) where revoked_at is null;

create table chatgov_holds (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id),
  reference       text not null check (length(btrim(reference)) between 3 and 120),
  reason          text not null check (length(btrim(reason)) between 10 and 2000),
  scope_user      uuid references user_profiles(id),
  scope_conversation uuid references chat_conversations(id),
  placed_by       uuid not null references user_profiles(id),
  placed_at       timestamptz not null default now(),
  released_by     uuid references user_profiles(id),
  released_at     timestamptz,
  release_reason  text
);

create table chatgov_requests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id),
  reference       text not null check (length(btrim(reference)) between 3 and 120),
  reason          text not null check (length(btrim(reason)) between 10 and 2000),
  scope_user      uuid references user_profiles(id),
  scope_conversation uuid references chat_conversations(id),
  from_date       date,
  to_date         date,
  reader_id       uuid not null references user_profiles(id),
  requested_by    uuid not null references user_profiles(id),
  requested_at    timestamptz not null default now(),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'closed')),
  decided_by      uuid references user_profiles(id),
  decided_at      timestamptz,
  decision_note   text,
  expires_at      timestamptz,
  closed_by       uuid references user_profiles(id),
  closed_at       timestamptz,
  check (scope_user is not null or scope_conversation is not null),
  check (requested_by is distinct from decided_by),
  check (reader_id is distinct from decided_by)
);

-- One row per read: who, when, under which request, and exactly which messages.
create table chatgov_access_log (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references chatgov_requests(id),
  org_id      uuid not null references organizations(id),
  accessor_id uuid not null references user_profiles(id),
  accessed_at timestamptz not null default now(),
  message_ids uuid[] not null
);
create index chatgov_access_log_request on chatgov_access_log (request_id, accessed_at);

-- The MD is recognised by the protected role itself, not by a permission another role could be given.
create or replace function app.chatgov_is_md(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from organization_memberships m join roles r on r.id = m.role_id where m.org_id = p_org and m.user_id = app.current_user_id() and m.is_active and r.key = 'md')
$$;
create or replace function app.chatgov_user_has(p_org uuid, p_user uuid, p_capability text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.user_is_active_member(p_user, p_org) and exists (select 1 from chatgov_delegates d where d.org_id = p_org and d.user_id = p_user and d.capability = p_capability and d.revoked_at is null)
$$;
-- The MD may request and approve. Reading always needs an explicit named grant, including for the MD.
create or replace function app.chatgov_has(p_org uuid, p_capability text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (p_capability in ('requester', 'approver') and app.chatgov_is_md(p_org)) or app.chatgov_user_has(p_org, app.current_user_id(), p_capability)
$$;
create or replace function app.chatgov_can_view(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.chatgov_is_md(p_org) or app.chatgov_has(p_org, 'requester') or app.chatgov_has(p_org, 'approver') or app.chatgov_has(p_org, 'reader')
$$;

alter table chatgov_retention_policies enable row level security;
alter table chatgov_retention_runs enable row level security;
alter table chatgov_delegates enable row level security;
alter table chatgov_holds enable row level security;
alter table chatgov_requests enable row level security;
alter table chatgov_access_log enable row level security;
create policy chatgov_retention_select on chatgov_retention_policies for select to erp_app using (app.chatgov_can_view(org_id));
create policy chatgov_runs_select on chatgov_retention_runs for select to erp_app using (app.chatgov_can_view(org_id));
create policy chatgov_delegates_select on chatgov_delegates for select to erp_app using (app.chatgov_can_view(org_id));
create policy chatgov_holds_select on chatgov_holds for select to erp_app using (app.chatgov_can_view(org_id));
create policy chatgov_requests_select on chatgov_requests for select to erp_app using (app.chatgov_can_view(org_id));
create policy chatgov_log_select on chatgov_access_log for select to erp_app using (app.chatgov_can_view(org_id));
grant select on chatgov_retention_policies, chatgov_retention_runs, chatgov_delegates, chatgov_holds, chatgov_requests, chatgov_access_log to erp_app;

-- Evidence rules, enforced even for functions running with full rights.
create or replace function app.chatgov_held(p_conversation uuid, p_sender uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from chatgov_holds h where h.org_id = p_org and h.released_at is null and (
    (h.scope_user is null and h.scope_conversation is null) or h.scope_conversation = p_conversation or h.scope_user = p_sender
    or exists (select 1 from chat_members c where c.conversation_id = p_conversation and c.user_id = h.scope_user)))
$$;
create or replace function app.chatgov_no_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'This governance record cannot be changed or deleted.' using errcode = '42501';
end $$;
create or replace function app.chatgov_no_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'This governance record cannot be deleted.' using errcode = '42501';
end $$;
create trigger chatgov_access_log_locked before update or delete on chatgov_access_log for each row execute function app.chatgov_no_change();
create trigger chatgov_runs_locked before update or delete on chatgov_retention_runs for each row execute function app.chatgov_no_change();
create trigger chatgov_requests_keep before delete on chatgov_requests for each row execute function app.chatgov_no_delete();
create trigger chatgov_holds_keep before delete on chatgov_holds for each row execute function app.chatgov_no_delete();
create trigger chatgov_delegates_keep before delete on chatgov_delegates for each row execute function app.chatgov_no_delete();

-- The archive: never edited; removed only by the approved retention job, and never under a hold.
create or replace function app.chatgov_archive_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m chat_messages%rowtype;
begin
  if tg_op = 'UPDATE' then raise exception 'Archived messages cannot be changed.' using errcode = '42501'; end if;
  if coalesce(current_setting('app.chatgov_retention_job', true), '') <> 'on' then raise exception 'Archived messages cannot be deleted.' using errcode = '42501'; end if;
  select * into v_m from chat_messages where id = old.message_id;
  if app.chatgov_held(v_m.conversation_id, v_m.sender_id, v_m.org_id) then raise exception 'These messages are under a legal hold.' using errcode = '42501'; end if;
  return old;
end $$;
create trigger chat_message_history_guard before update or delete on chat_message_history for each row execute function app.chatgov_archive_guard();

create or replace function app.chatgov_notify(p_org uuid, p_user uuid, p_event text, p_title text, p_subject uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.staff_notify(p_user, p_org, p_event, p_title, '/chat/governance', 'chatgov', p_subject, 'critical', null, false);
end $$;

create or replace function app.chatgov_set_retention(p_org uuid, p_days int, p_archive_days int, p_purge boolean, p_reference text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id(); v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if not app.chatgov_is_md(p_org) then raise exception 'permission denied: only the MD sets the retention policy' using errcode = '42501'; end if;
  if p_purge and p_days is null then raise exception 'Set a retention period before turning on automatic removal.' using errcode = '23514'; end if;
  if p_purge and v_ref is null then raise exception 'Give the reference of the approved policy.' using errcode = '23514'; end if;
  insert into chatgov_retention_policies (org_id, retention_days, archive_retention_days, purge_enabled, approval_reference, approved_by, approved_at)
  values (p_org, p_days, p_archive_days, p_purge, v_ref, v_me, now())
  on conflict (org_id) do update set retention_days = excluded.retention_days, archive_retention_days = excluded.archive_retention_days, purge_enabled = excluded.purge_enabled,
    approval_reference = excluded.approval_reference, approved_by = excluded.approved_by, approved_at = excluded.approved_at;
  perform app.audit('chat_retention_policy_set', 'chatgov_retention_policies', p_org::text, p_org, null, null, jsonb_build_object('retention_days', p_days, 'archive_retention_days', p_archive_days, 'purge_enabled', p_purge));
end $$;

create or replace function app.chatgov_set_delegate(p_org uuid, p_user uuid, p_capability text, p_on boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id();
begin
  if not app.chatgov_is_md(p_org) then raise exception 'permission denied: only the MD names these authorities' using errcode = '42501'; end if;
  if p_on then
    if not app.user_is_active_member(p_user, p_org) then raise exception 'This person is not an active member of the company.' using errcode = '23514'; end if;
    insert into chatgov_delegates (org_id, user_id, capability, reason, granted_by) values (p_org, p_user, p_capability, btrim(coalesce(p_reason, '')), v_me) on conflict (org_id, user_id, capability) where revoked_at is null do nothing;
    perform app.chatgov_notify(p_org, p_user, 'chatgov_authority', 'You were given a chat governance responsibility', p_org);
  else
    update chatgov_delegates set revoked_by = v_me, revoked_at = now() where org_id = p_org and user_id = p_user and capability = p_capability and revoked_at is null;
  end if;
  perform app.audit(case when p_on then 'chat_authority_granted' else 'chat_authority_revoked' end, 'chatgov_delegates', p_user::text, p_org, null, null, jsonb_build_object('capability', p_capability));
end $$;

create or replace function app.chatgov_groups(p_org uuid) returns table (id uuid, name text, group_type text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.chatgov_can_view(p_org) then raise exception 'permission denied: chat governance' using errcode = '42501'; end if;
  return query select c.id, c.name, c.group_type from chat_conversations c where c.org_id = p_org and c.kind = 'group' order by c.name;
end $$;

-- Two people: their direct conversation, without listing anyone's conversations.
create or replace function app.chatgov_direct_of(p_org uuid, p_a uuid, p_b uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id from chat_conversations c where c.org_id = p_org and c.direct_key = least(p_a::text, p_b::text) || ':' || greatest(p_a::text, p_b::text)
$$;

create or replace function app.chatgov_place_hold(p_org uuid, p_reference text, p_reason text, p_user uuid, p_conversation uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not app.chatgov_has(p_org, 'approver') then raise exception 'permission denied: legal hold' using errcode = '42501'; end if;
  if p_conversation is not null and not exists (select 1 from chat_conversations c where c.id = p_conversation and c.org_id = p_org) then raise exception 'That conversation is not in this company.' using errcode = '23514'; end if;
  if p_user is not null and not exists (select 1 from organization_memberships m where m.org_id = p_org and m.user_id = p_user) then raise exception 'That person is not in this company.' using errcode = '23514'; end if;
  insert into chatgov_holds (org_id, reference, reason, scope_user, scope_conversation, placed_by) values (p_org, btrim(p_reference), btrim(p_reason), p_user, p_conversation, app.current_user_id()) returning id into v_id;
  perform app.audit('chat_legal_hold_placed', 'chatgov_holds', v_id::text, p_org, null, null, null);
  return v_id;
end $$;

create or replace function app.chatgov_release_hold(p_hold uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_h chatgov_holds%rowtype;
begin
  select * into v_h from chatgov_holds h where h.id = p_hold and h.released_at is null for update;
  if v_h.id is null or not app.chatgov_has(v_h.org_id, 'approver') then raise exception 'permission denied: legal hold' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give the reason for releasing the hold.' using errcode = '23514'; end if;
  update chatgov_holds set released_by = app.current_user_id(), released_at = now(), release_reason = btrim(p_reason) where id = p_hold;
  perform app.audit('chat_legal_hold_released', 'chatgov_holds', p_hold::text, v_h.org_id, null, null, null);
end $$;

create or replace function app.chatgov_request(p_org uuid, p_reference text, p_reason text, p_user uuid, p_user2 uuid, p_group uuid, p_from date, p_to date, p_reader uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id(); v_id uuid; v_conv uuid := p_group; v_subject uuid := p_user; r record;
begin
  if not app.chatgov_has(p_org, 'requester') then raise exception 'permission denied: chat investigation' using errcode = '42501'; end if;
  if not app.chatgov_user_has(p_org, p_reader, 'reader') then raise exception 'The person who will read must be named as a reader by the MD.' using errcode = '23514'; end if;
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'The end date is before the start date.' using errcode = '23514'; end if;
  if p_group is not null then
    if not exists (select 1 from chat_conversations c where c.id = p_group and c.org_id = p_org and c.kind = 'group') then raise exception 'That group is not in this company.' using errcode = '23514'; end if;
    v_subject := null;
  elsif p_user is null then raise exception 'Choose the person or group.' using errcode = '23514';
  elsif not exists (select 1 from organization_memberships m where m.org_id = p_org and m.user_id = p_user) then raise exception 'That person is not in this company.' using errcode = '23514';
  elsif p_user2 is not null then
    v_conv := app.chatgov_direct_of(p_org, p_user, p_user2);
    if v_conv is null then raise exception 'These two people have no direct conversation.' using errcode = '23514'; end if;
    v_subject := null;
  end if;
  if p_reader = v_subject or (v_conv is not null and exists (select 1 from chat_members c where c.conversation_id = v_conv and c.user_id = p_reader)) then
    raise exception 'The reader cannot be a person under review.' using errcode = '23514';
  end if;
  insert into chatgov_requests (org_id, reference, reason, scope_user, scope_conversation, from_date, to_date, reader_id, requested_by)
  values (p_org, btrim(p_reference), btrim(p_reason), v_subject, v_conv, p_from, p_to, p_reader, v_me) returning id into v_id;
  perform app.audit('chat_investigation_requested', 'chatgov_requests', v_id::text, p_org, null, null, null);
  for r in select m.user_id from organization_memberships m join roles ro on ro.id = m.role_id where m.org_id = p_org and m.is_active and ro.key = 'md'
           union select d.user_id from chatgov_delegates d where d.org_id = p_org and d.capability = 'approver' and d.revoked_at is null loop
    perform app.chatgov_notify(p_org, r.user_id, 'chatgov_request', 'A chat investigation request needs a decision', v_id);
  end loop;
  return v_id;
end $$;

create or replace function app.chatgov_decide(p_request uuid, p_approve boolean, p_note text, p_days int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r chatgov_requests%rowtype; v_me uuid := app.current_user_id();
begin
  select * into v_r from chatgov_requests q where q.id = p_request for update;
  if v_r.id is null or not app.chatgov_has(v_r.org_id, 'approver') then raise exception 'permission denied: chat investigation' using errcode = '42501'; end if;
  if v_r.status <> 'pending' then raise exception 'This request has already been decided.' using errcode = '23514'; end if;
  if v_r.requested_by = v_me then raise exception 'A different authority must decide a request you made.' using errcode = '42501'; end if;
  if v_r.reader_id = v_me then raise exception 'The approver and the reader must be different people.' using errcode = '42501'; end if;
  if v_r.scope_user = v_me or (v_r.scope_conversation is not null and exists (select 1 from chat_members c where c.conversation_id = v_r.scope_conversation and c.user_id = v_me)) then
    raise exception 'You cannot decide a request about your own messages.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Give the reason for this decision.' using errcode = '23514'; end if;
  if p_approve and (p_days is null or p_days not between 1 and 30) then raise exception 'Access can be approved for 1 to 30 days.' using errcode = '23514'; end if;
  update chatgov_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = v_me, decided_at = now(), decision_note = btrim(p_note),
    expires_at = case when p_approve then now() + make_interval(days => p_days) end where id = p_request;
  perform app.audit(case when p_approve then 'chat_investigation_approved' else 'chat_investigation_rejected' end, 'chatgov_requests', p_request::text, v_r.org_id, null, null, jsonb_build_object('days', p_days));
  perform app.chatgov_notify(v_r.org_id, v_r.requested_by, 'chatgov_decision', 'A chat investigation request was decided', p_request);
  if p_approve then perform app.chatgov_notify(v_r.org_id, v_r.reader_id, 'chatgov_decision', 'You were authorised to review chat records', p_request); end if;
end $$;

create or replace function app.chatgov_close(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r chatgov_requests%rowtype;
begin
  select * into v_r from chatgov_requests q where q.id = p_request for update;
  if v_r.id is null or not (app.chatgov_has(v_r.org_id, 'approver') or v_r.requested_by = app.current_user_id() or v_r.reader_id = app.current_user_id()) then raise exception 'permission denied: chat investigation' using errcode = '42501'; end if;
  if v_r.status not in ('pending', 'approved') then raise exception 'This request is already finished.' using errcode = '23514'; end if;
  update chatgov_requests set status = 'closed', closed_by = app.current_user_id(), closed_at = now() where id = p_request;
  perform app.audit('chat_investigation_closed', 'chatgov_requests', p_request::text, v_r.org_id, null, null, null);
end $$;

-- The only way to read the archive. Only the named reader, only while approved, only within the scope. Each read is logged message by message.
create or replace function app.chatgov_read(p_request uuid, p_offset int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r chatgov_requests%rowtype; v_me uuid := app.current_user_id(); v_ids uuid[]; v_total int; v_rows jsonb;
begin
  select * into v_r from chatgov_requests q where q.id = p_request;
  if v_r.id is null or v_r.reader_id <> v_me or not app.chatgov_user_has(v_r.org_id, v_me, 'reader') or not app.user_is_active_member(v_me, v_r.org_id) then
    raise exception 'permission denied: chat investigation' using errcode = '42501';
  end if;
  if v_r.status <> 'approved' or v_r.expires_at <= now() then raise exception 'This authorisation is not active.' using errcode = '42501'; end if;
  select count(*) into v_total from chat_messages m where m.org_id = v_r.org_id
    and (m.conversation_id = v_r.scope_conversation or m.sender_id = v_r.scope_user)
    and (v_r.from_date is null or m.created_at >= v_r.from_date) and (v_r.to_date is null or m.created_at < v_r.to_date + 1);
  select array_agg(x.id) into v_ids from (select m.id from chat_messages m where m.org_id = v_r.org_id
    and (m.conversation_id = v_r.scope_conversation or m.sender_id = v_r.scope_user)
    and (v_r.from_date is null or m.created_at >= v_r.from_date) and (v_r.to_date is null or m.created_at < v_r.to_date + 1)
    order by m.created_at, m.id limit 100 offset greatest(coalesce(p_offset, 0), 0)) x;
  if v_ids is not null then insert into chatgov_access_log (request_id, org_id, accessor_id, message_ids) values (p_request, v_r.org_id, v_me, v_ids); end if;
  perform app.audit('chat_investigation_read', 'chatgov_requests', p_request::text, v_r.org_id, null, null, jsonb_build_object('messages', coalesce(array_length(v_ids, 1), 0)));
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'conversation_id', m.conversation_id, 'sender', u.full_name, 'created_at', m.created_at, 'edited_at', m.edited_at, 'deleted_at', m.deleted_at, 'body', m.body,
      'history', coalesce((select jsonb_agg(jsonb_build_object('action', h.action, 'body', h.previous_body, 'at', h.acted_at, 'by', hu.full_name) order by h.acted_at) from chat_message_history h left join user_profiles hu on hu.id = h.actor_id where h.message_id = m.id), '[]'),
      'files', coalesce((select jsonb_agg(jsonb_build_object('name', f.original_filename, 'sha256', f.sha256, 'removed_at', f.removed_at)) from secure_files f where f.context_type = 'chat' and f.context_id = m.id), '[]')) order by m.created_at, m.id), '[]')
    into v_rows from chat_messages m join user_profiles u on u.id = m.sender_id where m.id = any(coalesce(v_ids, '{}'));
  return jsonb_build_object('total', v_total, 'messages', v_rows);
end $$;

-- System job. Does nothing for a company without an approved policy with automatic removal turned on. Held messages are skipped.
create or replace function app.chatgov_retention_tick() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; v_arch int; v_purged int; v_held int; v_total int := 0; m record;
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  for p in select * from chatgov_retention_policies where purge_enabled and retention_days is not null and approved_by is not null loop
    v_arch := 0; v_purged := 0; v_held := 0;
    for m in select * from chat_messages x where x.org_id = p.org_id and x.deleted_at is null and x.created_at < now() - make_interval(days => p.retention_days) for update loop
      if app.chatgov_held(m.conversation_id, m.sender_id, m.org_id) then v_held := v_held + 1; continue; end if;
      insert into chat_message_history (message_id, previous_body, action) values (m.id, m.body, 'retention_archived');
      update chat_messages set body = '', deleted_at = now(), pinned_at = null, pinned_by = null where id = m.id;
      update secure_files set removed_at = now() where context_type = 'chat' and context_id = m.id and removed_at is null;
      v_arch := v_arch + 1;
    end loop;
    if p.archive_retention_days is not null then
      perform set_config('app.chatgov_retention_job', 'on', true);
      for m in select h.id, x.conversation_id, x.sender_id, x.org_id from chat_message_history h join chat_messages x on x.id = h.message_id
                where x.org_id = p.org_id and h.acted_at < now() - make_interval(days => p.archive_retention_days) loop
        if app.chatgov_held(m.conversation_id, m.sender_id, m.org_id) then v_held := v_held + 1; continue; end if;
        delete from chat_message_history where id = m.id;
        v_purged := v_purged + 1;
      end loop;
      perform set_config('app.chatgov_retention_job', '', true);
    end if;
    insert into chatgov_retention_runs (org_id, archived, purged, held_skipped) values (p.org_id, v_arch, v_purged, v_held);
    perform app.audit('chat_retention_run', 'chatgov_retention_policies', p.org_id::text, p.org_id, null, null, jsonb_build_object('archived', v_arch, 'purged', v_purged, 'held_skipped', v_held));
    v_total := v_total + v_arch + v_purged;
  end loop;
  return v_total;
end $$;

revoke execute on function app.chatgov_is_md(uuid), app.chatgov_user_has(uuid, uuid, text), app.chatgov_has(uuid, text), app.chatgov_can_view(uuid), app.chatgov_held(uuid, uuid, uuid), app.chatgov_no_change(), app.chatgov_no_delete(),
  app.chatgov_archive_guard(), app.chatgov_notify(uuid, uuid, text, text, uuid), app.chatgov_set_retention(uuid, int, int, boolean, text), app.chatgov_set_delegate(uuid, uuid, text, boolean, text), app.chatgov_groups(uuid), app.chatgov_direct_of(uuid, uuid, uuid),
  app.chatgov_place_hold(uuid, text, text, uuid, uuid), app.chatgov_release_hold(uuid, text), app.chatgov_request(uuid, text, text, uuid, uuid, uuid, date, date, uuid), app.chatgov_decide(uuid, boolean, text, int), app.chatgov_close(uuid),
  app.chatgov_read(uuid, int), app.chatgov_retention_tick() from public;
grant execute on function app.chatgov_is_md(uuid), app.chatgov_has(uuid, text), app.chatgov_can_view(uuid), app.chatgov_set_retention(uuid, int, int, boolean, text), app.chatgov_set_delegate(uuid, uuid, text, boolean, text), app.chatgov_groups(uuid),
  app.chatgov_place_hold(uuid, text, text, uuid, uuid), app.chatgov_release_hold(uuid, text), app.chatgov_request(uuid, text, text, uuid, uuid, uuid, date, date, uuid), app.chatgov_decide(uuid, boolean, text, int), app.chatgov_close(uuid),
  app.chatgov_read(uuid, int), app.chatgov_retention_tick() to erp_app;
