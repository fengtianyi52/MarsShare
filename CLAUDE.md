# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MarsShare — Material Design 3 风格的 SNS + 网盘社交平台。Monorepo 包含两个 git submodule：

- `api/` — Go 后端 (module: `github.com/marsshare/api`)
- `web/` — React 前端 (TypeScript, Material Design 3)
- `PRD.md` — 产品需求文档（含数据库设计、API 接口、开发 TODO）

## Development Commands

### 启动完整开发环境

```bash
cp .env.example .env   # 首次需要
docker compose up --build
```

前端: http://localhost:5173 | API: http://localhost:8080/api | 健康检查: GET /healthz

启动时自动运行 Goose 迁移并用 `.env` 中的 `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` 创建管理员。

### 后端 (api/)

```bash
cd api
go run ./cmd/api       # API 服务
go run ./cmd/worker    # 后台 Worker（会员过期、热榜重算、清理过期 Session）
go test ./...          # 全部测试
go test ./internal/crypto/...  # 单个包测试
```

数据库迁移使用 Goose，迁移文件在 `api/migrations/`。

### 前端 (web/)

```bash
cd web
npm install
npm run dev            # Vite dev server
npm run build          # tsc --noEmit + vite build
```

## Architecture

### 后端分层 (`api/internal/`)

- `app/` — 应用入口：依赖组装 (`Dependencies`)、配置加载 (`Config`)、HTTP Server 生命周期、graceful shutdown
- `http/` — Gin 路由与 Handler，按领域拆分为多个 handler 文件：
  - `server.go` — RegisterRoutes()，分三层路由：公开、认证 (`requireAuth`)、管理员 (`requireAdmin`)
  - `middleware.go` — JWT 认证中间件
  - `handlers_auth.go` — 注册、登录、登出、刷新、个人资料
  - `handlers_social.go` — 帖子、评论、点赞、关注、搜索、话题、举报
  - `handlers_drive.go` — 文件上传下载、文件夹树、预览
  - `handlers_share.go` — 分享链接、公开分享、转存
  - `handlers_billing.go` — 钱包、会员、兑换码
  - `handlers_admin.go` — 管理后台全部接口
  - `handlers_notification.go` — 通知
- `store/` — 数据访问层（原始 SQL + pgx），按领域拆分：`auth`、`social`、`drive`、`billing`、`admin`、`settings`、`notification`
- `auth/` — JWT token 管理 (golang-jwt，HS256)
- `crypto/` — SecretBox 加解密（NaCl secretbox，基于 APP_MASTER_KEY）
- `storage/` — 存储策略系统：Handler 接口 + Manager + 多后端实现（local、s3）
- `worker/` — 后台定时任务（会员过期、热榜重算、Session 清理）
- `model/` — 全部数据模型（与 DB 表一一对应）+ 分页辅助类型

### 前端结构 (`web/src/`)

- `App.tsx` — React Router 路由（22 个路由）
- `lib/api.ts` — API 客户端（自动 token 刷新）
- `lib/auth.tsx` — AuthContext（用户状态、登录登出）
- `pages/` — 20+ 页面组件
- `components/` — 布局组件（AppShell/Navbar/Sidebar/MobileBottomNav）+ 业务组件（PostCard/DriveTree/MarkdownRenderer 等）
- TailwindCSS 配置 Material Design 3 色彩系统

### 关键设计

- **存储策略**：`storage_policies` 表定义后端类型（local/s3/oss/cos/qiniu/upyun），`objects` 通过 `policy_id` 关联策略。Handler 接口统一 Put/Get/Delete/Source 操作
- **Object/Node 分离**：`objects` 存物理文件（SHA256 去重），`drive_nodes` 是虚拟文件树
- **游标分页**：cursor = 上一页最后一条的 created_at ISO 时间戳
- Docker Compose 启动 postgres + api + worker + web 四个服务
- 数据库连接 pgx pool + stdlib 桥接供 Goose 使用
