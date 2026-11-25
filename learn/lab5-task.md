# 工作单 · Lab 5 —— Host 路由 + 浏览器面板

> 前置：Lab 4 完成（`build_c` 能往 `forge-out/` 写出 `.c` + `.bin`）。
> 目标：浏览器左侧栏加一个 Forge 面板，显示 `forge-out/` 里的构建列表。
> 分两半做，每半都能单独验证：**先 Host**（一条 HTTP 路由，`curl` 就能验），**再 Client**（面板把它画出来）。
> 反过来做会死得很难看 —— 面板一片空白时，你分不清是"路由没生效"还是"前端写错了"。

---

## 0. 先理解：这是两个程序

```
Host 进程（Node）                             浏览器
─────────────────────────                    ─────────────────────────
forge/index.js                         forge/client.js
  ctx.tools        → 模型调用                   ctx.slots  → 画界面
  ctx.webServer    → HTTP 路由 ←── fetch ────  fetch('/forge/builds')
  ctx.subprocess   → 跑 gcc                   没有 fs / 没有 subprocess
  ctx.llm          → 调模型                   没有 Node 内置模块
```

- 两边**各有一个 ctx**，但**不是同一个对象**。Host 的 `ctx.tools` 在浏览器里不存在，反之亦然。
- 两边之间**只有序列化的数据**能过（JSON）。函数、`Buffer`、class 实例都过不去。
- 两份代码共用一个 `package.json`、一个包名 —— 但它们是**两个独立的插件**。

所以"做一个面板"不是"给 Host 插件加个页面"，是**再加一个不认识 Host ctx 的小程序**，让它们通过 HTTP 说话。
前端在 DSH 里的定位就是**展示 + 输入输出** —— 它不产生能力，只是把 Host 的能力摆出来。

---

## 5-1 Host：把 `forge-out/` 暴露成 HTTP

目标形状（3 步，每步都能用 curl 验证）：

| 步 | 做什么 | 验收 |
|---|---|---|
| S1 | `inject` 加 `'webServer'` | 插件还能正常加载（工具还能调） |
| S2 | 写一个「读目录 → 数组」的函数 | 先在 Node 里跑通逻辑（或直接 `node -e` 试） |
| S3 | 注册 `GET /forge/builds` 路由 | `curl` 拿到 JSON |

### S1. 声明你要用 webServer

`index.js` 顶部：

```js
export const inject = ['tools', 'subprocess', 'llm', 'agentDefaultModel', 'webServer']
```

`inject` 是**依赖声明**：声明的服务才有，没声明就是 `undefined`。写漏了的症状：`ctx.webServer` 是 `undefined`，
调用时报 `Cannot read properties of undefined (reading 'register')`。

在 `apply(ctx)` 里用：

```js
ctx.webServer.register(route)   // 见 S3
```

### S2. 读 `forge-out/`，拼成数组

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

### S3. 注册路由

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

DSH 自己的路由全包了 `effect`，可查 `dsh-host-open-in-app/lib/index.js`、`dsh-client-modules/lib/index.js` 里 `effect(` 的用法。

### 签名（API 参考）

```ts
ctx.webServer.register(route: WebRoute | WebResourceRoute): () => void   // 返回 disposer，用 ctx.effect 收
ctx.effect(execute: () => Disposable | void, label?: string): Disposable<Promise<void>>
```

