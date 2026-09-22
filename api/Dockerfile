FROM dockerproxy.net/library/golang:1.24-alpine

# 使用阿里云 Alpine 镜像源加速 apk
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# 配置 Go 模块代理（七牛云 goproxy.cn）
ENV GOPROXY=https://goproxy.cn,direct \
    GONOSUMCHECK=* \
    GOFLAGS=-mod=mod

WORKDIR /app

RUN apk add --no-cache gcc musl-dev ca-certificates wget

COPY go.mod go.sum ./
RUN go mod download

COPY . .

CMD ["go", "run", "./cmd/api"]
