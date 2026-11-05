-- Phase 6: internal employee chat. Only the members of a conversation can read it. No role, including administrators and the Managing Director, reads a conversation
-- they are not a member of. Audit entries record actions, never message text. Edited and deleted text is kept in a table the application role cannot read, until a
-- retention and legal-access rule is decided.

insert into permissions (key, category, description, is_sensitive) values
  ('chat.groups.manage', 'Chat', 'Create group chats in the company', false)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key) select r.id, 'chat.groups.manage' from roles r where r.key in ('md', 'ceo', 'manager') on conflict do nothing;

create table chat_conversations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id),
  kind       text not null check (kind in ('direct', 'group')),
  name       text check (name is null or length(btrim(name)) between 2 and 100),
  group_type text check (group_type in ('core_team', 'all_employees', 'sales', 'marketing', 'management', 'custom')),
  direct_key text,
  created_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  check ((kind = 'direct' and direct_key is not null and name is null and group_type is null) or (kind = 'group' and direct_key is null and name is not null and group_type is not null))
);
create unique index chat_conversations_direct on chat_conversations (org_id, direct_key) where direct_key is not null;

create table chat_members (
  conversation_id   uuid not null references chat_conversations(id),
  user_id           uuid not null references user_profiles(id),
  org_id            uuid not null references organizations(id),
  role              text not null default 'member' check (role in ('member', 'admin')),
  joined_at         timestamptz not null default now(),
  left_at           timestamptz,
  last_read_at      timestamptz not null default now(),
  last_delivered_at timestamptz not null default now(),
  typing_until      timestamptz,
  primary key (conversation_id, user_id)
);
create index chat_members_user on chat_members (user_id) where left_at is null;

create table chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id),
  org_id          uuid not null references organizations(id),
  sender_id       uuid not null references user_profiles(id),
  body            text not null default '' check (length(body) <= 4000),
  reply_to_id     uuid references chat_messages(id),
  forwarded       boolean not null default false,
  task_id         uuid references tasks(id),
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  pinned_at       timestamptz,
  pinned_by       uuid references user_profiles(id)
);
create index chat_messages_conv on chat_messages (conversation_id, created_at desc, id desc);
create index chat_messages_search on chat_messages using gin (to_tsvector('simple', body));

