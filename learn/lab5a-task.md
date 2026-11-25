# 工作单 · Lab 5a —— Host 路由：把 `forge-out/` 暴露成 HTTP

> 前置：Lab 4 完成（`build_c` 能往 `forge-out/` 写出 `.c` + `.bin`）。
> 目标：`GET /forge/builds` 返回 `forge-out/` 下所有构建的 JSON 数组。
> 性质：**纯 Host 半边**，一行浏览器代码都没有 —— 用 `curl` 就能验收。

---

## 0. 为什么先做这一半

DSH 插件有**两半**，跑在两个进程里：

```
Host 半边（Node 进程）              Client 半边（浏览器）
  能读文件、跑 gcc、调模型     ←→     能画界面、接鼠标键盘
              ↑ 中间要有一条"通信通道" ↑
```

数据在 Host（`forge-out/` 在磁盘上），显示在 Client（浏览器）。所以顺序是：

1. **5a（本单）：先把通道做出来** —— 纯 Host，能单独验证，错了就是 JSON 错了。
2. **5b（`learn/lab5b-task.md`）：再做面板** —— 纯 Client，只管把 JSON 画出来。

反过来做会死得很难看：面板一片空白时你分不清是"路由没生效"还是"前端写错了"。

> 前端在 DSH 里的定位就是**展示 + 输入输出** —— 它不产生能力，只是把 Host 的能力摆出来。

---

## 1. 目标形状（3 步，每步都能用 curl 验证）

| 步 | 做什么 | 验收 |
|---|---|---|
| S1 | `inject` 加 `'webServer'` | 插件还能正常加载（工具还能调） |
| S2 | 写一个「读目录 → 数组」的函数 | 先在 Node 里跑通逻辑（或直接 `node -e` 试） |
| S3 | 注册 `GET /forge/builds` 路由 | `curl` 拿到 JSON |

---

## S1. 声明你要用 webServer

`index.js` 顶部：

```js
export const inject = ['tools', 'subprocess', 'llm', 'agentDefaultModel', 'webServer']
```

`inject` 是**依赖声明**（OS 里的"我要链接这个库"）。写漏了的症状：`ctx.webServer` 是 `undefined`，
调用时报 `Cannot read properties of undefined (reading 'register')`。

在 `apply(ctx)` 里用：

```js
ctx.webServer.register(route)   // 见 S3
```

---

## S2. 读 `forge-out/`，拼成数组

`forge-out/<id>/` 里每个构建目录只有一对文件：`<名字>.c` 和 `<名字>.bin`。

```js
import { readdir, stat } from 'node:fs/promises'
```

要返回的每一条：

```js
{ id: 'forge-XXXXXX', source: '/…/sum_final.c', binary: '/…/sum_final.bin', size: 16056, mtime: 1794908405769.06 }
```

规则：

1. 遍历 `forge-out/` 的子目录（只要目录，别把文件混进来）。
2. 每个子目录里找第一个 `.c` 和第一个 `.bin`；**没有 `.bin` 的目录跳过**（编译失败的残骸）。
3. `source` / `binary` 返回**绝对路径**（前端要按目录名分组显示，别给相对路径）。
4. `size` / `mtime` 取 **`.bin`** 的（人关心的是可执行文件多大、什么时候编的）。
5. `forge-out/` 不存在时返回**空数组** —— `ENOENT` 必须 catch，不能 500。

签名：

```ts
readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>
//   dirent.name        文件名（不含路径）
//   dirent.isDirectory()

stat(path: string): Promise<Stats>
//   stats.size         字节数
//   stats.mtimeMs      修改时间（毫秒时间戳，浮点）
```

写法上建议单独一个函数（Lab 6 还要复用它）：

```js
async function listBuilds() { /* 返回数组 */ }
```

---

## S3. 注册路由

```js
ctx.effect(() => ctx.webServer.register({
  kind: 'exact',
  path: '/forge/builds',
  resource: async (request) => {
    const data = await listBuilds()
    return new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    })
  },
}))
```

★ **为什么必须包 `ctx.effect`**：`register` 返回一个 disposer（删路由的函数），
但**它不会自动挂到 ctx 上**。不包的话：插件卸载（重载）时路由还留在表里 →
再启用时 `register` 抛 `webserver: duplicate exact route "/forge/builds"` → 插件加载失败。

对比记忆：

| 调用 | 自动绑 ctx 吗 | 裸调会不会炸 |
|---|---|---|
| `ctx.tools.register()` | **会**（内部走了 `layers.effect`） | Lab 1–4 裸调没炸 |
| `ctx.webServer.register()` | **不会**（就是一句 `Map.set`） | 重载时 `duplicate exact route` |

