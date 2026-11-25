# DSH 插件开发实验课

用 **Lab 0 → Lab 6**，从一个空的 Linux 环境走到「工具 + 面板 + 受认证 HTTP 路由」全部自己写。

每一课是一份**工作单**：只给签名、契约和验收标准，**不给实现**。代码自己敲，卡住了要提示，不要答案。
（这套材料就是这样练出来的：学习者写代码；AI 讲概念、出工作单、审代码、装插件、触发重载、跑验证。）

---

## 你需要

| 项 | 要求 |
|---|---|
| DSH | 0.2.x（写这套材料时是 `0.2.2-rc.1`） |
| Node | ≥ 24.9（DSH 的 `engines` 要求） |
| 系统 | Linux 或 WSL2；有 `gcc`（Lab 4 开始用） |
| pnpm | 插件安装器内部要 `spawn pnpm` |
| 一个 AI 会话 | 装/重载插件靠 AI 的工具（`plugin_manager`），不是命令行 |

环境没搭好先做 Lab 0，别跳。

## 怎么用

1. 从 [`learn/lab0-task.md`](learn/lab0-task.md) 开始，**一次只读一节**，别通读。
2. 每节末尾有验收清单，过了再往下走。
3. 卡住了说「卡在哪一步」，问 AI 要提示，而不是让它把实现写出来。
4. 两类改动生效方式不同：Host 半边（`index.js`）改完**必须重载插件**；client 半边（`client.js`）改完**刷新页面**即可。

## 课程表

| Lab | 做什么 | 产出 | 学到 |
|---|---|---|---|
| [0](learn/lab0-task.md) | 裸 Linux 搭环境 | `dsh web` 能打开 GUI | Node / pnpm / profile |
| [1](learn/lab1-task.md) | 第一个工具 | `echo_text` | 插件骨架、tool 契约、热重载 |
| [2](learn/lab2-task.md) | 调宿主能力 | `sys_info` | `ctx.subprocess`、受管子进程 |
| [3](learn/lab3-task.md) | 调模型 | `gen_c` | `ctx.llm.stream` 流式、抽 markdown 围栏 |
| [4](learn/lab4-task.md) | 落盘 + 编译 | `build_c` | 产物写工作区、spawn gcc、object 输出 |
| [5a](learn/lab5a-task.md) | 裸 HTTP 路由 | `GET /forge/builds` | 路由表、`ctx.effect` 生命周期 |
| [5b](learn/lab5b-task.md) | 浏览器半边 | Forge 面板 | 两个进程、`slots` 席位、四态、stale closure |
| [6](learn/lab6-task.md) | 受认证路由 + 控制台 | `/api/forge/compile`、Compiler 面板 | `connection.fetch`、错误契约 |
| [6·S5](learn/lab6-s5-task.md) | 面板接线（单出一份） | 自然语言 → C → 编译 → 运行 | React 最小集、HTTP 契约 |

主线其实只有一条：**同一个能力，两个入口**。Lab 4 把能力做成工具（模型调），Lab 6 把它接到面板（人调）。

## 对照实现

跟着做完，你会自己造出那个插件（4 个工具 + 2 个面板 + 2 条 `/api` 路由）。
[`example/`](example/) 是我写的**另一份**参考实现，用在卡住时对照一两段 —— 不是作业，也不是标准答案。

| 文件 | 内容 |
|---|---|
| [`index.js`](example/index.js) | 4 个工具 + 2 条 `/api` 路由。入口薄、内核厚：`gen_c_with_llm` 碰模型，`compileC` 不碰 |
| [`client.js`](example/client.js) | 两个面板：构建列表（四态 + 刷新）、编译器（自然语言 → C → 运行） |
| [`package.json`](example/package.json) / [`cordis.patch.yml`](example/cordis.patch.yml) | 包声明与插件树补丁 |
| [`README.md`](example/README.md) | 每个文件对应哪一课、读的时候看什么 |

它和你自己的插件用同样的工具名和路由路径，**别同时装进同一个 profile**（会打架）。

工作单里写"本套材料用的写法"的地方（比如非 2xx + `{error}` 的错误约定、400/500 的分工），
意思是"这是一个能跑通的约定"；真做的时候，错误怎么表达、能力怎么分层，都可以按你的判断换 ——
只要 Host 和 Client 两边一致。

## 附录

- [`tool-schema-cheatsheet.md`](learn/tool-schema-cheatsheet.md) — 工具 schema 的受支持子集（写错 `JsonSchemaError`，整个插件起不来）
- [`tool-subprocess-api.md`](learn/tool-subprocess-api.md) — `subprocess` + 工具注册的签名
- [`tool-llm-api.md`](learn/tool-llm-api.md) — `llm` 流式 + 当前模型选择
- [`js-for-c-programmers.md`](learn/js-for-c-programmers.md) — 给 C 程序员的 JS 速查（只列会踩的差异）

## 仓库里没有的

作者自己跑通的那个插件（`forge/`）、构建产物（`forge-out/`）、旁支插件（`scratchpad-plugin/`）、
练习用的 `js-demos/`、`reference/`、`setup/`、`tools/`，以及会话记录（`PROGRESS.md` / `AGENTS.md`）
都不进公开仓库 —— 里面是个人取舍和过程痕迹，不是教程内容。
早期那几份独立文档（入门 / 知识地图 / 安装流程 / 两版 TUTORIAL）已被本套工作单取代。

这些规则写在 [`.gitignore`](.gitignore) 里 —— `git add .` 不会把它们带进仓库。

## 版本

针对 DSH `0.2.2-rc.1` 写。DSH 还在 rc 阶段，后续版本的工具契约、席位名、路由 API 可能变；
遇到不一致时以安装目录里的 `lib/types/*.d.ts` 和本机运行结果为准，别信本文档的旧记忆。
