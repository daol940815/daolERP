#!/usr/bin/env bash
# 암호화 묶음을 풀고 체크섬을 확인한다.
# 사용: unpack.sh <묶음(.tar.gz.gpg)> <풀 폴더>   환경변수: BACKUP_PASSPHRASE
# (윈도우 PC에서 손으로 풀 때는 docs/db-backup-track.md '백업 파일 열기' 참고)
set -euo pipefail
in="${1:?묶음 파일}"
out="${2:?풀 폴더}"
pass="${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE 가 없습니다}"
mkdir -p "$out"
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 -d "$in" 3<<<"$pass" | tar -C "$out" -xzf -
(cd "$out" && sha256sum --quiet -c SHA256SUMS)
echo "묶음 풀기 완료 · 체크섬 일치"
