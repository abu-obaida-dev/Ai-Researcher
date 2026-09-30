#!/usr/bin/env bash
#
# تهيئة PostgreSQL لمشروع مشرفي AI على Ubuntu / Zorin / Debian أو Fedora.
#
# الاستخدام:
#   sudo bash scripts/setup-postgres.sh
#   أو من داخل المشروع:  npm run db:setup
#
# ما يفعله السكربت:
#   1) تثبيت PostgreSQL إن لم يكن مثبّتاً (apt أو dnf).
#   2) تشغيل الخدمة وتفعيلها لتعمل بعد إعادة تشغيل الجهاز.
#   3) ضبط كلمة مرور مستخدم postgres ليطابق DATABASE_URL في .env.
#   4) التحقق من الاتصال على 127.0.0.1:5432.
# السكربت آمن للتشغيل المتكرر (idempotent).
set -euo pipefail

PG_USER="${PG_USER:-postgres}"
PG_PASSWORD="${PG_PASSWORD:-postgres}"

log() { printf '\n==> %s\n' "$*"; }
fail() {
  printf '\nخطأ: %s\n' "$*" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  fail "يحتاج هذا السكربت صلاحيات المدير. شغّله هكذا:  sudo bash scripts/setup-postgres.sh  أو  npm run db:setup"
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# 1) التثبيت
if command -v psql >/dev/null 2>&1; then
  log 'PostgreSQL مثبّت بالفعل — لا حاجة لتثبيته.'
else
  log 'تثبيت PostgreSQL...'
  if command -v apt >/dev/null 2>&1; then
    apt update -qq
    DEBIAN_FRONTEND=noninteractive apt install -y postgresql
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y postgresql-server postgresql
    postgresql-setup --initdb || true
  else
    fail 'لم أجد apt ولا dnf. ثبّت PostgreSQL يدوياً ثم شغّل: npm run db:init'
  fi
fi

# 2) التشغيل (وتفعيل الخدمة لتعمل تلقائياً بعد كل إعادة تشغيل)
log 'تشغيل خدمة PostgreSQL...'
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now postgresql 2>/dev/null || systemctl start postgresql
else
  service postgresql start
fi

# 3) انتظار جاهزية الخادم
log 'انتظار جهوزية الخادم...'
for _ in $(seq 1 30); do
  if su - "$PG_USER" -c 'psql -tAc "SELECT 1"' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# 4) كلمة المرور (لتطابق postgresql://postgres:postgres@localhost:5432 في .env)
log "ضبط كلمة مرور المستخدم ${PG_USER}..."
su - "$PG_USER" -c "psql -v ON_ERROR_STOP=1 -c \"ALTER USER ${PG_USER} WITH PASSWORD '${PG_PASSWORD}' CREATEDB;\""

# 5) التحقق من الاتصال كما يتصل به المشروع (TCP على 127.0.0.1)
log 'التحقق من الاتصال على 127.0.0.1:5432...'
if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -h 127.0.0.1 -p 5432 || true
fi

cat <<EOF

تم تجهيز PostgreSQL بنجاح.
  المستخدم: ${PG_USER}
  كلمة المرور: ${PG_PASSWORD}
  المنفذ: 5432

الخطوة التالية (بدون sudo، من مجلد المشروع):
  cd "${PROJECT_DIR}"
  npm run db:init
  npm run db:seed

تأكد أن DATABASE_URL في .env يطابق:
  postgresql://${PG_USER}:${PG_PASSWORD}@localhost:5432/ai_researcher
EOF
