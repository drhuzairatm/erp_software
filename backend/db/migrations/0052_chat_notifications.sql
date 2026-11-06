-- Global chat notifications: each person's own alert settings and muted conversations, read and written only by that person.
-- Membership and company rules are not changed. Nothing here adds access to any conversation or message.
-- Also a read-only session check for background polling, so a page left open cannot keep an unattended session alive.

create table chat_notification_settings (
  user_id         uuid primary key references user_profiles(id),
  in_app          boolean not null default true,
  sound           boolean not null default false,
  desktop_preview boolean not null default false,
  updated_at      timestamptz not null default now()
);

create table chat_conversation_mutes (
  conversation_id uuid not null references chat_conversations(id),
  user_id         uuid not null references user_profiles(id),
  created_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index chat_conversation_mutes_user on chat_conversation_mutes (user_id);

alter table chat_notification_settings enable row level security;
alter table chat_conversation_mutes enable row level security;
create policy chat_notification_settings_select on chat_notification_settings for select to erp_app using (user_id = app.current_user_id());
create policy chat_conversation_mutes_select on chat_conversation_mutes for select to erp_app using (user_id = app.current_user_id());
grant select on chat_notification_settings, chat_conversation_mutes to erp_app;

create function app.chat_save_notification_settings(p_in_app boolean, p_sound boolean, p_desktop_preview boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id();
begin
  if v_me is null then raise exception 'permission denied' using errcode = '42501'; end if;
  insert into chat_notification_settings (user_id, in_app, sound, desktop_preview) values (v_me, p_in_app, p_sound, p_desktop_preview)
    on conflict (user_id) do update set in_app = excluded.in_app, sound = excluded.sound, desktop_preview = excluded.desktop_preview, updated_at = now();
end $$;

create function app.chat_set_mute(p_conv uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id();
begin
  if v_me is null or not app.chat_is_member(p_conv) then raise exception 'permission denied: chat' using errcode = '42501'; end if;
  if p_muted then
    insert into chat_conversation_mutes (conversation_id, user_id) values (p_conv, v_me) on conflict do nothing;
  else
    delete from chat_conversation_mutes where conversation_id = p_conv and user_id = v_me;
  end if;
end $$;

-- The same checks as app.auth_resolve_session, without moving last_seen_at. Only background polling uses it, so a request
-- nobody made in person does not count as activity and the 8-hour idle limit still applies.
create function app.auth_peek_session(p_token_hash text)
returns table (session_id uuid, user_id uuid, must_change_password boolean, mfa_pending boolean, mfa_enabled boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_s auth_private.sessions%rowtype;
begin
  select s.* into v_s from auth_private.sessions s
    join user_profiles u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
     and s.last_seen_at > now() - interval '8 hours' and u.is_active;
  if not found then return; end if;
  return query select v_s.id, v_s.user_id, c.must_change_password, v_s.mfa_pending,
                      exists (select 1 from auth_private.mfa m where m.user_id = v_s.user_id and m.enabled_at is not null)
                 from auth_private.credentials c where c.user_id = v_s.user_id;
end $$;

revoke execute on function app.chat_save_notification_settings(boolean, boolean, boolean), app.chat_set_mute(uuid, boolean), app.auth_peek_session(text) from public;
grant execute on function app.chat_save_notification_settings(boolean, boolean, boolean), app.chat_set_mute(uuid, boolean), app.auth_peek_session(text) to erp_app;
