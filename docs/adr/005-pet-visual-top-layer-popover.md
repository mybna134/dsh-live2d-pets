# ADR-005: 宠物视觉层挂载 — Popover API（浏览器顶层），回退 body portal

## Status

Accepted

## Date

2026-08-14

## Context

- 实测数据（spike pkg-7 探针）：
  - `shell.overlay` 容器（`.overlayLayer`）`position:absolute; z-index:20` → **创建层叠上下文，内部元素 z-index 被封顶在 20**
  - 已装插件 `dsh-better-sidebar` 浮层 z-index = 50~60 → **必然盖住留在 slot 内的宠物**（用户实测复现）
- 需求：宠物必须**始终在所有插件之上**，且不能靠 z-index 军备竞赛（今天 sidebar z=60，明天别的插件可能更高）
- ADR-002 选定的 `shell.overlay` 作为生命周期/设置锚点仍然成立，但**视觉层不能留在 slot 容器内**

## Decision

1. **视觉层采用 Popover API（浏览器原生 top layer）**：
   - `popover="manual"` 元素 + `showPopover()`，浏览器把元素渲染进 **top layer**——天然高于一切层叠上下文，**零 z-index**，免疫任意插件的覆盖
   - 非模态：不阻断页面其余交互、不锁焦点，多个顶层元素可共存；宠物/气泡/召唤按钮的正常交互不受影响
   - 兼容基线：Chrome 114+ / Safari 17.4+ / Firefox 125+（2024 年中起全绿；本环境 Chromium 实测可用）

2. **兼容回退**：运行时检测 `HTMLElement.prototype.showPopover`；不支持则回退为 **document.body portal + `z-index: 2147483647`**（2³¹-1，浏览器数值上限，pkg-7 已验证有效）

3. **保留 `shell.overlay` 注册**：作为生命周期与设置锚点（插件禁用/更新时 UI 随 fiber 卸载）；视觉元素经 popover/portal 脱离 slot 容器渲染

4. **已知边界（记录在案）**：`shell.overlay` 容器 z-index=20（实测）——所有留在该 slot 内的 UI 都可能被 z>20 的插件覆盖；这是平台现状，本插件的顶层元素不受影响

## Alternatives Considered

### 备选方案 A：留在 shell.overlay + 提高内部 z-index

- Pros: 无需改动挂载结构
- Cons: 被容器 z-index=20 的层叠上下文封顶（实测数据），**结构性不可行**
- Rejected: 实证否决

### 备选方案 B：document.body portal + z-index 封顶（pkg-7 已验证）

- Pros: 简单、实测有效（z=2147483647 压过一切）
- Cons: 仍是"数值竞争"而非"机制免疫"；若另一插件也用满值且 DOM 更靠后则仍可能被盖
- Rejected: 仅作旧浏览器回退

### 备选方案 C：纯 document.body 全局 root（dsh-pet 方案）

- Pros: 竞品实证可用
- Cons: 完全脱离 slot 系统，丢失生命周期/设置锚点
- Rejected: 我们保留 slot 注册（见 Decision 3）

## Consequences

- 宠物视觉层免疫一切插件覆盖（top layer 机制，非数值竞争）
- 浏览器兼容基线提升到 2024 中；旧浏览器自动降级 body portal（功能等价，仅实现机制不同）
- 实现提示：React 18 通过 `popover="manual"` 属性透传 + ref 调用 `showPopover()`；React 19 有原生支持
- **已实证的坑（pkg-9）**：UA 样式表给 `[popover]` 默认 `inset:0 + margin:auto`（自动居中），自定义定位必须显式重置：`inset:auto; margin:0; top/left/right/bottom 显式指定`，否则宠物会被居中而非停靠角落
- spike 验证项（pkg-8）：popover 元素在真实 DSH 页面覆盖 sidebar 的实证
