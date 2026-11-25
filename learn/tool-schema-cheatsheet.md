# 工具 schema 速查（DSH 0.2.2-rc.1）

工具注册里的 `parameters` 和 `output.schema` 用的是 **JSON Schema 的一个受支持子集**。
不是 JSON Schema 全量，也不是 TypeScript 类型；用了子集之外的词，**插件注册时直接报错**（`JsonSchemaError`，注册不上去）。

## 允许的 `type`（只能是单个字符串）

`object` · `array` · `string` · `number` · `integer` · `boolean` · `null`

- 不接受 `type: ["string","null"]` 这种数组写法；要"可空/多选一"用 `oneOf`。

## 每个类型允许的关键字

| 类型 | 允许的关键字 |
|---|---|
| `object` | `properties`（子 schema 表）、`required`（字符串数组，必须在 properties 里）、`additionalProperties`（布尔；`false` 拒绝未声明字段，省略=允许） |
| `array` | `items`（一个子 schema；省略=任意 JSON） |
| `string` / `number` / `integer` / `boolean` / `null` | `enum`（非空、类型匹配的数组）、`const`（类型匹配的单值） |
| 任意节点 | 注解：`description`、`title`、`default`、`examples`（不参与校验） |

**明确不支持**（写了会注册失败）：
`minLength`、`maxLength`、`pattern`、`minimum`、`maximum`、`multipleOf`、
`minItems`、`maxItems`、`uniqueItems`、`format`、`allOf`、`anyOf`、`$ref`、`type` 数组。

## 两条硬约束

1. **`parameters` 的根必须是 `object`**（`assertObjectJsonSchema`）；
2. **`output.schema` 可以是任意受支持根**（string/object/array…），返回值和它不匹配就 `ToolOutputError`，**不会强制转换**。

## 例子

无参数工具：

```js
parameters: { type: 'object', properties: {} }
```

带参数：

```js
parameters: {
  type: 'object',
  properties: {
    text: { type: 'string', description: '要处理的文字' },
    times: { type: 'integer', description: '重复次数' },
    mode: { type: 'string', enum: ['upper', 'lower'] },
  },
  required: ['text', 'times'],
  additionalProperties: false,
}
```

返回对象（要自己序列化文本）：

```js
output: {
  schema: {
    type: 'object',
    properties: {
      stdout: { type: 'string' },
      exitCode: { type: 'integer' },
    },
    required: ['stdout', 'exitCode'],
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}
```

多选一（`oneOf`，至少两支，旁边不能放 type/properties 等）：

```js
output: {
  schema: {
    oneOf: [
      { type: 'string' },
      { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
    ],
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}
```

## 校验时机

| 时机 | 校验对象 | 失败表现 |
|---|---|---|
| 插件注册时 | schema 本身是否在子集内 | 插件加载失败（安装返回 failed / Host 日志报错） |
| 每次调用前 | 模型给的参数 vs `parameters` | 工具失败（`ToolArgsError`），不会进你的 `execute` |
| 每次返回后 | 你的返回值 vs `output.schema` | 工具失败（`ToolOutputError`），不会进 `render` |

来源：`dsh-tools/lib/types/json-schema.d.ts`（`JsonSchemaType`、`JsonSchemaNode`）与实现里的 `assertSupportedJsonSchema` / `validateJsonSchemaValue`。
