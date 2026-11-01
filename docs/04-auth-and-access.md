# 04 — Authentication and Access: Google OAuth + Sessions + Roles

## 1. Google Sign-In (OAuth 2.0) — `src/auth/google.js`

```
Researcher → GET /auth/login → Google URL (+ random state in an httpOnly cookie)
  → approves on Google → GET /auth/google/callback?code=…&state=…
  → verify state (against CSRF) → exchange code for access_token (back-channel request)
  → fetch profile (email/name/picture/sub)
  → ensureUserFromGoogle() → session cookie → redirect to destination (homePathFor)
```

- **No passwords:** We do not store any user secret.
- **The `sub`:** Google’s stable identifier — it links the account even if the user changes their email or name.
- **Not configured?** If `GOOGLE_CLIENT_ID/SECRET` are missing, the sign-in page explains the issue instead of crashing.

## 2. Sessions: HMAC-Signed Cookie — No Session Table

- Payload: `{ uid, email, role, iat, exp }` — encoded as `base64url` + signed with `HMAC-SHA256` using the secret.
- Verification uses `timingSafeEqual` — prevents forgery and timing attacks.
- `Secure + HttpOnly + SameSite=Lax` in production, with a one-day TTL (24 hours) — the signature and the cookie’s `Max-Age` expire together, automatically logging the user out.
- **Why no Redis/session table?** Simplicity: verification is purely computational, and revocation is handled through `is_active/deleted` in `users`.

## 3. `attachAccount` — Every Request Knows Its Owner (`src/middleware/auth.js`)

- Mounted before all routes: reads the cookie → `getUserById` → `syncUserRole` → loads `services` + `adminPermissions` once.
- Suspended/deleted account → no session. DB failure → public pages continue to work (log a warning only).

## 4. Role Synchronization `syncUserRole` — Priority Order

```
admin (ADMIN_EMAILS or admins table)  ← highest priority; removed only by changing the source
  ← supervisor (supervisors table)
  ← plan role (plans.role_code)
  ← no plan: 'researcher' (so services are not suddenly locked for legacy data)
```

## 5. Permissions and Services — `src/services/access.js`

- Each service in `PLATFORM_SERVICES` has **one permission** (such as `chat:use`, `library:use`, `defense:use`).
- Roles have their permissions in `role_permissions` — the admin edits them under “Roles and Permissions,” and changes take effect on the next request (30-second cache only).
- **Chat is open to all plans** as soon as users register — restrictions apply to advanced features, not to the supervisor itself.
- `requireService(key)` in routes: a user without access sees an Arabic-language page explaining the service and required plan (403), rather than a bare error — covers `/references`, `/notes`, `/files`, `/defense`, and `/journey` (`/chat` is intentionally excluded).
- `requireCoreOnboarding` (partial profile gate): features that need research context — sending a chat message, the research journey, and starting a defense — redirect incomplete profiles to `/onboarding?next=…` so users return to their destination after saving. General reading and assistance are not blocked (the researcher dashboard redirects to the profile only on the first visit).
- `needsOnboarding`: admins/supervisors are not required to have a research profile.

## 6. Admin Permissions `ADMIN_PERMISSIONS`

`admin:panel/users/library/plans/roles/usage/payments/notify` — the admin has `*`; the supervisor receives only explicitly granted permissions, and the sidebar is filtered accordingly.

## 7. Two-Layer `/admin` Protection

1. **`ADMIN_TOKEN`** (constant-time comparison) — or localhost only if it is absent in development; production startup is rejected without the token.
2. **admin/supervisor+panel role** from the session — the token alone is insufficient.
