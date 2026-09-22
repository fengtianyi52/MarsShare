FROM dockerproxy.net/library/node:24-alpine

# 使用阿里云 Alpine 镜像源加速 apk
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# 配置 npm 使用国内镜像源，并启用重试
RUN npm config set registry https://registry.npmmirror.com && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-timeout 300000

WORKDIR /app

COPY package*.json ./
RUN npm install

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
