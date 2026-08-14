# dsh-live2d-pets 🐾

DSH（DeepSeek Harness）的 Live2D 桌宠插件：**Agent 状态镜像 + 互动陪伴**。

> Live2D pet plugin for DeepSeek Harness — an agent state mirror with interactive companionship.

## 特性（v0.1）

- **状态镜像**：宠物实时反映 agent 思考 / 空闲 / 出错 / 完成 / 等审批（动画 + 气泡）
- **互动陪伴**：摸头 / 点击反应 / 拖动停靠，任务完成庆祝
- **预设模型**：宽松许可精选模型（许可卡片可查看）+ 支持加载任意模型 URL
- **不打扰**：小尺寸、四角停靠、一键隐藏、标签页隐藏暂停渲染、低配降级静态头像

## 文档

| 需求 | 文档 |
|------|------|
| 产品意图 | [`docs/intent/live2d-pet-plugin.md`](docs/intent/live2d-pet-plugin.md) |
| 行为规格 | [`docs/spec/live2d-pet-v01.md`](docs/spec/live2d-pet-v01.md) |
| 架构决策 | [`docs/adr/`](docs/adr/)（渲染栈见 ADR-003） |

## 技术栈

- pixi-live2d-display 0.4.0 + PixiJS 6.5.10 + Cubism Core 4（[ADR-003](docs/adr/003-spike-results-and-rendering-stack.md)）
- 客户端渲染于 DSH Web GUI 的 `shell.overlay` 悬浮层（[ADR-002](docs/adr/002-pet-mount-and-state-source.md)）
- 状态推送：Host 订阅 `agent/*` 事件 → Client 轮询拉取

## 许可

- **插件代码**：MIT
- **预设模型**：各自许可（见 [`src/presets/presets.json`](src/presets/presets.json)，逐一核实"可再分发"后定稿）
- **Live2D SDK**：按 [Live2D 官方条款](https://help.live2d.com/zh-CHS/sdk/)（免费商用，需遵守版权声明等）

## 状态

⚠️ **开发中**：技术验证（spike）已全部通过（WebGL / 模型渲染 / 状态拉取 / 触摸命中），进入正式实现阶段。
