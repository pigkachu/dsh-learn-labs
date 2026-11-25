# 参考实现 · @example/forge

跟着工作单做完，你也可以不打开这里。它是**答案**，用来在卡住时对照一两段，不是必读。

## 别和你的插件一起装

工具名和路由路径都一样，同时装进同一个 profile 会打架（重复路由会让后加载的那个插件起不来）。
真想跑它：先停掉自己的插件，再装这个。

## 文件

| 文件 | 对应哪一课 |
|---|---|
| `index.js` `echo_text` | Lab 1：`ctx.tools.register` + 参数/返回值契约 |
| `index.js` `sys_info` | Lab 2：`resolveExecutable` → `spawn` → `done` → `readFrom` |
| `index.js` `gen_c_with_llm` / `extractCode` | Lab 3：`ctx.llm.stream` 流式 + 抽代码 + `finish.reason` |
| `index.js` `compileC` | Lab 4：落盘、gcc、可选运行（Lab 6 S4 的 `run_*` 也在这） |
| `index.js` `get_builds` / `/api/forge/builds` | Lab 5（读目录 → 数组）+ Lab 6（换成 `/api` 后） |
| `index.js` `/api/forge/compile` | Lab 6：`ctx.connection.fetch.register`，400 / 500 分层 |
| `client.js` `BuildsPanel` | Lab 5：席位、四态、stale closure |
| `client.js` `CompilerPanel` | Lab 6：受控输入、提交、成功/失败两种呈现 |
| `package.json` / `cordis.patch.yml` | Lab 1 + Lab 5：包名、bundle patch、client 声明 |

## 读它的时候重点看三件事

1. **分层**：`gen_c_with_llm` 是入口层（唯一碰模型的地方），`compileC` 是核心（不碰模型）。
   工具和面板都调这两个函数，能力不会走偏。
2. **边界**：HTTP 入口把失败翻译成 `{error}` + 状态码；工具入口把失败翻译成 `{err, err_log}`。
   `Error` 对象本身过不了进程/HTTP 边界，先抄出 `message`。
3. **花钱的顺序**：能白嫖的校验（`assertName`、body 形状）放在调模型之前 —— 非法请求不该烧一次模型调用。
