# 工作单 · Lab 6 —— Forge 控制台（面板 + 受认证的 Host 路由）

> 前置：Lab 4（`build_c`）、Lab 5a（裸路由）、Lab 5b（面板 + 四态）都完成。
> 目标：面板上**输入自然语言** → 生成 C → 编译 → 跑 → 看输出（和对话里的 `build_c` 同一个能力，人机两个入口）。
> 与 5a 的区别：**不再用裸 `webServer` 路由**，改在 `/api` 下认领**受认证**的 exact 路由（`ctx.connection.fetch.register`）。
> 一次读一节，别通读。

---

## 0. 传输层怎么选（先看这段）

Lab 5a 的路由长这样：

```js
ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/forge/builds', resource }))
```

能用，但有两个硬伤：

| 性质 | 后果 |
|---|---|
| **不认证** | 任何能访问 8787 的进程/人都能读。`curl /forge/builds` 不带 cookie 就 200（而 `curl /` 是 401） |
| **只答 GET/HEAD**（`resource`） | 编译是**有副作用**的操作，塞进只读约定里是错的 |
| **要自己管生命周期** | 忘了 `ctx.effect` → 重载时 `duplicate exact route` |

DSH 官方包扩展“浏览器 ⇄ Host”能力，用的是 **`connection` 服务 + `/api` 下的 exact 路由**：

```ts
ctx.connection.fetch.register(route: ConnectionFetchRoute): () => Promise<void>
```

这是官方 feature 包的主流做法（deliverables、file-upload、plugin-manager、plugin-market、
api-session-controller、session-log-export、experimental-liveshare、experimental-inspector、
cordis-client-runner 都在用这个 API）。

- 路径**必须以 `/api` 开头**（共享通道的命名空间），且全局唯一。
- 认证由 `/api` 那套闸门统一做：没登录 → **401**，非 owner principal → 403，方法不匹配 → 404。
- body 由 bridge 读好；`requestBody: 'buffered'` = 一次读进内存（默认 JSON 上限内）。
- 客户端就是同源 `fetch('/api/forge/...')`，浏览器自动带 cookie —— **不是公开端口、不是裸路由**。
- 带类型的接口是另一条路：Typert Remote（`/api` 上 `<namespace>/<method>`），**构建期生成**，手写插件接不进去。

> `ctx.connection.rpc.handle()`（自定义逻辑通道）看起来更“像 RPC”，但 **0 个官方包在用**，而且在 DSH 0.2.2-rc.1 里是坏的
> （抛 `cannot get property "webServer" without inject`，通道从未挂载，浏览器看到 405）。细节和补丁见文末附录。

| | 裸 `webServer` 路由（5a） | `connection.fetch` 路由（Lab 6） |
|---|---|---|
| 认证 | 无 | ✅ 同一个 `/api` 闸门 |
| 能 POST | 用 Node `handler` 自己读流 | ✅ `methods: ['POST']` |
| 生命周期 | 自己包 `ctx.effect` | 内部包（`registerFetchRoute` 里有 `owner.effect`） |
| 返回 | 自己造 `Response` | `Response`（`Response.json(...)`） |
| 开箱即用 | ✅ | ✅ |

---

## 1. 目标形状

```
Host（forge/index.js）
  gen_c_with_llm(spec, signal, ctx)          自然语言 → C 源码（入口层工具，不是内核）
  compileC(source, opts, ctx)                纯编译内核：只认 C 源码，不碰模型
  apply(ctx)
    ├ 4 个 tool（build_c = spec → gen → compileC）
    └ 两条 /api 路由（ctx.connection.fetch.register）
         GET  /api/forge/builds   → 200 [{id,source,binary,size,mtime}, ...]
         POST /api/forge/compile  → body {spec,name?,stdin?,run?}
                                   → gen_c_with_llm(spec) → compileC(code, opts)
                                   → 200 {code, id, dir, source, binary, compile_*, run_*}
                                   失败 → 非 2xx + {error: '...'}

Client（forge/client.js）
  inject: ['slots']
  Panel: fetch('/api/forge/builds') / fetch('/api/forge/compile', {method:'POST', body: JSON.stringify(...)})
```

数据流：

