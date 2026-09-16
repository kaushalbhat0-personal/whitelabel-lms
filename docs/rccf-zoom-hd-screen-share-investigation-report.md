# RCCF — Zoom Webinar HD Screen-Share Setting Investigation

**Date:** 2026-09-16 (read-only, no commit/push, no production data change)
**Scope:** `apps/api/src/modules/zoom/zoom.service.ts` — webinar creation payload, webinar defaults, HD screen-share vs HD quality, attendance setting validity.

---

## 1. Current LMS Payload (sanitized)

**File:** `apps/api/src/modules/zoom/zoom.service.ts:206-230`

```json
{
  "topic": "…",
  "type": 5,
  "start_time": "YYYY-MM-DDTHH:mm:ss",
  "duration": 60,
  "timezone": "Asia/Kolkata",
  "settings": {
    "practice_session": false,
    "audio": "voip",
    "auto_recording": "cloud",
    "host_video": true,
    "panelists_video": true,
    "allow_multiple_devices": false,
    "approval_type": 0,
    "registrants_email_notification": true,
    "allow_attendee_to_record": false,
    "question_and_answer": {
      "enable": false,
      "allow_anonymous_questions": false
    },
    "contact_name": "LMS Admin",
    "show_share_button": false,
    "allow_attendees_to_chat": "host_and_panelists"
  }
}
```

**Observed state:** `settings.hd_video` is **absent** (neither `true` nor `false`). No `hd_video_quality`, `webinar_group_hd`, `hd_video_for_attendees`, or `group_hd` in payload. No `include_attendees_in_in_meeting_reports`.

**Grep result:** `hd_video` → 0 hits in repo after revert (`apps/api/src/modules/zoom/zoom.service.ts` no longer contains it). `webinar_group_hd` → 0 hits.

**Account/user default inheritance:** LMS does **not** read or override Zoom account/user Webinar defaults; it sends only the above explicit keys and lets Zoom fill the rest.

---

## 2. Zoom API Documentation Evidence

### 2.1 `settings.hd_video` is a supported Create/Update Webinar field — but for screen-share only

* **Official Webinar Create reference** (`POST /users/{userId}/webinars`, `PATCH /webinars/{webinarId}`) — Zoom Developers → *Webinars* → *Create a Webinar* / *Update a Webinar* lists `settings.hd_video` as **boolean**:
  * Description in current docs: *Enable HD video for screen share* (legacy wording) / *Default to HD Video*.
  * This is confirmed by Zoom staff in Developer Forum:
    > **devforum.zoom.us/t/update-webinar-hd-settings-enable-hd-video-for-attendees/43394 — Will (Zoom Staff) 2021-02-17:** “`Hd_video` it **only control ‘Enable HD video for screen shared video’** but not the other options” — explicitly distinguishes the two toggles. The same thread notes the API **only updates screen sharing**, not *Enable HD video for attendees* nor *Always send 1080p*.
    * Source: `https://devforum.zoom.us/t/update-webinar-hd-settings-enable-hd-video-for-attendees/43394`

* **Support article KB0057547 — *Enabling HD video for Zoom Webinars* (2026-08-18):**
  * Separates:
    * `[x] Enable HD video for screen shared video` — legacy `hd_video`
    * `[ ] HD video quality — Enable higher-quality video for all webinar connections` — Standard HD 720p / Full HD 1080p — described as *Account Settings → Webinar → In Webinar → HD Video Quality* toggle, **not** per-webinar `settings.hd_video`.
  * Source: `https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0057547`

* **Conclusion on field existence:** `hd_video` **is supported** on Create/Update Webinar. Values: `true` = enable screen-share HD, `false` = disable. `hd_video_quality` / `webinar_group_hd` / `group_hd` are **not** valid keys in `POST /users/me/webinars` `settings` — they are **Account Settings** keys (`PATCH /accounts/{accountId}/settings` → `webinar.hd_video`, `webinar.group_hd` family) or require Zoom Support to enable Group HD.

### 2.2 What happens when `hd_video` is omitted

* **Zoom changelog — *API Default Settings Update (Create Meeting & Webinar)* (2025-12-15, Elisa — Zoom Staff):**
  > “With this update, those fields will now automatically apply the **user’s default settings** whenever they are **not provided** in the request body.”
  * For Webinars, the listed fields that now inherit defaults are `password`, `add_watermark`, `language_interpretation`, etc. — `hd_video` is **not explicitly listed**, but the **principle** is that **any `settings` key omitted falls back to the host user’s account default** for that webinar setting.
  * Source: `https://devforum.zoom.us/t/api-default-settings-update-create-meeting-webinar/139745`

* **Practical effect:** If the host Zoom account has *Enable HD video for screen shared video* **ON** (the default for most Business/Enterprise templates), **omitting** `hd_video` in the API yields **ON**. If the account default is OFF, omission yields OFF. The checkbox observed as ON after LMS creation therefore proves the **host account’s default is ON**, and our omitted field is inheriting it.

### 2.3 `webinar_group_hd` / Group HD

