# 修复报告

## 概要

本次修复覆盖了提出的 4 个问题，并额外修复了一批由前后端字段契约不一致引起的关联故障，避免页面因为接口返回结构变化而直接崩溃。

## 已修复问题

### 1. Admin 存储策略页面加载异常

- 原因：
  - 前端直接读取 `allowed_types.join(...)`
  - 后端实际返回的是 `allowed_mime_types`、`max_file_size_bytes`、`local_path` 等字段
- 修复：
  - 在 `web/src/lib/api.ts` 中增加存储策略数据归一化
  - 在 `web/src/pages/admin/AdminStoragePage.tsx` 中对 `allowed_types`、`config` 做空值保护
  - 存储策略创建和更新时，将前端表单结构正确转换为后端真实字段

### 2. Admin 兑换码管理页面加载异常

- 原因：
  - 前端把 `/api/admin/redeem-batches` 返回的 `{ items: [...] }` 直接当数组使用并调用 `map`
- 修复：
  - 在 `web/src/lib/api.ts` 中统一归一化兑换码批次返回结构
  - 在 `web/src/pages/admin/AdminRedeemPage.tsx` 中修复创建批次后的响应处理，正确展示生成的兑换码

### 3. 发帖后广场页面加载异常，关注和热榜看不到帖子

- 原因：
  - `PostCard` 依赖旧字段，如 `topics`、`attachments.file_name`、`original_post`、`avatar_url`
  - 后端返回结构与前端预期不一致，导致发帖后列表渲染直接报错
  - 关注流未包含当前用户自己的帖子
  - 热榜依赖异步刷新，刚发布的公开帖子不会立刻进入候选集合
- 修复：
  - 在 `web/src/lib/api.ts` 中增加用户、帖子、评论、通知、钱包、网盘等数据的统一归一化
  - 重写 `web/src/types.ts`，使前端类型与当前后端接口对齐
  - 在 `api/internal/store/social.go` 中：
    - 关注流改为包含当前用户自己的帖子
    - 关注流仅返回 `public` 和 `followers`，避免泄露私密帖子
    - 热榜仅统计公开帖子
    - 新建公开帖子时立即插入 `trending_scores` 候选记录，保证热榜可见

### 4. Admin 内容管理中删除后仍显示删除按钮

- 原因：
  - 页面错误调用了用户侧的 `DELETE /api/posts/:id`
  - 页面把“可见性”错误提交给了 admin 的“状态”接口
- 修复：
  - 重写 `web/src/pages/admin/AdminPostsPage.tsx`
  - 改为使用 `POST /api/admin/posts/:id/status`
  - 已删除帖子显示“恢复”按钮
  - 增加状态列与状态筛选

## 额外修复

- `api/internal/store/store.go`
  - 修复默认本地存储策略启动补种逻辑，避免每次启动重复插入默认策略
- `api/internal/store/settings.go`
  - 新增默认存储策略唯一性维护，创建、编辑、删除时都保证系统始终只有一个默认策略
- `api/internal/store/drive.go`
  - 默认存储策略查询增加稳定排序，避免脏数据历史下命中不确定记录
- `web/src/pages/UserProfilePage.tsx`
  - 修复用户主页错误请求公共广场接口的问题
  - 改为使用用户详情接口返回的 `user + posts`
- `web/src/components/FollowButton.tsx`
  - 修复把 `username` 当作 follow API 的 `userId` 传入的问题
- `web/src/pages/DrivePage.tsx`
  - 修复网盘页面只拿整棵树、不按当前目录展示子节点的问题
- `web/src/pages/WalletPage.tsx`
  - 修复钱包余额、套餐、流水字段映射错误
- `web/src/components/NotificationItem.tsx`
  - 修复通知已读接口的 ID 类型不一致问题
- 侧边栏存储配额显示恢复正常，不再出现 `NaN undefined / NaN undefined`

## 修改文件

### API

- `api/internal/store/social.go`

### Web

- `web/src/types.ts`
- `web/src/lib/api.ts`
- `web/src/components/DriveTree.tsx`
- `web/src/components/FollowButton.tsx`
- `web/src/components/NotificationItem.tsx`
- `web/src/components/UserCard.tsx`
- `web/src/pages/DrivePage.tsx`
- `web/src/pages/UserProfilePage.tsx`
- `web/src/pages/WalletPage.tsx`
- `web/src/pages/admin/AdminPostsPage.tsx`
- `web/src/pages/admin/AdminRedeemPage.tsx`
- `web/src/pages/admin/AdminStoragePage.tsx`

## 验证结果

### 构建与测试

- `web`: `npm run build` 通过
- `api`: `go test ./...` 通过

### 浏览器联调

已实际验证以下页面和流程：

- Admin 存储策略页可以正常打开和编辑
- Admin 兑换码页可以正常打开和创建批次
- 广场发帖后页面正常渲染，帖子可见
- 关注页可以看到当前用户自己的帖子
- 热榜页可以看到新发布的公开帖子
- Admin 内容管理删除后按钮变为“恢复”，恢复后帖子重新出现在广场
- 用户主页可以正常打开并展示帖子
- 钱包页面可以正常打开
- 网盘页面可以正常打开

## 验证过程中的数据变更

- 测试期间创建过一个临时兑换码批次 `smoke-test`，已清理
- 测试期间创建过一个临时存储策略 `smoke-local`，已删除
- 数据库中历史残留的 2 条重复默认本地存储策略已清理

## 备注

- 当前运行环境已确认只保留 1 条默认本地存储策略记录
