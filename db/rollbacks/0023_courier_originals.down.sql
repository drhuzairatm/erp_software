-- Undo 0023 (original documents by courier). WARNING: deletes delivery addresses, courier instructions, shipments,
-- their history and courier tasks. Custody events recorded on receipt stay in the document history. Back up first (npm run db:backup).

drop function app.portal_shipments(text);
drop function app.reconcile_shipment(uuid, jsonb);
drop function app.update_shipment_status(uuid, text, text);
drop function app.portal_submit_courier(text, uuid, text, text, date);
drop function app.record_courier_dispatch(uuid, text, text, date, date);
drop function app.issue_courier_instructions(uuid, uuid, uuid[], text);
drop function app.save_courier_address(uuid, uuid, text, text, text, text, text, boolean);
drop function app.shipment_event(uuid, text, text, text);

drop table original_shipment_events;
drop table original_shipment_items;
drop table original_shipments;
drop table courier_addresses;
drop function app.guard_shipments();

delete from notification_messages where event_key in ('courier_instructions_issued', 'original_received');
delete from notification_rules where event_key in ('courier_instructions_issued', 'original_received');
alter table notification_rules drop constraint notification_rules_event_key_check;
alter table notification_rules add constraint notification_rules_event_key_check
  check (event_key in ('student_registered', 'stage_changed', 'document_changes_required', 'document_rejected', 'document_approved',
                       'visa_outcome', 'portal_login_code', 'attestation_stage_completed', 'attestation_completed', 'one_and_same_requested'));

delete from task_events where task_id in (select id from tasks where task_type = 'courier');
delete from task_comments where task_id in (select id from tasks where task_type = 'courier');
delete from tasks where task_type = 'courier';
alter table tasks drop constraint tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check check (task_type in ('general', 'followup', 'documentation', 'attestation', 'apostille',
  'translation', 'university_application', 'visa', 'finance', 'travel', 'passport'));

delete from role_permissions where permission_key = 'courier.exception';
delete from permissions where key = 'courier.exception';
