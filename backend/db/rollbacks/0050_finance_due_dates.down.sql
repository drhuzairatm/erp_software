-- Undo 0050. WARNING: every due date and its note is lost. Payment entries are not touched. Reminders already sent stay in staff_notifications.
drop function app.payment_due_reminders();
drop function app.set_payment_due_date(uuid, date, text, text);
drop view payment_due_status;
drop table payment_due_dates;
