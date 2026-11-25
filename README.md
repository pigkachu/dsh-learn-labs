# DSH 插件开发实验课

> 跟着做完，你会亲手写出一个完整的 DSH 插件：**4 个工具 + 2 个面板 + 2 条受认证路由**，
> 并且知道它为什么这么分层。

每一课是一份**工作单**：只给签名、契约和验收标准，**不给实现**。代码自己敲，卡住了要提示，不要答案。
（这套材料就是这么练出来的：学习者写代码，AI 当助教 —— 讲概念、审代码、装插件、跑验证。）

---

## 为什么学这个

学完带走三样东西。

**① 知道插件能往哪儿加东西**

插件 ≠ "给模型加个 tool"。真正的插件是**往宿主上加入口**：工具、面板、斜杠命令、设置页、定时任务、事件 ——
入口不同，底下复用同一套能力。很多人第一课就卡在"以为插件只有 tool"。

**② 会用宿主的能力，而不是重造轮子**

模型、子进程、会话、存储、认证都由 Host 提供，你只写业务那一层。
`ctx.llm` / `ctx.subprocess` / `ctx.tools` 就是宿主给你的接口，`inject` 声明你要用哪几个 ——
不声明就 `undefined`，调用直接报错，这是最直接的反馈。

**③ 能分清进程和边界**

Host（Node 进程，能读文件、跑 gcc、调模型）和 Client（浏览器，只能画界面、发请求）是**两个程序**，
中间只有 JSON 能过。分不清这个，面板白屏时你只能猜；分清了，你一眼就知道是哪半边出了问题。

---

## 都在 vibe coding，为什么还要自己学

AI 已经能把这个插件的代码写出来。那为什么还要自己敲一遍？因为**能跑**、**知道它为什么能跑**、**坏了知道查哪**是三件事。

- **能提要求**：插件怎么分层、入口是什么、错误怎么表达 —— 这些是设计决定，AI 按你的话做。
  你不懂这些词，就只能说"随便写个能用的"，然后拿到一个只能用的。
- **能验收**：AI 说"改好了"不算数。一次请求是 401 还是 500、body 空不空、是 Host 没重载还是 Client 没刷新 ——
  这些现象你得知道往哪儿看。
- **能兜底**：面板白屏、重载报 `duplicate route`、schema 校验不过 —— AI 也得靠你贴的报错和描述的现象才能查。
  你至少得知道问题出在哪半边。

结论：vibe coding 省的是**打字**，不是**判断**。这套材料的写法就是「AI 当助教、代码你敲」——
一路都可以让 AI 解释、审、装、验，但设计、验收、排错这三件事得落在你身上。

---

## 你会做出什么

同一个能力，两个入口 —— 这是整条线的主线：

```
       对话里（模型调）                          面板上（人调）
   build_c({ spec })  ──┐                  ┌── 编译器：一句话 → C → 编译 → 运行
                        ├── 同一个核心 ────┤
   gen_c_with_llm ──────┘                  └── 构建列表：forge-out/ 里的产物
```

面板不经过模型，走的是 `/api/forge/*` 两条受认证路由 —— 但调的是同一个核心。

最终产物：

| | 是什么 |
|---|---|
| 4 个工具 | `echo_text` / `sys_info` / `gen_c` / `build_c` |
| 2 个面板 | 构建列表（四态 + 刷新）、编译器（自然语言 → C → 编译 → 运行） |
| 2 条路由 | `GET /api/forge/builds`、`POST /api/forge/compile` |

---

## 开始之前

| 项 | 要求 |
|---|---|
| DSH | 0.2.x（写这套材料时是 `0.2.2-rc.1`） |
| Node | ≥ 24.9（DSH 的 `engines` 要求） |
| 系统 | Linux / WSL2 / Windows 都行；有 `gcc`（Lab 4 开始用） |
| pnpm | 插件安装器内部要 `spawn pnpm` |
| 一个 AI 会话 | 装/重载插件靠 AI 的工具（`plugin_manager`），不是命令行 |

环境没搭好先做 Lab 0，别跳。

## 怎么用

1. 从 [`learn/lab0-task.md`](learn/lab0-task.md) 开始（Linux / WSL2 / Windows 都在里面）。**一次只读一节**，别通读。
2. 每节末尾有验收清单，过了再往下走。
3. 卡住了说「卡在哪一步」，问 AI 要提示，而不是让它把实现写出来。
4. 两类改动生效方式不同：Host 半边（`index.js`）改完**必须重载插件**；client 半边（`client.js`）改完**刷新页面**即可。

---

## 课程表

