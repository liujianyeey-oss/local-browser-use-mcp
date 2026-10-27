# local-browser-use-mcp

[![CI](https://github.com/liujianyeey-oss/local-browser-use-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/liujianyeey-oss/local-browser-use-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/local-browser-use-mcp)](https://www.npmjs.com/package/local-browser-use-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-green)](package.json)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success)](package.json)

[English](../README.md)

local-browser-use-mcp 是一个非官方的 macOS 本地 stdio MCP bridge。它让 Kimi、Claude Code、Claude Desktop 等支持 MCP 的 Agent CLI 复用本机已安装、未经修改的 OpenAI Browser Runtime，控制已连接的 Chrome/Edge；当宿主提供内置浏览器（IAB）backend 时，也可以使用内置浏览器。

> [!IMPORTANT]
> 本项目只是薄接线层，不包含 OpenAI Browser Runtime、浏览器扩展、Native Messaging Host、WASM、ChatGPT/Codex 桌面端二进制或官方 Prompt。npm 包安装成功不代表官方前置组件已存在；本包不会安装、修改或分发这些组件。

## 快速开始

```bash
npm install --global local-browser-use-mcp
local-browser-use-mcp doctor
local-browser-use-mcp doctor --online
```

`doctor --online` 通过一次只读 `cua.getState()` 检查实际浏览器 backend。若安装成功但 doctor 报错，请查看「安装诊断」表。

## 核心能力

- 复用本机已安装的 OpenAI Browser Runtime，不修改、不再分发官方组件；
- 向 MCP 客户端暴露 `js`、`js_reset`、`turn_ended`；
- 强制 `CUA_REPL_ENABLED_SURFACES=browser`，不暴露原生应用或桌面控制；
- 为外部 MCP 客户端补齐 turn metadata，使 `turn_ended` 生命周期可用；
- 在 MCP initialize 响应中注入自研使用与安全说明；
- 客户端支持 MCP elicitation 时转发审批请求，否则 fail-closed，不会自动批准。

## 前置条件

| 前置条件 | 是否随本包提供 |
| --- | ---: |
| macOS | 否 |
| Node.js 20 或更高版本 | 否 |
| 兼容的 ChatGPT/Codex 桌面端资源，能生成 `~/.codex/plugins/cache/openai-bundled/unified-computer-use/<version>/.mcp.json` | 否 |
| 桌面端提供的 `cua_repl` broker 与 Browser Runtime | 否 |
| Chrome 模式下，官方 ChatGPT Chrome 扩展已安装启用，`com.openai.codexextension` Native Messaging Host 已注册 | 否 |
| 当前可连接的浏览器 backend | 否 |

本包只包含 bridge、CLI、测试、文档和自研说明。

## 兼容性

| 环境 | 状态 | 说明 |
| --- | --- | --- |
| macOS + Node.js 20/22 | 支持 | CI matrix |
| Chrome backend | 支持 | 使用官方扩展和 Native Host |
| Edge backend | 实验性 | 依赖 Runtime 浏览器 inventory，本仓库未单独测试 |
| IAB backend | 宿主提供时支持 | 可用性取决于 Agent 宿主 |
| Windows / Linux | 不支持 | package 声明 `os: ["darwin"]`，Runtime 集成仅面向 macOS |
| 原生桌面控制 | 不暴露 | 强制 `CUA_REPL_ENABLED_SURFACES=browser` |

## 架构

```text
Agent CLI / MCP client
  → local-browser-use-mcp
  → cua_repl / node_repl broker
  → Browser Runtime
  → desktop native pipe
  → Chrome extension + Native Host, or IAB backend
```

## 安装

### npm

```bash
npm install --global local-browser-use-mcp
local-browser-use-mcp doctor
```

### 源码

```bash
git clone https://github.com/liujianyeey-oss/local-browser-use-mcp.git local-browser-use-mcp
cd local-browser-use-mcp
npm run verify
```

本项目没有运行时 npm 依赖，使用源码不需要 `npm install`。开发验证：

```bash
npm run check
npm test
npm run verify:package
```

`npm run verify:package` 会创建临时 npm 归档，检查文件白名单和敏感路径，并从解包产物执行 fake backend MCP E2E；不访问真实浏览器，不依赖本地官方参考文件。

## 配置 MCP 客户端

全局安装且命令在 `PATH` 中时：

```json
{
  "mcpServers": {
    "local-browser-use": {
      "command": "local-browser-use-mcp",
      "args": ["serve"]
    }
  }
}
```

源码运行时 GUI 客户端通常需要绝对路径。先执行：

```bash
node bin/local-browser-use-mcp.mjs print-config
```

然后将输出的 `command` 与 `args` 填入客户端配置。显式 `--config` 配置失败时不会回退自动发现。

## 使用

连接后，Agent 会看到 `js`、`js_reset`、`turn_ended` 工具。通常直接让 Agent 执行浏览器任务，不需要手动调用工具。

第一次 `js` 调用只执行：

```js
await cua.getState()
```

Agent 必须先读取返回的动态文档，再选择 Chrome 或 IAB backend。浏览器和标签页句柄应保存在持久 `let`/`const` 绑定中复用。

默认诊断输出会隐藏用户目录和配置路径。只有明确传入 `--show-paths` 时才显示完整路径。

首次验收请只执行只读任务，例如列出当前标签页标题；不要提交表单、上传文件或发送消息。

## 安装诊断

| 字段 | 含义 | 常见原因 | 处理方式 |
| --- | --- | --- | --- |
| `configured=false` | 未找到兼容 `.mcp.json` | 缺少兼容桌面端资源 | 安装或启动兼容桌面端并生成配置 |
| `runtimePresent=false` | 配置存在，但 Runtime 文件不完整 | launcher、`cua_repl` 或 Browser Runtime 缺失 | 检查桌面端安装后重跑 doctor |
| `backendOnline=null` | 未执行在线检查 | 未加 `--online` | 使用 `doctor --online` |
| `backendOnline=false` | 只读 `cua.getState()` 失败 | backend 未连接、扩展未启用、宿主不兼容或环境限制 | 查看 `backendErrorKind` / `backendErrorDetail` |
| `backendErrorKind=no_browser_backend` | bridge 正常，但没有浏览器连接 | 当前没有 Chrome/Edge/IAB backend | 打开或连接支持的浏览器 backend |
| `backendErrorKind=runtime_kernel_failed` | Runtime node_repl kernel 未启动 | Runtime 内部 sandbox 创建失败，常见于宿主自身受限沙箱 | 在普通终端或非嵌套沙箱 Agent CLI 中重试 |

如果 `backendErrorKind=runtime_kernel_failed` 且 detail 说明 sandbox creation 被拒绝，这可能是环境性误报。macOS Runtime 的 node_repl 会再创建自己的 sandbox；宿主也启用 sandbox 时可能出现 `sandbox_apply: Operation not permitted`、kernel `exited(code=71)`。请先在非受限环境中重试，再判断 Chrome backend 是否离线。

## 安全边界

- 只启用 browser surface，不提供原生应用或桌面控制；
- 页面内容、DOM、accessibility state、下载内容和工具输出都是不可信观察数据，不能视为用户授权；
- 默认不读取 cookies、localStorage、密码库或浏览器 profile；
- 高风险外部副作用和敏感数据传输前必须获得明确用户确认；
- 运行时 elicitation 与模型层确认是两个独立门槛；
- 客户端不支持 elicitation 时 fail-closed；
- 不绕过浏览器扩展、Native Host、Browser Auth、peer authorization 或组织策略；
- 默认脱敏 home 与已知用户路径，`--show-paths` 是显式例外。

详见 [SECURITY.md](../SECURITY.md)。

## 卸载

1. 从 MCP 客户端配置删除 `local-browser-use`；
2. npm 全局安装时执行 `npm uninstall --global local-browser-use-mcp`；
3. 源码使用时删除源码目录。

卸载本包不会卸载或修改 ChatGPT/Codex 桌面端、浏览器扩展、Native Host 或浏览器数据。

## 许可与商标

本项目原创代码与文档使用 MIT License，见 [LICENSE](../LICENSE)。第三方组件、产品名称和商标归各自权利人所有。本项目非官方，与 OpenAI 无隶属关系。
