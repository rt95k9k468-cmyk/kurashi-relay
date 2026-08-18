#!/usr/bin/env bash
# 中継所が本当に「置けて・取れて・消える」かを、外から確かめます。
#
#     ./verify.sh https://あなたの.workers.dev/kn-xxxxxxxx
#
# setup.sh が最後に呼びますが、あとから単体で走らせても構いません。
# 「アプリで取り込めない」ときに、中継所とアプリのどちらが悪いのかを
# 切り分けるのが、このスクリプトの仕事です。

set -uo pipefail
url="${1:-}"
[ -n "$url" ] || { echo "使い方: ./verify.sh <中継所のURL>" >&2; exit 2; }

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
ng()  { fail=$((fail+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }

# 確かめ用の便。本物と同じ形にしておきます（アプリの読み取りも一緒に試せる）。
probe="day=$(date +%Y-%m-%d)
steps=1234"

echo "中継所を確かめます: $url"

# --- 置く ---
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$url" --data-binary "$probe" || echo 000)
if [ "$code" = "200" ]; then ok "置けた（POST 200）"
else ng "置けなかった（POST が $code）"; echo; echo "  → URLが違うか、まだ公開できていません。" >&2; exit 1; fi

# --- 取る ---
body=$(curl -sS "$url" || true)
if [ "$body" = "$probe" ]; then ok "置いたものがそのまま取れた"
else ng "取れた中身がちがう"; printf '    置いた: %q\n    取れた: %q\n' "$probe" "$body" >&2; fi

# --- 消えている ---
code=$(curl -sS -o /dev/null -w '%{http_code}' "$url" || echo 000)
if [ "$code" = "204" ]; then ok "渡したら消えた（二度目は 204）"
elif [ "$code" = "200" ]; then
  # KVは結果整合なので、消したことが伝わるまで少しかかることがあります。
  sleep 3
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$url" || echo 000)
  if [ "$code" = "204" ]; then ok "渡したら消えた（少し待って 204）"
  else ng "渡したのに消えていない（$code）。同じ便が二度届きます"; fi
else ng "二度目が $code"; fi

# --- 道が合言葉になっている ---
code=$(curl -sS -o /dev/null -w '%{http_code}' "${url}x" || echo 000)
if [ "$code" = "404" ]; then ok "道が違えば渡さない（404）"
else ng "道を間違えても $code が返る。合言葉になっていません"; fi

# --- ブラウザから読める ---
allow=$(curl -sS -D - -o /dev/null "$url" 2>/dev/null | tr -d '\r' \
        | awk 'tolower($1) == "access-control-allow-origin:" { print $2 }')
if [ "$allow" = "*" ]; then ok "アプリから読める（CORS）"
else ng "CORSの許しが返っていない（'$allow'）。アプリからは読めません"; fi

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32m%s件すべて通りました。\033[0m\n' "$pass"
  exit 0
else
  printf '\033[31m%s件が通りませんでした（%s件は通過）。\033[0m\n' "$fail" "$pass"
  exit 1
fi
