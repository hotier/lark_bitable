# 飞书工作台 · Bitable Manager

一个基于飞书开放平台 API 的多维表格 / 云文档 / 在线表格管理与自动化工作流平台。
通过 OAuth 授权后将飞书 Token 托管在服务端（HttpOnly Cookie + 数据库），前端无需接触密钥，并支持用 Webhook 触发可视化工作流。

## 功能特性

- **多维表格**：应用、数据表、字段、记录的全量 CRUD，带前端会话级缓存与静默全量预热。
- **云文档 / 在线表格**：列表与新建，模块化缓存失效。
- **OAuth 登录**：飞书 OAuth 2.0 授权，Token 写入 HttpOnly Cookie（防 XSS），服务端用 `refresh_token` 自动续期。
- **工作流编辑器**：基于 `@xyflow/react` 的可视化节点编排（触发、HTTP、代码、条件、循环、消息通知等），支持 Webhook 触发。
- **Webhook 触发器**：可「带秘钥」或「不校验」两种模式，秘钥采用恒定时间比较防时序攻击。
- **执行记录**：工作流运行历史与详情查看。
- **文件代理**：飞书文件的安全预览 / 下载签名代理。

## 技术栈

- **框架**：Next.js 16（App Router、Turbopack）、React 19
- **样式**：Tailwind CSS v4 + CSS 变量设计令牌（支持暗色模式与响应式）
- **数据库**：PostgreSQL（Neon Serverless），SQL 由 `lib/db.ts` 托管
- **飞书 SDK**：`@larksuiteoapi/node-sdk`
- **状态管理**：Zustand
- **校验**：Zod（API 入参边界控制）
- **测试**：Vitest（纯函数与工具层单测）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（复制后填写真实值）
cp .env.example .env.local

# 3. 启动开发服务器
npm run dev
# 打开 http://localhost:3000
```

### 环境变量

参见 [`.env.example`](./.env.example)，核心变量：

| 变量 | 说明 |
| --- | --- |
| `APP_ID` / `APP_SECRET` | 飞书开放平台应用凭据 |
| `REDIRECT_URI` | OAuth 回调地址，需与飞书后台一致 |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `CRON_SECRET` | 内部 cron 接口鉴权（可选） |
| `CACHE_TTL_MS` | 内存缓存默认 TTL（可选） |

## 脚本

```bash
npm run dev      # 开发服务器（Turbopack）
npm run build    # 生产构建
npm run start    # 启动生产服务
npm run lint     # ESLint
npm test         # 运行 Vitest 单元测试
```

## 目录结构

```
app/                 # Next.js App Router（路由 + 页面 + API Route Handlers）
  api/               # API 路由（bitable 代理、oauth、workflows、executions、webhook…）
  (app)/             # 登录后主界面（bitable / docs / sheets / flow）
  components/        # UI 组件（管理器、工作流编辑器、执行记录等）
lib/                 # 工具与基础设施（crypto、cache、db、validation、logger…）
services/            # 飞书 API 服务封装
tests/               # Vitest 单元测试
```

## 安全说明

- 飞书 Access Token 仅存于服务端（HttpOnly Cookie + 数据库），前端 JS 不可读，降低 XSS 泄露风险。
- Webhook 秘钥（如配置）使用 `crypto.timingSafeEqual` 恒定时间比较，抵御时序攻击。
- Webhook 请求体解析做原型链污染防护（剥离 `__proto__` / `constructor` / `prototype`）。
- API 入参经 Zod 校验，参数错误以 400 返回；敏感日志（含请求体）仅在非生产环境输出。

## 部署

项目包含 `vercel.json`，可直接部署到 Vercel；也可通过 `npm run build && npm run start` 自托管。部署前请确保 `REDIRECT_URI` 指向线上域名，并配置数据库与飞书 OAuth 回调。
