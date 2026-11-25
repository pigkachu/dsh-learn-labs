# 工作单 · Lab 4 —— 落盘 + 编译：`build_c`（无前端版 forge）

> 前置：Lab 3 完成（`gen_c` 能从模型拿到 C 代码）。
> 产出：`build_c(spec, filename?)` —— 一句话规格 → 生成 C → 写进文件 → gcc 编译 → 返回产物路径。
> 做完这步，聊天框就是你的编译服务的输入输出。

---

## 0. 你会学到的机制

```
execute
  ├ gen_c_with_llm(spec)      → C 源码字符串        （Lab 3 已会）
  ├ 写文件到工作区             → .c
  ├ ctx.subprocess.spawn gcc  → .bin              （Lab 2 已会）
  └ 返回 object               → { source, executable, err_log }
```

三个新东西：**文件落盘**、**产物写哪**、**object 类型的工具输出**。

---

## S0. 产物写工作区（不是 `/tmp`）

判据很简单：**产物是用户要的东西吗？** 是 → 写工作区。

原因（按重要性）：

1. 工作区是**插件、bash 工具、用户、编辑器**四方唯一共享的地方。写在别处，用户拿到路径 `cd` 过去是空的。
2. `/tmp` 会被系统清理，重启就没了。
3. 插件跑在 DSH Host 进程里，`process.cwd()` 是整个服务器的 cwd，**不保证**是工作区 —— 所以路径必须是绝对路径。

本 Lab 的约定：工作区下 `forge-out/`，**每次调用一个独立子目录**（gcc 有中间产物，混在一起容易互相覆盖）。

---

## S1. 建目录

```ts
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'

mkdir(p: string, options?: { recursive?: boolean }): Promise<string | undefined>
mkdtemp(prefix: string): Promise<string>    // ★ 只有一个参数；prefix 是「路径前缀」
```

要求：

- `out_dir` 用 `import.meta.dirname`（= 插件目录 `forge/`）往上拼一层，得到工作区的 `forge-out/`。
- 先 `mkdir(out_dir, { recursive: true })` 保证父目录在，**忽略它的返回值**。
- 再 `mkdtemp(path.join(out_dir, 'forge-'))` 建本次的独立子目录。

**为什么忽略 `mkdir` 的返回值**：目录已存在时它返回 `undefined`。
如果写成 `out_dir = await mkdir(...)`，第二次调用 `out_dir` 就变 `undefined` 了 —— 这是本 Lab 真实踩过的坑。

---

## S2. 写 `.c` 文件

```ts
writeFile(file: string, data: string): Promise<void>   // 必须 await
```

可选参数 `filename`：

```js
if (args.filename === undefined) filename = 随机 4 位
```

**校验放哪**：放在 `execute` 的**最开头**，`gen_c_with_llm` 之前。

- 理由：文件名不合法是**参数问题**，不需要花一次模型调用才发现。
- 校验规则必须**锚定**：`/^[A-Za-z0-9_-]+$/`。不锚定的 `/…+/` 是"子串匹配"，`foo/bar`、`../evil` 都能混过去 —— 会把文件写到目录外面。

---

## S3. 编译

签名见 Lab 2（`ctx.subprocess.resolveExecutable` / `spawn` / `handle.done` / 采集模式）。

```js
argv: [gcc_path, filename_C, '-o', filename_BIN]
cwd: full_dir
stdio: { stdin: 'ignore', stdout: { maxBytes: 128 }, stderr: { maxBytes: 1024 } }
graceMs: 10000
signal: exec.signal
```

要点：

- **Windows 上产物后缀用 `.exe`**，不是 `.bin`（平台差异见 [`lab0-task.md`](lab0-task.md) 的 S7）。
- **`cwd` 设成本次的子目录**，`argv` 里用相对文件名 —— 路径短、不会串。
- 判成功：`exitCode === 0`。失败时**读 stderr**（gcc 的行号和原因都在 stderr）。
- 必须 `await handle.done`，否则你不知道编译成没成功。

---

## S4. 输出 object（第一次返回非字符串）

