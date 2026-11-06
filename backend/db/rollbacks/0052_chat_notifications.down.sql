-- Undo 0052. People's chat alert settings and muted conversations are lost. No message, membership or read state changes.
drop function app.auth_peek_session(text);
drop function app.chat_set_mute(uuid, boolean);
drop function app.chat_save_notification_settings(boolean, boolean, boolean);
drop table chat_conversation_mutes;
drop table chat_notification_settings;
