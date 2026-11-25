# 工作单 · Lab 6 · S5 —— 面板控制台（最后一个作业）

> 前置：Lab 6 S1–S4 完成（见 `learn/lab6-task.md`）。
> `GET /api/forge/builds` 已在面板里跑通；`POST /api/forge/compile` 已在 `build_c` 工具里跑通。
> 目标：把「面板输入自然语言 → 生成 C → 编译 → 跑」这条链**接到面板上**，和对话里的 `build_c` 是同一个能力的两个入口。
> 本单写完，Lab 6 就完了。

---

## 0. React 最小集（没用过也能跟）

这个面板只需要 5 个概念。全部例子用 `h()`（= `React.createElement`），因为**面板文件没有打包步骤，没有 JSX**。

### ① 组件 = 一个返回「描述树」的函数

```js
function Hello(props) {
  return h('div', null, 'hi ' + props.name)
}
```

`h(type, props, ...children)` 返回的是**描述**，不是真 DOM；DSH 拿它去渲染。`props` 是参数，只读。

### ② 渲染 = 组件函数整个重跑

状态一变，React 把函数**再调一次**，拿新描述跟旧的对比，只改变化的部分。
类比：每次重新执行一遍脚本，不是原地改内存。

### ③ 状态寄存处：`useState`

函数每次重跑，普通局部变量每次清零，所以要一块「函数外面」的内存：

```js
const [count, setCount] = useState(0)    // 首次 = 0
```

- `count` 是**本轮渲染的快照**，只读；
- `setCount(5)` = 改那块内存 + 触发重跑；
- `count = 5` 没用（改的是本轮快照，下次渲染就没了，也不重跑）。

类比：局部变量在栈上；`useState` 在堆上，写它时唤醒调度器。

### ④ 事件：传函数，不传调用结果

```js
h('button', { onClick: () => setCount(count + 1) }, '加一')
```

`onClick` 要的是**函数本体**，点击时才调。写成 `onClick: setCount(count + 1)` 会渲染时立刻执行掉，处理器变成 `undefined`，点了没反应。
回调里读到的 `count` 是**创建这个箭头函数那一次渲染**的值（闭包捕获）——这个面板不需要连点，忽略函数式更新 `setCount(c => c + 1)`。

### ⑤ `useEffect`：挂载后跑一次

```js
useEffect(() => { updatePage() }, [])
```

`[]` = 只跑一次，相当于构造函数 / init 钩子。你现在的列表加载就是它。
effect 回调**不能**直接 `async`（要返回清理函数而不是 Promise），要包一层 `() => { fn() }`。

### 规则一条（会无限循环）

**不要在组件函数体里直接调 `setX(...)`**（没包在事件回调 / effect 里）——每次渲染都触发重跑 = 无限循环。

---

## 1. 先热手（5 分钟，别跳过）

在现在这个 Panel 里临时加一个计数器（练手，看完效果就删）：

- `const [n, setN] = useState(0)`
- 一个按钮：`onClick: () => setN(n + 1)`，文字显示 `n`

刷新页面点几下。**看"状态变 → 函数重跑 → 界面更新"这条链路真的跑起来**，再动 S5 正题。

---

## 2. 交付物（改两个文件，都是你自己写）

| 文件 | 改什么 |
|---|---|
| `forge/index.js` | compile 路由多返回一个 `code`（一行） |
| `forge/client.js` | Panel 里加两个输入框、一个按钮、一套编译状态 |

---

## 3. Host 先补一步：把生成的 C 带回来

现在路由是：

```js
let ret = await compileC(...)
return ret
```

`ret` 是 `compileC` 的结果，**里面没有生成的 C 源码**——源码只落盘到 `ret.source`（一个绝对路径），
浏览器**没有 fs，读不到那个文件**。所以面板要显示「模型写的 C」，路由得把它一起返回：

```js
return { ...ret, code }
```

范围就这一行。不做的话，面板就不显示源码（也可以，但就少了一个「模型理解对不对」的判据）。

---

## 4. HTTP 契约（面板的判断依据就这些）

**请求**

```
POST /api/forge/compile
content-type: application/json          ← 少了 → 415
body: { spec: string, stdin?: string, name?: string, run?: boolean }
```

**失败：非 2xx + `{ error: string }`**

| 状态 | 含义 | 例子 |
|---|---|---|
| 400 | 参数不合法（在花钱的步骤**之前**抛的） | `name` 含非法字符、body 不是 JSON |
| 500 | 模型生成失败 **或** gcc 编不过；`error` 里是失败原因（gcc 那段 stderr 就在里面） | C 编不过 |
| 401 | 认证闸门（没 cookie / 会话失效） | 换个浏览器窗口打开 |

**成功：200 + 裸对象（没有信封）**

