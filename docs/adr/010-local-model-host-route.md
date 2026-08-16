# ADR-010: 本地模型通过 Host 路由加载

## Status

Accepted

## Date

2026-08-16

## Context

README 声称支持“本机可达的本地模型地址”，但浏览器不能直接加载 `file://` 本地文件。用户希望直接填写本机硬盘绝对路径（如 `C:/models/foo/foo.model3.json`）来使用本地模型。

## Decision

采用 Host 路由方案，不建 junction：

- 用户自定义模型可填远程 URL 或**本地绝对路径**；
- 本地路径原样保存在 `custom-models.jsonc` 的 `modelUrl`；
- Host 根据自定义模型 id 将本地路径映射为同源虚拟 URL：

  ```text
  /pet-local-models/<customId>/<model3.json 文件名>
  ```

- 新增 `PET_LOCAL_MODELS_PREFIX = '/pet-local-models'` 前缀路由：
  - 按 `customId` 查找自定义模型；
  - 解析本地目录；
  - 安全校验相对路径，拒绝路径穿越；
  - 读取文件并返回给浏览器；
- `resolveModelUrl()` 对本地路径返回上述虚拟 URL，客户端照常通过同源 HTTP 加载。

## Alternatives Considered

### 备选方案 A：junction 链接到静态资源目录

- Pros：固定路径可见。
- Cons：依赖 Windows junction / 跨平台复杂；升级易丢；清理成本高。
- Rejected：Host 路由更简单、跨平台、不修改用户文件系统。

### 备选方案 B：让用户自己起本地 HTTP 服务

- Pros：实现零成本。
- Cons：用户负担大，体验差。
- Rejected：插件应直接支持本地路径。

## Consequences

- 用户可直接填写本地绝对路径加载模型；
- 浏览器始终只访问同源 HTTP URL，不暴露 `file://`；
- 需要处理本地路径失效时的加载失败提示；
- 本地模型资源（贴图、动作、物理）随模型目录相对路径一并可访问。
