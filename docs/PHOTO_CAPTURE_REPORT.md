# Universal photo capture: completion report (1 Nov 2026)

## 1. Root cause of the "Take photo" failure
The old picker used only `<input type="file" capture="user">`. On laptops and desktops browsers ignore `capture`, so "Take photo" opened a file dialog, never the camera. Also, the site's `Permissions-Policy` header was `camera=()`, which **blocks the camera for the ERP itself**, so an in-page camera could never have worked either.

## 2. Files changed
- `src/components/photo-capture.tsx`: **new** reusable `PhotoCapture` component (replaces `photo-picker.tsx`, removed).
- `src/app/(app)/admin/admin-forms.tsx` (staff registration + staff photo edit), `src/app/(app)/students/student-form.tsx` (student registration / edit), `src/app/(app)/students/[id]/photo-controls.tsx` (student profile upload/replace): switched to `PhotoCapture`.
- `next.config.ts`: `Permissions-Policy: camera=(self)` (microphone, geolocation, payment still blocked); CSP `media-src 'self' blob: mediastream:` for the live preview.
- `tests/e2e/photo-capture.spec.ts`: new browser tests.
- No database, storage, permission or server-upload changes were needed.

## 3. PhotoCapture
- **Phones/tablets** (touch screen): "Take photo" opens the native front camera (`capture="user"`, JPG/PNG), then preview with **Retake / Use photo**.
- **Laptops/desktops**: an in-app camera window (`getUserMedia`, front camera, ideal 1280×720), live preview mirrored; **Capture / Retake / Use photo / Cancel**. The saved photo is not mirrored (JPEG, quality 0.9). All camera tracks stop on capture, cancel, Escape or close, so the camera light goes off. "Choose from files instead" is available in the window.
- **"Choose from gallery / files"** never has `capture`, so it never forces the camera.
- Then the existing crop step (zoom, drag, oval/circle guide, avatar preview); square for staff, passport format for students.
- Checks before upload: real JPG/PNG signature (renamed files refused), 5 MB limit; larger photos are compressed in the browser to under 5 MB. The server checks everything again (type, size, readable image, minimum size, crop shape) and re-encodes.
- Error messages (never silent): blocked permission (with the Mac System Settings hint), no camera, camera in use by another app, insecure (non-HTTPS) connection. File upload always remains available.
- Camera previews are temporary (in memory only); only the photo you save is stored.

## 4–5. Staff and student integration
Same storage and permissions as before (private storage, versioned photos, previous versions kept, served through authorised routes; the version in the URL avoids outdated cached images).
- **Staff:** registration, profile (view/replace/remove), staff list, task screens, leads, dashboard, audit log show the avatar; default initials avatar when none.
- **Students:** registration, edit, profile (view/upload/replace), student list, dashboard, task screens show the photo; default avatar when none.
- **Who can change photos:** unchanged existing rules (staff photos: user administrators within their authority; student photos: staff who may edit that student). No new permission system.

## 6–7. Test results
**Actually tested (automated, Chrome on this Mac, with Chrome's simulated camera):**
- Laptop camera, staff photo: live preview opens, preview mirrored, capture, camera stopped while reviewing, retake, use photo, crop, save → saved to that staff member, new avatar shown immediately on the profile and in the staff list.
- Laptop camera, student photo from the profile: cancel → camera stopped and nothing saved; capture → save → one new photo version for that student, shown immediately on the profile and in the student list.
- Errors: permission denied, no camera, camera in use, insecure connection → correct messages; gallery upload still works afterwards.
- Gallery: JPG accepted, PNG accepted, ~8 MB PNG compressed to under 5 MB, a PDF renamed to .jpg refused.
- Phone layout (simulated touch device): "Take photo" opens the native camera input (`capture="user"`), preview, Retake, Use photo, crop; gallery input has no `capture`.
- Headers: `camera=(self)` and `microphone=()` sent.
- Earlier photo tests (upload, replace, permissions, server validation) and the whole existing test suite: see the final check.

**Implemented but NOT tested on real devices** (needs a person with the device and the ERP on HTTPS):
- A real laptop webcam (MacBook / Windows, Chrome and Safari), real iPhone (Safari), real Android (Chrome), real iPad.
- Real "camera in use by Zoom/Teams" and Mac privacy-setting cases (simulated only).

## 8. Database and storage
No changes. Existing staff and student photo tables, private storage and version history are reused; replacing a photo adds a new version for that person only.

## 9. Security
- Camera allowed only for the ERP's own pages (`camera=(self)`), never for embedded third parties; microphone stays blocked; no audio is requested.
- CSP still allows images only from the ERP, `data:` and `blob:`; media only from the ERP, `blob:` and the live camera stream.
- **The camera requires HTTPS.** It works on `localhost` and on the production HTTPS address, but **not** when the development server is opened from a phone via `http://192.168.x.x`; the ERP shows the HTTPS message in that case. Use the HTTPS address (or upload from the gallery) for phone testing.

## 10. Remaining limitations
- Real-device testing (list above) is still to be done by you after deployment over HTTPS.
- Devices with only a rear camera fall back to whatever camera the browser offers.
