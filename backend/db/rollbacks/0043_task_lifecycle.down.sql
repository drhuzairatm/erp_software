-- Undo 0043. WARNING: deadlines with a time, extensions, review history, reminder settings and recorded overdue breaches are lost. Tasks in "submitted" return to "in_progress". Back up first.
drop trigger if exists tasks_lifecycle_before on tasks;
drop function if exists app.task_reminders_tick();
drop function if exists app.task_extend(uuid, timestamptz, text);
drop function if exists app.task_review(uuid, text, text);
drop function if exists app.task_submit(uuid, text);
drop function if exists app.tasks_lifecycle_before();
drop function if exists app.task_can_review(uuid);
drop table if exists task_reminder_settings;
drop table if exists task_reviews;
drop table if exists task_deadline_extensions;
drop function if exists app.task_deadline(timestamptz, date);
drop index if exists tasks_open_deadline_idx;
update tasks set status = 'in_progress' where status = 'submitted';
alter table tasks drop constraint tasks_status_check;
alter table tasks add constraint tasks_status_check check (status in ('not_started', 'in_progress', 'waiting_external', 'completed', 'cancelled'));
alter table tasks drop column due_at, drop column start_date, drop column completion_instructions, drop column evidence_required, drop column requires_review, drop column progress_percent,
  drop column assigned_at, drop column assigned_by, drop column original_due_at, drop column original_due_date, drop column overdue_at, drop column completed_late,
  drop column submitted_at, drop column submitted_by, drop column correction_count;
