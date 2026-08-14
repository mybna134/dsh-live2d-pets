'use strict'

// DSH Live2D 宠物插件 — 入口占位
//
// 当前状态：
// - 可运行原型 = 动态插件 petsp-1（spike 全绿，见 docs/adr/003-spike-results-and-rendering-stack.md）
// - 本仓库的正式插件代码从下列切片开始落地（docs/spec/live2d-pet-v01.md）：
//   1. Host 状态机：agent/* 事件 → 宠物状态 + pet-state RPC（轮询通道，spike 已验证）
//   2. Client 渲染器：pixi 引导 + 模型加载 + 命中检测（spike 已验证：0.4.0 + pixi6 + Core4）
//   3. 气泡系统 + 触摸互动（命中区按模型动态识别，不硬编码名字）
//   4. 设置（开关/大小/位置/模型选择）+ 预设管理（src/presets/presets.json）
//
// 待决：插件打包/分发形态（cordis.yml 插件行 vs clientModules bundle vs npm 包）→ ADR-004

module.exports = {
  apply() {
    // 打包形态确定后填充（ADR-004）
  },
}
