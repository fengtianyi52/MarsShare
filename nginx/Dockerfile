# syntax=docker/dockerfile:1.6
#
# MarsShare production gateway image.
#
# Stage 1 builds the React/Vite frontend bundle. Stage 2 starts from the
# official nginx image and copies the built assets in alongside the site
# config so a single image contains both the static frontend and the
# reverse-proxy rules for the API.
#
# Build context is the repository root so we can read web/ and nginx/
# from a single Dockerfile.

# ── Stage 1: build the SPA bundle ─────────────────────────────
FROM dockerproxy.net/library/node:24-alpine AS web-builder
WORKDIR /build

# 使用阿里云 Alpine 镜像源加速 apk
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# 配置 npm 使用国内镜像源，并启用重试以应对网络抖动
RUN npm config set registry https://registry.npmmirror.com && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-timeout 300000

# Install deps separately so the layer is cached as long as
# package*.json doesn't change.
COPY web/package*.json ./
RUN npm ci --prefer-offline 2>/dev/null || npm ci

COPY web/ ./
RUN npm run build

# ── Stage 2: nginx runtime ────────────────────────────────────
FROM dockerproxy.net/library/nginx:1.27-alpine

# Replace the default site config with our reverse-proxy + SPA setup.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

# Static SPA bundle, served straight off disk by nginx.
COPY --from=web-builder /build/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
