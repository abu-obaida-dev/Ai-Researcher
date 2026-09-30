#!/usr/bin/env bash
# يحرّر منفذ الخادم (افتراضي 3000) من العمليات العالقة.
# الاستخدام:  npm run dev:free   أو   bash scripts/free-port.sh 4000
set -u
PORT="${1:-${PORT:-3000}}"

pids="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
if [ -z "$pids" ]; then
  pids="$(fuser -n tcp "$PORT" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true)"
fi

if [ -z "$pids" ]; then
  echo "✓ المنفذ $PORT حر — لا حاجة لإيقاف أي عملية."
  exit 0
fi

echo "إيقاف العمليات على المنفذ $PORT: $pids"
# shellcheck disable=SC2086
kill $pids 2>/dev/null || true
sleep 1

remaining="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
if [ -n "$remaining" ]; then
  echo "بعض العمليات لم تستجب للإيقاف العادي — إرسال SIGKILL."
  # shellcheck disable=SC2086
  kill -9 $remaining 2>/dev/null || true
  sleep 1
fi

if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
  echo "✖ تعذّر تحرير المنفذ $PORT — جرّب يدوياً أو استخدم منفذاً آخر: PORT=3001 npm run dev"
  exit 1
fi

echo "✓ تم تحرير المنفذ $PORT — شغّل الآن: npm run dev"
