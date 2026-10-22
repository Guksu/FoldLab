# Playwright 공식 이미지: 크로미움과 실행에 필요한 라이브러리가 들어 있다
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# 캡처한 화면의 한글이 깨지지 않게 CJK 글꼴을 넣는다
# 이미지의 Node는 이미지를 만든 때의 버전에 머물러 있다. 이미지에 등록된 NodeSource 저장소에서
# 보안 패치 버전(2026-10 보안 릴리스: Brotli 디코더 원격 코드 실행 등)으로 올리고, 못 올렸으면 빌드를 멈춘다
ARG NODE_MIN_VERSION=24.22.1
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && apt-get install -y --only-upgrade nodejs \
  && rm -rf /var/lib/apt/lists/* \
  && if dpkg --compare-versions "$(node -p process.versions.node)" lt "$NODE_MIN_VERSION"; then \
       echo "Node $(node -v)는 보안 패치 전 버전입니다(필요: v$NODE_MIN_VERSION 이상)" >&2; exit 1; \
     fi

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production \
    FOLDLAB_HOST=0.0.0.0 \
    FOLDLAB_PORT=4280
EXPOSE 4280
USER pwuser
CMD ["node", "dist/server/index.js"]
