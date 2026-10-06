# Playwright 공식 이미지: 크로미움과 실행에 필요한 라이브러리가 들어 있다
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# 캡처한 화면의 한글이 깨지지 않게 CJK 글꼴을 넣는다
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

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
