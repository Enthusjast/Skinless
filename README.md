# Skinless

Cloudflare Serverless Minecraft 皮肤站与 Yggdrasil 外置登录服务。

Skinless 使用 Hono + TypeScript 运行在 Workers，D1 保存账号和 token，R2 保存私有 PNG 纹理，`frontend/` 是部署到 Cloudflare Pages 的 Vue 3 单页应用。

## 功能

- Yggdrasil `authenticate`、`refresh`、`validate`、`invalidate`、`signout`
- `hasJoined`、Minecraft profile 和私有 R2 纹理代理
- 邮箱注册、密码修改、皮肤/披风上传删除
- Classic（Steve）和 Slim（Alex）模型选择、CSS 2D 预览
- 基础管理员用户列表和角色修改
- PBKDF2-SHA256 密码哈希、Bearer token、PNG 尺寸校验、CORS、登录失败限制和 Cron token 清理

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

Vite 会把 `/api`、`/authserver`、`/sessionserver` 和 `/textures` 代理到本地 Worker。前端部署到独立 Pages 项目时，设置 `frontend/.env`：

```dotenv
VITE_API_BASE_URL=https://skin.example.com
```

## 验证命令

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm exec wrangler deploy --dry-run
```

本地 D1 迁移由 `pnpm db:local` 执行。真实 Cloudflare 数据库、R2 bucket、域名和 secrets 不包含在仓库中。

## API 根路径

推荐将 Authlib Injector 指向 `https://skin.example.com/api/yggdrasil`。为兼容不同启动器，Yggdrasil 路由也在根路径提供别名：

| 能力 | 规范路径 | 根路径别名 |
| --- | --- | --- |
| 元信息 | `/api/yggdrasil/` | `/` |
| 认证 | `/api/yggdrasil/authserver/*` | `/authserver/*` |
| 会话 | `/api/yggdrasil/sessionserver/*` | `/sessionserver/*` |
| 纹理 | `/api/yggdrasil/textures/:hash` | `/textures/:hash` |

`hasJoined` 响应会缓存 60 秒；纹理使用内容 SHA-256 作为 R2 key，并设置长期 immutable 缓存。

## Cloudflare 部署

1. 安装依赖并创建资源：

   ```bash
   pnpm install
   wrangler d1 create mc-skin-db
   wrangler r2 bucket create mc-skins
   ```

2. 将 D1 返回的 `database_id` 写入 `wrangler.toml`，并替换生产环境的 `SKIN_DOMAIN`、`API_BASE_URL` 和 `CORS_ORIGIN`。

3. 执行生产迁移并部署 Worker：

   ```bash
   wrangler d1 execute mc-skin-db --remote --file=./migrations/0001_init.sql
   wrangler deploy
   ```

4. 在 Cloudflare Pages 创建前端项目，构建命令使用 `pnpm --filter @skinless/frontend build`，输出目录为 `frontend/dist`，并配置 `VITE_API_BASE_URL`。

5. 注册首个账号后，用 D1 手动提升管理员角色：

   ```bash
   wrangler d1 execute mc-skin-db --remote \
     --command="UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'"
   ```

不要把 database ID、生产域名或任何 secret 写入前端代码。当前 v1 不需要 JWT secret；token 使用 D1 中保存的随机 UUID 管理。

## Minecraft 接入

下载 `authlib-injector.jar`，启动服务端时加入：

```bash
-javaagent:authlib-injector.jar=https://skin.example.com/api/yggdrasil
```

并在 `server.properties` 设置：

```properties
online-mode=false
```

HMCL/PCL2 等启动器选择“外置登录（Authlib Injector）”，认证服务器填写同一个 API 地址，账号使用 Skinless 注册邮箱和密码。

## 安全与运行边界

- 密码使用 Workers Web Crypto PBKDF2-SHA256（100,000 次迭代），数据库不保存明文密码。
- Worker 校验 PNG 魔数、尺寸和 64 KB 大小限制；图片处理在浏览器 Canvas 中完成。
- API 不使用 Cookie，管理接口需要 Bearer token 且 `role=admin`。
- 登录失败限制当前按 Worker 实例内存计数，适合 v1 小规模部署；若需要跨实例的严格全局限制，应替换为 Durable Object 或 KV 方案。
- v1 不生成 RSA textures signature；主流 Authlib Injector 和启动器可在无签名时工作。
