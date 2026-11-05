-- Undo 0039. WARNING: employee notifications and the records of task attachments are lost. Attachment bytes stay in storage,
-- but nothing points to them. Back up first. The audit log keeps its entries. The application must first return to a version
-- that doesn't use these tables.
drop trigger if exists tasks_staff_notify on tasks;
drop trigger if exists task_comments_staff_notify on task_comments;
drop trigger if exists student_documents_staff_notify on student_documents;
drop trigger if exists document_files_staff_notify on document_files;

drop function if exists app.secure_files_to_rescan(int);
drop function if exists app.record_secure_file_scan(text, text, text, text);
drop function if exists app.remove_secure_file(uuid);
drop function if exists app.authorize_secure_file_download(uuid);
drop function if exists app.register_secure_file(text, uuid, text, text, text, bigint, text);
drop function if exists app.secure_file_upload_org(text, uuid);

drop table if exists secure_files;

drop function if exists app.secure_file_can_write(text, uuid);
drop function if exists app.secure_file_can_read(text, uuid);
drop function if exists app.staff_notification_email_finish(uuid, text);
drop function if exists app.staff_notification_email_claim(int);
drop function if exists app.staff_notifications_daily();
drop function if exists app.mark_staff_notifications_read(uuid[]);
drop function if exists app.staff_notify_document_file_quarantined();
drop function if exists app.staff_notify_document();
drop function if exists app.student_document_approvers(uuid);
drop function if exists app.staff_notify_task_comment();
drop function if exists app.staff_notify_task();
drop function if exists app.staff_notify(uuid, uuid, text, text, text, text, uuid, text, text, boolean);
drop function if exists app.staff_org_for_student(uuid, uuid);

drop table if exists staff_notifications;
