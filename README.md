# Skinless

Cloudflare Serverless Minecraft 皮肤站与 Yggdrasil 外置登录服务。

Skinless 使用 Hono + TypeScript 运行在 Cloudflare Workers，D1 保存账户、Profile、会话和令牌，R2 保存内容寻址的 PNG 纹理，`frontend/` 是 Vue 3 单页应用。

## 功能概览

- Yggdrasil `authenticate`、`refresh`、`validate`、`invalidate`、`signout`
- `join`、`hasJoined`、Profile 查询和纹理代理
- 邮箱验证注册、密码修改、密码找回、邮箱变更和 7 天内账号恢复
- 一个账号管理多个 Minecraft Profile，每个 Profile 可单独选择 Classic（Steve）或 Slim（Alex）模型
- 皮肤、披风上传与删除；私有纹理衣柜；2D 预览和按需加载的 3D 预览
- 管理员可配置注册策略、邀请、账号状态、会话撤销和审计日志
- 同源 Cookie 会话、CSRF 防护、Yggdrasil Bearer token、分布式失败限制、可选 Turnstile 和 Cron 清理

## 开发环境

需要 Node.js 20+。项目使用 pnpm workspace；如果系统没有 pnpm，可使用 Corepack 或 `npx pnpm@9.15.4` 代替。

```bash
pnpm install
pnpm db:local

# Worker：http://localhost:8787
pnpm dev

# 另一个终端启动前端：http://localhost:5173
pnpm frontend:dev
```

`pnpm db:local` 会应用 `migrations/` 中的全部本地 D1 迁移。Vite 会把 `/api`、`/authserver`、`/sessionserver` 和 `/textures` 代理到本地 Worker。前端默认使用当前站点的同源 API 路径；本地或同源部署无需设置 API base URL：

```dotenv
VITE_API_BASE_URL=
```

本地 Worker 至少需要一个 `.dev.vars`：

```dotenv
ENVIRONMENT=local
WEB_SESSION_SECRET=replace-with-a-long-random-local-secret
YGGDRASIL_ALLOW_UNSIGNED_TEXTURES=true
```

`YGGDRASIL_ALLOW_UNSIGNED_TEXTURES=true` 只允许在 `local`、`development` 或 `test` 环境使用。需要测试邮箱流程时，还要配置 Resend 的 API key 和发件人；前端 Turnstile site key 放在 `frontend/.env.local` 的 `VITE_TURNSTILE_SITE_KEY` 中。

## 验证命令

```bash
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration
pnpm test:frontend
pnpm typecheck
pnpm build
pnpm exec wrangler deploy --dry-run
```

## 部署到 Cloudflare

### 1. 创建资源并应用迁移

```bash
pnpm install
wrangler d1 create mc-skin-db
wrangler r2 bucket create mc-skins
```

将 D1 返回的 `database_id` 写入 `wrangler.toml`，再应用全部迁移：

```bash
wrangler d1 migrations apply mc-skin-db --remote
```

不要只执行 `migrations/0001_init.sql`；账户恢复、衣柜、注册策略、审计和 Yggdrasil 会话 IP 绑定都依赖后续迁移。

### 2. 配置 Worker 变量和 secrets

生产环境建议为前端和 Worker 使用同一个自定义域名。`wrangler.toml` 中的公开变量至少要替换为实际值：

| 变量                     | 作用                                                     |
| ------------------------ | -------------------------------------------------------- |
| `SKIN_DOMAIN`            | 纹理域名，填写主机名，可用逗号分隔多个域名，不要填写路径 |
| `API_BASE_URL`           | Yggdrasil 纹理和 Profile URL 的完整 `https://` 基地址    |
| `CORS_ORIGIN`            | 前端站点的精确 Origin；不要在 Cookie 会话部署中使用 `*`  |
| `ENVIRONMENT`            | 生产环境填写 `production`                                |
| `SERVER_NAME`            | 启动器元信息中显示的服务名称                             |
| `IMPLEMENTATION_VERSION` | 对外报告的实现版本                                       |
| `TOKEN_EXPIRY_HOURS`     | Yggdrasil access token 有效期，默认 24 小时              |
| `BOOTSTRAP_ADMIN_EMAIL`  | 首个已验证注册邮箱；匹配后自动成为管理员，完成后应移除   |