```js
output: {
  schema: {
    type: 'object',
    properties: {
      source:     { type: 'string', description: '源码路径' },
      executable: { type: 'string', description: '可执行文件路径' },
      err_log:    { type: 'string', description: '编译错误输出' },
    },
    required: ['source'],
  },
  render: (_args, value) => [ ... ],
}
```

两条硬规则：

1. **失败时给 `''`，不给 `null`**。schema 写了 `string`，返回 `null` → `ToolOutputError`，`render` 根本不会跑。
2. **`render` 必须返回 `ContentBlock[]`**，不是字符串。`[{ type: 'text', text }]`。

路径字段一律返回 `path.join(full_dir, name)` 的**绝对路径** —— 用户要能直接 `cd` 过去。

---

## S5. 复用，别复制（重构点）

`gen_c` 和 `build_c` 都要"调模型抽代码"，抽成模块级 helper：

```js
async function gen_c_with_llm(args, exec, ctx) { ... }   // 返回 C 源码字符串
```

`ctx` 必须**作为参数传进去**。模块顶层没有 `ctx`（Lab 1 的坑），helper 又不能从闭包拿 —— 传参是唯一选择。

---

## 验收

```
build_c({ spec: '读入两个整数，输出它们的和；只写 C 代码', filename: 'sum_final' })
→ /…/forge-out/forge-<随机>/sum_final.c
→ /…/forge-out/forge-<随机>/sum_final.bin
```

自测三件：

| 检查 | 怎么做 |
|---|---|
| 产物真存在 | 照返回的绝对路径 `ls` 一下，`.c` 和 `.bin` 都在工作区里 |
| 能直接跑 | `echo "31 11" \| <返回的 .bin 路径>` → 打印 `42` |
| 非法文件名不烧模型调用 | 传 `filename: "bad/name"`，应在调模型**之前**就报 `Error: 文件名格式错误` |

通过条件：产物在工作区里真实存在、能直接运行；非法文件名不会浪费一次模型调用。

---

## 排错对照表

| 症状 | 原因 |
|---|---|
| `ENOENT` 建临时目录失败 | `forge-out/` 父目录不存在 → 先 `mkdir(..., {recursive:true})` |
| 第二次调用后路径变 `undefined` / `path.join` 报 `ERR_INVALID_ARG_TYPE` | 把 `await mkdir(...)` 的返回值当路径用了（已存在时返回 `undefined`） |
| `ERR_INVALID_ARG_VALUE ... 'encoding'` | `mkdtemp(path, 'forge-')` 传了两个参数 —— 第二个参数是 options，前缀要拼进第一个参数 |
| `ERR_INVALID_ARG_TYPE` | `path.join([a, b])` 传了数组；`path.join` 是变参列表 |
| 返回相对文件名，用户找不到 | 返回的是 `filename_C` 而不是 `path.join(full_dir, filename_C)` |
| `ToolOutputError` | 失败时返回了 `null`（schema 是 string） |
| 编译报"找不到文件" | `writeFile` 漏了 `await`，gcc 读到空文件 |
| 编译失败但没错误信息 | 读的是 stdout；gcc 的报错在 stderr |
| `foo/bar`、`../evil` 通过了校验 | 正则没锚定，`^...$` 加上 |
| 非法文件名也烧了一次模型调用 | 校验在 `gen_c_with_llm` 之后；挪到 `execute` 开头 |

---

## 原理小结

| 概念 | 一句话 | OS 类比 |
|---|---|---|
| 产物落工作区 | 四方共享的持久面 | 用户目录，不是 `/tmp` |
| 每次独立子目录 | 隔离，避免互相覆盖 | 每次进程一个临时工作目录 |
| `cwd` + 相对文件名 | 命令行短、路径不串 | `chdir` 后再操作 |
| object 输出 | 结构化返回，`render` 负责呈现 | 结构化结果 + 格式化输出分离 |

**Lab 4 的结论**：生成、落盘、编译是三段可拆的能力。把它们写成 helper、把入口（tool）写成薄薄一层 —— Lab 6 的面板才能复用同一套内核。

> 对照实现：[`example/index.js`](../example/index.js) 里的 `compileC` —— 建目录、写文件、gcc、可选运行，从头到尾一段。
