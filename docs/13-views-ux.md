# 13 — Interfaces: Arabic SSR Without React

## Decision
Server-generated HTML in `src/views/` (13 files) + custom CSS + lightweight JS in `public/js/` — **no React/Next/Vite, no build step, no heavy CDN**.

## Structure — `views/layout.js` (1,948 lines)
- `renderLayout({account, services, active, content})`: the `<html dir=rtl lang=ar>` element + branding + sidebar (filtered by account services and admin permissions) + floating WhatsApp button + PWA compatibility.
- `renderNotice` (success/error pages) + `renderServiceNotice` (403 gate notices: which service and which plan is required).

## Pages
| File | Pages |
|---|---|
| `landing.js` | Landing page: hero/features/services/how it works/audience/plans (with generated features)/FAQ/call to action |
| `auth.js` | Login + research profile (onboarding: **standalone page without a sidebar until complete**, then editable in the dashboard) + analytics (7-day charts) + account |
| `journey.js` | Research path: steps + statuses + status-change button + note |
| `chat.js` | Supervisor: conversations + messages + verified references below the response + file attachments + step-completion review card (read ⇄ edit without JavaScript) |
| `defense.js` | Defense: stages + counter (question n/11) + preparation checklist + evaluation |
| `workspace.js` | References (library + external search + reading statuses) + notebook + files (upload/preview/download) |
| `payments.js` | Plans + payment methods + request form + request status |
| `admin.js` + `admin-payments.js` | All dashboard sections (tables + filters + forms) |

## Branding — Zena AI
Emerald (trust) / copper (distinction) / parchment (background) / plum ink (administration) — Manrope + IBM Plex Sans Arabic fonts are **stored locally** in `public/fonts/` (work offline), and the icons are SVGs in `views/icons.js`.

## Browser behavior — `public/js/`
`app-shell.js` (menu/offline) · `file-picker.js` (chat file picker) · `chat-auto-scroll.js` (scroll to the latest response) · `push-notifications.js` + `firebase-messaging-sw.js` (FCM token registration).