DSH 自己的路由全包了 `effect`，可查 `dsh-host-open-in-app/lib/index.js:1271`、`dsh-client-modules/lib/index.js:621`。

---

## 签名（API 参考）

```ts
ctx.webServer.register(route: WebRoute | WebResourceRoute): () => void   // 返回 disposer，用 ctx.effect 收
ctx.effect(execute: () => Disposable | void, label?: string): Disposable<Promise<void>>
```

```ts
interface WebResourceRoute {
  kind: 'exact' | 'prefix'
  path: string                                  // ★ 绝对路径（" / " 开头），末尾不带 /
  resource: (request: Request, peer?: PeerScope) => Promise<Response>
}

interface WebRoute {                            // 有 POST / SSE 需求时用这个（Lab 6 会用到）
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```

要点：

- `resource` 只答 **GET / HEAD**，其他方法自动 **405** —— 我们只要 GET，够用。
- `request` 是 **Fetch API 的 Request**（不是 Node 的 `IncomingMessage`）；返回也是 Fetch 的 `Response`。
- 返回 JSON 最省事：`new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })`
  —— 注意 `{ headers }` 是 `Response` 的第二个参数，别塞进 `JSON.stringify` 里。

---

## 验收

重载插件后（Host 半边不是热更新的），用 `curl` 打一次：

```bash
curl -i http://127.0.0.1:8787/forge/builds
```

通过标准：

1. `200`，`content-type: application/json`
2. 数组条数 = `forge-out/` 里成功的构建数
3. `POST` 同一路径 → `405`
4. 把 `forge-out/` 临时挪走 → `200` + `[]`（不是 500）

---

## 排错对照表

| 症状 | 最可能的原因 |
|---|---|
| `ctx.webServer is undefined` | `inject` 里漏了 `'webServer'` |
| 重载后插件加载失败，报 `duplicate exact route` | 忘了 `ctx.effect` 包住 `register` |
| 刚注册就 `curl 404` | `ctx.effect(register(...))` 少了箭头 → effect **立刻执行**了 disposer |
| `curl` 404 | `path` 少了开头的 `/`（相对路径不生效） |
| 返回的是数组不是 Response | `resource` 必须 `return new Response(...)`，不能 `return data` |
| 浏览器拿到 JSON 但 `content-type` 是 `text/plain` | `{ headers }` 写进了 `JSON.stringify` 的括号里 |
| `ENOENT` 500 | 没 catch `forge-out/` 不存在的情况 |
| 记录条数比预期少 | 没有 `.bin` 的目录（编译失败残骸）本来就该跳过 |

---

## ⚠ 这条路由的局限（Lab 6 会拆掉它）

`ctx.webServer.register` 是**裸路由**：DSH 的认证只包住了 `/` 和 `/api` 那些入口，你自己注册的路径**没有任何认证**。

验证（不带任何 cookie）：

```bash
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/forge/builds   → 200
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/             → 401
```

也就是说：**任何能访问这个端口的人都能读你的数据**。本机自娱自乐没问题，一旦把 8787 暴露到局域网/公网就是漏洞。

DSH 自己的功能不走裸路由，走 `connection` 服务：用
`ctx.connection.fetch.register({ path: '/api/...', methods: [...], requestBody: 'buffered', fetch })`
在共享的 `/api` 命名空间上认领 exact 路由 —— 认证由 `/api` 那套闸门统一做，不用自己操心。

所以 5a 这版的意义是**理解通道**（路径、Response、生命周期、`ctx.effect`），而不是终态。
Lab 6 会把 `/forge/builds` 迁到 `/api/forge/builds`，并删掉这条裸路由。详见 `learn/lab6-task.md` 第 0 节。

---

## 原理小结

- **`inject` = 链接声明**，`apply(ctx)` = 拿到句柄后干活；句柄不是白给的，声明了才有。
- **注册就是往一张全局表里塞条目**（路由表 / 工具表）。塞进去的东西**必须有对应的删除路径**，
  否则重载 = 泄漏 + 冲突。`ctx.effect` 就是"登记删除路径"的机制（类似 `atexit` / RAII 的析构）。
- **`resource` 是只读约定**：只接受 GET/HEAD，天然不适合有副作用的东西 —— 编译要用 `handler`（Lab 6）。

---

## 收尾

通道通了，下一步是 `learn/lab5b-task.md`：在浏览器里加一个 Forge 面板，`fetch('/forge/builds')` 把这份 JSON 画成列表。

> 对照实现里**没有**这条裸路由：它在 Lab 6 被换成了 `/api` 下受认证的那条，见 [`example/index.js`](../example/index.js) 的 `/api/forge/builds`。
> 5a 的价值在理解通道和 `ctx.effect` 生命周期，这一步的代码不必留到最后。
