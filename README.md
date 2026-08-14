# dsh-live2d-pets 🐾

DSH（DeepSeek Harness）的 Live2D 桌宠插件：**Agent 状态镜像 + 互动陪伴**。

> Live2D pet plugin for DeepSeek Harness — an agent state mirror with interactive companionship.

## 特性（v0.1）

- **状态镜像**：宠物实时反映 agent 思考 / 空闲 / 出错 / 完成 / 等审批（动画 + 气泡）
- **互动陪伴**：摸头 / 点击反应 / 拖动停靠，任务完成庆祝
- **模型清单**：策展模型 URL（默认 Hiyori，条目展示许可类型与链接，NC 模型标注"仅限非商用"）+ 支持加载任意模型 URL
- **不打扰**：小尺寸、四角停靠、一键隐藏、标签页隐藏暂停渲染、低配降级静态头像

## 快速开始

在 DSH 中安装插件（`web` profile 首次使用时自动初始化）：

```sh
dsh plugin --profile web add dsh-live2d-pets
```

安装后插件默认启用。启动 DSH：

```sh
dsh web
```

浏览器打开后，右下角会出现默认宠物（尺寸 160px）。当前默认模型为 Hiyori（Live2D 官方示例模型），首次加载需联网。

### 自定义配置

编辑 web profile 的用户 patch 层（未设置 `$DSH_HOME` 时为 `~/.dsh/profiles/web/cordis.patch.yml`），按 id 覆盖插件配置——**patch 会整体替换 `config`，未改字段也要一并重述**：

```yaml
- id: live2d-pet
  config:
    enabled: true        # 总开关
    size: 160            # 宠物尺寸（px），范围 40–400
    corner: bottom-right # 默认停靠角：bottom-right / bottom-left / top-right / top-left
    model: https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Hiyori/Hiyori.model3.json
    debug: false         # 调试面板（开发用）
```

> `model` 支持 **`.model3.json` URL**。当前默认值为 Hiyori（Live2D 官方示例模型，首次加载需联网）；模型清单见 [`src/presets/presets.json`](src/presets/presets.json)。保存即热生效（HMR），无需重启。

### 卸载

```sh
dsh plugin --profile web remove dsh-live2d-pets
```

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
- **模型清单**：模型一律 URL 直载、不随包分发；清单门槛为「许可可标注」——每条记录许可类型与链接，NC（禁止商用）模型标注"仅限非商用"（清单见 [`src/presets/presets.json`](src/presets/presets.json)）
- **默认模型 Hiyori**：Live2D 官方示例模型，按[示例模型条款](https://www.live2d.com/eula/live2d-sample-model-terms_cn.html)使用（免费商用可，需标注著作权）
- **Live2D SDK**：按 [Live2D 官方条款](https://help.live2d.com/zh-CHS/sdk/)（免费商用，需遵守版权声明等）
