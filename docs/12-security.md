# 12 — Security: Layers, Not Slogans

| Layer | Mechanism | Location |
|---|---|---|
| Sessions | HMAC-SHA256 + `timingSafeEqual` + HttpOnly/Secure/Lax + TTL | `auth/google.js` |
| Passwords | None — OAuth only | — |
| CSRF | `requireSameOrigin`: rejects every session-authenticated POST without a matching Origin/Referer | `middleware/security.js` |
| Rate limiting | `rateLimit(name)` on every sensitive route (login/payment/upload), keyed by route + IP, with periodic cleanup | `middleware/security.js` |
| Concurrency | Limit of 4 uploads / 2 books — immediate `429` when full; released on `finish/close` | `concurrencyLimit` |
| Uploads | Allowlisted extensions + MIME + **binary signature check** before any write + `nosniff` and forced content type when served | `upload-guard.js` + `files.js` |
| Injection | `escapeHtml` in every View + prompt files treated as “data only” + `step_key` validated against the researcher's path | `views/*` + `supervisor-prompt.js` |
| Crashes | `isUuid` guard before every query + general error handler (HTML/JSON) + capture of `unhandledRejection` | `constants.js` + `server.js` |
| Reverse proxy | `TRUST_PROXY` set to the number of proxies — otherwise everyone appears as `127.0.0.1` (admin access opens and limits break) | `server.js` + `.env.example` |
| Production | Refuses to start without real `SESSION_SECRET/ADMIN_TOKEN` values + diagnoses ENV **names only** | `server.js` |
| Secrets | AI and FCM keys stay on the server — the browser sees names and counts only | `services/ai.js` |

## Golden rule
> **Fail closed**: any error while checking authorization means denial — except administrators, whose role bypasses the gates.
