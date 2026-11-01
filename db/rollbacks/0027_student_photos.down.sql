-- Undo 0027 (student photos). WARNING: removes the photo records (the image files in storage are NOT deleted by this script;
-- remove the "photos/" objects from storage separately if required). Back up first (npm run db:backup).
drop function app.student_photo_file(uuid, text);
drop function app.remove_student_photo(uuid);
drop function app.set_student_photo(uuid, text, text, text, text, int, int, int);
drop table student_photos;
drop function app.guard_student_photos();