```
面板 ──POST /api/forge/compile {spec,stdin,run}──▶ fetch 路由
                                                    ├ gen_c_with_llm(spec) → C 源码
                                                    └▶ compileC(code, opts)
                                                         ├ 写 .c 到 forge-out/forge-XXXXXX/
                                                         ├ spawn gcc
                                                         └ (run) spawn .bin，喂 stdin
面板 ◀── 200 {code, binary, compile_stdout, run_stdout, ...} ──┘     （失败：非 2xx + {error}）
```

**「谁来生成」在入口层**：工具 `build_c` 和 `compile` 路由都先调 `gen_c_with_llm` 再调 `compileC`（两家各自调，或抽一个共用的小 helper；这样两个入口的能力不会走偏）。`compileC` 内核始终不碰模型。
如果以后想「直接编译我手写的 C」，**再加一条 `POST /api/forge/raw`**（body 里是 `source`，直接调 `compileC`），不用动 `compile`。

---

## S1. 提取 `compileC`

要点：

- 内核签名 `compileC(source, opts, ctx)`，`opts: { name?, run?, stdin?, signal? }`；没有 `args`/`exec`。
- 内核**不碰模型**；`gen_c_with_llm` 是入口层的工具。
- 返回 `{id, dir, source, binary, compile_stdout, compile_stderr}`（`run_*` 在 S4 补）。
- 失败策略：内核**抛异常**（`gcc` 非零就抛 `Error(stderr)`）。
- 两个入口各自决定怎么呈现失败：工具入口 catch 成 `{err, err_log}` 给模型看；HTTP 入口 catch 成 `{error}` + 状态码给浏览器看。
- 跨边界的铁律：进程/HTTP 边界只传 JSON，`Error` 对象和它的字段不写进返回值就全消失。
- 文件名校验：规则一份（小函数），调用点在 gen **之前**、compileC **之前**（先校验再花钱）。

---

## S2. Host：在 `/api` 认领两条路由（约 40 分钟）

`inject` 里加 `'connection'`（裸路由删掉后 `'webServer'` 就不再需要）。

DSH 给的形状是「一条路由一次调用」：

```ts
ctx.connection.fetch.register(route: ConnectionFetchRoute): () => Promise<void>

interface ConnectionFetchRoute {
  path: string                                  // 必须在 /api 下，全局唯一
  methods: ('GET' | 'HEAD' | 'POST')[]          // 只认这三个
  requestBody: 'buffered' | 'streaming'         // 你这两条都用 buffered
  fetch: (request: Request) => Promise<Response>
}
```

`fetch` 是**普通函数**：输入 Fetch 的 `Request`，输出 Fetch 的 `Response`。
所以三件杂事要自己干 —— 解析 body、把异常变成响应、把返回值包成 `Response`。两条路由铺开写：

```js
ctx.connection.fetch.register({
  path: '/api/forge/builds',
  methods: ['GET'],
  requestBody: 'buffered',
  fetch: async () => Response.json(await get_builds()),   // Response.json 是 Fetch 的全局，不用 import
})

ctx.connection.fetch.register({
  path: '/api/forge/compile',
  methods: ['POST'],
  requestBody: 'buffered',
  fetch: async (request) => {
    let payload
    try {
      payload = await request.json()
    } catch {
      return Response.json({ error: 'body is not JSON' }, { status: 400 })
    }
    if (payload.name !== undefined && !/^[A-Za-z0-9_-]+$/.test(payload.name)) {
      return Response.json({ error: '文件名格式错误' }, { status: 400 })
    }
    try {
      const code = await gen_c_with_llm(payload.spec, request.signal, ctx)
      const ret = await compileC(code,
        { name: payload.name, stdin: payload.stdin, run: payload.run, signal: request.signal }, ctx)
      return Response.json(ret)
    } catch (e) {
      return Response.json({ error: e.message })       // 默认 500
    }
  },
})
```

`compileC` 里 gcc 非零时抛异常，会落进最后的 `catch` → 客户端拿到 500 + `{error: gcc 的 stderr}`。

要点：

- **`fetch` 必须返回 `Response`**；返回普通对象会 500。
- **`fetch` 里别 throw**：抛出去 = HTTP 500 + **空 body**，客户端只能看到状态码。上面那层 `try/catch` 就是为这个。
- 状态码语义**自己定**，但两类失败要能分开：请求本身不合法（400）和"请求合法但干活失败"（500）。
  本套材料用的约定是：非 2xx + `{error: string}`；成功 200 直接返回数据（不包 `{ok,value}` 信封）。
  你也可以换成别的约定，只要 Host 和 Client 两边一致 —— 这是设计决定，不是 DSH 的要求。
