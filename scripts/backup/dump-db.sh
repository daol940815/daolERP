#!/usr/bin/env bash
# 운영 DB를 Supabase 공식 백업 형식(roles / schema / data 3개 파일)으로 덤프한다.
# 복원 절차는 Supabase 공식 문서와 같다(docs/db-backup-track.md "복원").
# 사용: dump-db.sh <작업 폴더>   환경변수: SUPABASE_DB_URL
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

out="${1:?작업 폴더를 지정하세요}"
db="${SUPABASE_DB_URL:?SUPABASE_DB_URL 이 없습니다}"
mkdir -p "$out/db"

echo "1/4 역할(roles) 덤프"
supabase db dump --db-url "$db" --role-only -f "$out/db/roles.sql"
echo "2/4 구조(schema) 덤프"
supabase db dump --db-url "$db" -f "$out/db/schema.sql"
echo "3/4 데이터(data) 덤프 — auth(로그인 계정) · storage(파일 목록) 포함"
supabase db dump --db-url "$db" --data-only --use-copy -f "$out/db/data.sql"

echo "4/4 대조용 정보"
psql "$db" -X -At -v ON_ERROR_STOP=1 -c 'show server_version_num' > "$out/db/server_version_num"
# 파일 저장소 목록: storage.objects 원본(덤프 직후 시점)
psql "$db" -X -At -v ON_ERROR_STOP=1 -c "
  select coalesce(json_agg(json_build_object(
           'bucket', bucket_id, 'name', name,
           'size', nullif(metadata->>'size','')::bigint,
           'mimetype', metadata->>'mimetype') order by bucket_id, name), '[]'::json)
  from storage.objects" > "$out/db/storage-objects.json"
count_copy_rows "$out/db/data.sql" > "$out/db/row-counts.tsv"

for f in roles schema data; do
  [[ -s "$out/db/$f.sql" ]] || { echo "::error::$f.sql 이 비어 있습니다"; exit 1; }
done
grep -q $'^public\.employees\t' "$out/db/row-counts.tsv" \
  || { echo "::error::데이터 덤프에 public.employees 가 없습니다 — 덤프가 불완전합니다"; exit 1; }

tables=$(wc -l < "$out/db/row-counts.tsv")
rows=$(sum_counts "$out/db/row-counts.tsv")
size=$(du -sh "$out/db" | cut -f1)
echo "DB 덤프 완료: 표 ${tables}개 · 행 ${rows}건 · ${size} (PostgreSQL $(cat "$out/db/server_version_num"))"
