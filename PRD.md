# MarsShare 产品需求文档 (PRD)

> 面向开发的产品设计文档，包含功能需求、技术架构与开发计划。

---

## 1. 产品概述

### 1.1 产品定位

MarsShare（火星分享）是一个 **Material Design 3 设计风格的社交网盘平台**，融合微博式信息流与个人网盘功能。用户可以发布 Markdown 格式的帖子、附带文件分享，同时拥有独立的云盘空间管理个人文件。

### 1.2 目标用户

- 内容创作者：使用 Markdown 撰写技术笔记、教程并附带源码/资源
- 文件分享爱好者：需要便捷的文件托管与分享链接生成
- 小型团队/社区：需要一个轻量级的知识分享 + 文件协作平台

### 1.3 设计理念

- **Material Design 3**：遵循 Google MD3 设计规范，使用 Dynamic Color、圆角卡片、Elevation 层次、Motion 过渡动效
- **Markdown 内容**：所有用户内容（帖子、评论、个人简介）均支持 Markdown 渲染
- **响应式设计**：Mobile-first，适配桌面端与移动端，遵循 MD3 自适应布局规范
- **渐进式功能**：社交与网盘功能独立可用，组合使用时体验更佳

---

## 2. 技术栈

| 层级 | 技术选型 |
|------|----------|
| 前端 | React 19、TypeScript、Vite、TailwindCSS、TanStack Query、React Router |
| 后端 | Go 1.24、Gin、pgx (PostgreSQL) / go-sqlite3 (SQLite) |
| 数据库 | PostgreSQL 16（主）/ SQLite（轻量部署） |
| 数据库迁移 | Goose |
| 认证 | JWT（access token + refresh token） |
| 对象存储 | 本地磁盘（默认）、S3 兼容（AWS/R2/MinIO）、阿里云 OSS、腾讯云 COS、七牛云 Kodo、又拍云 |
| 容器化 | Docker、Docker Compose |
| 邮件（开发） | Mailpit |

---

## 3. 用户角色与权限

| 角色 | 标识 | 核心权限 |
|------|------|----------|
| 游客 | 未登录 | 浏览公开信息流、查看公开分享页、注册/登录 |
| 普通用户（免费） | `role: user` | 发帖、评论、点赞、关注、管理网盘（基础配额）、创建分享链接 |
| 普通用户（付费会员） | `role: user` + `membership` | 同上 + 更大存储配额、更大单文件上传限制 |
| 管理员 | `role: admin` | 全部用户权限 + 用户管理、内容审核、系统设置、兑换码管理、钱包充值 |

---

## 4. 功能模块详细需求

### 4.1 用户系统

**注册**
- 字段：邮箱、用户名、密码
- 用户名唯一性校验（3-20 字符，字母数字下划线）
- 邮箱唯一性校验
- 密码使用 bcrypt 哈希存储

**登录**
- 邮箱或用户名 + 密码登录
- 返回 JWT access token（短期，15min）+ refresh token（长期，7d）
- 记录 Session（user_agent、IP、过期时间）

**Token 管理**
- Refresh token 轮换：每次刷新生成新 token，旧 token 失效
- Logout 撤销当前 refresh token

**用户资料**
- 可编辑字段：显示名称（display_name）、个人简介（bio，支持 Markdown）、头像
- 头像上传至对象存储，关联 objects 表

**密码修改**
- 需验证旧密码

**管理员引导**
- 服务首次启动时，使用环境变量 `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` 自动创建管理员账户

### 4.2 社交信息流

**帖子创建**
- 内容：Markdown 文本（必填，最长 10000 字符）
- 附件：可从网盘选择文件附加（最多 9 个）
- 话题标签：从内容中自动提取 `#标签` 语法
- 可见性：公开（public）/ 仅关注者（followers）/ 私密（private）

**信息流**
- **公开广场**：所有公开帖子，按时间倒序，支持游客访问
- **关注信息流**：仅关注用户的帖子，需登录
- **话题信息流**：指定话题标签下的帖子
- **用户主页**：指定用户的帖子列表
- 分页：基于游标（cursor-based）

**互动**
- 点赞 / 取消点赞：每用户每帖一次
- 评论：Markdown 内容，支持嵌套回复（parent_id）
- 转发：引用原帖创建新帖

**关注系统**
- 关注 / 取消关注
- 关注者/被关注计数

**热榜**
- 基于 24 小时 / 7 天窗口的评分算法
- Worker 定时重算（默认 30s 间隔）
- 评分因子：点赞数、评论数、转发数、时间衰减

**搜索**
- 帖子全文搜索：PostgreSQL 使用 `tsvector` + `ts_query`；SQLite 使用 FTS5
- 用户搜索：用户名/显示名称模糊匹配

**举报**
- 用户可举报帖子或评论
- 字段：目标类型（post/comment）、目标 ID、原因
- 管理员在后台审核处理

### 4.3 云盘系统

#### 4.3.1 存储策略（Storage Policy）

