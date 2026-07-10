# daolERP API — 빌드 컨텍스트는 저장소 루트 (모노레포)
# docker build -f apps/api/Dockerfile -t daolerp-api .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN cd apps/api && pnpm exec prisma generate && pnpm build

FROM node:22-alpine
RUN corepack enable
ENV NODE_ENV=production TZ=Asia/Seoul
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
WORKDIR /app/apps/api
EXPOSE 3000
# 기동 시 마이그레이션 적용 후 서버 시작 (법인 복제 배포 시에도 동일)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/apps/api/src/main.js"]
