#!/usr/bin/env bash
# 백업에 필요한 GitHub 비밀값(Secrets)이 제대로 들어 있는지 확인한다. 값 자체는 찍지 않는다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

missing=()
[[ "${NEED_DB_URL:-1}" == 0 || -n "${SUPABASE_DB_URL:-}" ]] || missing+=(SUPABASE_DB_URL)
[[ -n "${BACKUP_PASSPHRASE:-}" ]] || missing+=(BACKUP_PASSPHRASE)
[[ "${NEED_SERVICE_KEY:-1}" == 0 || -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] || missing+=(SUPABASE_SERVICE_ROLE_KEY)
if (( ${#missing[@]} )); then
  echo "::error::GitHub 비밀값이 없습니다: ${missing[*]} (설정 방법: docs/db-backup-track.md '처음 설정')"
  exit 1
fi

if [[ "${NEED_DB_URL:-1}" != 0 && -n "${SUPABASE_DB_URL:-}" ]]; then
  mask_db_password "$SUPABASE_DB_URL"
  case "$SUPABASE_DB_URL" in
    *'[YOUR-PASSWORD]'*)
      echo "::error::SUPABASE_DB_URL 의 [YOUR-PASSWORD] 자리를 실제 DB 비밀번호로 바꿔 넣어야 합니다"; exit 1 ;;
    *pooler.supabase.com:6543*)
      echo "::error::SUPABASE_DB_URL 이 Transaction pooler(6543) 주소입니다. Session pooler(5432) 주소를 넣어 주세요"; exit 1 ;;
    *@db.*.supabase.co*)
      echo "::warning::Direct connection 주소입니다. GitHub 서버는 IPv6 를 못 써서 접속이 안 될 수 있습니다 — Session pooler 주소를 권장" ;;
  esac
  [[ -n "$(project_ref_from_url "$SUPABASE_DB_URL")" ]] \
    || echo "::warning::연결 주소에서 프로젝트를 알아내지 못했습니다. SUPABASE_URL 비밀값을 추가하세요"
fi

if [[ -n "${BACKUP_PASSPHRASE:-}" && ${#BACKUP_PASSPHRASE} -lt 20 ]]; then
  echo "::error::BACKUP_PASSPHRASE 가 너무 짧습니다(20자 이상). 저장소가 공개라 암호 강도가 곧 보안입니다"
  exit 1
fi
echo "비밀값 확인 완료"
