# Research: 将 dsh-live2d-pets 配置接入 DSH 设置面板（开一个 tab）

> 调研报告（Research），非决策记录。结论基于 DSH 官方包（已装版本 0.1.0-rc.6）的 README、类型契约与源码；官方仓库 docs 链接见文末。
> 状态：**范围已确认**（2026-08，interview-me 结论）——四项设置（开关/尺寸滑杆/模型列表/调试模式），其余移除；模型列表 = 内置 presets.jsonc 只读 + 自定义模型可增删改（名称 + URL），持久化到 settings 用户层。已同步 `docs/intent/live2d-pet-plugin.md` 与 `docs/spec/live2d-pet-v01.md`（§2/§4/§6/§8/§9/§10）。**实现进行中**：v0.1.2 已按 §5 落地，设置传输经 §3.5 方案 B（插件自身 API，因 §3.4 wire 白名单限制）；待 DSH 落地插件自助暴露后迁移回 settingsScope wire。

## 1. 结论摘要

**可行，且官方机制现成，无需改 DSH 本体或 profile 配置。**

- 设置面板的顶层导航项由 Client slot `settings.section` 驱动：一个列表项 = 一个设置页。截图里「侧边卡片」正是已装插件 `dsh-better-sidebar` 用它贡献的页面，dsh-live2d-pets 走同一条路即可。
- 配置持久化走 Host 服务 `ctx.settings`（写 `$DSH_HOME/settings.yaml`，文件 provider 已随 base bundle 挂载，热重载、atomic 写、带 revision 并发控制）。
- 全部改动集中在 dsh-live2d-pets 仓库内部：host 半区注册 settings namespace + client 半区注册 section 页面。

## 2. 官方资料清单（一手来源）

### 2.1 本地官方包（权威性最高：与插件 peerDeps 匹配的同版本产物）

| 来源 | 用途 |
|------|------|
| `@deepseek-ai/dsh-client-ui-settings` → `lib/types/client/contract/slots.d.ts` | 设置面板 slot 契约的唯一权威定义（`settings.trigger/header/action/close/section/plugins.tab/onboarding/general.item`） |
| `dsh-client-ui-settings` README | settings 域基座：`ctx.settingsScope`（Host 传输面）、slot 类型声明职责 |
| `dsh-client-ui-settings-general` README | 设置 shell：占据 `sidebar.settings`，把 `settings.section` ledger 投射为导航项 |
| `dsh-client-ui-settings-plugins` README | Plugins 分区与 `settings.plugins.tab` / `settings.plugin.item` 的配置卡机制 |
| `@deepseek-ai/dsh-settings` README | Host 侧 settings 服务完整 API（register/get/update/replace/mutate/watch） |
| `@deepseek-ai/dsh-settings-file` README | 文件 provider：YAML 持久化、热发布、原子写、跨进程写锁 |
| `dsh-base/cordis.patch.yml` L78-79 | 实测确认 `settings` + `dsh-settings-file` 已随基础合成挂载 |
| `dsh-web-app/cordis.patch.yml` L186-196, L263-264 | 实测确认设置 UI（ui-settings、general、models、plugin-inventory、plugins）已在 web bundle |
| 已装 `dsh-better-sidebar` → `lib/client.js` L8230-8239 | 可运行的同款范例：`ctx.slots.inject('settings.section', ...)` |

### 2.2 官方仓库 docs（GitHub `deepseek-ai/DeepSeek-Harness`）

沙盒禁止直连外网，以下仅拿到链接，机制结论以本地官方包为准：