- `request.signal` 一路传给 `gen_c_with_llm` / `compileC` / `spawn`（浏览器取消、断连都会 abort）。
- `register` 内部已经 `owner.effect` 注册，**不用**再包 `ctx.effect`；重载会自动注销。
- 路径写一次别改：`/api/forge/builds`、`/api/forge/compile` 两边（Host/Client）必须一字不差。
- 一个 path 一条 route，要**分别** register；重复 path 会抛错。

### 自测

重载后，在终端里**不带 cookie** 打两枪：

```bash
# 1. 5a 的裸路由已删 → 404
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/forge/builds

# 2. 没 cookie 访问 /api 下的路由 → 401（认证闸门先挡）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/forge/builds
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8787/api/forge/compile -H 'content-type: application/json' -d '{}'
```

带 cookie 的真实调用只能在浏览器里验（S3/S5）：DevTools Console 里
`fetch('/api/forge/builds').then(r => r.json())` —— 同源会自动带 cookie。

---

## S3. Client：把 5b 的 `fetch('/forge/builds')` 换成 `/api/forge/builds`（约 30 分钟）

`client.js` 的 `inject` 保持不变（`['slots']`），数据源换路径即可：

```js
const res = await fetch('/api/forge/builds')
if (res.status === 401) throw new Error('未登录/会话失效')
if (!res.ok) throw new Error(`HTTP ${res.status}`)
const builds = await res.json()
```

四态（`loading / ready / empty / error`）不变，只是 `error` 里现在要能把 **401** 和别的问题区分开（401 是认证闸门，不是路由不存在）。

**自测**：面板显示构建列表；DevTools 里请求路径是 `/api/forge/builds`，响应 200；把 `forge-out/` 改名 → 空列表。

---

## S4. 支持 `run`（约 30 分钟）

`opts.run === true` 时，编译成功后启动 `.bin`：

```js
const handle = ctx.subprocess.spawn({
  argv: [binPath],
  cwd: dir,
  stdio: {
    stdin: { data: opts.stdin ?? '' },      // 批量喂入 + 自动关闭
    stdout: { maxBytes: 64 * 1024 },
    stderr: { maxBytes: 64 * 1024 },
  },
  graceMs: 10000,
  signal: opts.signal,                       // ← request.signal
})
const outcome = await handle.done
handle.collected.stdout.readFrom(0).text
```

返回对象加三个字段：`run_stdout` / `run_stderr` / `run_exit_code`。

注意 `run_exit_code` 只在 `exitCode !== null` 时写 —— 被信号杀死时没有退出码，字段就不出现（`run:false` 时三个字段都不出现）。
所以 schema 里它只能是 `{ type: 'number' }`，不能写 `['number','null']`（DSH 的 schema 子集不支持联合类型，插件会加载失败）。

注意：`stdin: { data }` 是“写完后立刻关闭”，`fscanf` 能读到 EOF；程序不读 stdin 时传空串无影响。
Windows 上产物是 `.exe`，`argv` 指它就行（平台差异见 [`lab0-windows-task.md`](lab0-windows-task.md)）。

---

## S5. 面板控制台（约 60 分钟）

**单独一份工作单：[`lab6-s5-task.md`](lab6-s5-task.md)** —— 含 React 最小集、HTTP 契约、状态划分、渲染分支、自测清单。

第一件要做的事是补 host：`compile` 路由要 `return { ...ret, code }`。因为 `ret` 里只有**落盘路径**
（`ret.source` 是服务器上的文件路径），浏览器读不到文件系统 —— 要显示源码就得把 `code` 一起放进响应。
（也可以让 `compileC` 直接把 `code` 塞进返回值，路由就不用动。）其余见工作单。

---

## 排错对照表