| 字段 | 何时有 | 说明 |
|---|---|---|
| `id` / `dir` / `source` / `binary` | 总是 | 路径都是 Host 上的绝对路径 |
| `compile_stdout` / `compile_stderr` | 总是 | gcc 输出 |
| `code` | 总是（补了第 3 节之后） | 模型生成的 C 源码 |
| `run_stdout` / `run_stderr` / `run_exit_code` | **只有 `run:true` 时** | 用 `'run_stdout' in r` 判断存在；空串 = 跑了没输出，字段缺失 = 根本没跑 |

---

## 5. Client：状态放哪

**列表那套 `status` / `error` 别复用**。复用的话，编译失败会把整页替换成错误页，列表消失。另起一套：

```js
const [spec, setSpec] = useState('')                 // 自然语言描述
const [stdin, setStdin] = useState('')               // 喂给程序的输入（可空）
const [result, setResult] = useState(null)           // 200 的裸对象，null = 还没编译
const [compileError, setCompileError] = useState('') // 非 2xx / 网络断，字符串
const [busy, setBusy] = useState(false)
```

## 6. Client：提交逻辑

事件回调可以是 `async`（`onClick` 里 `await` 没问题）：

```
setBusy(true); setCompileError(''); setResult(null)
try {
  const res = await fetch('/api/forge/compile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ spec, stdin, run: true }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))     // 400/500 都是 {error}
    setCompileError(`${res.status} ${body.error ?? ''}`)
  } else {
    setResult(await res.json())
  }
} catch (e) {
  setCompileError(e.message)                            // 断网 / 浏览器取消
} finally {
  setBusy(false)
}
```

注意 `fetch` **不会**因为 4xx/5xx 而抛异常——状态码要看 `res.ok`。只有网络层坏了才进 `catch`。

## 7. Client：渲染分支（核心，别省）

1. **`busy`** → 按钮 `disabled: busy`，文字变「编译中…」
2. **`compileError`** → 黄条「通道错误：…」（401 未登录 / 400 参数 / 500 生成或编译失败 / 网络断）
3. **`result`** → `binary`、`run_stdout`（放 `<pre>`）、`run_exit_code`、`code`（放 `<pre>`）

成功和失败**长得必须不一样**——这是 Lab 5→6 的主线：失败不是"空列表"，是有明显提示。

输入框写法（受控，`value` + `onChange` 缺一个就变只读或非受控）：

```js
h('textarea', { value: spec, onChange: (e) => setSpec(e.target.value), rows: 6 })
```

---

## 8. 自测清单

1. 刷新页面 → 面板仍然显示构建列表（S3 没被拆坏）
2. 输入「读入一个整数，输出它的平方」，stdin 填 `7`，点编译 → 看到 C 源码 + `49` + `run_exit_code: 0`
3. 再点一次刷新（或编译完）→ 列表多一条新构建
4. `spec` 清空点编译 → 看面板提示（应该是 500/400 里的一个，**不是**白屏/无反应）
5. 断网测试（DevTools Network → Offline）→ 点编译 → 黄条显示网络错误，不崩
6. 编译中按钮变灰、文字变「编译中…」

## 9. 排错对照表

| 症状 | 最可能的原因 |
|---|---|
| 点编译没反应 | `onClick: doCompile()` 调用了而不是传函数 → 改成 `onClick: doCompile` 或 `() => doCompile()` |
| 415 | 少了 `content-type: application/json` |
| 400 `body is not JSON` | `body` 忘了 `JSON.stringify` |
| 500 且 `error` 是 gcc 那段 | 模型写的 C 编不过，看 `code` 反推它理解错在哪 |
| 500 且 `error` 是模型/网络错误 | `gen_c_with_llm` 那层失败，和编译无关 |
| 点按钮整页变错误页 | 复用了列表的 `error`/`status` state |
| `run_stdout` 一直是 undefined | 请求没带 `run: true`；或判断用错（要判键，不是判空串） |
| 输入框打不进去字 | `textarea` 只给了 `value` 没给 `onChange`（变只读）或都没给（非受控） |
| 一直「编译中…」 | `finally` 里忘了 `setBusy(false)`，或 `catch` 吞了异常 |

## 10. 验收

1. Host 重载后，对话里 `build_c` 仍然工作（工具入口没被拆坏）
2. 面板：自然语言 → 显示源码 + 编译结果 + 程序输出
3. 面板：非法输入 → 明确错误提示，和成功态一眼能分开
4. 面板构建完 → 列表多一条
5. 重载两次不报重复路径错误

---

## 边界（老规矩）

**代码你自己写。** AI 只给签名、契约、审查、重载、跑验证。
卡住了就说"卡在哪一步"，让 AI 给提示，而不是让它把实现写出来。

> 对照实现：[`example/client.js`](../example/client.js) 里的 `CompilerPanel`（受控输入、`busy`/`error`/`result` 三态、`'run_stdout' in result` 判键）。