用 Wrangler secret 保存敏感值：

```bash
openssl rand -hex 32 | wrangler secret put WEB_SESSION_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put MAIL_FROM
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put YGGDRASIL_PRIVATE_KEY_PEM
wrangler secret put YGGDRASIL_PUBLIC_KEY_PEM
```

其中：

- `WEB_SESSION_SECRET` 用于签发和验证管理端 Cookie 会话，生产环境必填；更换后现有 Web 会话会失效。
- `RESEND_API_KEY` 和 `MAIL_FROM` 用于注册、密码找回、邮箱变更和账号恢复验证码。`MAIL_FROM` 必须是已验证的发件人。
- `TURNSTILE_SECRET_KEY` 可选；配置后会在注册和重复登录失败等场景启用服务端校验。前端对应的 `VITE_TURNSTILE_SITE_KEY` 只放 Pages 环境变量，不放 Worker secret。
- Yggdrasil RSA 私钥、公钥用于 `textures` property 签名。生产环境应配置成对的 PKCS#8 私钥和 SPKI 公钥；没有签名密钥时，生产请求不会静默返回未签名纹理。

可以用以下命令生成一对 RSA 密钥，私钥文件不要提交到 Git：

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out yggdrasil-private.pem
openssl pkey -in yggdrasil-private.pem -pubout -out yggdrasil-public.pem
```

### 3. 部署前端并保持同源

在 Cloudflare Pages 创建前端项目：

- 构建命令：`pnpm --filter @skinless/frontend build`
- 输出目录：`frontend/dist`
- `VITE_API_BASE_URL` 留空，让浏览器使用同源 `/api`、`/authserver`、`/sessionserver` 和 `/textures`
- 如果启用 Turnstile，配置 `VITE_TURNSTILE_SITE_KEY`

Pages 的 `frontend/public/_redirects` 已将 SPA 路由回退到 `index.html`，`frontend/public/_headers` 提供 CSP 和安全响应头。生产站点需要把 Worker 的管理 API 和 Yggdrasil 路径通过同一个站点暴露，否则浏览器 Cookie 会话和 CSRF 校验不会按预期工作。

部署 Worker 前先运行：

```bash
pnpm exec wrangler deploy --dry-run
pnpm deploy
```

### 4. 创建首个管理员

优先在部署前设置 `BOOTSTRAP_ADMIN_EMAIL`，然后完成邮箱验证注册。若未使用 bootstrap 变量，可在确认账号邮箱已验证后手动提升：

```bash
wrangler d1 execute mc-skin-db --remote \
  --command="UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'"
