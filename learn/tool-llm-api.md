# `llm` / 模型选择签名速查（DSH 0.2.2-rc.1）

只列签名与类型形状，不给实现。来源：
- `.../dsh-llm/lib/types/types.d.ts`（`GenerateOptions`、`StreamChunk`、`FinishReason`）
- `.../dsh-agent-default-model/lib/types/index.d.ts`（`ModelSelection`、`currentSelection`）
- `.../dsh-llm/lib/types/message.d.ts`（消息形状）

## 取服务

```js
export const inject = ['llm', 'agentDefaultModel']

ctx.llm                // LlmRuntime
ctx.agentDefaultModel  // AgentDefaultModelConfig
```

## 调模型

```ts
ctx.llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

```ts
interface GenerateOptions {
  provider: string
  model: string
  reasoningEffort?: string
  messages: RequestMessage[]      // 手写一段对话用 RequestUserInput
  system?: string                 // 一次性调用的系统提示词
  tools?: ToolSchema[]
  toolHistory?: ToolHistory
  temperature?: number
  maxTokens?: number
  stopSequences?: string[]
  signal?: AbortSignal            // 取消（工具里传 exec.signal）
  // 还有 purpose / metadata 等辅助字段，普通调用不用
}

// user 消息的最小形状（RequestUserInput）：
{
  role: 'user',
  content: [{ type: 'text', text: '……' }],
}
```

## 流式返回的 chunk

```ts
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: unknown }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason }

type FinishReason =
  | { kind: 'stop' }
  | { kind: 'tool-calls' }
  | { kind: 'max-tokens' }
  | { kind: 'aborted'; failure: LlmFailure }
  | { kind: 'error'; failure: LlmFailure }   // failure.message 可读
```

**要点**：`stream` 返回的是流，必须 `for await` 累积 `text-delta`；正常结束是 `finish`，错误也在 `finish.reason.kind`，不会以"返回值"形式给你。

## 当前默认模型

```ts
interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

ctx.agentDefaultModel.currentSelection(): ModelSelection
```

## 最小调用骨架（形状，不是完整实现）

```js
const { provider, model } = ctx.agentDefaultModel.currentSelection()
const chunks = ctx.llm.stream({
  provider,
  model,
  system: '……',
  messages: [{ role: 'user', content: [{ type: 'text', text: spec }] }],
  signal: exec.signal,
})
let text = ''
for await (const chunk of chunks) {
  if (chunk.type === 'text-delta') text += chunk.text
  else if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
    throw new Error(chunk.reason.failure?.message ?? '模型调用失败')
  }
}
```
