# ADR-004: 插件打包形态与通信架构（基于官方开发规范）

## Status

Proposed

## Date

2026-08-14

## Context

- 需要确定正式插件的打包/分发/通信/挂载形态（此前为开放项）
- **方法修正**：初稿曾从社区插件 `@linxin666/dsh-pet` 反推机制，违反第一性原理；本稿改为**以官方规范为唯一依据**推导，社区插件仅作工程范式参照
- 官方来源（deepseek-ai/deepseek-harness 仓库）：
  - [docs/user/develop/basic/publish.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md) — 组合包/profile 概念、安装机制、git 安装构建坑
  - [docs/user/develop/basic/config.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.zh.md) — 插件配置（Schemastery schema + cordis.yml config 行 + HMR）
  - [docs/user/develop/basic/index.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md) — 插件 = 导出 apply(ctx) 的模块，cordis.yml insert 注册
  - [packages/client/modules/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.zh.md) — 客户端模块契约（`dsh.client` 扫描、`exports["./client"]`、`/plugins` 服务、`window.__ModuleLoader__.load`）
  - 首方客户端插件源码（`@deepseek-ai/dsh-client-ui-*`）— 官方客户端工程范式

## Decision

1. **打包形态（组合包 bundle）**：npm 包，`package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`；`cordis.patch.yml` 以**包名**插入插件行：
   ```yaml
   - insert:
       - id: live2d-pet
         name: dsh-live2d-pets
   ```
   安装：`dsh plugin --profile web add <包>`（自动追加进 `dsh.profile.bundles`）；分发走 npm 或 `pnpm pack` tarball（避开 git 安装的 prepare 构建授权坑，官方文档明确推荐）。

2. **配置机制（官方 config 规范）**：插件导出 `Config` 接口 + Schemastery schema（默认值写进 schema）；用户经 cordis.yml 插件行 `config:` 传参；schema 校验、非法配置加载失败、**改配置触发 HMR 热替换**。v0.1 配置字段：enabled / size / corner / model。

3. **Host 半区**：插件模块导出 `apply(ctx, config)`；用 `ctx.webServer.register(route)` 注册同源 JSON API（`/api/live2d-pet/*`）与模型资产静态路由（`/pet-assets/*`）；订阅 `agent/status`、`agent/error`、`agent/turn-stopping`、`approval/request`、`agent/inbox/inserted` → 宠物状态机（事件经 `Event.listEvents` 实测存在）。

4. **Client 半区**：`package.json` 声明 `"dsh": { "client": { "platform": "web", "inject": [...] } }` 与 `exports["./client"]`（构建为 `window.__ModuleLoader__.load` 契约，tsdown）；优先挂载 `shell.overlay`（实测存在，root 级、replaceRisk=none），不可用则回退 `document.body` 全局 React root；通信为同源 fetch 轮询（800ms，visibility-aware）。

5. **构建链**：TypeScript + `tsc -b && tsdown` + vitest；CSS Modules 由 lightningcss 内联；React/cordis 外部化。

## Alternatives Considered

### 备选方案 A：仅 client 包（无 dsh.bundle，如官方 dsh-client-ui-*）

- Pros: 首方客户端插件的形态
- Cons: 官方 client-only 包由 dsh-web-app 等 bundle 装配，不面向独立分发；我们的插件需要同时装 Host 状态机
- Rejected: 采用"单包双半区"（dsh.bundle + dsh.client 合一），与官方 publish.md + client-modules 两套契约都兼容

### 备选方案 B：git 安装分发

- Pros: 免注册表
- Cons: 官方文档明确 git 安装拉源码不跑 build，需 prepare 脚本 + 用户授权 allowBuilds，安全与可靠性差
- Rejected: 用 npm 发布或 tarball 分发预构建产物

### 备选方案 C：自建设置页（settings 命名空间）替代 config schema

- Pros: 类似 dsh-pet 的 pet.json 持久化，UI 亲和
- Cons: 违背官方 config 规范（schema + cordis.yml config + HMR）；配置即声明、可审计
- Rejected: 遵循官方 config 规范；显示类偏好（尺寸/位置）可后续经设置卡补充

## Consequences

- 插件形态完全对齐官方规范，安装/升级/回滚走标准 `dsh plugin` 通道
- 配置经 schema 校验 + HMR，用户可在 cordis.yml 直接改配置并热生效
- 与竞品 dsh-pet 差异化：Live2D 渲染 + 触摸分区 + 可靠状态事件源 + root 级浮层 slot
- 构建链引入 TypeScript 工具链（tsconfig/tsdown/vitest）
- 实现顺序：重构骨架（官方形态）→ Host 状态机+路由 → Client 渲染器（移植 spike 已验证代码）→ 气泡/触摸 → 配置与预设 → README 与发布
