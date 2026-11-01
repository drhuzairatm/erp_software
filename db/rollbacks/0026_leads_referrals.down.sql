-- Undo 0026 (leads and referrals). WARNING: deletes all leads, their activity history, referral codes and referrals.
-- Students created from leads are kept. Back up first (npm run db:backup).

drop trigger student_stage_history_lead on student_stage_history;
drop function app.lead_on_admission();
drop function app.portal_referrals(text);
drop function app.public_countries();
drop function app.public_submit_referral(text, jsonb, text);
drop function app.public_referral_info(text);
drop function app.portal_submit_referral(text, jsonb, text);
drop function app.create_referral(text, text, jsonb, text);
drop function app.portal_referral_code(text);
drop function app.new_referral_code();
drop function app.link_lead_student(uuid, uuid);

alter table leads drop column referral_id;
drop table referrals;
drop table referral_codes;
drop table lead_activities;
drop table leads;
drop function app.lead_log_changes();
drop function app.lead_flag_duplicates();
drop function app.lead_route(text);
drop function app.guard_lead();

delete from role_permissions where permission_key in ('leads.read', 'leads.manage', 'leads.review');
delete from permissions where key in ('leads.read', 'leads.manage', 'leads.review');
