# 工作单 · Lab 1 —— 第一个工具：`echo_text`

> 前置：DSH 已装（0.2.x 均可）、**Node ≥ 24.9**（DSH 的 `engines` 要求）、Linux/WSL2、`pnpm` 可用（装插件要用它）。
> 产出：一个能被模型调用的工具 `echo_text`，能把文字重复 n 次。
> 这是整条线第一次接触 DSH 插件：**插件骨架 + 工具契约 + 热重载**。

---

## 0. 你会学到的机制

```
用户说话 → 模型决定调用工具 → DSH 校验参数 → 你的 execute(args, exec) → 返回值校验 → render → 模型看到文本
```

在 DSH 里，插件就是一个 Cordis 模块：露出 `inject`（我要哪些服务）和 `apply(ctx)`（我做什么）。
`ctx` 是服务容器 —— 类似进程里已经初始化好的"内核对象表"。

---

## S0. 插件骨架（三个文件）

目录随意，跟包名无关。下面用 `forge/` 当例子（这个名字只是习惯，不要求）：

### `package.json`

```json
{
  "name": "@learn/forge",
  "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- `type: "module"` —— 插件是 ESM，用 `import`。
- `dsh.bundle.patch` —— 告诉 DSH"装这个包时要往插件树里插什么"。

### `cordis.patch.yml`

```yaml
- insert:
    - id: forge
      name: '@learn/forge'
```

这一行就是"把这个包作为一个插件节点插进 DSH 的插件树"。`id` 是**实例名**（随便叫，这里叫 `forge`），`name` 是要加载的**包名**。

> 名字只有一个：**`@learn/forge`**。`package.json` 的 `name`、这里的 `name`、profile 里依赖的键，三处必须一致。
> 后面 Lab 5b 的 client 半边还要第四处一致：`__ModuleLoader__.load({ id: '@learn/forge' })`。不一致是公开插件的第一大坑。

### `index.js`

```js
export const inject = ['tools']        // 我要什么服务

export function apply(ctx) {           // DSH 会调用它
  // 在这里注册东西
}
```

**要点**：`ctx` 只存在于 `apply` 里。**模块顶层写 `ctx.xxx` 会 `ReferenceError`** —— 这是新手第一个坑（OS 类比：`ctx` 是进程初始化后才有得指针，不是全局变量）。

装进 profile（`plugin_manager(action:"install_bundle", target:"<插件绝对路径>")`），DSH 会重启组合并加载你的插件。
装完可以看一眼 profile 的 `package.json`（`~/.dsh/profiles/web/package.json`）：多了 `"@learn/forge": "link:<你的目录>"`，
`dsh.profile.bundles` 里也多了 `"@learn/forge"`。

---

## S1. 注册 `echo_text`

```ts
ctx.tools.register(definition: ToolDefinition, options?): () => void
```

```ts
interface ToolDefinition {
  name: string                       // 模型看到的工具名
  description: string                // 模型判断"要不要调"的主要依据
  parameters: Record<string, unknown>  // JSON Schema 子集，根必须是 object
  output: {
    schema: JsonSchemaNode           // 校验你返回值（不匹配 → ToolOutputError）
    render(args: unknown, value: JsonValue): ContentBlock[]   // 把结果变成给模型看的文本
  }
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
}
```

本 Lab 的 `parameters`：

```js
{
  type: 'object',
  properties: {
    text:  { type: 'string',  description: '要回显的文字' },
    times: { type: 'integer', description: '要回显的次数' },
  },
  required: ['text', 'times'],
}
```

`output.schema` 给 `{ type: 'string' }`，`render` 返回 `[{ type: 'text', text: value }]`。

### 两个硬规则（DSH 强制）

1. **只认受支持的 JSON Schema 子集**。注释关键字只有 `description` / `title` / `default` / `examples`。
   写了别的（比如 `text:`）→ 注册时抛 `JsonSchemaError`，**整个插件加载失败**（连别的工具一起没）。
2. **返回值严格按 schema 校验，不做类型转换**。`schema: {type:'string'}` 就返回字符串；返回 `null` → `ToolOutputError`，**`render` 根本不会被调用**。

---

## S2. 验证

1. 让 AI（或你）重载：`plugin_manager set_bundle @learn/forge false` → `true`
   **Host 半边改了不会自动生效**，必须触发一次重新组合。
2. 在对话里说「把 Hello-DSH! 重复 3 次」→ 模型会调 `echo_text`。

通过输出：

```
Hello-DSH!
Hello-DSH!
Hello-DSH!
```

---

## 排错对照表

| 症状 | 原因 |
|---|---|
| 插件加载失败、所有工具消失 | schema 里有不受支持的关键字 |
| `ReferenceError: ctx is not defined` | 在模块顶层用了 `ctx` |
| `ToolOutputError` | 返回值和 `output.schema` 不匹配（常见：`string` 却返回 `null`） |
| `render` 没被调用 | 同上 —— 校验在 `render` 之前 |
| 模型不调用你的工具 | `description` 太模糊，或者参数名/类型不对 |
| 改了代码没变化 | 没重载；Host 半边不是热更新的 |
| 工具名重复 | 同名工具注册两次（比如忘了改 name 复制粘贴） |

---

## 原理小结

| 概念 | 一句话 | OS 类比 |
|---|---|---|
| `inject` | 声明依赖的服务 | 头文件/链接依赖 |
| `apply(ctx)` | 插件入口 | `main()` |
| `ctx.tools.register` | 往内核注册一个能力 | 注册 syscall |
| `parameters` | 参数的契约 | 函数原型 + 类型检查 |
| `output.schema` | 返回值的契约 | 返回类型 + 运行时断言 |
| `render` | 给模型看的呈现层 | `printf` 格式化 |
| 重载 | 卸载旧插件、装新插件 | `rmmod` / `insmod` |

**Lab 1 的结论**：参数和返回值都有"内核帮你校验"的契约 —— 你不需要防御性检查类型，但也不能越界。

---

一次 `ctx.tools.register` 调用就是一个工具。后面 Lab 2/3/4 都往同一个 `apply` 里继续加，**不新建包**。

> 对照实现：[`example/index.js`](../example/index.js) 里 `echo_text` 那一次 `ctx.tools.register`。卡住时再看，别先看。
