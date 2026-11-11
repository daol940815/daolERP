#!/usr/bin/env bash
# 복원 시험: 풀어 놓은 백업을 빈 Supabase(이 컴퓨터 안 임시 서버)에 공식 절차대로 복원하고
# 표별 행 수가 백업 시점과 정확히 같은지, 파일 수가 목록과 같은지 대조한다.
# 사용: restore-test.sh <풀어 놓은 백업 폴더>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

bk="$(cd "${1:?백업 폴더}" && pwd)"
proj="${RUNNER_TEMP:-/tmp}/restore-project"
rm -rf "$proj"; mkdir -p "$proj"; cd "$proj"

major=$(( $(cat "$bk/db/server_version_num") / 10000 ))
supabase init < /dev/null > /dev/null
sed -i "s/^major_version = .*/major_version = ${major}/" supabase/config.toml
echo "임시 Supabase 시작(PostgreSQL ${major})"
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,postgres-meta,supavisor > /dev/null

local_db="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

echo "복원: roles → schema → data (Supabase 공식 절차)"
psql "$local_db" -X -q --single-transaction -v ON_ERROR_STOP=1 \
  --file "$bk/db/roles.sql" \
  --file "$bk/db/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$bk/db/data.sql" > /dev/null

count_db_rows "$local_db" "$bk/db/row-counts.tsv" > "$proj/restored-counts.tsv"
if ! diff -q "$bk/db/row-counts.tsv" "$proj/restored-counts.tsv" > /dev/null; then
  n=$(diff "$bk/db/row-counts.tsv" "$proj/restored-counts.tsv" | grep -c '^>' || true)
  echo "::error::복원 후 행 수가 다른 표가 ${n}개 있습니다"
  exit 1
fi
tables=$(wc -l < "$bk/db/row-counts.tsv")
rows=$(sum_counts "$bk/db/row-counts.tsv")
echo "DB 복원 대조 일치: 표 ${tables}개 · 행 ${rows}건"

# 핵심 표가 실제로 들어왔는지(0건이면 의심)
emp=$(psql "$local_db" -X -At -c 'select count(*) from public.employees')
users=$(psql "$local_db" -X -At -c 'select count(*) from auth.users')
[[ "$emp" -gt 0 ]] || { echo "::error::복원된 직원(employees)이 0명입니다"; exit 1; }
echo "직원 ${emp}명 · 로그인 계정 ${users}개 복원 확인"

expected=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)' "$bk/db/storage-objects.json")
got=0
[[ -d "$bk/storage" ]] && got=$(find "$bk/storage" -type f | wc -l)
if [[ "$got" -ne "$expected" ]]; then
  echo "::error::파일 저장소: 목록 ${expected}개 중 ${got}개만 백업에 있습니다"
  exit 1
fi
echo "파일 저장소 대조 일치: ${got}개"

# 비상 복원 때 쓰는 파일 올리기 스크립트를 임시 서버에 실제로 돌려 본다.
if [[ "$got" -gt 0 ]]; then
  status_env=$(supabase status -o env 2>/dev/null)
  api_url=$(sed -n 's/^API_URL="\(.*\)"$/\1/p' <<<"$status_env")
  svc_key=$(sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p' <<<"$status_env")
  [[ -n "$svc_key" ]] || svc_key=$(sed -n 's/^SECRET_KEY="\(.*\)"$/\1/p' <<<"$status_env")
  SUPABASE_URL="${api_url:-http://127.0.0.1:54321}" SUPABASE_SERVICE_ROLE_KEY="$svc_key" \
    node "$here/restore-storage.mjs" "$bk"
fi

supabase stop --no-backup > /dev/null || true
echo "복원 시험 통과"
