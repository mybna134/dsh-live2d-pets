# ADR-007: 自定义人设走插件独有 JSONC 文件（不进 DSH settings 体系）

## Status

Accepted

## Date

2026-08-16

## Context

人设体系需要支持用户自定义性格预设（含台词池覆盖与 base 继承）。自定义内容放哪里有三条路：

1. **DSH settings 用户层**（`$DSH_HOME/settings.yaml`，经 `ctx.settings`，与开关/尺寸等标量设置同机制）
2. **插件独有配置文件**（`$DSH_HOME/live2d-pet/personas.jsonc`，Host 直接 fs 读写）
3. 随包静态文件（安装目录内）

关键约束：用户要 **VSCode settings.json 式体验**——打开文件就能看到**带注释的模板**（女仆人设彩蛋：取消注释即得），复制粘贴即可添加自己的预设。而 settings.yaml 归 DSH settings 系统管：GUI 每次写设置会整体重写文件，**注释存活不可控**；标准 JSON 又不支持注释，模板彩蛋无从谈起。随包文件则在 node_modules 里，插件更新即丢。

## Decision

自定义人设走**插件独有 JSONC 文件** `$DSH_HOME/live2d-pet/personas.jsonc`（JSONC：解析前剥注释，与 VSCode settings.json 同构）：

- **首启动落地模板**（不存在才写，含使用说明注释 + 注释版女仆彩蛋）；此后插件对该文件**只读不写**——注释永存
- Host `PersonasStore` 每次 `/state` 快照**现读**（无缓存 → 刷新页面即生效）；`POST /reload-personas` 重读 + version bump + SSE 推送（设置页「↻ 重新读取」按钮，宠物当场换台词）
- **职责分层**：GUI 标量设置（开关/尺寸/模型/调试/**人设选择**）仍走 `ctx.settings`（ADR-002 边界不动）；**自定义人设内容**归该文件——GUI 管"选哪个"，文件管"有哪些"
- 台词合并放 client：`PetStateView` 只带 `config.persona` + `customPersonas` 原样定义，client 沿 base 链与内置文案表（client 常量）本地合并，内置表不重复下发
- 「自定义人设 ↗」入口优先经 `ctx.get('workspaces').openPath`（DSH `host.openPath`）打开文件，失败弹层兜底（复制路径/模板）

## Alternatives Considered

### 备选方案 A：全部走 ctx.settings（settings.yaml）

- Pros: 与现有设置同机制，零新文件
- Cons: settings.yaml 由 DSH settings writer 整体重写，**注释无法存活**——模板彩蛋（注释版女仆）不可能；用户层 schema 需嵌套数组结构，GUI 表单化编辑与"手写文件"体验冲突
- Rejected: 满足不了注释模板这一核心体验

### 备选方案 B：运行时把注释动态追加进 settings.yaml

- Pros: 不新增文件
- Cons: 持续写用户设置文件（骚扰感）；被 writer 剥离后需维护补回逻辑（复杂、易错）；用户明确否决"动态追加"
- Rejected: 用户拍板"不做动态追加"

### 备选方案 C：随包模板文件 + 引导用户编辑

- Pros: 零写入用户文件
- Cons: 安装目录在 node_modules，插件更新即丢编辑；"打开就有注释"体验不存在
- Rejected: 持久性不成立

## Consequences

- 正面：注释彩蛋成立且**永存**（落地后无人重写该文件）；自定义人设零接触 DSH yaml 体系，解析失败只影响人设不伤其它设置；现读策略让"刷新页面/点按钮"两条生效路径都自然成立
- 代价：多一个文件与一份 JSONC 剥注释解析器（~40 行，已测）；人设清单与 settings 解析值分属两处，靠 `PetStateView` 聚合下发
- 对后续：若 v0.2 做设置页内文案编辑器，写入目标应是该文件（保持"文件是唯一真源"）；fs.watch 热重载仍明确不做（按钮显式触发足够）