借鉴 [Cloudreve](https://github.com/cloudreve/cloudreve) 的存储策略架构，采用 **Handler 接口 + 策略工厂** 模式，将物理存储与业务逻辑解耦。

**支持的存储后端**

| 后端类型 | 标识 | 说明 |
|----------|------|------|
| 本地磁盘 | `local` | 默认，文件存储在服务器本地目录 |
| S3 兼容 | `s3` | AWS S3、Cloudflare R2、MinIO 等所有 S3 兼容服务 |
| 阿里云 OSS | `oss` | 阿里云对象存储 |
| 腾讯云 COS | `cos` | 腾讯云对象存储 |
| 七牛云 Kodo | `qiniu` | 七牛云存储 |
| 又拍云 | `upyun` | 又拍云存储 |

**Handler 接口定义**

所有存储后端实现统一的 `StorageHandler` 接口：

```go
type StorageHandler interface {
    // 上传文件，返回 object_key
    Put(ctx context.Context, key string, reader io.Reader, size int64) error
    // 获取文件内容（流式读取）
    Get(ctx context.Context, key string) (io.ReadCloser, error)
    // 删除文件
    Delete(ctx context.Context, keys []string) error
    // 生成临时访问 URL（用于下载/预览，含过期时间）
    Source(ctx context.Context, key string, expires time.Duration) (string, error)
    // 生成缩略图 URL（可选能力）
    Thumb(ctx context.Context, key string, width, height int) (string, error)
    // 声明后端能力（是否支持直链、缩略图、限速等）
    Capabilities() Capabilities
}

type Capabilities struct {
    DirectURL       bool  // 是否支持生成直链（云存储支持，本地不支持）
    ThumbSupport    bool  // 是否支持服务端缩略图
    MaxFileSize     int64 // 后端限制的最大文件大小（0 = 无限制）
    ProxyRequired   bool  // 下载是否需要服务端中转（本地存储需要）
}
```

**策略工厂**

根据 `storage_policies.type` 字段路由到对应后端实现：

```go
func NewHandler(policy StoragePolicy) (StorageHandler, error) {
    switch policy.Type {
    case "local":  return local.New(policy)
    case "s3":     return s3.New(policy)
    case "oss":    return oss.New(policy)
    case "cos":    return cos.New(policy)
    case "qiniu":  return qiniu.New(policy)
    case "upyun":  return upyun.New(policy)
    default:       return nil, ErrUnsupportedBackend
    }
}
```

**存储策略配置（管理员在后台配置）**

每个策略包含：
- 后端类型（type）
- 连接信息：Endpoint / Bucket / Region
- 认证凭据：AccessKey / SecretKey（加密存储）
- 文件命名规则：支持 `{uid}/{date}/{random}` 等变量
- 是否启用、是否为默认策略
- 单文件大小限制、允许的 MIME 类型

**策略与用户组关联**

- 会员计划 (`membership_plans`) 关联一个存储策略 ID
- 免费用户使用系统默认策略（`is_default = true` 的策略）
- 付费会员使用其计划关联的策略（可能是更大容量的云存储）
- 上传时根据用户当前会员状态选择对应策略

**下载/预览的中转策略**

- **本地存储**：服务端直接流式传输（ProxyRequired = true）
- **云存储（支持直链）**：生成带签名的临时 URL，客户端直接从云存储下载
- **云存储（私有桶/需中转）**：服务端反向代理，从云存储获取内容后转发给客户端
- 管理员可在策略设置中选择是否强制中转（如需要限速或统计下载量）

#### 4.3.2 存储架构（Object/Node 分离）

- `objects` 表：物理文件记录，关联存储策略。按 SHA256 + policy_id 去重，同一策略下相同文件只存储一份
- `drive_nodes` 表：虚拟文件树，每个节点是文件夹或文件引用。多个 node 可指向同一个 object

#### 4.3.3 文件夹树

- 每个用户有一个根文件夹（隐式，parent_id = NULL）
- 支持任意深度嵌套
- API 返回完整树结构

#### 4.3.4 文件上传

- Multipart 上传
- 根据用户会员状态选择存储策略
- 服务端计算 SHA256，同策略下已存在则复用 object
- MIME 类型自动检测，校验策略允许的类型
- 上传前检查存储配额和单文件大小限制
- 上传流程：客户端 → API 服务 → StorageHandler.Put() → 物理存储

#### 4.3.5 文件操作

- 重命名：修改 drive_node.name
- 移动：修改 drive_node.parent_id
- 删除：软删除（is_trashed = true），移入回收站
- 恢复：从回收站恢复

#### 4.3.6 文件下载

- **本地存储**：服务端流式传输，设置 Content-Disposition
- **云存储**：返回签名临时 URL（302 重定向）或服务端反向代理
- 支持 HTTP Range 请求（断点续传）

#### 4.3.7 文件预览

- 图片：直接预览 + 缩略图（云存储可利用其缩略图服务）
- 文本/代码：语法高亮渲染
- Markdown：渲染预览
- PDF：首页预览（Worker 异步生成）
- 其他：显示文件信息 + 下载按钮

#### 4.3.8 存储配额

- 免费用户：默认 1 GB
- 付费会员：按计划配置（如 10 GB、50 GB）
- 上传时强制校验，超额拒绝

#### 4.3.9 单文件大小限制

- 由存储策略和会员计划共同决定，取两者较小值
- 免费用户默认策略：50 MB
- 付费会员策略：按计划配置（如 500 MB、2 GB）

### 4.4 文件分享

**创建分享链接**
- 选择网盘中的文件/文件夹
- 生成唯一 token（URL-safe）
- 可选：密码保护（bcrypt 哈希存储）
- 可选：过期时间

**公开分享页**
- 无需登录即可访问
- 显示文件信息（名称、大小、类型）
- 密码保护的分享需先验证密码
- 支持预览和下载

**转存功能**
- 已登录用户可将分享文件保存到自己的网盘
- 帖子附件也可转存到个人网盘
- 转存复用 object（不重复存储物理文件），但创建新的 drive_node

**分享管理**
- 查看我创建的所有分享链接
- 撤销分享（revoked_at 时间戳）
- 查看下载次数统计

### 4.5 会员与计费

**钱包系统**
- 每个用户有余额（单位：分）
- 所有变动记录在 wallet_ledgers 流水表
- 流水类型：充值（redeem）、消费（purchase）、管理员充值（admin_credit）、退款（refund）

**兑换码**
- 管理员批量生成（指定面值和数量）
- 每个兑换码只能使用一次
- 用户输入兑换码 → 金额充入钱包

**会员计划**
- 管理员定义计划：名称、价格（分）、时长（天）、存储配额、单文件限制
- 用户从钱包扣款购买
- 会员到期后自动降级为免费用户配额

**Stripe 支付（可选）**
- 创建 Checkout Session → 用户跳转支付 → Webhook 回调充值
- 作为预留接口，初期可不实现

**Worker 任务**
- 定时检查过期会员，重置配额为免费档

### 4.6 管理后台

**Dashboard**
- 统计数据：用户总数、帖子总数、文件总数、总存储使用量、待处理举报数

**用户管理**
- 用户列表（分页、搜索）
- 封禁 / 解封用户
- 管理员充值（向指定用户钱包充值）

**内容审核**
- 帖子列表（按状态筛选：published / hidden / deleted）
- 修改帖子状态
- 举报列表及处理（标记已处理、关联管理员）

**系统设置**
- Key-Value 存储，value 支持加密
- 示例设置项：SMTP 配置、站点名称、注册开关、默认存储配额

**兑换码管理**
- 创建批次（面值 + 数量）
- 查看批次下的兑换码列表及使用状态

**审计日志**
- 记录所有管理员操作
- 字段：操作者、动作、目标类型/ID、详情（JSONB）、时间

### 4.7 通知系统

**通知类型**
- `like`：有人点赞了你的帖子
- `comment`：有人评论了你的帖子
- `repost`：有人转发了你的帖子
- `follow`：有人关注了你
- `system`：系统公告

**通知管理**
- 通知列表（分页，按时间倒序）
- 未读计数
- 标记单条已读 / 全部已读

**触发时机**
- 点赞、评论、转发、关注操作时，在事务中创建通知记录
- 不通知自己对自己的操作

**扩展预留**
- WebSocket 实时推送（未来）
- 邮件通知（未来，结合 SMTP 设置）

---

## 5. 数据库设计

### 5.1 用户与认证

```sql
-- 用户表
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    username        TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL DEFAULT '',
    bio             TEXT NOT NULL DEFAULT '',
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'user',       -- 'user' | 'admin'
    avatar_object_id UUID REFERENCES objects(id),
    wallet_balance_cents BIGINT NOT NULL DEFAULT 0,
    storage_used_bytes   BIGINT NOT NULL DEFAULT 0,
    storage_quota_bytes  BIGINT NOT NULL DEFAULT 1073741824, -- 1 GB
    upload_limit_bytes   BIGINT NOT NULL DEFAULT 52428800,   -- 50 MB
    membership_plan_id   UUID REFERENCES membership_plans(id),
    membership_ends_at   TIMESTAMPTZ,
    is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 登录会话表
CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  TEXT NOT NULL,
    user_agent          TEXT NOT NULL DEFAULT '',
    ip_address          TEXT NOT NULL DEFAULT '',
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
```

### 5.2 社交模块

```sql
-- 帖子表
CREATE TABLE posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    visibility      TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'followers' | 'private'
    status          TEXT NOT NULL DEFAULT 'published', -- 'published' | 'hidden' | 'deleted'
    repost_of_id    UUID REFERENCES posts(id),
    like_count      INT NOT NULL DEFAULT 0,
    comment_count   INT NOT NULL DEFAULT 0,
    repost_count    INT NOT NULL DEFAULT 0,
    search_vector   TSVECTOR,  -- PostgreSQL 全文搜索
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_posts_author ON posts(author_id, created_at DESC);
CREATE INDEX idx_posts_created ON posts(created_at DESC) WHERE status = 'published';
CREATE INDEX idx_posts_search ON posts USING GIN(search_vector);

-- 评论表
CREATE TABLE comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id   UUID REFERENCES comments(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_post ON comments(post_id, created_at);

-- 点赞表
CREATE TABLE reactions (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);

-- 转发表
CREATE TABLE reposts (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);

-- 关注表
CREATE TABLE follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX idx_follows_followee ON follows(followee_id);

-- 话题表
CREATE TABLE topics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    post_count  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 帖子-话题关联
CREATE TABLE post_topics (
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    topic_id    UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, topic_id)
);

-- 热榜评分（Worker 重算）
CREATE TABLE trending_scores (
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    score_24h   DOUBLE PRECISION NOT NULL DEFAULT 0,
    score_7d    DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id)
);

-- 举报表
CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type     TEXT NOT NULL,  -- 'post' | 'comment'
    target_id       UUID NOT NULL,
    reason          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'resolved' | 'dismissed'
    resolved_by     UUID REFERENCES users(id),
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_status ON reports(status, created_at DESC);
```

### 5.3 云盘与存储

```sql
-- 存储策略表（管理员配置，定义存储后端连接方式）
CREATE TABLE storage_policies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,                          -- 策略显示名称，如"本地存储"、"阿里云 OSS"
    type                TEXT NOT NULL DEFAULT 'local',          -- 'local' | 's3' | 'oss' | 'cos' | 'qiniu' | 'upyun'
    is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    is_default          BOOLEAN NOT NULL DEFAULT FALSE,         -- 是否为免费用户的默认策略
    -- 连接配置
    endpoint            TEXT NOT NULL DEFAULT '',               -- 服务端点 URL（云存储必填）
    bucket              TEXT NOT NULL DEFAULT '',               -- 桶/空间名称
    region              TEXT NOT NULL DEFAULT '',               -- 区域
    access_key          TEXT NOT NULL DEFAULT '',               -- 凭据 AccessKey（加密存储）
    secret_key          TEXT NOT NULL DEFAULT '',               -- 凭据 SecretKey（加密存储）
    -- 本地存储配置
    local_path          TEXT NOT NULL DEFAULT '/data/storage',  -- 本地存储目录
    -- 文件管理规则
    dir_naming_rule     TEXT NOT NULL DEFAULT '{uid}/{date}',   -- 目录命名规则，支持 {uid}/{date}/{year}/{month}
    file_naming_rule    TEXT NOT NULL DEFAULT '{random}{ext}',  -- 文件命名规则，支持 {random}/{uuid}/{original}{ext}
    max_file_size_bytes BIGINT NOT NULL DEFAULT 52428800,       -- 单文件大小限制（默认 50MB）
    allowed_mime_types  TEXT NOT NULL DEFAULT '*',              -- 允许的 MIME 类型，逗号分隔，* 表示全部
    -- 下载策略
    is_private          BOOLEAN NOT NULL DEFAULT TRUE,          -- 桶是否为私有（需签名 URL）
    proxy_download      BOOLEAN NOT NULL DEFAULT FALSE,         -- 是否强制服务端中转下载
    base_url            TEXT NOT NULL DEFAULT '',               -- CDN/自定义域名（云存储可选）
    url_expire_seconds  INT NOT NULL DEFAULT 3600,              -- 签名 URL 过期时间（秒）
    -- 扩展配置
    settings            JSONB NOT NULL DEFAULT '{}',            -- 后端特有的额外配置
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 对象表（物理文件，按策略去重存储）
CREATE TABLE objects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    policy_id       UUID NOT NULL REFERENCES storage_policies(id),  -- 关联存储策略
    object_key      TEXT NOT NULL,          -- 存储路径（由策略命名规则生成）
    sha256          TEXT NOT NULL,
    mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'orphaned' | 'deleted'
    preview_status  TEXT NOT NULL DEFAULT 'none',   -- 'none' | 'pending' | 'ready' | 'failed'
    preview_object_key TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_objects_sha256_policy ON objects(sha256, policy_id);

-- 网盘节点表（虚拟文件树）
CREATE TABLE drive_nodes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id   UUID REFERENCES drive_nodes(id) ON DELETE CASCADE,
    object_id   UUID REFERENCES objects(id),
    kind        TEXT NOT NULL,  -- 'folder' | 'file'
    name        TEXT NOT NULL,
    size_bytes  BIGINT NOT NULL DEFAULT 0,
    mime_type   TEXT NOT NULL DEFAULT '',
    is_trashed  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_drive_nodes_user_parent ON drive_nodes(user_id, parent_id);
CREATE INDEX idx_drive_nodes_trashed ON drive_nodes(user_id, is_trashed);

-- 帖子附件
CREATE TABLE post_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    object_id       UUID NOT NULL REFERENCES objects(id),
    drive_node_id   UUID REFERENCES drive_nodes(id),
    name            TEXT NOT NULL,
    mime_type       TEXT NOT NULL DEFAULT '',
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_post_attachments_post ON post_attachments(post_id, sort_order);

-- 分享链接
CREATE TABLE share_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drive_node_id   UUID NOT NULL REFERENCES drive_nodes(id) ON DELETE CASCADE,
    token           TEXT NOT NULL UNIQUE,
    password_hash   TEXT,
    expires_at      TIMESTAMPTZ,
    download_count  INT NOT NULL DEFAULT 0,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_share_links_token ON share_links(token);
```

### 5.4 计费与会员

```sql
-- 会员计划
CREATE TABLE membership_plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    slug                TEXT NOT NULL UNIQUE,
    price_cents         BIGINT NOT NULL,
    duration_days       INT NOT NULL,
    storage_policy_id   UUID REFERENCES storage_policies(id),  -- 关联存储策略（NULL 则用默认策略）
    storage_quota_bytes BIGINT NOT NULL,
    upload_limit_bytes  BIGINT NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order          INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 会员购买记录
CREATE TABLE memberships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id     UUID NOT NULL REFERENCES membership_plans(id),
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at     TIMESTAMPTZ NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'wallet', -- 'wallet' | 'stripe' | 'admin'
    source_id   TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memberships_user ON memberships(user_id, ends_at DESC);

-- 钱包流水
CREATE TABLE wallet_ledgers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,  -- 'redeem' | 'purchase' | 'admin_credit' | 'refund' | 'stripe'
    amount_cents    BIGINT NOT NULL,
    balance_after   BIGINT NOT NULL,
    reference_type  TEXT NOT NULL DEFAULT '',
    reference_id    TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wallet_ledgers_user ON wallet_ledgers(user_id, created_at DESC);

-- 兑换码批次
CREATE TABLE redeem_batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    amount_cents    BIGINT NOT NULL,
    total_count     INT NOT NULL,
    redeemed_count  INT NOT NULL DEFAULT 0,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 兑换码
CREATE TABLE redeem_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id    UUID NOT NULL REFERENCES redeem_batches(id) ON DELETE CASCADE,
    code        TEXT NOT NULL UNIQUE,
    amount_cents BIGINT NOT NULL,
    redeemed_by UUID REFERENCES users(id),
    redeemed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_redeem_codes_code ON redeem_codes(code);
```

### 5.5 通知与系统

```sql
-- 通知表
CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,  -- 'like' | 'comment' | 'repost' | 'follow' | 'system'
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    post_id     UUID REFERENCES posts(id) ON DELETE CASCADE,
    message     TEXT NOT NULL DEFAULT '',
    payload     JSONB,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

-- 系统设置
CREATE TABLE system_settings (
    key             TEXT PRIMARY KEY,
    value_encrypted TEXT NOT NULL,
    is_secret       BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 审计日志
CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID NOT NULL REFERENCES users(id),
    action      TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id   TEXT NOT NULL DEFAULT '',
    payload     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
```

### 5.6 SQLite 兼容说明

在 SQLite 模式下需做以下调整：

| PostgreSQL | SQLite 替代方案 |
|------------|-----------------|
| `UUID` + `gen_random_uuid()` | `TEXT` + 应用层生成 UUID |
| `TIMESTAMPTZ` | `TEXT`（ISO 8601 格式） |
| `TSVECTOR` + GIN 索引 | FTS5 虚拟表 |
| `JSONB` | `TEXT`（JSON 字符串） |
| `pg_trgm` 模糊匹配 | `LIKE` 查询 |

---

## 6. API 接口设计

所有接口前缀 `/api`，JSON 格式请求/响应。认证使用 `Authorization: Bearer <access_token>` Header。

### 6.1 认证 Auth

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| POST | `/api/auth/register` | 无 | 注册新用户 |
| POST | `/api/auth/login` | 无 | 登录，返回 access + refresh token |
| POST | `/api/auth/logout` | 无 | 登出，撤销 refresh token |
| POST | `/api/auth/refresh` | 无 | 刷新 access token |
| GET | `/api/me` | 必需 | 获取当前用户信息 |
| PATCH | `/api/me` | 必需 | 更新个人资料（display_name, bio, avatar） |
| POST | `/api/auth/password` | 必需 | 修改密码 |

### 6.2 社交 Social

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | `/api/feed` | 可选 | 信息流（query: type=public/following） |
| GET | `/api/trending` | 无 | 热榜帖子 |
| GET | `/api/search` | 可选 | 搜索帖子/用户（query: q, type=posts/users） |
| GET | `/api/topics/:slug` | 可选 | 话题信息流 |
| GET | `/api/users/:username` | 可选 | 用户主页 + 帖子列表 |
| POST | `/api/posts` | 必需 | 创建帖子 |
| GET | `/api/posts/:id` | 可选 | 帖子详情 + 评论列表 |
| DELETE | `/api/posts/:id` | 必需 | 删除自己的帖子 |
| POST | `/api/posts/:id/comments` | 必需 | 添加评论 |
| POST | `/api/posts/:id/reactions` | 必需 | 点赞 |
| DELETE | `/api/posts/:id/reactions` | 必需 | 取消点赞 |
| POST | `/api/posts/:id/repost` | 必需 | 转发 |
| POST | `/api/follows/:id` | 必需 | 关注用户 |
| DELETE | `/api/follows/:id` | 必需 | 取消关注 |
| POST | `/api/reports` | 必需 | 举报内容 |

### 6.3 通知 Notifications

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | `/api/notifications` | 必需 | 通知列表（分页） |
| POST | `/api/notifications/:id/read` | 必需 | 标记单条已读 |
| POST | `/api/notifications/read-all` | 必需 | 标记全部已读 |

### 6.4 网盘 Drive

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | `/api/drive/tree` | 必需 | 获取文件夹树 |
| POST | `/api/drive/folders` | 必需 | 创建文件夹 |
| PATCH | `/api/drive/nodes/:id` | 必需 | 重命名/移动节点 |
| DELETE | `/api/drive/nodes/:id` | 必需 | 删除节点（移入回收站） |
| POST | `/api/drive/nodes/:id/restore` | 必需 | 从回收站恢复 |
| GET | `/api/drive/trash` | 必需 | 回收站列表 |
| POST | `/api/uploads` | 必需 | 上传文件 |
| GET | `/api/files/:id/download` | 必需 | 下载文件 |
| GET | `/api/files/:id/preview` | 必需 | 预览文件 |

### 6.5 分享 Sharing

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| POST | `/api/shares` | 必需 | 创建分享链接 |
| GET | `/api/shares` | 必需 | 我的分享列表 |
| DELETE | `/api/shares/:id` | 必需 | 撤销分享 |
| GET | `/api/shares/public/:token` | 无 | 获取公开分享信息 |
| POST | `/api/shares/public/:token/verify` | 无 | 验证分享密码 |
| GET | `/api/shares/public/:token/download` | 无 | 下载分享文件 |
| GET | `/api/shares/public/:token/preview` | 无 | 预览分享文件 |
| POST | `/api/drive/transfer/attachments/:id` | 必需 | 帖子附件转存到网盘 |
| POST | `/api/drive/transfer/shares/:token` | 必需 | 分享文件转存到网盘 |

### 6.6 计费 Billing

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | `/api/billing/wallet` | 必需 | 钱包余额 + 流水记录 |
| GET | `/api/billing/plans` | 必需 | 会员计划列表 |
| POST | `/api/billing/memberships/purchase` | 必需 | 购买会员 |
| POST | `/api/billing/redeem` | 必需 | 兑换码兑换 |
| POST | `/api/billing/stripe/checkout` | 必需 | 创建 Stripe 支付会话 |
| POST | `/api/billing/stripe/webhook` | 无 | Stripe Webhook 回调 |

### 6.7 管理 Admin

所有接口前缀 `/api/admin`，需 admin 角色。

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/admin/dashboard` | Dashboard 统计数据 |
| GET | `/api/admin/users` | 用户列表（分页、搜索） |
| POST | `/api/admin/users/:id/ban` | 封禁/解封用户 |
| POST | `/api/admin/wallet/credit` | 管理员充值 |
| GET | `/api/admin/posts` | 帖子列表（审核） |
| POST | `/api/admin/posts/:id/status` | 修改帖子状态 |
| GET | `/api/admin/reports` | 举报列表 |
| POST | `/api/admin/reports/:id/resolve` | 处理举报 |
| GET | `/api/admin/settings` | 系统设置 |
| PUT | `/api/admin/settings` | 更新设置 |
| POST | `/api/admin/redeem-batches` | 创建兑换码批次 |
| GET | `/api/admin/redeem-batches` | 兑换码批次列表 |
| GET | `/api/admin/storage-policies` | 存储策略列表 |
| POST | `/api/admin/storage-policies` | 创建存储策略 |
| PUT | `/api/admin/storage-policies/:id` | 更新存储策略 |
| DELETE | `/api/admin/storage-policies/:id` | 删除存储策略（需无关联文件） |
| POST | `/api/admin/storage-policies/:id/test` | 测试存储策略连接 |

---

## 7. 前端页面与组件架构

### 7.1 路由表

| 路由 | 页面 | 需登录 |
|------|------|--------|
| `/` | HomePage — 公开广场 | 否 |
| `/login` | AuthPage — 登录 | 否 |
| `/register` | AuthPage — 注册 | 否 |
| `/feed` | FeedPage — 关注信息流 | 是 |
| `/trending` | TrendingPage — 热榜 | 否 |
| `/topics/:slug` | TopicPage — 话题 | 否 |
| `/u/:username` | UserProfilePage — 用户主页 | 否 |
| `/post/:id` | PostDetailPage — 帖子详情 | 否 |
| `/drive` | DrivePage — 网盘 | 是 |
| `/drive/trash` | DriveTrashPage — 回收站 | 是 |
| `/share/:token` | PublicSharePage — 公开分享 | 否 |
| `/wallet` | WalletPage — 钱包与会员 | 是 |
| `/notifications` | NotificationsPage — 通知 | 是 |
| `/settings` | SettingsPage — 个人设置 | 是 |
| `/admin` | AdminDashboard | 管理员 |
| `/admin/users` | AdminUsersPage | 管理员 |
| `/admin/posts` | AdminPostsPage | 管理员 |
| `/admin/reports` | AdminReportsPage | 管理员 |
| `/admin/settings` | AdminSettingsPage | 管理员 |
| `/admin/redeem` | AdminRedeemPage | 管理员 |
| `/admin/storage` | AdminStoragePage — 存储策略管理 | 管理员 |

### 7.2 核心组件

**布局组件**
- `AppShell` — 顶部导航 + 侧边栏 + 主内容区
- `Navbar` — Logo、搜索框、通知铃铛、用户头像下拉菜单
- `Sidebar` — 导航链接（广场、关注、网盘、钱包）、热门话题小部件
- `MobileBottomNav` — 移动端底部导航栏

**内容组件**
- `MarkdownRenderer` — Markdown 渲染，支持语法高亮
- `MarkdownEditor` — 编辑器，工具栏 + 实时预览切换
- `PostCard` — 帖子卡片（头像、内容、附件、交互按钮）
- `CommentThread` — 嵌套评论展示
- `PostComposer` — 发帖组件（编辑器 + 附件选择 + 发布）

**用户组件**
- `UserAvatar` — 用户头像
- `UserCard` — 用户信息悬浮卡片
- `FollowButton` — 关注/取消关注按钮

**网盘组件**
- `DriveTree` — 文件夹树侧边栏
- `FileList` — 文件/文件夹网格或列表视图
- `UploadModal` — 拖拽上传 + 进度条
- `FilePreview` — 图片/PDF/文本/代码预览
- `StorageQuotaBar` — 存储使用量进度条
- `ShareDialog` — 创建分享链接（密码/有效期设置）

**通用组件**
- `NotificationItem` — 单条通知
- `Pagination` — 分页组件
- `EmptyState` — 空状态占位
- `LoadingSpinner` — 加载中
- `FileIcon` — 基于 MIME 类型的文件图标

### 7.3 状态管理

| 状态类型 | 方案 |
|----------|------|
| 服务端数据（帖子、文件、用户等） | TanStack Query（缓存、自动失效、乐观更新） |
| 认证状态（当前用户、Token） | React Context + localStorage |
| URL 状态（分页、搜索、筛选） | React Router searchParams |
| 表单状态 | React useState（局部） |

---

## 8. Docker 部署架构

### 8.1 服务编排

| 服务 | 镜像 | 端口 | 用途 |
|------|------|------|------|
| `postgres` | postgres:16-alpine | 5432 | 数据库 |
| `api` | Go 自定义构建 | 8080 | REST API |
| `worker` | 同 api 镜像，不同入口 | — | 后台任务 |
| `web` | Node/Vite（开发）/ nginx（生产） | 5173 / 80 | 前端 SPA |
| `mailpit` | axllent/mailpit（dev profile） | 8025 / 1025 | 邮件测试 |

### 8.2 卷挂载

- `./data/postgres` → PostgreSQL 数据持久化
- `./data/storage` → 本地文件存储

### 8.3 环境变量

```env
DATABASE_URL=postgres://marsshare:marsshare@postgres:5432/marsshare?sslmode=disable
APP_MASTER_KEY=change-me-to-a-32-byte-secret
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=change-me-now
APP_BASE_URL=http://localhost:5173
API_ADDR=:8080
CORS_ORIGIN=http://localhost:5173
LOCAL_STORAGE_PATH=/data/storage
PUBLIC_STORAGE_BASE=/storage
WORKER_INTERVAL=30s
```

### 8.4 生产环境

- Go 多阶段构建：编译阶段 → 最终 scratch/alpine 镜像
- React 多阶段构建：npm build → nginx 提供静态文件
- 所有服务配置 healthcheck
- 可选 nginx 反向代理统一入口

### 8.5 SQLite 模式

- 当 `DATABASE_URL` 以 `sqlite://` 开头时，使用 SQLite 驱动
- Docker Compose 中不启动 postgres 服务
- 数据库文件挂载至 `./data/marsshare.db`
- 适用于单用户/轻量部署场景

---

## 9. 开发 TODO List

### Phase 1：基础框架 🏗️

```
- [x] Go module 初始化（github.com/marsshare/api）
- [x] React + Vite + TypeScript 项目初始化
- [x] Monorepo 目录结构搭建（api/ web/ docker-compose.yml）
- [x] Docker Compose 基础配置（postgres + api + web）
- [x] Go Dockerfile（多阶段构建）
- [x] Web Dockerfile（dev 模式 + 生产模式）
- [x] 环境变量配置加载模块
- [x] 数据库迁移框架集成（Goose）
- [x] 初始 migration：users + sessions 表
- [x] SQLite / PostgreSQL 双驱动抽象层
- [x] 用户注册 API（邮箱+用户名+密码，bcrypt 哈希）
- [x] 用户登录 API（JWT access + refresh token）
- [x] Token 刷新 API（refresh token 轮换）
- [x] 登出 API（撤销 refresh token）
- [x] 获取当前用户 API（GET /api/me）
- [x] JWT 认证中间件（requireAuth / optionalAuth）
- [x] 健康检查端点（GET /healthz）
- [x] 管理员引导（启动时自动创建）
- [x] 前端 TailwindCSS 配置（Material Design 3 主题色 + Dynamic Color）
- [x] 前端 API 客户端封装（fetch + token 自动刷新拦截器）
- [x] 前端 TanStack Query 配置
- [x] 前端 React Router 路由配置
- [x] 前端 AuthContext（认证状态管理）
- [x] 前端 AppShell 布局组件（Navbar + Sidebar + 主内容区）
- [x] 前端 MobileBottomNav 移动端导航
- [x] 前端登录页面
- [x] 前端注册页面
- [x] 响应式布局测试（桌面 + 平板 + 手机）
```

### Phase 2：社交核心 💬

```
- [x] Migration：posts, comments, reactions, reposts, follows, topics, post_topics, trending_scores, reports 表
- [x] 创建帖子 API（Markdown 内容 + 可见性）
- [x] 话题标签自动提取（#tag 解析 → topics + post_topics）
- [x] 帖子详情 API（含评论列表）
- [x] 删除帖子 API（仅作者可删）
- [x] 公开信息流 API（游标分页，按时间倒序）
- [x] 关注信息流 API（仅关注用户的帖子）
- [x] 话题信息流 API
- [x] 用户主页 API（个人帖子列表 + 用户信息）
- [x] 点赞 / 取消点赞 API（计数同步更新）
- [x] 评论 API（创建 + 嵌套回复）
- [x] 转发 API（repost_of_id 关联）
- [x] 关注 / 取消关注 API
- [x] 全文搜索 API（PostgreSQL tsvector / SQLite FTS5）
- [x] 用户搜索 API（用户名模糊匹配）
- [x] 热榜 API（按 score_24h 排序）
- [x] 举报 API（创建举报）
- [x] 更新个人资料 API（PATCH /api/me）
- [x] 修改密码 API
- [x] 前端 MarkdownRenderer 组件（代码语法高亮、链接处理）
- [x] 前端 MarkdownEditor 组件（工具栏：加粗/斜体/链接/图片/代码块 + 预览切换）
- [x] 前端 PostCard 组件（头像、内容渲染、时间、操作栏）
- [x] 前端 PostComposer 组件（编辑器 + 可见性选择 + 发布按钮）
- [x] 前端 CommentThread 组件（嵌套展示 + 回复输入）
- [x] 前端 UserAvatar 组件
- [x] 前端 UserCard 悬浮卡片
- [x] 前端 FollowButton 组件
- [x] 前端 HomePage（公开广场）
- [x] 前端 FeedPage（关注信息流）
- [x] 前端 PostDetailPage（帖子详情 + 评论区）
- [x] 前端 UserProfilePage（用户主页）
- [x] 前端 TrendingPage（热榜）
- [x] 前端 TopicPage（话题页）
- [x] 前端搜索功能（搜索框 + 结果页）
- [x] 前端 SettingsPage（个人资料编辑 + 密码修改）
```

### Phase 3：云盘系统 📁

```
- [x] Migration：storage_policies, objects, drive_nodes, post_attachments 表
- [x] StorageHandler 接口定义（Put/Get/Delete/Source/Thumb/Capabilities）
- [x] Capabilities 结构体（DirectURL/ThumbSupport/MaxFileSize/ProxyRequired）
- [x] 策略工厂 NewHandler()：根据 policy.type 路由到对应后端
- [x] 本地磁盘存储后端实现（local.Handler）
- [x] S3 兼容存储后端实现（s3.Handler，覆盖 AWS S3/R2/MinIO）
- [x] 阿里云 OSS 存储后端实现（通过 S3 兼容协议复用 s3.Handler）
- [x] 腾讯云 COS 存储后端实现（通过 S3 兼容协议复用 s3.Handler）
- [x] 七牛云 Kodo 存储后端实现（通过 S3 兼容协议复用 s3.Handler）
- [x] 又拍云存储后端实现（通过 S3 兼容协议复用 s3.Handler）
- [x] 存储策略命名规则引擎（{uid}/{date}/{random}/{original}{ext} 变量替换）
- [x] 存储策略选择逻辑（根据用户会员状态 → membership_plan.storage_policy_id → 默认策略）
- [x] 文件上传 API（multipart, SHA256 校验, MIME 检测, 配额检查, 策略路由）
- [x] objects 去重逻辑（同策略 + 同 SHA256 匹配则复用）
- [x] 文件夹树查询 API（GET /api/drive/tree）
- [x] 创建文件夹 API
- [x] 重命名/移动节点 API
- [x] 删除节点 API（软删除 → 回收站）
- [x] 回收站列表 API
- [x] 从回收站恢复 API
- [x] 文件下载 API：本地 → 流式传输；云存储 → 签名 URL 302 重定向或反向代理
- [x] 文件下载中转代理（proxy_download = true 时服务端中转）
- [x] HTTP Range 请求支持（断点续传，本地文件通过 http.ServeContent）
- [x] 文件预览 API（图片直出、文本/代码返回内容、云存储缩略图委托）
- [x] 存储配额实时校验（上传前 + 上传后更新 storage_used_bytes）
- [x] 帖子附件功能（创建帖子时关联 object_id）
- [x] 前端 DriveTree 组件（可展开/折叠的文件夹树）
- [x] 前端 FileList 组件（网格视图 / 列表视图切换）
- [x] 前端 FileIcon 组件（基于 MIME 类型显示图标）
- [x] 前端 UploadModal 组件（拖拽上传 + 进度条 + 取消）
- [x] 前端 FilePreview 组件（图片/文本/Markdown/PDF 预览）
- [x] 前端 StorageQuotaBar 组件
- [x] 前端 DrivePage 完整页面（树 + 文件列表 + 操作栏）
- [x] 前端 DriveTrashPage（回收站页面）
- [x] 前端 PostComposer 集成附件选择（从网盘选文件）
- [x] 前端 PostCard 附件展示（文件卡片 + 预览/下载）
```

### Phase 4：分享与通知 🔗

```
- [x] Migration：share_links, notifications 表
- [x] 创建分享链接 API（token 生成、可选密码、可选过期时间）
- [x] 公开分享信息 API（GET /api/shares/public/:token）
- [x] 分享密码验证 API
- [x] 公开分享下载 API
- [x] 公开分享预览 API
- [x] 我的分享列表 API
- [x] 撤销分享 API
- [x] 下载计数更新
- [x] 转存：帖子附件 → 个人网盘 API
- [x] 转存：分享文件 → 个人网盘 API（复用 object，新建 drive_node）
- [x] 通知创建（点赞/评论/转发/关注时触发）
- [x] 通知列表 API（分页 + 未读计数）
- [x] 标记单条通知已读 API
- [x] 标记全部通知已读 API
- [x] 前端 ShareDialog 组件（密码设置 + 有效期选择 + 复制链接）
- [x] 前端 PublicSharePage（分享页面：文件信息 + 密码输入 + 预览/下载）
- [x] 前端分享管理列表（我的分享 + 撤销操作）
- [x] 前端 NotificationItem 组件
- [x] 前端 NotificationsPage（通知列表 + 标记已读）
- [x] 前端 Navbar 通知铃铛（未读计数红点）
```

### Phase 5：计费与会员 💰

```
- [x] Migration：membership_plans, memberships, wallet_ledgers, redeem_batches, redeem_codes 表
- [x] 会员计划列表 API
- [x] 钱包余额 + 流水查询 API
- [x] 兑换码兑换 API（验证 → 充值 → 记录流水）
- [x] 会员购买 API（扣款 → 更新配额 → 记录流水 + 购买记录）
- [x] 会员到期 Worker 任务（检查过期 → 重置配额为免费档）
- [x] Stripe Checkout Session 创建 API（预留）
- [x] Stripe Webhook 处理 API（预留）
- [x] 前端 WalletPage（余额展示 + 流水列表 + 兑换码输入）
- [x] 前端会员计划展示（卡片式对比 + 购买按钮）
- [x] 前端会员状态展示（当前计划 + 到期时间 + 配额信息）
```

### Phase 6：管理后台与优化 ⚙️

```
- [x] Migration：system_settings, audit_logs 表
- [x] Admin Dashboard API（统计数据聚合）
- [x] 用户管理 API（列表、搜索、封禁/解封）
- [x] 管理员充值 API（向用户钱包充值）
- [x] 帖子审核 API（列表 + 状态修改）
- [x] 举报处理 API（列表 + 标记处理）
- [x] 系统设置 API（读取 + 更新，支持加密值）
- [x] 兑换码批量生成 API
- [x] 兑换码批次列表 API
- [x] 存储策略 CRUD API（创建/列表/更新/删除）
- [x] 存储策略连接测试 API（验证凭据和连通性）
- [x] 前端 AdminStoragePage（策略列表 + 创建/编辑表单 + 连接测试按钮）
- [x] 审计日志记录（所有管理员操作自动记录）
- [x] 热榜评分重算 Worker（24h/7d 窗口）
- [x] 孤立对象清理 Worker（清理无 drive_node 引用的 object）
- [x] 文件预览生成 Worker（PDF 缩略图等，预留占位）
- [x] 前端 AdminDashboard 页面（统计卡片 + 图表）
- [x] 前端 AdminUsersPage（用户表格 + 搜索 + 封禁操作）
- [x] 前端 AdminPostsPage（帖子表格 + 状态筛选 + 操作）
- [x] 前端 AdminReportsPage（举报列表 + 处理操作）
- [x] 前端 AdminSettingsPage（设置表单）
- [x] 前端 AdminRedeemPage（创建批次 + 查看兑换码）
- [x] 全局错误处理优化（API 错误码统一 + 前端 toast 提示）
- [x] Loading 状态优化（骨架屏 Skeleton）
- [x] 移动端响应式全面测试与修复
- [x] 图片懒加载 + 缩略图优化
- [x] API 响应缓存策略优化
- [x] 生产环境 Docker 配置（多阶段构建 + nginx 反向代理）
- [x] .env.example 更新 + 部署文档
```

---

## 附录：错误码规范

| HTTP 状态码 | 场景 |
|-------------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 401 | 未认证 / Token 过期 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 409 | 冲突（如用户名已存在） |
| 413 | 文件过大 |
| 422 | 业务逻辑错误（如余额不足） |
| 429 | 请求频率过高 |
| 500 | 服务器内部错误 |

**统一错误响应格式：**

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "钱包余额不足"
  }
}
```
