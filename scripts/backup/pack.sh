#!/usr/bin/env bash
# 작업 폴더를 묶어 AES-256 으로 암호화한다. 암호(BACKUP_PASSPHRASE)가 없으면 아무도 열 수 없다.
# 사용: pack.sh <작업 폴더> <결과 파일(.tar.gz.gpg)>   환경변수: BACKUP_PASSPHRASE
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/common.sh"

work="${1:?작업 폴더}"
outfile="${2:?결과 파일}"
pass="${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE 가 없습니다}"

files=0; bytes=0
if [[ -d "$work/storage" ]]; then
  files=$(find "$work/storage" -type f | wc -l)
  bytes=$(du -sb "$work/storage" | cut -f1)
fi
expected=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)' "$work/db/storage-objects.json")

{
  echo "daolERP 백업"
  echo "생성(UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "커밋: ${GITHUB_SHA:-local}"
  echo "PostgreSQL: $(cat "$work/db/server_version_num")"
  echo "DB 표: $(wc -l < "$work/db/row-counts.tsv")개 · 행 합계 $(sum_counts "$work/db/row-counts.tsv")건 (표별 건수: db/row-counts.tsv)"
  echo "파일 저장소: ${files}/${expected}개 · ${bytes} bytes"
  echo
  echo "복원 방법: 저장소 docs/db-backup-track.md '복원' 절"
} > "$work/MANIFEST.txt"
(cd "$work" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)

mkdir -p "$(dirname "$outfile")"
tar -C "$work" -czf - . \
  | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
        --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 \
        --compress-algo none -o "$outfile" 3<<<"$pass"

# 암호로 다시 열리는지 바로 확인(목록만)
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d "$outfile" 3<<<"$pass" | tar -tzf - > /dev/null

echo "암호화 묶음: $(du -h "$outfile" | cut -f1) (DB + 파일 ${files}개)"
