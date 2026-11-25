# `subprocess` / 工具签名速查（DSH 0.2.2-rc.1）

只列**签名和类型形状**，不给实现。全部来自 DSH 安装目录里的运行时类型声明
（`npm root -g` 下 `@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-*/lib/types/`）：
- `dsh-subprocess/lib/types/{index,types}.d.ts`
- `dsh-tools/lib/types/contracts.d.ts`
- `dsh-llm/lib/types/types.d.ts`

## 1. 取服务

```ts
// 插件里声明依赖：
export const inject = ['tools', 'subprocess']

// 之后：
ctx.subprocess                     // SubprocessRuntime
```

## 2. `SubprocessRuntime`（ctx.subprocess 的接口）

```ts
resolveExecutable(
  command: string,                                   // 绝对路径或裸命令名（走 PATH）
  env?: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<string>                                    // 返回规范化后的可执行文件路径

spawn(spec: SubprocessSpawnSpec): SubprocessHandle    // 同步返回句柄；参数非法时同步 throw

// 还有 terminalEnvironment() / spawnTerminal()（分配真终端），本 Lab 用不到
```

## 3. `SubprocessSpawnSpec`（spawn 的入参）

```ts
interface SubprocessSpawnSpec {
  argv: readonly string[]       // argv[0] 是程序；数组形式，不经过 shell
  cwd: string                   // 工作目录，必须已存在
  stdio: SubprocessStdio
  graceMs: number               // 正数毫秒；超时后的清理宽限
  signal?: AbortSignal          // 取消信号（工具里传 exec.signal）
  env?: NodeJS.ProcessEnv       // 在脱敏后的父环境上合并；通常不传
}

interface SubprocessStdio {
  stdin: SubprocessStdinMode
  stdout: SubprocessOutputMode
  stderr: SubprocessOutputMode
  control?: 'pipe'              // 需不需要独立字节通道；默认不需要
}

type SubprocessStdinMode =
  | 'ignore'                    // /dev/null
  | 'pipe'                      // 暴露 handle.stdin
  | { readonly data: string }   // 写入后关闭（批处理形状）

type SubprocessOutputMode =
  | 'pipe'                      // 暴露原始 Readable
  | 'inherit'                   // 直接继承父进程的 fd
  | {                           // 采集模式：有界缓存 + 偏移读取
      maxBytes: number          // 内存上限；溢出保留 TAIL
      spill?: { maxBytes: number }  // 可选：完整流落盘
    }
```

## 4. `SubprocessHandle`（spawn 的返回）

```ts
interface SubprocessHandle {
  stdin: Writable | undefined          // 仅 stdin:'pipe' 时存在
  stdout: Readable | undefined         // 仅 stdout:'pipe' 时存在
  stderr: Readable | undefined         // 仅 stderr:'pipe' 时存在
  control: Duplex | undefined
  collected: SubprocessCollectedOutputs   // 采集模式下的读取器
  done: Promise<SubprocessOutcome>        // 进程退出后 resolve
  terminate(): void                       // 触发受管终止
  waitForExit(signal?: AbortSignal): Promise<boolean>
}

interface SubprocessOutcome {
  exitCode: number | null      // 被信号杀死时为 null
  signal: NodeJS.Signals | null
}

interface SubprocessCollectedOutputs {
  stdout?: SubprocessOutputReader   // 仅 stdout 用采集模式时存在
  stderr?: SubprocessOutputReader
}

interface SubprocessOutputReader {
  readFrom(fromByte: number): SubprocessOutputRead
}

interface SubprocessOutputRead {
  text: string
  nextOffset: number
  lossy: boolean
  spillPath?: string
}
```

## 5. 工具注册相关签名

```ts
// ctx.tools.register(definition, options?) => disposer（卸载时自动撤销）
register(definition: ToolDefinition, options?: ToolRegistrationOptions): () => void

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>   // 受支持 JSON Schema 子集（见 tool-schema-cheatsheet.md）
  output: {
    schema: JsonSchemaNode
    render(args: unknown, value: JsonValue): ContentBlock[]
  }
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
}

// execute 的第二个参数（关键字段）
interface ToolRunContext {
  signal: AbortSignal        // 调用级取消信号；spawn 时传进去
  callId: ToolCallId
  name: string
  arguments: unknown
  agent?: Agent
  // 还有 deferContext() / concludeTurn()，一般工具用不到
}

interface TextBlock { type: 'text'; text: string }
type ContentBlock = TextBlock | /* reasoning/image/... 等 */ unknown
```

## 6. 两个容易误会的点

1. **`spawn` 不是 shell**：`argv` 是数组，没有管道、通配符、重定向、`&&`。要 shell 语义得自己 spawn `bash -c '...'`（本 Lab 不需要）。
2. **采集模式 vs 管道模式**：`stdout: { maxBytes }` → 用 `handle.collected.stdout.readFrom(0)` 读；`stdout: 'pipe'` → 自己消费 `handle.stdout` 可读流。别混用。
