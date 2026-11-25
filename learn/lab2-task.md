# 工作单 · Lab 2 —— 调宿主能力：`sys_info`（`subprocess`）

> 前置：Lab 1 完成（会注册工具、会重载）。
> 产出：`sys_info()` —— 无参数工具，跑 `uname -srm`，把宿主机信息返回给模型。
> 这一课开始**用 DSH 提供的能力**，而不是自己写 Node 的逻辑。

---

## 0. 你会学到的机制

DSH 插件不是"拥有权限"的，是**向宿主申请服务**。`subprocess` 是 DSH 的受管子进程服务：

- 它管生命周期（超时、取消、清理）；
- 它有**有界缓冲**（不会因为子进程狂输出把你的 Host 进程搞 OOM）；
- 它拿到的是**工具调用级的取消信号**（`exec.signal`）—— 用户中断时子进程一起死。

跟直接 `node:child_process` 的区别：那边你得自己处理超时、缓冲、信号。这里服务替你管。

---

## S1. 申请服务

```js
export const inject = ['tools', 'subprocess']
```

`inject` 里的名字是**服务名**（`ctx.subprocess` 存在的前提），不是包名。

> 到 Lab 6 结束时你的 `inject` 会是 `['tools', 'subprocess', 'llm', 'agentDefaultModel', 'webServer', 'connection']` ——
> 每加一个 Lab 就多申请一个服务。**改了 `inject` 必须重载**（和改 `apply` 一样，Host 半边不是热的）。

---

## S2. 写 `sys_info`

`parameters` 是空对象（没有输入）：

```js
parameters: { type: 'object', properties: {}, required: [] }
```

`execute` 里三步：

1. **解析可执行文件路径**
   ```ts
   ctx.subprocess.resolveExecutable(
     command: string,                          // 'uname'
     env?: Readonly<Record<string, string>>,
     signal?: AbortSignal,
   ): Promise<string>                          // 绝对路径
   ```
   为什么要它：直接给 `'uname'` 也常能用（走 PATH），但拿绝对路径有两个好处 ——
   `argv[0]` 明确、不受子进程环境变量影响。

2. **spawn**
   ```ts
   ctx.subprocess.spawn(spec: SubprocessSpawnSpec): SubprocessHandle

   interface SubprocessSpawnSpec {
     argv: readonly string[]   // 数组！不经过 shell
     cwd: string               // 必须已存在
     stdio: SubprocessStdio
     graceMs: number           // 正数毫秒，超时后的清理宽限
     signal?: AbortSignal      // 传 exec.signal
   }

   interface SubprocessStdio {
     stdin: SubprocessStdinMode
     stdout: SubprocessOutputMode
     stderr: SubprocessOutputMode
   }

   type SubprocessStdinMode  = 'ignore' | 'pipe' | { readonly data: string }
   type SubprocessOutputMode = 'pipe' | 'inherit' | { maxBytes: number }
   ```

   本 Lab 用**采集模式**（`{maxBytes}`）：输出进有界缓存，之后按偏移读。

3. **等退出再读结果**
   ```ts
   handle.done: Promise<SubprocessOutcome>     // { exitCode: number | null, signal: string | null }
   handle.collected.stdout.readFrom(0): { text, nextOffset, lossy }
   ```

   逻辑：`exitCode === 0` → 读 stdout 返回；否则把 stderr 抛出去（错误信息在 stderr，不在 stdout）。

成功时返回类似 `Linux ... x86_64` 的一行。

> Windows 没有 `uname`：把 `argv` 换成 `['cmd', '/c', 'ver']`。见 [`lab0-task.md`](lab0-task.md) 的 S7 平台差异表。

---

## 排错对照表

| 症状 | 原因 |
|---|---|
| `TypeError: ctx.resolveExecutable is not a function` | 方法在 `ctx.subprocess.resolveExecutable`，不在 `ctx` 上 |
| `handle.collected is undefined` 或 `collected.stdout` 不存在 | stdout 用了 `'pipe'` 或 `'inherit'`；采集模式才生成 `collected` |
| 拿到的 stdout 是空 | 忘了 `await handle.done` —— 进程还没退你就读了 |
| `spawn` 同步抛错 | `argv` 不是数组 / `cwd` 不存在 / `graceMs` 不是正数 |
| 退出码当布尔用 | 被信号杀死时 `exitCode === null`，不是 0 也不是 1 |
| 子进程不结束、一直挂着 | 没传 `signal: exec.signal`，用户中断传不下去 |

---

## 原理小结

| 概念 | 一句话 |
|---|---|
| `spawn` 不是 shell | `argv` 是数组，没有 `|` `>` `&&` 通配符；要 shell 语义得自己 spawn `bash -c` |
| 采集模式 vs 管道模式 | `{maxBytes}` → `collected.*.readFrom(0)`；`'pipe'` → 自己消费 Readable。**别混用** |
| 有界缓冲 | 超过 `maxBytes` 会保留尾部（`lossy: true` 提示丢过内容） |
| `exec.signal` | 工具调用级取消 —— 用户点停止，子进程跟着死 |

**Lab 2 的结论**：DSH 把"开进程"这件事做成了受管资源。你拿到的不是 root 权限，是**宿主允许你用的那一份能力**。

> 同一个 `spawn` 用法后面 Lab 4 还会复用（编译 gcc、跑 `.bin`），区别只是 `argv` 和 `stdio`。

> 对照实现：[`example/index.js`](../example/index.js) 里的 `sys_info`（`resolveExecutable` → `spawn` → `done` → `readFrom`）。