- [docs/user/develop/basic/publish.md](https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/develop/basic/publish.md) — 官方插件形态（bundle patch 安装流程；插件自带 `cordis.patch.yml` 注释亦引用此页）
- [docs/user/develop/basic/config.md](https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/develop/basic/config.md) — 配置
- [docs/cookbook/extension-cookbook.md](https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/cookbook/extension-cookbook.md) — 扩展 cookbook
- [docs/user/develop/framework/service.md](https://github.com/deepseek-ai/DeepSeek-Harness/blob/master/docs/user/develop/framework/service.md) — 服务开发

## 3. 设置面板扩展机制

### 3.1 Slot 类型全表（slots.d.ts）

| slot | kind | 作用 |
|------|------|------|
| `settings.trigger` | single | 侧边栏底部触发行（图标+文案） |
| `settings.header` / `settings.close` | single | 面板标题 / 关闭按钮无障碍名 |
| `settings.action` | list | 内容区头部动作 |
| **`settings.section`** | **list** | **一个列表项 = 一个顶层设置页**（导航里的「通用设置/模型/插件/侧边卡片」均为其条目） |
| `settings.plugins.tab` | list | 插件分区内部的子 tab |
| `settings.general.item` | list | 通用设置里的单行偏好项 |
| `settings.onboarding` | list | 首次引导步骤 |

### 3.2 `settings.section` 注册契约

- 条目选项：`id`（分区键，驱动 only 过滤）、`order`（导航位置）、`label`（注册者本地化的显示文本；locale 变更时重注册，shell 不订阅 locale）。
- Owner props 仅一个：`close: () => void`（关闭设置面板）。
- 页面数据走注册者自己的 `inject` face / store，shell 不提供业务 props。
- 注册方式（better-sidebar 范例）：

```ts
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'better-sidebar',
  order: 100,
  label: () => t('settingsNav'),
  inject: () => ({ store, service }),
}, SideCardSection))
```

### 3.3 Host 侧 settings 服务（dsh-settings）

- `register(ns, schema, { base?, applies? })` → owner `SettingsScope`（`get` / `watch` / `update` / `replace` / `mutate`）。
- **三层解析值**：schema 默认值 → 注册者 composition `base`（即 cordis.yml 条目 config 子集）→ 用户文档 section（`$DSH_HOME/settings.yaml`）。
- 写路径：`update(ns, patch)` 深合并进 user section（绝不写 base），校验通过才持久化；每个 namespace 有单调 `revision`，写带 `expectedRevision`，过期写抛 `SETTINGS_CONFLICT`。
- 文件 provider：YAML 热发布、atomic 重命名写、跨进程写锁、外部编辑保留注释与未观察改动。
- **关键推论：插件现有 cordis.yml config 天然是 base 层**，现有配置方式继续有效，GUI 只是叠加用户覆盖。

### 3.4 Client 侧写路径（平台限制实测：wire 白名单）

- `ctx.settingsScope`（`dsh-client-ui-settings` 提供）→ `bind<T>(spec)` → `SettingsScope<T>`。
- 读：`getSnapshot()`（status / value / base / user / revision / writability）。
- 写：`set` / `unset`（单字段、带 revision；`unset` 清除用户覆盖、回退 base）。
- **平台限制（2026-08 实测，根因）**：wire 层 `dsh-host-apiproxy` 只把**硬编码白名单**内的 namespace 暴露给浏览器——
  `WEB_SETTINGS_NAMESPACES`（agent-loop/shell/locale/permission/ui-conversation/ui-theme/web-search-deepseek）
  + `PRODUCT_SETTINGS_NAMESPACES`（ui-onboarding/agent-presets）+ 模型提供者 namespace。
  第三方注册的 namespace 对 `settings.describe` 返回 `settings-not-exposed` → client scope 恒为 `unavailable`
  （现象：设置页渲染正常但提示"设置服务不可用"）。
  官方注释明确：*"Moving that declaration to `settings.register()`, so a plugin can expose its own
  configuration without a change in this package, is deferred work"* —— 该版本平台欠账，第三方插件**无法**
  通过 settingsScope wire 暴露自己的 namespace（已装 `dsh-better-sidebar` 因此自带 store，不碰 ctx.settings）。

### 3.5 传输层决策（已确认：方案 B）

因 3.4 白名单限制，设置页**不走 settingsScope wire**，改走**插件自身同源 HTTP API**：
`GET/POST /api/live2d-pet/settings`（Host 直连 `ctx.settings`：`get` / `mutate`，持久化仍是 settings.yaml
用户层、base 层语义不变）。优点：随插件发布、任何用户可用、无需改 DSH；代价：无 wire 的 revision 冲突检测
（mutate 写队列本身串行，冲突仅影响并发外部编辑器，v0.1 接受）。待 DSH 落地插件自助暴露后，可迁移回
settingsScope wire（迁移点：client 数据层 + host 路由移除）。

> 实现注意：`dsh-host-webserver` 的 `exact` 表按 **path 唯一**（不按 HTTP method 分表），同 path 的
> GET/POST 必须合并进**一条** `register`（handler 内按 `req.method` 分发），否则启动报
> `duplicate exact route "/api/live2d-pet/settings"`。

## 4. 三种接入路径对比

| 路径 | 呈现 | 截图对应 | 适配度 |
|------|------|----------|--------|
| **A. `settings.section`** | 顶层导航多一项「桌宠配置」，完整设置页 | ✅ 红箭头所指位置，与「侧边卡片」同款 | **推荐** |
| B. `settings.plugins.tab` | 导航「插件」下多一个子 tab | ✗ 藏在插件分区内 | 备选 |
| C. `settings.plugin.item` | 插件 → configurable tab 下的可展开配置卡（bash / agent-loop 同款） | ✗ 非独立页 | ADR-002 提过的「插件配置卡」，体验弱于独立页 |

## 5. dsh-live2d-pets 接入路径（方案，未实现）

### 5.1 现状

- host（`src/index.ts`）：`Config` schema（enabled/size/corner/model/debug）+ `webServer` 路由；配置仅来自 cordis.yml 插件行 config。
- client（`src/client/index.ts`）：仅注册 `shell.overlay` 挂载点；无任何设置入口。
- ADR-002 已预留 `settings.plugin.item` / `settings.section` 两个入口方向，spec §2 已列设置项清单，均未落地。

### 5.2 Host 改动

1. `ctx.settings.register('live2d-pet', Config, { base: config })`——注册 namespace，cordis.yml 配置自动成为 base 层；
2. `PetService` 改读 `ctx.settings.get('live2d-pet')`（或 `watch`）取三层解析值，GUI 改动即时生效（不改则 GUI 写入无人读取）；
3. 现有 `webServer` 路由不动。

### 5.3 Client 改动

按 better-sidebar 范例注册 section（`src/client/index.ts`）：

```ts
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'live2d-pet',
  order: 200,
  label: () => '桌宠配置',
  inject: () => ({ scope: /* ctx.settingsScope.bind(spec) */ }),
}, PetSettingsSection))
```

`PetSettingsSection` 接 `close` prop；表单控件经 `settingsScope` 读写。表单实现方式决定改动量：

- **最小形态**：仅镜像当前 5 项配置，用 `dsh-client-schema-form` 按 Config schema 自动生成 → 改动最小；
- **完整形态**：实现 spec §2 清单（开关/尺寸小中大/重置位置/隐藏快捷键/模型清单+自定义 URL/调试模式），需新增配置字段 + 手写控件 → 改动大。

### 5.4 package.json

- peerDeps 增加 `@deepseek-ai/dsh-client-ui-settings`（settingsScope 提供方）与 `@deepseek-ai/dsh-client-runtime`（类型契约）；
- `dsh.client.inject` 相应扩展。

## 6. 风险与注意（官方 README 明示）

- **单字段写**：client `SettingsScope` 每次写一个字段、无事务；联动字段分两次写并处理 revision。
- **loopback 限制**：remote browser 无持久设置（本地 127.0.0.1 的 web 不受影响）。
- **热重载安全**：settings.yaml 外部编辑热发布、namespace 重新解析；无效 section 保留 last-good 并告警，不拖垮进程。
- **label 本地化**：section label 是注册者提供的 thunk，locale 变更需重注册。
- **未验证项**：官方 docs 站点全文因沙盒禁网未直接抓取；本报告机制结论以本地官方包（版本 0.1.0-rc.6）为准。

## 7. 建议的下一步

1. ~~定「内容范围」~~ ✅ 已确认：四项设置（开关/尺寸滑杆/模型列表/调试模式），其余移除；模型列表 = 内置只读 + 自定义增删改（名称 + URL）
2. 可行性验证：先用动态 Cordis 插件在运行中的 DSH 注册空 `settings.section` 占位，确认 tab 出现、行为符合预期（不碰仓库代码）
3. 验证通过后按 §5 落地实现 + 重装验证；
4. 实现落地时按文档驱动约定：行为变化 → spec（§2/§4/§6/§8/§9/§10 已按确认范围更新）；技术取舍 → 新 ADR（可标记本文为调研前置）。