```

部署后进入 `/admin`（管理员导航显示为“用户管理”），检查注册模式、Profile/纹理配额、邀请和 Join IP 策略。`/dashboard/setup` 可检查元信息、认证、会话、Profile 和纹理端点。

## 账户工作流

### 注册与登录

注册模式由管理员控制：

- `open`：允许新用户注册
- `invite`：需要有效、未过期且未超出次数的邀请码
- `closed`：暂时关闭注册

注册先保存待验证记录，再向邮箱发送 6 位验证码。验证码有效期为 10 分钟，重发有冷却时间，错误尝试次数有限；只有验证成功后才会创建可登录账户。重复失败可能需要 Turnstile。登录后浏览器使用 HttpOnly、同源 Cookie；Yggdrasil 启动器仍使用独立的 Bearer token。

### Profile 管理

用户可以创建、重命名、切换和删除 Profile。默认上限为 5 个，可由管理员调整；最后一个 Profile 不能删除。每个 Profile 保存自己的游戏名、模型、皮肤和披风，切换默认 Profile 后，启动器认证返回的 `selectedProfile` 会同步变化。

### 会话、密码和邮箱

“账户安全”中可以：

- 修改密码；修改后当前 Web 会话会退出
- 查看设备会话并撤销单个或全部其他会话
- 发起邮箱变更并用新邮箱验证码确认
- 通过“忘记密码”完成密码重置

恢复码、邮箱变更码和密码重置码均为短期一次性验证码。不要把验证码写入日志或工单。

### 账号删除与恢复

删除账号会进入 7 天的 `pending_deletion` 恢复期，期间不能登录或继续使用纹理。用户可以从登录页进入“恢复待删除账号”，输入恢复码取消删除。恢复期结束后 Cron 会按批次删除账号、会话和关联数据；未再被引用的 R2 纹理会进入延迟清理队列。

## 纹理工作流

### 上传约束

浏览器和 Worker 都会校验 PNG。当前支持：

| 资源 | 支持尺寸                                  |
| ---- | ----------------------------------------- |
| 皮肤 | `64 × 64`，以及会被规范化的旧版 `64 × 32` |
| 披风 | `64 × 32` 或 `1024 × 512`                 |

规范化后的文件必须不超过 64 KB。服务端会校验 PNG 签名、块结构、CRC、解压数据和像素尺寸，并按内容 SHA-256 保存到 R2；浏览器不会通过拉伸来掩盖错误尺寸。选择皮肤时同时选择 Classic 或 Slim，模型会随 Profile 纹理保存。

### 衣柜与应用

纹理衣柜保存用户自己的皮肤和披风，默认每个账号最多 50 条。衣柜纹理可以预览、重命名并应用到任意 Profile。正在被 Profile 使用的纹理不能直接删除；先切换或移除引用，再删除衣柜记录。2D 预览始终可用，3D 预览只在用户主动切换时加载，并提供 WebGL 失败回退。

### 延迟清理

纹理对象以内容 hash 复用。Profile 或衣柜不再引用某个 hash 时，Worker 会把它加入延迟清理队列，默认等待 7 天后再删除 R2 对象；Cron 每次只处理有界批次，并在发现引用重新出现或 R2 操作失败时保留/取消队列记录。这让替换纹理和短暂恢复操作不会误删仍在使用的对象。

## Minecraft 接入

推荐将 Authlib Injector 指向 Yggdrasil 根地址：

```bash
-javaagent:authlib-injector.jar=https://skin.example.com/api/yggdrasil
```

服务端设置：

```properties
online-mode=false
```

HMCL、PCL2 等启动器选择“外置登录（Authlib Injector）”，认证服务器填写同一个 API 地址，账号使用 Skinless 的注册邮箱和密码。服务端进服时先调用 `sessionserver/session/minecraft/join`，`hasJoined` 只会返回最近建立且未过期的服务端会话；如果管理员启用了 Join IP 绑定，请确保启动器和服务端的来源地址符合部署预期。

## API 根路径

推荐地址为 `https://skin.example.com/api/yggdrasil`。同时保留根路径别名：

| 能力   | 推荐路径                         | 根路径别名         |
| ------ | -------------------------------- | ------------------ |
| 元信息 | `/api/yggdrasil/`                | `/`                |
| 认证   | `/api/yggdrasil/authserver/*`    | `/authserver/*`    |
| 会话   | `/api/yggdrasil/sessionserver/*` | `/sessionserver/*` |
| 纹理   | `/api/yggdrasil/textures/:hash`  | `/textures/:hash`  |

管理端 API 在 `/api` 下，注册流程在 `/api/auth` 下，公开 Profile 查询在 `/api/public/profiles` 下。管理端请求需要 Cookie 会话和 CSRF token；协议端点继续使用 Bearer token。

## 安全与运行边界

- 密码使用 Workers Web Crypto PBKDF2-SHA256 哈希，数据库不保存明文密码。
- 生产环境不允许用 `YGGDRASIL_ALLOW_UNSIGNED_TEXTURES` 绕过签名要求。
- 不要把 D1 database ID 以外的 secret、RSA 私钥、Resend key、Turnstile secret 或 `WEB_SESSION_SECRET` 写入前端代码、`wrangler.toml` 或 Git。
- R2 bucket 保持私有，仅由 Worker 根据纹理 hash 提供必要的纹理响应。
- Cron 每天执行过期 token、服务端会话、账号删除、纹理清理和审计日志清理；确认 `wrangler.toml` 的 Cron trigger 已随 Worker 部署。
- `CORS_ORIGIN`、Cookie 域名和 Pages/Worker 的自定义域名必须按实际拓扑配置；浏览器管理端优先采用同源部署。