| 症状 | 最可能的原因 |
|---|---|
| 浏览器 401 | 没登录/会话失效 → 重新打开 GUI 地址（会走 `/connect` 换 cookie） |
| 浏览器 404 | route 没注册（路径拼错 / 插件没激活） |
| 浏览器 500 且 body 空 | `fetch` 里 throw 了，或在 `fetch` 里没返回 `Response` |
| 请求 415 | 少了 `content-type: application/json` |
| 400 `body is not JSON` | 面板 `body` 忘了 `JSON.stringify` |
| 400 `文件名格式错误` | `name` 里带了 `.` `/` 等非法字符 |
| 500 且 `error` 是 gcc 那段 stderr | 模型写的 C 编不过；看 `<pre>` 里的 `code` 反推它理解错在哪 |
| 500 且 `error` 是模型/网络错误 | `gen_c_with_llm` 那一层失败，和编译无关 |
| 编译失败却拿到 200 | 不会：校验失败 400，生成/编译失败 500（`{error}` 里有 gcc 的 stderr） |
| 运行没输出 | `stdin` 没喂；或程序输出到 stderr |
| gcc 输出为空 | 输出可能在 `compile_stdout`（gcc 有时把警告写 stdout） |

---

## 验收

1. `GET /forge/builds` → **404**（5a 的裸路由已删）
2. `GET /api/forge/builds`（无 cookie）→ **401**；`POST /api/forge/compile`（无 cookie）→ **401**
3. 面板显示构建列表（带 cookie 的 `/api/forge/builds` 通的）
4. 面板输入一段自然语言 → 显示生成的 C 源码 + 编译结果
5. 输入会让模型生成编不过的 C 的描述 → 面板显示 **HTTP 500 + `{error}`**，与成功态明显不同
6. `run:true` → 显示程序输出（喂 stdin 的情况也对）
7. 面板构建完，列表多一条
8. 对话里调 `build_c` 仍然工作（工具入口没被拆坏）
9. 重载两次不出重复路径错误（自动注销生效）

---

## 坑（预先说）

- **这是任意代码执行**：面板能把任意 C 交给 gcc 编译并运行，跑在 Host 用户权限下，**不是沙箱**。别把 8787 暴露到局域网；正经做法接 `dsh-sandbox`，以后再学。
- `/api` 是共享命名空间：你的 path 必须唯一，最好固定前缀 `/api/forge/`；起名冲突时注册会抛错。
- `connection` 只保证**认证**（是你这个 owner 的浏览器），不保证**授权**。多用户/远程访问时要自己看 principal。
- 别在面板里直接调 tool —— tool 是给模型的入口，不是前端 API。
- 路径写一次就别改：Host 的 `path` 和 Client 的 `fetch` 必须完全一致（差一个 `/api` 就是 404）。

---

## 附录：为什么不用 `connection.rpc.handle`

自定义逻辑通道 `ctx.connection.rpc.handle('/forge', handler)` 看起来更像 RPC（DSH 帮你解析 `payload`、校验
`{ok,value}` 信封、客户端 `rpc.call`），但：

- **0 个官方包在用**——官方的 feature 包都走 `fetch.register`；
- 在 DSH 0.2.2-rc.1 里**是坏的**：一注册就抛 `cannot get property "webServer" without inject`，
  错误在 effect 里被吞掉，通道从未挂载，浏览器请求落到静态处理器 → **405**。
  根因：`register()` 末尾用 `owner.webServer`，而 `owner` 是 connection 插件自己的 ctx，那个 fiber 没 inject webServer。
  上游讨论（报的是 0.1.5-rc.1，0.2.2-rc.1 下复现一致）：
  [#6105](https://github.com/deepseek-ai/deepseek-harness/discussions/6105)、
  [#6179](https://github.com/deepseek-ai/deepseek-harness/discussions/6179)、
  [#6289](https://github.com/deepseek-ai/deepseek-harness/discussions/6289)；社区修复包 `dsh-connection-rpc-fix`。
- 妥协修法：给 profile 的 `connection` 行补 `inject: [webStartup, webServer]`，然后**重启** `dsh web`。
  这是跟着版本走的临时补丁，升级 DSH 后要复查——所以本 Lab 不用它。

想学信封那一套的话，`rpc.call` / `rpc.handle` 的类型在
`dsh-client-connection/lib/types/rpc.d.ts`（`ConnectionRpcResult` / `ConnectionRpcFailure`），
`ok` 管的是**传输/协议层**，`value.err` 管的是**业务结果**——两者不是一回事。

> 对照实现：[`example/index.js`](../example/index.js) 的两条路由 + [`example/client.js`](../example/client.js) 的 `CompilerPanel`。
