#!/usr/bin/env bash
# daolERP 서버 초기 설정 스크립트 — Ubuntu 22.04/24.04 기준
# 사용법: 새 서버에 root(또는 sudo 가능 계정)로 접속 후
#   curl -fsSL https://raw.githubusercontent.com/daol940815/daolERP/main/deploy/setup-server.sh | bash
# 또는 저장소 클론 후: bash deploy/setup-server.sh
set -euo pipefail

echo "== [1/5] 시스템 업데이트 =="
sudo apt-get update -y && sudo apt-get upgrade -y

echo "== [2/5] Docker 설치 =="
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
docker --version

echo "== [3/5] 방화벽 (SSH/HTTP/HTTPS 만 허용) =="
sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo "== [4/5] 스왑 2GB (저사양 서버 안정성) =="
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "== [5/5] 저장소 클론 =="
if [ ! -d "$HOME/daolERP" ]; then
  # 비공개 저장소면 GitHub 토큰 필요: git clone https://<토큰>@github.com/daol940815/daolERP.git
  git clone https://github.com/daol940815/daolERP.git "$HOME/daolERP" || {
    echo "!! 클론 실패 — 비공개 저장소면 토큰 포함 URL 로 직접 클론하세요."
  }
fi

cat <<'EOF'

======================================================
서버 준비 완료. 다음 단계:

  cd ~/daolERP
  cp .env.production.example .env
  nano .env        # POSTGRES_PASSWORD, JWT_SECRET(openssl rand -hex 48), DOMAIN 설정

  # 사내 전용(HTTP):
  docker compose -f docker-compose.prod.yml up -d --build

  # 외부 접속(도메인 + 자동 HTTPS):
  docker compose -f docker-compose.prod.yml -f deploy/docker-compose.https.yml up -d --build

접속 후: docs/attendance/오픈_체크리스트.md 3단계(초기 설정)부터 진행
======================================================
EOF