```ts
interface WebResourceRoute {
  kind: 'exact' | 'prefix'
  path: string                                  // ★ 绝对路径（"/" 开头），末尾不带 /
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

### 验收

重载插件后（Host 半边不是热更新的），用 `curl` 打一次：

```bash
curl -i http://127.0.0.1:8787/forge/builds
```

通过标准：

1. `200`，`content-type: application/json`
2. 数组条数 = `forge-out/` 里成功的构建数
3. `POST` 同一路径 → `405`
4. 把 `forge-out/` 临时挪走 → `200` + `[]`（不是 500）

### ⚠ 这条路由的局限（Lab 6 会拆掉它）

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

所以 5-1 这半的意义是**理解通道**（路径、Response、生命周期、`ctx.effect`），而不是终态。
Lab 6 会把 `/forge/builds` 迁到 `/api/forge/builds`，并删掉这条裸路由。

---

## 5-2 Client：Forge 面板

目标形状（4 步，每步都能在浏览器看到结果）：

| 步 | 做什么 | 验收（浏览器里） |
|---|---|---|
| S4 | `package.json` 接线 + 最小 `client.js`（只有侧栏图标） | 左侧栏多一个图标 |
| S5 | 加 `main` 席位（空面板） | 点图标 → 主区域显示你的页面 |
| S6 | Panel 里 `fetch('/forge/builds')` + 列表 | 看到构建记录 |
| S7 | 刷新按钮 + 空列表/通道错误分支 | 点刷新能更新；断路由时提示不同 |

一次做一步。每步做完喊 AI 重载，你刷新页面看结果，再往下走。

### S4. 最小可加载

**① `package.json` 加两处**

```json
{
  "name": "@learn/forge",
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-sidebar"
      ]
    }
  }
}
```

三个新字段的分工：

| 字段 | 作用 | 写错的后果 |
|---|---|---|
| `exports["./client"]` | DSH 去哪找浏览器半边 | 报 `declares dsh.client but exports no "./client" bundle` |
| `dsh.client.platform` | 这半边只给 Web 平台 | 不声明，client 半边根本不会被扫描 |
| `dsh.client.immediately` | 页面启动就加载 | 不声明可能懒加载，直到用到才出现 |
| `dsh.client.inject` | 依赖哪些 UI 包先在场 | 席位依赖的侧栏/layout 没就绪，注册可能落空 |

**② 包名只有一个**

插件名 = 目录 `forge/` = `package.json` 的 `name`（`@learn/forge`）= `cordis.patch.yml` 的 `name`
= profile 里的依赖名与 bundles 项。

于是 client 模块的 `id` 就写 **`'@learn/forge'`** —— loader id 必须等于 manifest 的 `name`，
DSH 会用它去 `import` 这个包、比对 `exports["./client"]`。名字对不上时，Node 的"包内自引用"
可能仍能解析，但 client loader 认的是 manifest `name` —— 这类错位是公开插件第一个坑。

**③ `client.js` 骨架（签名级）**

```js
window.__ModuleLoader__.load({
  id: '@learn/forge',   // = manifest 的 name，不能改
  factory(require) {
    // require 是 DSH 注入的：'react' 直接可用，不用装依赖
    const React = require('react')
    const h = React.createElement

    function PanelIcon(props) {
      // props.size 是边长（number）；返回一个 React 元素
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 侧栏图标：一个席位
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'forge', order: 30, label: () => 'Forge' },
            PanelIcon,
          ),
        )
      },
    }
  },
})
```

要点：

- `window.__ModuleLoader__.load` 是 DSH 的浏览器模块系统入口。**必须**用它，不能 `export`。
- `id` 不匹配时，浏览器控制台会报 `loaded without registering "<id>"`。
- 这里**没有 JSX 编译器**，只能用 `React.createElement`。
- `styles.insert` 在普通 client 插件里**不存在**（那是动态 Cordis 插件的符号），样式用行内 `style={{...}}`。

**验收**：AI 重载（`package.json` 变了要重装/重组合）→ 你 `Ctrl+Shift+R` 刷新 → 左侧栏出现图标。
没出现就看浏览器 DevTools Console，把第一行报错贴给 AI。

### S5. 第二个席位：页面

```js
ctx.slots.inject('main', () =>
  ctx.slots.register(
    { name: 'main', key: 'forge', label: () => 'Forge' },   // ★ key = 上面那个 id
    Panel,
  ),
)
```

★ **`main` 的 `key` 必须等于 `sidebar.panellist` 的 `id`**。侧栏点击时就是按这个 id 去切 `main` 的 key。
写错的典型症状：**有图标，点了没反应**（也不会报错，最难查）。

`Panel` 先写一个最小的，返回一个 `div` 里放文字就行。验收：点图标 → 主区域出现你的页面。

### S6. 跨进程取数据

Host 已经有路由（5-1）：

```
GET /forge/builds
→ [{ id, source, binary, size, mtime }, ...]     // source/binary 是绝对路径
```

Panel 里：

```js
const [builds, setBuilds] = useState([])

useEffect(() => { /* 挂载时 fetch 一次 */ }, [])