create table chat_reactions (
  message_id uuid not null references chat_messages(id),
  user_id    uuid not null references user_profiles(id),
  emoji      text not null check (emoji in ('👍', '❤️', '😂', '🎉', '✅', '🙏')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- Earlier text of edited or deleted messages. No grant: readable only by a separately approved procedure.
create table chat_message_history (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references chat_messages(id),
  previous_body text not null,
  action        text not null check (action in ('edited', 'deleted')),
  actor_id      uuid references user_profiles(id),
  acted_at      timestamptz not null default now()
);

create table chat_presence (
  user_id      uuid primary key references user_profiles(id),
  last_seen_at timestamptz not null default now()
);

create or replace function app.chat_is_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from chat_members c where c.conversation_id = p_conversation and c.user_id = app.current_user_id() and c.left_at is null and app.is_member(c.org_id))
$$;
create or replace function app.chat_is_admin(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from chat_members c where c.conversation_id = p_conversation and c.user_id = app.current_user_id() and c.left_at is null and c.role = 'admin' and app.is_member(c.org_id))
$$;
create or replace function app.chat_shares_company(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from organization_memberships a join organization_memberships b on b.org_id = a.org_id and b.is_active
                  where a.user_id = app.current_user_id() and a.is_active and b.user_id = p_user)
$$;

alter table chat_conversations enable row level security;
alter table chat_members enable row level security;
alter table chat_messages enable row level security;
alter table chat_reactions enable row level security;
alter table chat_message_history enable row level security;
alter table chat_presence enable row level security;
create policy chat_conversations_select on chat_conversations for select to erp_app using (app.chat_is_member(id));
create policy chat_members_select on chat_members for select to erp_app using (app.chat_is_member(conversation_id));
create policy chat_messages_select on chat_messages for select to erp_app using (app.chat_is_member(conversation_id));
create policy chat_reactions_select on chat_reactions for select to erp_app using (exists (select 1 from chat_messages m where m.id = message_id));
create policy chat_presence_select on chat_presence for select to erp_app using (app.chat_shares_company(user_id));
grant select on chat_conversations, chat_members, chat_messages, chat_reactions, chat_presence to erp_app;

create trigger chat_conversations_audit after insert on chat_conversations for each row execute function app.audit_row('org_id', '');

create or replace function app.chat_notify(p_conv uuid, p_org uuid, p_user uuid, p_event text, p_title text, p_last_read timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- one notification per person per unread run, so a busy conversation does not flood the bell
  perform app.staff_notify(p_user, p_org, p_event, p_title, '/chat', 'chat', p_conv, 'info', p_event || ':' || p_conv || ':' || extract(epoch from p_last_read)::bigint, false);
end $$;

create or replace function app.chat_open_direct(p_org uuid, p_other uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id(); v_key text; v_id uuid;
begin
  if v_me is null or not app.is_member(p_org) then raise exception 'permission denied: chat' using errcode = '42501'; end if;
  if p_other = v_me then raise exception 'Choose someone else to message.' using errcode = '23514'; end if;
  if not app.user_is_active_member(p_other, p_org) then raise exception 'This person is not an active member of the company.' using errcode = '23514'; end if;
  v_key := least(v_me::text, p_other::text) || ':' || greatest(v_me::text, p_other::text);
  perform pg_advisory_xact_lock(hashtextextended('chat:' || p_org || ':' || v_key, 0));
  select id into v_id from chat_conversations where org_id = p_org and direct_key = v_key;
  if v_id is null then
    insert into chat_conversations (org_id, kind, direct_key, created_by) values (p_org, 'direct', v_key, v_me) returning id into v_id;
    insert into chat_members (conversation_id, user_id, org_id) values (v_id, v_me, p_org), (v_id, p_other, p_org);
  end if;
  return v_id;
end $$;

create or replace function app.chat_add_member(p_conv uuid, p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.user_is_active_member(p_user, p_org) then raise exception 'Every member must be an active member of the company.' using errcode = '23514'; end if;
  insert into chat_members (conversation_id, user_id, org_id, role) values (p_conv, p_user, p_org, p_role)
  on conflict (conversation_id, user_id) do update set left_at = null, joined_at = case when chat_members.left_at is null then chat_members.joined_at else now() end;
end $$;

-- All Employees and Core Team take their members from the company. Other groups use the people chosen.
create or replace function app.chat_create_group(p_org uuid, p_name text, p_type text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id(); v_id uuid; u uuid;
begin
  if not app.has_perm(p_org, 'chat.groups.manage') then raise exception 'permission denied: chat groups' using errcode = '42501'; end if;
  insert into chat_conversations (org_id, kind, name, group_type, created_by) values (p_org, 'group', btrim(p_name), p_type, v_me) returning id into v_id;
  insert into chat_members (conversation_id, user_id, org_id, role) values (v_id, v_me, p_org, 'admin');
  foreach u in array coalesce(p_members, '{}') loop
    if u <> v_me then perform app.chat_add_member(v_id, p_org, u, 'member'); end if;
  end loop;
  perform app.chat_sync_group(v_id);
  return v_id;
end $$;

create or replace function app.chat_sync_group(p_conv uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c chat_conversations%rowtype; n int;
begin
  select * into v_c from chat_conversations where id = p_conv;
  if v_c.id is null or not app.chat_is_admin(p_conv) then raise exception 'permission denied: chat groups' using errcode = '42501'; end if;
  if v_c.group_type = 'all_employees' then
    insert into chat_members (conversation_id, user_id, org_id)
      select p_conv, m.user_id, v_c.org_id from organization_memberships m join user_profiles u on u.id = m.user_id and u.account_status = 'active' where m.org_id = v_c.org_id and m.is_active
    on conflict (conversation_id, user_id) do update set left_at = null;
    get diagnostics n = row_count;
  elsif v_c.group_type = 'core_team' then
    insert into chat_members (conversation_id, user_id, org_id)
      select p_conv, c.user_id, v_c.org_id from core_team_members c where c.org_id = v_c.org_id and c.removed_at is null and app.user_is_active_member(c.user_id, v_c.org_id)
    on conflict (conversation_id, user_id) do update set left_at = null;
    get diagnostics n = row_count;
    update chat_members cm set left_at = now() where cm.conversation_id = p_conv and cm.left_at is null and cm.role <> 'admin'
      and not exists (select 1 from core_team_members c where c.org_id = v_c.org_id and c.user_id = cm.user_id and c.removed_at is null);
  else n := 0;
  end if;
  return n;
end $$;

create or replace function app.chat_set_member(p_conv uuid, p_user uuid, p_present boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c chat_conversations%rowtype;
begin
  select * into v_c from chat_conversations where id = p_conv;
  if v_c.id is null or v_c.kind <> 'group' then raise exception 'Only groups have members to manage.' using errcode = '23514'; end if;
  if p_user = app.current_user_id() and not p_present and app.chat_is_member(p_conv) then
    update chat_members set left_at = now() where conversation_id = p_conv and user_id = p_user;
    perform app.audit('chat_group_left', 'chat_conversations', p_conv::text, v_c.org_id, null, null, jsonb_build_object('user', p_user));
    return;
  end if;
  if not app.chat_is_admin(p_conv) then raise exception 'permission denied: chat groups' using errcode = '42501'; end if;
  if p_present then
    perform app.chat_add_member(p_conv, v_c.org_id, p_user, 'member');
    perform app.staff_notify(p_user, v_c.org_id, 'chat_added', 'You were added to a chat group', '/chat', 'chat', p_conv, 'info', null, false);
  else
    update chat_members set left_at = now() where conversation_id = p_conv and user_id = p_user;
  end if;
  perform app.audit(case when p_present then 'chat_member_added' else 'chat_member_removed' end, 'chat_conversations', p_conv::text, v_c.org_id, null, null, jsonb_build_object('user', p_user));
end $$;

create or replace function app.chat_send(p_conv uuid, p_body text, p_reply_to uuid, p_forward_from uuid, p_task uuid, p_mentions uuid[]) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id(); v_c chat_conversations%rowtype; v_id uuid; v_body text := coalesce(p_body, ''); v_src chat_messages%rowtype; r record;
begin
  select * into v_c from chat_conversations where id = p_conv;
  if v_c.id is null or not app.chat_is_member(p_conv) then raise exception 'permission denied: chat' using errcode = '42501'; end if;
  if p_reply_to is not null and not exists (select 1 from chat_messages m where m.id = p_reply_to and m.conversation_id = p_conv) then
    raise exception 'That message is in another conversation.' using errcode = '23514';
  end if;
  if p_forward_from is not null then
    select * into v_src from chat_messages m where m.id = p_forward_from and m.deleted_at is null;
    if v_src.id is null or not app.chat_is_member(v_src.conversation_id) then raise exception 'permission denied: chat forward' using errcode = '42501'; end if;
    if v_src.org_id <> v_c.org_id then raise exception 'Messages cannot be forwarded to another company.' using errcode = '23514'; end if;
    v_body := v_src.body;
  end if;
  if p_task is not null and not exists (select 1 from tasks t where t.id = p_task and t.org_id = v_c.org_id and app.sf_task_read(t.id)) then
    raise exception 'permission denied: task reference' using errcode = '42501';
  end if;
  insert into chat_messages (conversation_id, org_id, sender_id, body, reply_to_id, forwarded, task_id)
  values (p_conv, v_c.org_id, v_me, v_body, p_reply_to, p_forward_from is not null, p_task) returning id into v_id;
  update chat_members set last_read_at = now(), last_delivered_at = now(), typing_until = null where conversation_id = p_conv and user_id = v_me;
  for r in select c.user_id, c.last_read_at from chat_members c where c.conversation_id = p_conv and c.left_at is null and c.user_id <> v_me loop
    if r.user_id = any(coalesce(p_mentions, '{}')) then
      perform app.chat_notify(p_conv, v_c.org_id, r.user_id, 'chat_mention', 'You were mentioned in a chat', r.last_read_at);
    elsif v_c.kind = 'direct' then
      perform app.chat_notify(p_conv, v_c.org_id, r.user_id, 'chat_message', 'You have a new direct message', r.last_read_at);
    end if;
  end loop;
  return v_id;
end $$;

create or replace function app.chat_edit(p_message uuid, p_body text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m chat_messages%rowtype; v_me uuid := app.current_user_id();
begin
  select * into v_m from chat_messages m where m.id = p_message and m.deleted_at is null for update;
  if v_m.id is null or not app.chat_is_member(v_m.conversation_id) then raise exception 'message not found' using errcode = 'P0002'; end if;
  if v_m.sender_id <> v_me then raise exception 'You can only edit your own messages.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'Write a message.' using errcode = '23514'; end if;
  insert into chat_message_history (message_id, previous_body, action, actor_id) values (p_message, v_m.body, 'edited', v_me);
  update chat_messages set body = p_body, edited_at = now() where id = p_message;
  perform app.audit('chat_message_edited', 'chat_messages', p_message::text, v_m.org_id, null, null, null);
end $$;

create or replace function app.chat_delete(p_message uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m chat_messages%rowtype; v_me uuid := app.current_user_id();
begin
  select * into v_m from chat_messages m where m.id = p_message and m.deleted_at is null for update;
  if v_m.id is null or not app.chat_is_member(v_m.conversation_id) then raise exception 'message not found' using errcode = 'P0002'; end if;
  if v_m.sender_id <> v_me and not app.chat_is_admin(v_m.conversation_id) then raise exception 'You can only delete your own messages.' using errcode = '42501'; end if;
  insert into chat_message_history (message_id, previous_body, action, actor_id) values (p_message, v_m.body, 'deleted', v_me);
  update chat_messages set body = '', deleted_at = now(), pinned_at = null, pinned_by = null where id = p_message;
  update secure_files set removed_at = now(), removed_by = v_me where context_type = 'chat' and context_id = p_message and removed_at is null;
  perform app.audit('chat_message_deleted', 'chat_messages', p_message::text, v_m.org_id, null, null, jsonb_build_object('own_message', v_m.sender_id = v_me));
end $$;

create or replace function app.chat_react(p_message uuid, p_emoji text, p_on boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_conv uuid;
begin
  select conversation_id into v_conv from chat_messages m where m.id = p_message and m.deleted_at is null;
  if v_conv is null or not app.chat_is_member(v_conv) then raise exception 'message not found' using errcode = 'P0002'; end if;
  if p_on then insert into chat_reactions (message_id, user_id, emoji) values (p_message, app.current_user_id(), p_emoji) on conflict do nothing;
  else delete from chat_reactions where message_id = p_message and user_id = app.current_user_id() and emoji = p_emoji; end if;
end $$;

create or replace function app.chat_pin(p_message uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m chat_messages%rowtype; v_kind text;
begin
  select * into v_m from chat_messages m where m.id = p_message and m.deleted_at is null;
  if v_m.id is null or not app.chat_is_member(v_m.conversation_id) then raise exception 'message not found' using errcode = 'P0002'; end if;
  select kind into v_kind from chat_conversations where id = v_m.conversation_id;
  if v_kind = 'group' and not app.chat_is_admin(v_m.conversation_id) then raise exception 'Only group admins can pin messages.' using errcode = '42501'; end if;
  update chat_messages set pinned_at = case when p_on then now() end, pinned_by = case when p_on then app.current_user_id() end where id = p_message;
end $$;

-- What the page calls every few seconds: presence, delivery, read and typing marks of the signed-in person.
create or replace function app.chat_heartbeat(p_conv uuid, p_read boolean, p_typing boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id();
begin
  if v_me is null then raise exception 'permission denied' using errcode = '42501'; end if;
  insert into chat_presence (user_id, last_seen_at) values (v_me, now()) on conflict (user_id) do update set last_seen_at = now();
  update chat_members set last_delivered_at = now() where user_id = v_me and left_at is null;
  if p_conv is not null then
    if not app.chat_is_member(p_conv) then raise exception 'permission denied: chat' using errcode = '42501'; end if;
    update chat_members set last_read_at = case when p_read then now() else last_read_at end, typing_until = case when p_typing then now() + interval '6 seconds' else typing_until end
     where conversation_id = p_conv and user_id = v_me;
    if p_read then update staff_notifications set read_at = now() where user_id = v_me and read_at is null and subject_type = 'chat' and subject_id = p_conv; end if;
  end if;
end $$;

-- Secure files: a chat attachment belongs to one message. Only members read it; only its sender attaches it.
alter table secure_files drop constraint secure_files_context_type_check;
alter table secure_files add constraint secure_files_context_type_check check (context_type in ('task', 'employee', 'attendance', 'meeting', 'chat'));
create or replace function app.sf_chat_org(p_context uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$ select org_id from chat_messages where id = p_context $$;
create or replace function app.sf_chat_read(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from chat_messages m where m.id = p_context and m.deleted_at is null and app.chat_is_member(m.conversation_id))
$$;
create or replace function app.sf_chat_write(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from chat_messages m where m.id = p_context and m.deleted_at is null and m.sender_id = app.current_user_id() and app.chat_is_member(m.conversation_id))
$$;
create or replace function app.sf_org(p_type text, p_context uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_type when 'task' then app.sf_task_org(p_context) when 'employee' then app.sf_employee_org(p_context) when 'attendance' then app.sf_attendance_org(p_context)
    when 'meeting' then app.sf_meeting_org(p_context) when 'chat' then app.sf_chat_org(p_context) end;
end $$;
create or replace function app.secure_file_can_read(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_read(p_context) when 'employee' then app.sf_employee_read(p_context) when 'attendance' then app.sf_attendance_read(p_context)
    when 'meeting' then app.meeting_can_read(p_context) when 'chat' then app.sf_chat_read(p_context) end, false);
end $$;
create or replace function app.secure_file_can_write(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_write(p_context) when 'employee' then app.sf_employee_write(p_context) when 'attendance' then app.sf_attendance_write(p_context)
    when 'meeting' then app.meeting_can_edit(p_context) when 'chat' then app.sf_chat_write(p_context) end, false);
end $$;

revoke execute on function app.chat_is_member(uuid), app.chat_is_admin(uuid), app.chat_shares_company(uuid), app.chat_notify(uuid, uuid, uuid, text, text, timestamptz), app.chat_open_direct(uuid, uuid),
  app.chat_add_member(uuid, uuid, uuid, text), app.chat_create_group(uuid, text, text, uuid[]), app.chat_sync_group(uuid), app.chat_set_member(uuid, uuid, boolean),
  app.chat_send(uuid, text, uuid, uuid, uuid, uuid[]), app.chat_edit(uuid, text), app.chat_delete(uuid), app.chat_react(uuid, text, boolean), app.chat_pin(uuid, boolean),
  app.chat_heartbeat(uuid, boolean, boolean), app.sf_chat_org(uuid), app.sf_chat_read(uuid), app.sf_chat_write(uuid) from public;
grant execute on function app.chat_is_member(uuid), app.chat_is_admin(uuid), app.chat_shares_company(uuid), app.chat_open_direct(uuid, uuid), app.chat_create_group(uuid, text, text, uuid[]), app.chat_sync_group(uuid),
  app.chat_set_member(uuid, uuid, boolean), app.chat_send(uuid, text, uuid, uuid, uuid, uuid[]), app.chat_edit(uuid, text), app.chat_delete(uuid), app.chat_react(uuid, text, boolean), app.chat_pin(uuid, boolean),
  app.chat_heartbeat(uuid, boolean, boolean) to erp_app;
