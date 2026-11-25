# 工作单 · Lab 5b —— Client 半边：Forge 面板

> 前置：Lab 4 完成（4 个工具能跑）、Lab 5a 完成（见 `learn/lab5a-task.md`：`GET /forge/builds` 返回 JSON）。
> 目标：给这个插件补上**浏览器半边**，在 DSH 页面左侧栏加一个 Forge 面板，显示 `forge-out/` 的构建列表。
> Lab 5 分两份独立工作单：**5a = Host 路由**（纯 Host，curl 验收）、**5b = Client 面板**（本单）。

---

## 0. 你要理解的第一件事：这是两个程序

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

---

## 1. 目标形状（4 步，每步都能在浏览器看到结果）

| 步 | 做什么 | 验收（浏览器里） |
|---|---|---|
| S1 | `package.json` 接线 + 最小 `client.js`（只有侧栏图标） | 左侧栏多一个图标 |
| S2 | 加 `main` 席位（空面板） | 点图标 → 主区域显示你的页面 |
| S3 | Panel 里 `fetch('/forge/builds')` + 列表 | 看到构建记录 |
| S4 | 刷新按钮 + 空列表/通道错误分支 | 点刷新能更新；断路由时提示不同 |

一次做一步。每步做完喊 AI 重载，你刷新页面看结果，再往下走。

---

## S1. 最小可加载

### ① `package.json` 加两处

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

### ② 包名只有一个

插件名 = 目录 `forge/` = `package.json` 的 `name`（`@learn/forge`）= `cordis.patch.yml` 的 `name`
= profile 里的依赖名与 bundles 项。

于是 client 模块的 `id` 就写 **`'@learn/forge'`** —— loader id 必须等于 manifest 的 `name`，
DSH 会用它去 `import` 这个包、比对 `exports["./client"]`。名字对不上时，Node 的"包内自引用"
可能仍能解析，但 client loader 认的是 manifest `name` —— 这类错位是公开插件第一个坑。

### ③ `client.js` 骨架（签名级）

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

### 验收 S1

AI 重载（`package.json` 变了要重装/重组合）→ 你 `Ctrl+Shift+R` 刷新 → 左侧栏出现图标。
没出现就看浏览器 DevTools Console，把第一行报错贴给 AI。

---

## S2. 第二个席位：页面

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

---

## S3. 跨进程取数据

Host 已经有路由（Lab 5a）：

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

数据结构（5a 已定）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `forge-XXXXXX` 目录名 |
| `source` / `binary` | string | 绝对路径 |
| `size` | number | 可执行文件字节数 |
| `mtime` | number | 毫秒时间戳（浮点） |

显示时自己处理：只显示文件名（路径太长）、字节数转 KB/MB、时间格式化。

验收：面板里看到构建记录（条数 = `forge-out/` 里成功的构建数）。

---

## S4. 三种状态要分开

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

## 收尾

5b 做完，`forge-out/` 的构建列表就"能看"了。下一步（Lab 6）是让它"能用"：
把 `compileC` 内核拆出来，加受认证的 `POST /api/forge/compile`，面板上把"一句话 → C → 编译 → 运行"
串成一条链 —— 人不用经过对话就能用同一个能力。见 `learn/lab6-task.md`。

> 对照实现：[`example/client.js`](../example/client.js) 里的 `BuildsPanel`（席位注册、四态、`reload` 刷新、列表渲染）。
