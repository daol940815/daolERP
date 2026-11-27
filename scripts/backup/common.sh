#!/usr/bin/env bash
# DB 정기 백업 공용 함수 (docs/db-backup-track.md)
# 저장소가 공개(public)이므로 로그에는 비밀값·개인정보·표 단위 건수를 찍지 않는다. 합계만.

set -euo pipefail

# 연결 문자열에서 비밀번호를 뽑아 로그 가림 처리한다(문자열 전체는 GitHub가 자동으로 가린다).
mask_db_password() {
  local url="$1" userinfo pw
  userinfo="${url#*://}"
  userinfo="${userinfo%%@*}"
  if [[ "$userinfo" == *:* ]]; then
    pw="${userinfo#*:}"
    [[ -n "$pw" ]] && echo "::add-mask::$pw"
  fi
  return 0
}

# postgres.<ref> 사용자명(세션 풀러)에서 프로젝트 ref를 뽑는다.
project_ref_from_url() {
  local url="$1" userinfo user
  userinfo="${url#*://}"
  userinfo="${userinfo%%@*}"
  user="${userinfo%%:*}"
  if [[ "$user" == postgres.* ]]; then
    echo "${user#postgres.}"
  else
    # 직접 연결(db.<ref>.supabase.co) 형식
    local host="${url#*@}"
    host="${host%%[:/]*}"
    if [[ "$host" == db.*.supabase.co ]]; then
      host="${host#db.}"
      echo "${host%.supabase.co}"
    fi
  fi
}

# data.sql(COPY 형식)에서 표별 행 수를 센다: "schema.table<TAB>건수<TAB>원래 식별자"
# COPY 텍스트 형식은 값 안의 줄바꿈을 \n으로 이스케이프하므로 한 줄 = 한 행.
# 이름은 따옴표 유무(pg_dump 는 필요할 때만, Supabase CLI 는 항상)와 상관없이 같게 맞춘다.
count_copy_rows() {
  awk '
    /^COPY / {
      ident = substr($0, 6); sub(/ (\(| FROM stdin).*$/, "", ident)
      name = ident; gsub(/"/, "", name); n = 0; inblk = 1; next
    }
    inblk && /^\\\.$/ { print name "\t" n "\t" ident; inblk = 0; next }
    inblk { n++ }
  ' "$1" | LC_ALL=C sort
}

# count_copy_rows 결과와 같은 형식으로 대상 DB의 실제 행 수를 센다.
count_db_rows() {
  local db="$1" list="$2" sql="" first=1 name ident
  while IFS=$'\t' read -r name _ ident; do
    [[ -z "$name" ]] && continue
    [[ $first -eq 1 ]] || sql+=" union all "
    sql+="select \$q\$${name}\$q\$, count(*), \$q\$${ident}\$q\$ from ${ident}"
    first=0
  done < "$list"
  [[ -z "$sql" ]] && return 0
  psql "$db" -X -At -F $'\t' -v ON_ERROR_STOP=1 -c "$sql" | LC_ALL=C sort
}

# 두 건수 목록의 합계
sum_counts() { awk -F'\t' '{ s += $2 } END { print s + 0 }' "$1"; }
