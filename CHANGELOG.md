# Changelog

## [0.1.1] - 2026-08-14

### Changed
- 模型边界：预设从「可再分发、随包分发」改为「策展模型 URL 清单（纯 URL 直载、不打包）」；清单门槛降为「许可可标注」（NC 模型标注"仅限非商用"），默认模型 Hiyori（商用安全）
- 依赖安装改用 bun（替换 npm）

### Added
- README 快速开始：提示词安装方式（复制给 DSH agent 自动安装）+ 手动安装 + 自定义配置 + 卸载

### Removed
- npm 锁文件（package-lock.json），改用 bun.lock
