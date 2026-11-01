# Student Photo Management: implementation report (Nov 2026)

## 1. What was built
- **Register Student → Student details → "Student Passport Photo" (optional):**
  - **Take photo** opens the phone camera; **Choose from gallery / files** works on every device and is the fallback where camera capture isn't offered.
  - A passport-format (35:45) frame with drag-to-reposition, zoom, a face oval, a live round avatar preview, and Cancel / choose another.
  - It shows the requested helper text. Registration works without a photo.
- **Student profile:** the round avatar in the header opens a larger preview with **Download Passport Photo**, **Remove photo** (with confirmation) and Close.
  - **Upload photo / Replace photo** shows the cropper with a preview, then **Confirm and replace**.
- **Round avatars (photo, or initials when there is none):** Students list, profile header, Students search results (the top-bar search opens the Students list), student column of the Tasks list and board, and the dashboard's "My students". Lead avatars stay initials, since leads have no photos.
- **Students list → Photo Status filter** (All Students / Photo Available / Photo Missing). It combines with search, company scope, assignment, other filters, sorting and pagination.

## 2. Files and components
- `db/migrations/0027_student_photos.sql` (+ `db/rollbacks/0027_student_photos.down.sql`)
- `src/server/services/photos.ts`: validation, processing, storage, authorisation, signed download
- `src/components/photo-picker.tsx`: camera / gallery, crop, zoom, preview
- `src/components/ui.tsx`: `Avatar` now accepts a photo; `studentPhotoUrl()`
- `src/app/(app)/students/[id]/photo-controls.tsx`: profile avatar, preview, upload / replace / remove / download
- `src/app/api/students/[id]/photo/route.ts` (thumbnail/portrait) and `.../photo/download/route.ts` (signed URL)
- Changed: student form, student actions, students list page and service (filter and `photo_version`), tasks service and page, dashboard service and page

## 3. Database
Table `student_photos` holds one row per version: student, version, storage references (original, portrait, thumbnail), format, size, dimensions, uploaded by/at, and ended by/at with the reason (replaced / removed).
- At most one current photo per student.
- Rows can't be edited or deleted except through the photo functions.
- Audit-logged without the storage keys.

## 4. Storage
Three private objects per version under the student's private storage folder:
- **original:** the uploaded image, upright, with all metadata removed
- **portrait:** the chosen passport crop at full quality, used for Download Passport Photo
- **thumbnail:** 256 × 256, used for avatars

When a photo is replaced or removed, its files are deleted from storage; the history row stays.
Nothing is public:
- avatars and the preview come through an authenticated route that checks access in the database
- downloads use a **60-second signed URL** with the filename `StudentName_StudentID_PassportPhoto.jpg`

## 5. Security
- The real file signature is checked (JPEG/PNG only); the file name and browser type are ignored. Maximum 5 MB.
- Images are decoded with limits (40 megapixels; malformed files rejected) and must be at least 200 × 200.
- **EXIF/GPS and all other metadata are removed** from every stored version, after applying the camera orientation.
- **Upload, replace and remove** need `students.update` on that student. **Viewing and downloading** need access to the student (company, role and assignment rules); the database enforces this.
- Other companies' staff get 404, and denied downloads are audited.

## 6. Tests run
- **Automated (`tests/integration/student-photos.test.ts`, 4 tests, passed):**
  - JPG and PNG processing with metadata removed (EXIF test data), portrait proportions kept, original size kept, and a 256 × 256 thumbnail
  - over-5 MB, renamed PDF, broken JPEG and wrong-format crop are all rejected
  - replace/remove history with old files deleted
  - cross-company denial and an audited download
  - activity history in order (uploaded, replaced, downloaded, removed)
  - rows protected from deletion
  - Photo Status filter
- **Browser (`tests/e2e/student-photos.spec.ts`, passed):**
  - register with a photo, see the avatar, open the larger preview
  - replace (the avatar updates to version 2)
  - list avatar and the Photo Missing filter
  - download returns a JPEG with the `_PassportPhoto.jpg` name
- **Manual:** the cropper checked at phone size (390 px).

## 7. Limitations
- Camera capture can't be automated in tests. It uses the standard `capture` input, which needs a real phone to check.
- There is no automatic face detection; the oval guide and manual positioning are used.
- The portrait is downloaded as JPEG, even when the original was a PNG. The PNG original is kept in storage.