// fetch 用【相对路径】/forge/builds —— 和 GUI 同源。
// 千万别写 http://127.0.0.1:8787（换端口/换 Host 就废了）
```

数据结构（5-1 已定）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `forge-XXXXXX` 目录名 |
| `source` / `binary` | string | 绝对路径 |
| `size` | number | 可执行文件字节数 |
| `mtime` | number | 毫秒时间戳（浮点） |

显示时自己处理：只显示文件名（路径太长）、字节数转 KB/MB、时间格式化。

验收：面板里看到构建记录（条数 = `forge-out/` 里成功的构建数）。

### S7. 三种状态要分开

`fetch` 的世界里，"空"和"坏"必须长得不一样：

```js
const [status, setStatus] = useState('loading')   // loading | ready | empty | error
const [error, setError] = useState('')
```

- `response.ok === false` → `error`（`HTTP 404` 之类）
- `fetch` 自己抛（断网、Host 挂了）→ `error`
- `data.length === 0` → `empty`：**"还没有构建"**，不是错误
- 否则 `ready`：画列表

再加一个「刷新」按钮：`onClick` 里重新走一遍流程。

验收：

1. 点刷新 → 列表更新
2. AI 再 `build_c` 一个新构建 → 点刷新（或切走再切回面板，见下）→ 多一条
3. 空分支：把 `forge-out/` 改名 → 路由 `200 []` → 面板显示「**还没有构建**」
4. 错分支：`chmod 000 forge-out` → 路由 **`400`** → 面板显示 `error: 400`
   （`resource` 里抛任何非 `ENOENT` 的异常，webServer 都答 **400**，不是 500；测完 `mv` / `chmod 755` 还原）

> 不用 DevTools 也能测 3、4：都是**数据层操作**，不动代码。
> 有 DevTools 时还有一个测法：Network 面板勾 **Offline** → 点刷新 → `fetch` 自己抛 → `error` 分支。
>
> 另外记住：主区域面板**切走即卸载、切回即重新挂载**，`useEffect(..., [])` 会再跑一次 = 自动重新拉数据。
> 所以"刷新"按钮是"不想切走"时的便利，不是唯一入口。

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
| 左侧栏没图标 | `dsh.client` 没声明 / `exports` 没 `./client` / 没重装 |
| 控制台 `loaded without registering "X"` | `load({id})` 里的 id 和包名不一致 |
| 有图标，点了没反应 | `main` 的 `key` ≠ `sidebar.panellist` 的 `id` |
| 面板空白 | `Panel` 返回了空 / 抛异常（看 Console） |
| `require is not defined` | 忘了用 `factory(require)` 拿注入的 require |
| `fetch is not defined` 或 404 乱码 | 路径写成了完整 URL / 或 Host 路由没生效 |
| 样式没生效 | 用了 `styles.insert`（普通 client 插件没有这个符号） |
| 改了 `client.js` 没变化 | 忘了刷新页面（client 改动刷新即可，不用重载） |
| 列表没项目符号、缩进乱 | `ul` / `li` 用反：外层容器是 `ul`，每项是 `li`（`key` 放 `li` 上） |
| 刷新按钮挤进列表里 | `<button>` 被塞进 `<ul>` 的 children，它应是 `<ul>` 的兄弟节点 |
| 状态分支永远不生效 | 在 `useEffect` / `async` 回调里读 `status`（**stale closure**），判断必须放进渲染分支 |
| 每行都是空字符串 | 在副作用里拼显示文本、存普通局部变量；派生值应在 `return` 里就地算 |
| `useEffect` 报 `must not return anything besides a function` | 传了 `async` 函数，包一层 `() => { fn() }` |
| 面板一直"加载中" | `status` 没被设置 / `fetch` 的路径错了（`fetch` 拿到 404 不抛异常，要看 `ok`） |
| 改了 `package.json` 没变化 | 需要 AI 重装/重组合，光刷新不够 |

---

## 原理小结

- **`inject` = 链接声明**，`apply(ctx)` = 拿到句柄后干活；句柄不是白给的，声明了才有。
- **注册就是往一张全局表里塞条目**（路由表 / 工具表 / 席位表）。塞进去的东西**必须有对应的删除路径**，
  否则重载 = 泄漏 + 冲突。`ctx.effect` 就是"登记删除路径"的机制：插件卸载时它替你调那一下。
- **`resource` 是只读约定**：只接受 GET/HEAD，天然不适合有副作用的东西 —— 编译要用 `handler`（Lab 6）。
- **两个进程，一条 HTTP**：Host 只负责把数据变成 JSON，Client 只负责画；中间只有序列化数据能过。

---

## 收尾

通道通了、列表能看了。下一步（Lab 6）是让它"能用"：把 `compileC` 核心拆出来，
加受认证的 `POST /api/forge/compile`，面板上把"一句话 → C → 编译 → 运行"串成一条链 ——
人不用经过对话就能用同一个能力。见 `learn/lab6-task.md`。

> 对照实现：[`example/index.js`](../example/index.js) 的 `get_builds` / `/api/forge/builds`，
> 和 [`example/client.js`](../example/client.js) 的 `BuildsPanel`（席位注册、四态、刷新、列表渲染）。
> 注意：最终实现里**没有**这条裸路由 —— 它在 Lab 6 被换成 `/api` 下受认证的那条。