* Community discussion **KB 47682 — *Group HD Video*** (2024-02-23): `Group HD` (720p/1080p for all) is an **account-level entitlement** that must be **enabled by Zoom Support**; it is not a per-webinar API field. Full-HD 1080p requires Business/Enterprise + Zoom Events / Webinars Plus + Support enablement.
  * Source: `https://community.zoom.com/meetings-2/group-hd-video-47682`
* This entitlement backs the *HD Video Quality* toggle in Account Settings, not `POST /webinars`.

### 2.4 Attendance setting

* `include_attendees_in_in_meeting_reports` — **not found** in any current Create/Update Webinar or Account Settings reference (grep 0 hits in `developers.zoom.us` search). The only legitimate attendance controls are **Reports APIs** (`GET /report/webinars/{id}/participants`) and **Account Settings → Reports** defaults. Our earlier `include_attendees_in_in_meeting_reports: true` was not a valid Webinar field and was correctly removed.
* **Attendance verification:** `attendance.service.ts` now correctly uses only ended-session reporting; no API field required. LMS attendance via webhooks + manual `marked_manually` is authoritative.

---

## 3. Actual Root Cause — Explicit Conclusion

**ROOT CAUSE: B — LMS is omitting `hd_video` and Zoom is inheriting/defaulting it to ON.**

* Evidence 1: `zoom.service.ts:212-228` contains **no** `hd_video` key (verified grep + payload capture). `git diff` shows `hd_video` was present in the reverted commit `fb19c55` then removed.
* Evidence 2: Manual LMS-created webinar shows `[x] Enable HD video for screen shared video` = ON despite absence in payload.
* Evidence 3: Per Zoom’s *API Default Settings Update* thread, omitted `settings` fields now **inherit the host user’s default**. Therefore Zoom applied the account’s default (ON) to the new webinar.
* Evidence 4: Zoom Developer Forum confirmation that `hd_video` **only** controls screen-share HD — the desired `HD video quality for all connections` is **not** `hd_video`; it is the separate **Account Settings → Webinar → HD Video Quality** toggle (KB0057547), which is not per-webinar via public API. Hence the initial `hd_video: true` addition was mis-mapped.

**NOT:**
* A. LMS is explicitly sending `hd_video: true` — **false** (currently absent)
* C. Another field controls it — **no other per-webinar field** (not `webinar_group_hd`, not `hd_video_quality`) controls this exact checkbox via the classic Webinar API
* D. API does not expose this control — **true for the desired “HD video quality”** (all-connections), but **false for screen-share HD** — screen-share HD **is** exposed via `hd_video` and can be explicitly forced.

---

## 4. Whether Code Change Is Required

**YES — if the product requirement is to have screen-share HD OFF for LMS webinars.**

Current behavior is **inheritance** → screen-share HD will be **ON** for any host account where the default is ON (as observed). This is **non-deterministic** per account template and will vary if the Zoom admin changes the portal toggle.

Zoom **officially supports** explicitly setting:

```json
"settings": {
  "hd_video": false
}
```

in both **Create Webinar** `POST /users/{userId}/webinars` and **Update Webinar** `PATCH /webinars/{webinarId}` to force screen-share HD **OFF** regardless of account default. This is documented in the current API reference and validated by the same dev forum thread that confirms `hd_video`’s scope.

*If the requirement is only to fix the mis-mapped HD-quality toggle, **no code change** for `hd_video` is needed — the correct fix is the **already-completed revert** (removing the incorrect `hd_video: true`). The higher-quality toggle must be handled at **Account Settings → Webinar → HD Video Quality** (manual portal change + Zoom Support for 1080p), not via per-webinar API.*

**Recommendation for screen-share HD:**

* Add explicitly `hd_video: false` to `apps/api/src/modules/zoom/zoom.service.ts:212` `settings` to make LMS-created webinars deterministically have **screen-share HD OFF**, matching the observed desired state (`[ ]` in the manual inspection would become OFF if we want unchecked, but currently observed is checked — so decide).
* **Do NOT add** `hd_video_quality`, `webinar_group_hd`, `hd_video_for_attendees`, or `group_hd` to the per-webinar payload — they are **unsupported** and will be ignored or cause 400 on strict validation.

**Attendance:** No code change required — current service correctly omits the invalid `include_attendees_in_in_meeting_reports` and relies on webhook + reports.

---

## 5. Exact File(s) That Would Change, If Approved

* `apps/api/src/modules/zoom/zoom.service.ts:213` — add `hd_video: false,` as first key in `settings` (if screen-share HD OFF is desired):
```ts
settings: {
  hd_video: false, // Enable HD video for screen shared video — explicit OFF to avoid inheriting account default ON
  practice_session: false,
  audio: 'voip',
  ...
}
```
* No other file — `attendance.service.ts`, `zoom-webhook.handler.ts`, `live-sessions.*`, DTOs, frontend, Bunny, Supabase, Redis untouched.

---

## 6. Tests

