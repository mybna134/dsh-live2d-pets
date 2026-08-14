# ADR-002: 宠物挂载点与状态事件源

## Status

Accepted

## Date

2026-08-14

## Context

- 宠物必须悬浮于页面之上、可四角停靠、**不替换任何既有 UI**（replaceRisk 必须为 none）
- 状态镜像需要真实、可订阅的 DSH 事件源；spec 中写入的状态映射必须基于实际存在的事件
- 已通过 `Slots.listSubTree` 与 `Event.listEvents` 实测确认（2026-08-14）

## Decision

1. **Client 挂载点：Slot `shell.overlay`**
   - 实测契约：Frame-wide floating layer，above every column and outside their scroll containers；kind=list，scope=root，replaceRisk=none
   - 注册方式：`{ id, order?, label? }`，宠物以独立 id 注册为悬浮层条目
   - 设置入口：`settings.plugin.item`（插件配置卡）或 `settings.section`（独立设置页）

2. **Host 状态事件源（全部实测存在）：**

   | 宠物状态 | 事件 |
   |----------|------|
   | 思考中 | `agent/status`（status=running） |
   | 空闲 | `agent/status`（status=idle） |
   | 出错 | `agent/error` |
   | 完成 | `agent/turn-stopping` + `agent/status` running→idle 下降沿 |
   | （可选）等审批 | `approval/request` |
   | （可选）收到消息 | `agent/inbox/inserted` |

   Host 半区订阅上述事件，经包私有通道把状态推送给 Client 渲染层。

3. **Host→Client 状态推送机制**：Client→Host 方向为 `host.call`；Host→Client 事件推送的具体机制（事件桥 vs 轮询）在 spike 中验证，不阻塞 spec。

## Alternatives Considered

### 备选方案 A：`conversation.composer.dock`（composer 下方整行）

- Pros: 同为 list 型、replaceRisk=none
- Cons: 占用页面布局内的一行（非悬浮），宠物无法覆盖在其他内容之上；随会话滚动
- Rejected: 与"悬浮桌宠"定位不符

### 备选方案 B：sidebar / conversation 主槽位

- Pros: 空间大
- Cons: replaceRisk=shadows-shipped-ui，占用即替换既有 UI，违反"不打扰"
- Rejected: 不可接受

## Consequences

- `shell.overlay` 为 root 级悬浮层，宠物可独立于会话滚动与列布局，天然满足"四角停靠 + 悬浮"
- 状态映射与真实事件一一对应，spec 可直接引用事件名，实现阶段无需猜事件
- Host 半区承担事件订阅与状态归一化，Client 半区只管表现——职责边界清晰
- 遗留待验证：Host→Client 推送机制细节（spike）
