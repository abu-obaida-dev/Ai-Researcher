# 11 — Admin Dashboard

## Access: two layers (see 04)
`ADMIN_TOKEN` + a role (admin or a supervisor with `admin:panel` permission). The sidebar is filtered by account permissions — you cannot see what you do not have access to.

## Sections — `src/routes/admin.js` (1,539 lines) + `views/admin.js`

| Section | Permission | What it does |
|---|---|---|
| Overview `/admin` | panel | Researcher/request/usage counts + alerts (missing AI keys, DB, etc.) |
| Researchers `/admin/users` | users | Search + filters (plan/role/status) + pagination + suspend/activate + grant points + change plan/role + soft delete |
| Library `/admin/library` | library | Upload books + import from free sources + edit metadata + permanent deletion |
| Plans `/admin/plans` | plans | Add/edit (price/points/**quota**/role/extra features) + activate/deactivate |
| Roles `/admin/roles` | roles | Edit each role's permissions (sensitive — takes effect on the next request) + manage human supervisors |
| Usage `/admin/usage` | usage | `usage_logs` history + charts (by type/days) + platform cost (zero-cost `chat_summary` is shown) |
| Payments `/admin/payments` | payments | `pending` queue + atomic confirmation / rejection with a note + status counters |
| Notifications `/admin/notify` | notify | Internal notification to all researchers + push to phones via FCM |
| Settings `/admin/settings` | panel (administrator) | Currency + storage limits + support WhatsApp + payment methods + administrator emails (`admins` table) |

## Dashboard principles
- **Every administrator decision takes effect immediately without a restart**: settings are in `settings`, and permissions have only a 30-second cache (`clearAccessCache` runs after each change).
- **Researchers are never physically deleted**: `deleted` is a soft-delete flag — their research data remains for auditing.
- **Administrators bypass service gates**: their role bypasses `requireService` — support access cannot be blocked by a permission.
