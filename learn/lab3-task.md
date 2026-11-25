# 工作单 · Lab 3 —— 调模型：`gen_c`（`llm` 流式）

> 前置：Lab 1、2 完成（会注册工具、会用 `subprocess`）。
> 产出：`gen_c(spec)` —— 一句话规格 → C 代码字符串。
> 这一课第一次让插件**自己调模型**，而且是**流式**的。

---

## 0. 你会学到的机制

```
你的 execute ──ctx.llm.stream(options)──▶ 异步迭代器
                                            ↓ 一段一段地吐
                       chunk: text-delta ... text-delta ... finish(stop)
```

三件事和 Lab 2 的 `spawn` 很像：**异步、分段、有终止状态**。
区别是这里没有进程，只有一个可迭代的流；终止状态在 `finish` chunk 里，而不是 `exitCode`。

---

## S1. 申请服务

```js
export const inject = ['tools', 'subprocess', 'llm', 'agentDefaultModel']
```

> 到 Lab 6 这个数组会更长（Lab 5 加了 `'webServer'`，Lab 6 又加了 `'connection'`），因为所有 Lab 都堆在同一个包里。

- `llm` —— 调模型。
- `agentDefaultModel` —— 拿到"当前会话选的模型"，不然你不知道该调哪个 provider/model。

---

## S2. 取当前模型

```ts
ctx.agentDefaultModel.currentSelection(): ModelSelection
// ModelSelection: { provider: string, model: string, reasoningEffort?: string }
```

同步方法，不返回 Promise。

---

## S3. 发起流式调用

```ts
ctx.llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

`GenerateOptions` 的必填项（其余可选）：

```ts
interface GenerateOptions {
  provider: string              // 从 currentSelection() 来
  model: string
  messages: RequestMessage[]    // [{ role: 'user', content: [{ type: 'text', text: '...' }] }]
  system?: string               // 一次性调用的系统提示
  signal?: AbortSignal          // 传 exec.signal，用户中断能传下去
  maxTokens?: number            // 可选：输出上限
}
```

**流的事件类型**（`for await` 拿到的 chunk，按 `type` 区分）：

```ts
type StreamChunk =
  | { type: 'block-start';  index: number; blockType: string }
  | { type: 'text-delta';   index: number; text: string }      // ★ 正文，连字符
  | { type: 'reasoning-delta'; ... }
  | { type: 'tool-call-delta'; ... }
  | { type: 'block-end';    index: number; block: ContentBlock }
  | { type: 'usage';        usage: TokenUsage }
  | { type: 'finish';       reason: FinishReason }             // ★ 终止
```

`FinishReason.kind` 有五种：

| kind | 含义 | 带 failure？ |
|---|---|---|
| `stop` | 正常结束 | 否 |
| `tool-calls` | 模型要调工具（我们没给工具，一般不会出现） | 否 |
| `max-tokens` | 被 `maxTokens` 截断 | 否 |
| `aborted` | 被取消（用户中断） | 是 |
| `error` | 出错 | 是 |

**关键**：适配器内部可能 `throw`，但 `stream()` 会把它**规范化成 `finish` 里的 `error`/`aborted`**。
所以你在 `for await` 里要判 `finish.reason.kind`，而不是只靠 `try/catch`。

---

## S4. 从文本里抽出代码

模型会包一层 markdown 围栏，直接返回整段没法编译。要抽：

```
```c
int main() { ... }
```
```

思路：用正则匹配围栏内容、`trim()`、匹配不到就报错。

**必须用正则字面量**（`/.../`），不能写成字符串（细节见排错表）。

---

## 验收

```
gen_c({ spec: '写一个求两个整数最大公约数的 C 程序' })
→ 一段 C 代码
```

自测方法：把返回的代码存成 `.c`，`gcc` 编译后跑通（例如让模型写 GCD 程序，输入 `12 18` 应打印 `6`）。

也就是说：**返回值必须能直接被 gcc 编译** —— 这就是下一课 Lab 4 要做的事。

---

## 排错对照表

| 症状 | 原因 |
|---|---|
| 模型收到的像"用户说的内容不对" | 传了 `spec` 变量而不是 `args.spec` |
| 一个字符都收不到 | 判的是 `'text_delta'`，正确的是 `'text-delta'`（连字符） |
| 抛错信息是乱码/undefined | 拼写错误掩盖了真实原因（比如把 `reason` 写成 `reasion`） |
| 正则永远匹配不到 | 把正则写成了字符串：`'/```c?([\s\S]*?)```/'` —— `String.match` 会隐式 `new RegExp`，字符串里 `\s` 退化成 `s`。用字面量 `/```c?([\s\S]*?)```/` |
| 匹配结果为 `null` 时崩了 | 没判空；输出可能被解释文字包着、或者被 `max-tokens` 截断 |
| 用户点停止后模型还在跑 | 没把 `exec.signal` 传进 `stream(options)` |
| `ReferenceError: ctx is not defined` | 把调用写进了模块级 helper，但没把 `ctx` 作为参数传进去 |

---

## 原理小结

| 概念 | 一句话 |
|---|---|
| 流式 | 结果分块到达，不是一次性返回 |
| `text-delta` | 增量正文，拼起来才是完整回答 |
| `finish.reason` | 终止原因，流结束时会报，失败也在这里报 |
| `signal` | 取消传播：用户停，模型调用跟着停 |
| `maxTokens` | 输出上限，超了会被截断 |

**为什么这样分**：`gen_c_with_llm` 返回**纯字符串**（已 `trim()` 的代码），正好对上 `gen_c` 的
`output.schema = { type: 'string' }`；Lab 4 的 `build_c` 调它拿代码，再自己写文件 + 编译，
所以这个 helper 从第一天起就不该碰"文件"和"编译" —— 这就是下面那句结论的由来。

**Lab 3 的结论**：模型的输出是"文本流"，不是"程序输出" —— 要把它变成可用的东西，得自己定格式并校验（这里就是抽围栏 + 失败即抛错）。

> 设计上值得记住的一点：**为什么不在插件里直接编译？** 因为 Lab 3 只做"生成"，生成和编译解耦后，Lab 4 才能复用同一个 `gen_c_with_llm` helper。后面 Lab 6 的面板又要复用同一个核心 —— 能力要函数化，别焊死在入口上。

> 对照实现：[`example/index.js`](../example/index.js) 里的 `gen_c_with_llm` 和 `extractCode`。
