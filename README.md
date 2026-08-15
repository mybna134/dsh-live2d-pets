# dsh-live2d-pets 🐾

[English](README.en.md) | 简体中文

[![npm](https://img.shields.io/npm/v/dsh-live2d-pets.svg)](https://www.npmjs.com/package/dsh-live2d-pets)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/dsh-live2d-pets.svg)](https://nodejs.org/)
[![GitHub release](https://img.shields.io/github/v/release/cyanfish-x/dsh-live2d-pets)](https://github.com/cyanfish-x/dsh-live2d-pets/releases)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-1f6feb)](https://github.com/topics/dsh-plugin)

DSH（DeepSeek Harness）的 Live2D 桌宠插件：**支持任意外部 URL 或本地模型地址加载 Live2D 模型**。

<p align="center">
  <img src="docs/media/hero.png" alt="dsh-live2d-pets 主视觉" width="920" />
</p>

## 特性

- **模型加载**：内置 5 条策展模型（Hiyori / Haru / Mao / Mark / Natori）+ 自定义条目；可用任意 `.model3.json` 的 **https / http URL**，或本机可达的本地模型地址
- **状态镜像**：宠物实时反映 agent 思考 / 空闲 / 出错 / 完成 / 等审批（动画 + 气泡，SSE 推送）
- **人设台词**：内置六种人设（傲娇 / 元气 / 天然呆 / 三无 / 温柔治愈 / 病娇），可在插件独有 JSONC 中自定义并热切换
- **互动陪伴**：分部位触摸反应 / 拖动停靠，任务完成庆祝；HitArea 不足时按包围盒五矩形空间回退分档
- **桌宠配置设置面板**：DSH 设置 →「桌宠配置」，开关 / 尺寸 / 渲染帧率 / 人设 / 模型列表 / 开发者选项；写入 `~/.dsh/settings.yaml`，即时生效
- **不打扰**：默认右下角、小尺寸、可拖动、可隐藏、标签页隐藏暂停渲染、限帧渲染、低配降级静态头像



## 快速开始



### 方式一：复制提示词让 agent 安装（推荐）

把下面这段提示词复制给你的 DSH agent（在 Web GUI 对话中直接粘贴即可），它会自己安装并验证：

```text
请帮我安装 dsh-live2d-pets 插件（DSH 的 Live2D 桌宠插件）：
1. 执行 dsh plugin --profile web add dsh-live2d-pets 安装
2. 执行 dsh plugin --profile web list，确认 dsh-live2d-pets 出现在已安装列表中
3. 告诉我安装结果；如果失败，请附上错误信息
```



### 方式二：手动安装

在终端执行（`web` profile 首次使用时自动初始化）：

```sh
dsh plugin --profile web add dsh-live2d-pets
```

安装后插件默认启用。启动 DSH：

```sh
dsh web
```

浏览器打开后，右下角会出现默认宠物（尺寸 160px）。当前默认模型为 Hiyori（Live2D 官方示例模型），首次加载需联网。

自定义模型：打开设置 →「桌宠配置」→「我的模型」，填写名称与 `.model3.json` 地址（外网 CDN、自建静态站或本机 HTTP 服务均可）。比例与默认差较多时可展开「空间分区覆盖（可选）」按字段微调五矩形（头/身/腿居中列 + 左右臂；0–1，留空用默认）；建议配合开发者选项「显示点击分区」对照色块。内置 Hiyori 已带居中分区预设。

### 配置设置

打开 **DSH 设置 →「桌宠配置」**，改完立刻生效，无需重启。

<p align="center">
  <img src="docs/media/settings-pet-config.png" alt="DSH 设置中的「桌宠配置」入口与面板" width="920" />
</p>

- **显示**：开关宠物
- **尺寸**：40–400px（默认 160）
- **渲染帧率**：30 / 60 / 不限制（默认 30）
- **人设台词**：切换内置或自定义人设；「自定义人设 ↗」编辑 `$DSH_HOME/live2d-pet-personas.json`，改完点「↻ 重新读取」
- **模型**：选内置策展模型，或在「我的模型」添加名称 + `.model3.json` URL（可选空间分区覆盖）
- **开发者选项**：调试面板、显示点击分区色块

### 卸载

```sh
dsh plugin --profile web remove dsh-live2d-pets
```



## 文档


| 需求        | 文档                                                                     |
| --------- | ---------------------------------------------------------------------- |
| 英文 README | `[README.en.md](README.en.md)`                                         |
| 产品意图      | `[docs/intent/live2d-pet-plugin.md](docs/intent/live2d-pet-plugin.md)` |
| 行为规格      | `[docs/spec/live2d-pet-v01.md](docs/spec/live2d-pet-v01.md)`           |
| 架构决策      | `[docs/adr/](docs/adr/)`（渲染栈见 ADR-003）                                 |
| 调研记录      | `[docs/research/](docs/research/)`（设置面板接入机制见 settings-tab.md）          |




## 技术栈

- pixi-live2d-display 0.4.0 + PixiJS 6.5.10 + Cubism Core 4（[ADR-003](docs/adr/003-spike-results-and-rendering-stack.md)）
- 客户端渲染于 DSH Web GUI 的 `shell.overlay` 悬浮层（视觉层 Popover 顶层，[ADR-005](docs/adr/005-pet-visual-top-layer-popover.md)），设置页注册于 `settings.section`（[ADR-002](docs/adr/002-pet-mount-and-state-source.md)）
- 状态推送：Host 订阅 `agent/*` 事件 → 同源 SSE `/api/live2d-pet/events`（[ADR-006](docs/adr/006-push-state-sse.md)）；标签页隐藏 / 失焦暂停渲染
- 设置持久化：Host `ctx.settings`（`~/.dsh/settings.yaml` 用户层覆盖 base）；传输走插件自身 API `/api/live2d-pet/settings`（settingsScope wire 白名单限制，见 [research 3.4/3.5](docs/research/settings-tab.md)）



## 许可

- **插件代码**：MIT
- **模型清单**：模型一律 URL 直载、不随包分发；清单门槛为「许可可标注」——每条记录许可类型与链接，NC（禁止商用）模型标注"仅限非商用"（清单见 `[src/presets/presets.json](src/presets/presets.json)`）
- **内置模型 Hiyori / Haru / Mao / Mark / Natori**：Live2D 官方示例模型，按[示例模型条款](https://www.live2d.com/eula/live2d-sample-model-terms_cn.html)使用（免费商用可，需标注著作权）
- **Live2D SDK**：按 [Live2D 官方条款](https://help.live2d.com/zh-CHS/sdk/)（免费商用，需遵守版权声明等）

