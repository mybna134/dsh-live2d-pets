# ADR-006: Host→Client 状态传输由轮询改为 SSE 推送

## Status

Accepted

## Date

2026-08-15

## Context

- v0.1 客户端用 **800ms 轮询**拉取 `GET /api/live2d-pet/state`（ADR-003 spike 验证、ADR-004 固化）
- 轮询的代价：
  - 固定的 ≤800ms 状态延迟，与 spec §3「状态变化即时反映（事件驱动，无轮询延迟感知）」矛盾
  - 空闲时每 800ms 一次 fetch + JSON 解析，长时间停留持续消耗主线程/网络；配合旧版「每轮询重启状态动画」的缺陷，表现为长时间停留后页面卡死
- `dsh-host-webserver` 是裸 `node:http` 服务（无响应超时/缓冲/Content-Length 强制，`await route.handler` 后即可流式写），天然支持 SSE

## Decision

1. **Host 新增同源 SSE 端点 `GET /api/live2d-pet/events`**：
   - 连接即回发当前快照（`data:` 帧），之后每次服务变化（状态/显示/配置）推送新快照
   - `retry: 3000` 指示 EventSource 重连间隔；30s 心跳注释帧（`: ping`）保持连接活性
   - 连接断开（req/res close）时退订并清理心跳；`res` error 吞掉避免写后抛异常
2. **PetService 提供变更订阅**：`onChange(listener)`（状态/显示变化自动触发）+ `notifyConfigChanged()`（设置写入路径在 `ctx.settings.mutate` 完成后调用）
3. **客户端以 EventSource 订阅替代 setInterval 轮询**：断线由浏览器自动重连，重连后首帧即全量快照，无需补偿拉取；初始首帧仍走 `GET /state`（同时作 EventSource 不可用时的降级）
4. **路由生命周期**：`makePetRoutes` 增加可选 `onStream` 钩子，插件卸载时关闭全部活跃流，避免路由注销后旧流空转心跳
5. **落实 spec §7**：标签页隐藏/窗口失焦 → 停 PIXI ticker（暂停渲染循环），恢复时继续；此前实现只停了轮询、渲染从未暂停

## Alternatives Considered

### WebSocket

- Pros: 双向通信
- Cons: 需自实现握手/心跳/重连；状态推送是单向场景，用不上双向能力；EventSource 自带自动重连与 `retry`
- Rejected

### 保留轮询

- Pros: 实现最简单
- Cons: 固定 ≤800ms 延迟 + 空闲持续请求，与 spec「无轮询延迟感知」矛盾
- Rejected

## Consequences

- 状态延迟从 ≤800ms 降至推送即达；空闲时网络/主线程开销趋近于零（仅心跳注释帧）
- 客户端复杂度小幅上升（EventSource 生命周期纳入 boot 清理，disposed 守卫覆盖）
- 推送需保持幂等：`applyConfig`/`applyState` 均为 diff/一次性语义，重复帧无害
- 插件 HMR/卸载时旧流由 `onStream` 钩子统一关闭

## 关联

- Supersede：ADR-004 第 4 条「通信为同源 fetch 轮询（800ms）」被本决策取代；ADR-003 spike 记录的历史轮询结论不变（历史事实）
- Spec §9 技术边界「状态传输」条目指向本决策
