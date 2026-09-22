# MarsShare

MarsShare 是一个使用 Go + React + PostgreSQL + Docker Compose 搭建的微博式 SNS 与网盘一体化平台。

## 技术栈

- 后端：Go 1.24、Gin、pgx、Goose
- 前端：React、Vite、TailwindCSS、TanStack Query
- 数据库：PostgreSQL 16
- 对象存储：本地磁盘默认启用，Cloudflare R2 预留驱动
- 调试部署：Docker Compose

## 快速启动

1. 复制环境变量模板：

```bash
cp .env.example .env
```

2. 启动开发环境：

```bash
docker compose up --build
```

3. 访问：

- 前端：`http://localhost:5173`
- API：`http://localhost:8080/api`

## 当前实现范围

- 一体化 React 前端：公开广场、登录注册、网盘、钱包会员、管理后台
- Go API：认证、信息流、帖子与评论、点赞、关注、网盘上传与分享、兑换码、会员购买、后台设置
- Worker：会员过期同步、热榜重算、预览任务占位
- PostgreSQL 初始 schema 与默认数据引导

## 管理员引导

服务启动时会使用 `.env` 中的 `BOOTSTRAP_ADMIN_EMAIL` 和 `BOOTSTRAP_ADMIN_PASSWORD` 自动创建管理员。