| Lab | 做什么 | 产出 | 学到 |
|---|---|---|---|
| [0](learn/lab0-task.md) | 搭环境（Linux / WSL2 / Windows 三选一） | `dsh web` 能打开 GUI | Node / pnpm / gcc / profile |
| [1](learn/lab1-task.md) | 第一个工具 | `echo_text` | 插件骨架、tool 契约、热重载 |
| [2](learn/lab2-task.md) | 调宿主能力 | `sys_info` | `ctx.subprocess`、受管子进程 |
| [3](learn/lab3-task.md) | 调模型 | `gen_c` | `ctx.llm.stream` 流式、抽 markdown 围栏 |
| [4](learn/lab4-task.md) | 落盘 + 编译 | `build_c` | 产物写工作区、spawn gcc、object 输出 |
| [5](learn/lab5-task.md) | Host 路由 + 浏览器面板 | `GET /forge/builds` + Forge 面板 | 路由表、`ctx.effect`、两个进程、`slots` 席位、四态、stale closure |
| [6](learn/lab6-task.md) | 受认证路由 + 控制台面板 | `/api/forge/*` + 自然语言 → C → 编译 → 运行 | `connection.fetch`、错误契约、React 最小集 |

主线只有一条：**同一个能力，两个入口**。Lab 4 把能力做成工具（模型调），Lab 6 把它接到面板（人调）。

---

## 给 AI 的

这套材料本来就是"AI 当助教、你写代码"练出来的。把仓库交给你的 AI，让它先读 [`AI-GUIDE.md`](AI-GUIDE.md)：
里面写了它的角色（**只给签名和审查，不代写**）、每轮流程、只有它能做的装 / 重载 / 验证操作，以及常见坑。

仓库根目录还有一份 `AGENTS.md`，只做一件事：指向 `AI-GUIDE.md`（不放正文，免得和维护两份）。
DSH、Codex 这类会自动加载 `AGENTS.md` 的 AI 看到它就知道该先读哪份。

## 对照实现

跟着做完，你会自己造出那个插件。[`example/`](example/) 是另一份参考实现，用在卡住时对照一两段 —— 不是作业，也不是标准答案。

| 文件 | 内容 |
|---|---|
| [`index.js`](example/index.js) | 4 个工具 + 2 条 `/api` 路由。入口薄、核心厚：`gen_c_with_llm` 碰模型，`compileC` 不碰 |
| [`client.js`](example/client.js) | 两个面板：构建列表（四态 + 刷新）、编译器（自然语言 → C → 运行） |
| [`package.json`](example/package.json) / [`cordis.patch.yml`](example/cordis.patch.yml) | 包声明与插件树补丁 |
| [`README.md`](example/README.md) | 每个文件对应哪一课、读的时候看什么 |

它和工作单里的插件用同样的工具名和路由路径，**别同时装进同一个 profile**（会打架）。

工作单里写"本套材料用的写法"的地方（比如非 2xx + `{error}` 的错误约定、400/500 的分工），
意思是"这是一个能跑通的约定"；真做的时候，错误怎么表达、能力怎么分层，都可以按你的判断换 ——
只要 Host 和 Client 两边一致。

## 附录

- [`tool-schema-cheatsheet.md`](learn/tool-schema-cheatsheet.md) — 工具 schema 的受支持子集（写错 `JsonSchemaError`，整个插件起不来）
- [`tool-subprocess-api.md`](learn/tool-subprocess-api.md) — `subprocess` + 工具注册的签名
- [`tool-llm-api.md`](learn/tool-llm-api.md) — `llm` 流式 + 当前模型选择
- [`js-for-c-programmers.md`](learn/js-for-c-programmers.md) — 给 C 程序员的 JS 速查（只列会踩的差异）

## 仓库结构

```
README.md                 这篇
AI-GUIDE.md               给 AI 的带课说明
AGENTS.md                 指向 AI-GUIDE.md 的入口提示
learn/lab0 … lab6.md      7 份工作单
learn/tool-*.md           3 份 API 速查
learn/js-for-c-*.md       给 C 程序员的 JS 速查
example/                  参考实现（Host + Client）
```

构建产物、本地练习材料不在仓库里，见 `.gitignore`。

## 版本

针对 DSH `0.2.2-rc.1` 写。DSH 还在 rc 阶段，后续版本的工具契约、席位名、路由 API 可能变；
遇到不一致时以安装目录里的 `lib/types/*.d.ts` 和本机运行结果为准，别信本文档的旧记忆。

## 署名

这套材料的**文本全是 AI 写的**：在 DSH 会话里由 AI 助手（`deepseek-flash`）撰写，没有人类捉刀。

人类做的事情是：定目标、提意见、验收 ——「这段太密」「别用 OS 类比」「加个 Windows 课」——
以及跟着工作单自己写那个不进仓库的插件。**文字本身没有人逐句校对过**，
所以读着有 AI 腔、有鱼腥味，那是 AI 的锅，不是仓库主人的人设。

`example/` 的参考实现也是 AI 写的，在真实 DSH 里跑过（宿主半边真调工具，两个面板在浏览器里验过）。
发现哪句空、哪段绕、哪里和代码不一致，直接提 issue，让它改成能看的样子。
