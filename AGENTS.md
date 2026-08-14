# dsh-live2d-pets

DSH 的 Live2D 桌宠插件项目（文档驱动开发）。

## 必读文档

| 需求 | 文档 |
|------|------|
| 产品意图 | docs/intent/ |
| 行为规格 | docs/spec/ |
| 架构决策 | docs/adr/ |

改用户可感知行为 → 同步 spec；改产品意图/范围 → 同步 intent；架构/技术取舍 → 新增或更新 ADR。
纯样式/文案/重构且行为不变可不写文档；若已有 spec 写到相关细节则顺手改。
意图不清时先澄清再落文档，禁止先写代码再补文档。

## 工程约定

- 依赖安装统一用 **bun**（`bun install`），**不要用 npm**（npm 在本机缓存目录有权限问题）。
- 本环境（DSH 沙盒）下 bun 写系统临时目录会被拒：安装时把 `BUN_TMPDIR`/`TMP`/`TEMP` 指向工作区 `.bun-tmp`，`BUN_INSTALL` 指向工作区 `.bun-home`（两者已 gitignore，装完可删）。
- 本环境（DSH 沙盒）禁止创建子进程（named-pipe 限制），vitest 默认 forks pool 会 `spawn EPERM`：`test` 脚本固定 `--pool=threads`（worker_threads 不 spawn 子进程），不要改成 forks，也不要加会被 vite 打包的 vitest.config.*（其配置加载阶段同样 spawn）。
