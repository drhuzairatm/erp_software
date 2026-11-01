-- Undo 0029 (combined PDF history). Removes the history records only (no files were stored).
drop function app.record_document_merge(uuid, text, uuid[], uuid, text, int, boolean, text, text, text);
drop table document_merges;
