# 工作单 · Lab 0 —— 在一台裸 Linux 上把环境搭起来

> 目标：一台干净的 Linux（或 WSL2），从零到 `dsh web` 能打开 GUI，并且**具备后面所有 Lab 需要的工具**。
> 本文以 Ubuntu 24.04+ / Node 24.9+ / DSH 0.2.x 为参照；版本更高也照做。

---

## 0. 先看清要装什么、为什么

| 依赖 | 谁需要它 | 缺了会怎样 |
|---|---|---|
| **Node ≥ 24.9** | DSH 本身（`engines.node: ">=24.9.0"`） | 起不来 |
| **pnpm** | 插件安装器（`install_bundle` 内部 `spawn pnpm`） | 装插件直接报 `spawn pnpm ENOENT` |
| **gcc** | Lab 4 之后编译 C | `build_c` 找不到编译器 |
| **git / curl** | 装 nvm、拉包 | 装不上 |
| **DSH** | 宿主 | 没有插件树和 GUI |

一条判断准则：**插件不是独立程序**，它跑在 DSH Host 进程里；DSH 又依赖 Node 和 pnpm 来组合/安装。所以缺一环，后面的 Lab 就没法做。

---

## S1. 系统依赖

```bash
sudo apt update
sudo apt install -y curl git build-essential
gcc --version        # 期望能打印版本
```

`build-essential` 里包含 gcc、make、libc 头文件 —— Lab 4 编译 C 只需要 gcc，但装整套省事。

---

## S2. Node（用 nvm，别用发行版的）

发行版的 Node 往往太旧（< 24.9），而且换版本麻烦。用 nvm：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# 重新开一个 shell，或 source ~/.bashrc

nvm install 26
nvm alias default 26
node -v              # v26.x
```

> Node 26 是写作时的当前版；DSH 只要求 `>= 24.9.0`，所以 24 以上都能跑。

---

## S3. pnpm

```bash
npm install -g pnpm --registry=https://registry.npmmirror.com
pnpm -v
```

- 国内网络加 `--registry=...` 会快很多；不加也行。
- **一定要装**：DSH 的插件管理器装 bundle 时会 `spawn pnpm`，没有就 `ENOENT`。
  这是真实踩过的坑 —— 表现是"任何插件都装不上"，但错误信息只说 `spawn pnpm ENOENT`，容易想不到是缺 pnpm。

---

## S4. 装 DSH

```bash
npm install -g @deepseek-ai/dsh
dsh --version        # 0.2.2-rc.1（或更新）
```

如果没有配镜像，可以加 `--registry=https://registry.npmmirror.com`。

---

## S5. 首次启动（自动创建 profile）

```bash
mkdir -p ~/dsh-learn && cd ~/dsh-learn   # 随便一个工作区目录
dsh web
```

- `dsh web` = `dsh --profile web`。
- **首次启动会自动创建** `$DSH_HOME/profiles/web`（`DSH_HOME` 默认 `~/.dsh`）。
- 终端会打印 GUI 地址，一般是 `http://127.0.0.1:8787`。在浏览器打开就是 Web 界面。
- 端口被占可以换：`dsh --profile web --port 8080`（`--port` 是 web app 的参数，透传给 profile）。

> **WSL2 注意**：在 WSL 里跑，Windows 浏览器直接访问 `http://127.0.0.1:8787` 即可（WSL2 会把 localhost 转发过去）。
> 工作区**放在 Linux 文件系统里**（`~/...`），别放 `/mnt/c` —— 跨文件系统 IO 慢，而且文件和权限行为不一致。

---

## S6. 验收清单

| 检查 | 命令 | 期望 |
|---|---|---|
| Node 版本够 | `node -v` | `v24.9.0` 以上 |
| pnpm 在 | `pnpm -v` | 有版本号 |
| gcc 在 | `gcc --version` | 有版本号 |
| DSH 在 | `dsh --version` | `0.2.2-rc.1` 或更新 |
| profile 建好了 | `ls ~/.dsh/profiles/` | 有 `web` |
| GUI 能开 | 浏览器打开打印出的地址 | 能看到对话界面 |

全部通过才能进 Lab 1。

---

## 排错对照表

| 症状 | 原因 / 处理 |
|---|---|
| `spawn pnpm ENOENT`（装插件时） | 没装 pnpm，或者装了但不在 PATH（nvm 切换后 PATH 会变） |
| `dsh: command not found` | 全局 bin 目录不在 PATH；用 `npm bin -g` 看装哪了 |
| DSH 起来报 Node 版本不满足 | 用了发行版 Node；`which node` 确认是不是 nvm 的那个 |
| GUI 打不开 | 端口被占用 → `--port` 换一个；WSL2 里确认是从 Windows 访问 127.0.0.1 |
| 装包特别慢 / 失败 | 加 `--registry=https://registry.npmmirror.com` |
| 工作区里 `ls` 很慢 | 工作区在 `/mnt/c` 上；搬到 Linux 文件系统 |
| 改了插件文件没反应 | 那是 Lab 1 之后的事：Host 半边需要重载，client 半边需要刷新页面 |

---

## 原理小结

| 概念 | 一句话 | OS 类比 |
|---|---|---|
| `$DSH_HOME` | DSH 的"根目录" | `/etc` + `/var/lib` 合体 |
| profile | 一套插件组合（`web` / `headless` / `acp` …） | 一个发行版/rootfs |
| bundle | 一组插件 + 一份 patch 层 | 一个安装包 |
| plugin | 树上的一个节点 | 一个驱动/服务 |
| `dsh plugin --profile <name> add <pkg>` | 命令行版的插件安装 | `apt install` |

**Lab 0 的结论**：DSH 不是单个二进制，而是"Node 运行时 + 一套 profile（插件组合）+ 一个 Web 宿主"。插件开发就是往这个组合里加自己的节点 —— 这也是为什么后面所有 Lab 的"装/重载"步骤都围绕 profile。