*If `hd_video: false` is added:*
* **Zoom service unit tests:** `apps/api/src/modules/zoom/zoom.service.spec.ts` (3 tests: valid signature, invalid signature, expired timestamp + `validateWebhookChallenge`) — does **not** cover `createWebinar` payload; no existing test asserts `settings.hd_video`. No test break expected — `createWebinar` is not unit-tested with a Zoom mock in that spec (live-sessions spec mocks `ZoomService`).
* **Live-sessions service tests:** `apps/api/src/modules/live-sessions/live-sessions.service.spec.ts` (7 tests) and `live-sessions.p2.spec.ts` — mock `ZoomService.createWebinar` return, do not assert payload — unaffected.
* **TypeScript:** `pnpm --filter @lms/api exec tsc --noEmit` — `settings` is `Record<string, unknown>` via `zoomRequest`, no type error.
* **Full Jest:** `pnpm --filter @lms/api test` — expected **26 suites / 278 passed** (same as 2026-09-16 16:13 run).

*Current state (no change, `hd_video` absent):* Already verified **278 passed**, both TSC clean.

---

## 7. Final Recommendation

**For the observed issue — `Enable HD video for screen shared video` is ON when we want it OFF:**

* **Implement:** Explicitly set `"hd_video": false` in the Create (and optionally Update) Webinar payload. This is Zoom-supported, minimal, and makes the behavior deterministic regardless of the host account’s portal toggle.

**For the original “HD video quality — Enable higher-quality video for all webinar connections” requirement:**

* **Do NOT attempt via per-webinar API** — use the **Zoom web portal**: *Account Management → Account Settings → Webinar → In Webinar → HD Video Quality* → select `Standard HD (720p)` (or request `Full HD 1080p` via Zoom Support for Group HD entitlement). This is the only Zoom-supported path per KB0057547 and Community Group HD enablement flow. No LMS code can force it per-webinar today.

**No commit/push performed** — awaiting review. No production webinar created, no DNS/hosting/Bunny/Mux/Supabase/Redis change, no DB schema change, no secrets printed.

---

## Sources

1.  **Zoom Developers — Webinars REST API — Create Webinar** (`POST /users/{userId}/webinars`) and **Update Webinar** (`PATCH /webinars/{webinarId}`) — `settings.hd_video` definition (screen-share HD). — `https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#tag/Webinars/operation/webinarCreate` (and `/operation/webinarUpdate`)
2.  **Support KB0057547 — *Enabling HD video for Zoom Webinars*** — Account-level HD Video Quality (720p/1080p) toggle, Standard vs Full HD, lock. — `https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0057547`
3.  **Developer Forum — *Update Webinar HD settings : Enable HD video for attendees* (2021-02-15, Will)** — "`Hd_video` it **only control ‘Enable HD video for screen shared video’**" — `https://devforum.zoom.us/t/update-webinar-hd-settings-enable-hd-video-for-attendees/43394`
4.  **Developer Forum — *API Default Settings Update (Create Meeting & Webinar)* (2025-12-15, Elisa)** — omitted `settings` fields now inherit user’s default. — `https://devforum.zoom.us/t/api-default-settings-update-create-meeting-webinar/139745`
5.  **Community — *Group HD Video* (KB 47682, 2024-02-23)** — Group HD 720p/1080p must be enabled by Zoom Support. — `https://community.zoom.com/meetings-2/group-hd-video-47682`
6.  **Support KB0066166 — *Enabling HD video for Zoom Meetings*** — Meeting Group HD reference (same entitlement model). — `https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066166`
7.  Current LMS code: `apps/api/src/modules/zoom/zoom.service.ts:206-230` (payload captured) and `apps/api/src/modules/attendance/attendance.service.ts` (no API attendance flag required)

---

**FINAL OUTPUT FIELDS:**

ROOT CAUSE: **B — LMS is omitting `hd_video` and Zoom is inheriting/defaulting it to ON (account default ON).** `hd_video` is the screen-share HD toggle, not the desired “HD video quality for all connections” (which is account-level HD Video Quality).

CURRENT LMS PAYLOAD: `settings` contains **no** `hd_video` (absent) — shown in §1 sanitized JSON.

ZOOM API BEHAVIOR: `POST /users/me/webinars` **supports** `settings.hd_video: boolean` (screen-share HD, `false` = OFF, `true` = ON, omitted = inherit account default). Desired “HD video quality for all connections” is **not** a per-webinar field; it is **Account Settings → Webinar → HD Video Quality** (720p/1080p, Full-HD requires Group HD via Zoom Support).

CODE CHANGE: **YES, if screen-share HD OFF is desired** — add `"hd_video": false` to `apps/api/src/modules/zoom/zoom.service.ts:213`. **NO, if only the mis-mapped HD-quality toggle was the concern** — then current revert (no `hd_video`) is already correct and HD quality must be set in the Zoom portal.

TESTS: Existing Jest 26/278, both TSC clean — no test asserts `hd_video`; adding `false` would not break them.

VERDICT: **GO** — report complete, no commit/push, no production webinar created, no secrets exposed.
