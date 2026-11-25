# 工作单 · Lab 0 —— 把环境搭起来

> 目标：一台干净的机器（Linux / WSL2 / Windows 都行），从零到 `dsh web` 能打开 GUI，并且**具备后面所有 Lab 需要的工具**。
> 本文以 Ubuntu 24.04+ / Node 24.9+ / DSH 0.2.x 为参照；版本更高也照做。
> 两步分平台：【Linux】和【Windows】，没标的两边一样。

---

## 0. 先看清要装什么、为什么

| 依赖 | 谁需要它 | 缺了会怎样 |
|---|---|---|
| **Node ≥ 24.9** | DSH 本身（`engines.node: ">=24.9.0"`） | 起不来 |
| **pnpm** | 插件安装器（`install_bundle` 内部 `spawn pnpm`） | 装插件直接报 `spawn pnpm ENOENT` |
| **gcc** | Lab 4 之后编译 C | `build_c` 找不到编译器 |
| **git / curl** | 装 nvm、拉包 | 装不上（Windows 自带 curl，git 可选） |
| **DSH** | 宿主 | 没有插件树和 GUI |

一条判断准则：**插件不是独立程序**，它跑在 DSH Host 进程里；DSH 又依赖 Node 和 pnpm 来组合/安装。所以缺一环，后面的 Lab 就没法做。

**先选路线**：

| 你手上是 | 建议 |
|---|---|
| 已经有 WSL2 | 走【Linux】，WSL2 里就是 Ubuntu，省掉 Windows 适配 |
| 只有 Windows | 走【Windows】，gcc 选 w64devkit（解压即用）或 MSYS2（要包管理时用） |

本套工作单里的命令是 Linux 风格（`mkdir -p`、`./x.bin`）。Windows 上让 AI 用 PowerShell 跑对应命令，语义一样。

---

## S1. 系统依赖

【Linux】

```bash
sudo apt update
sudo apt install -y curl git build-essential
gcc --version        # 期望能打印版本
```

`build-essential` 里包含 gcc、make、libc 头文件 —— Lab 4 编译 C 只需要 gcc，但装整套省事。

【Windows】系统自带 `curl.exe` 和 PowerShell，这步跳过。git 可选，本套实验不用。

---

## S2. Node

【Linux】发行版的 Node 往往太旧（< 24.9），而且换版本麻烦。用 nvm：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# 重新开一个 shell，或 source ~/.bashrc

nvm install 26
nvm alias default 26
node -v              # v26.x
```

> Node 26 是写作时的当前版；DSH 只要求 `>= 24.9.0`，所以 24 以上都能跑。

【Windows】任选一种：

```powershell
winget install OpenJS.NodeJS.LTS
```

或者去 nodejs.org 下 LTS 的 `.msi`，**勾上 "Add to PATH"**。

**重开一个终端**再验证：

```powershell
node -v      # v24.x 或更高
```

想换版本用 nvm-windows；只用最新 LTS 就不需要。

---

## S3. pnpm

两边一样：

```bash
npm install -g pnpm --registry=https://registry.npmmirror.com
pnpm -v
```

- 国内网络加 `--registry=...` 会快很多；不加也行。
- **一定要装**：DSH 的插件管理器装 bundle 时会 `spawn pnpm`，没有就 `ENOENT`。
  这是真实踩过的坑 —— 表现是"任何插件都装不上"，但错误信息只说 `spawn pnpm ENOENT`，容易想不到是缺 pnpm。
- Windows 上装完要**重开终端**，PATH 才更新。

---

## S4. gcc

【Linux】S1 的 `build-essential` 已经包含，不用再做。

【Windows】两条路，选一条：

### 路线 A：w64devkit（推荐，免安装）

1. 到 <https://github.com/skeeto/w64devkit/releases> 下 `w64devkit-x64-<版本>.7z.exe`
2. 双击自解压，装到 `C:\w64devkit`（安装器里可以勾"加进 PATH"）
3. 没勾就手动加：`系统属性 → 环境变量 → 用户变量 Path → 新建`，填 `C:\w64devkit`
4. **重开** PowerShell：`gcc --version`

w64devkit 里连 `make` / `gdb` / 常用 unix 命令都有，够本套实验用。

### 路线 B：MSYS2（要包管理、要长期更新就用它）

1. <https://www.msys2.org> 下安装器，默认装到 `C:\msys64`
2. 打开 **"MSYS2 UCRT64"** 这个终端（不是 "MSYS2 MSYS"）
3. 装工具链：

```bash
pacman -S --needed base-devel mingw-w64-ucrt-x86_64-gcc
```

4. 把 `C:\msys64\ucrt64\bin` 加进系统 PATH
5. **重开** PowerShell，`gcc --version`

> 只认 **UCRT64** 这一套。别把 `mingw64\bin`、`usr\bin` 也一起塞进 PATH —— 三套 DLL 混在一起会出现"编得过、跑不起来"。

---

## S5. 装 DSH

两边一样：

```bash
npm install -g @deepseek-ai/dsh
dsh --version        # 0.2.x（或更新）
```

如果没有配镜像，可以加 `--registry=https://registry.npmmirror.com`。

---

## S6. 首次启动（自动创建 profile）

【Linux】

```bash
mkdir -p ~/dsh-learn && cd ~/dsh-learn   # 随便一个工作区目录
dsh web
```

【Windows】

```powershell
mkdir C:\dsh-learn
cd C:\dsh-learn
dsh web
```

- `dsh web` = `dsh --profile web`。
- **首次启动会自动创建** `$DSH_HOME/profiles/web`（`DSH_HOME` 默认 `~/.dsh`，Windows 上是 `%USERPROFILE%\.dsh`）。
- 终端会打印 GUI 地址，一般是 `http://127.0.0.1:8787`。在浏览器打开就是 Web 界面。
- 端口被占可以换：`dsh --profile web --port 8080`（`--port` 是 web app 的参数，透传给 profile）。

> **WSL2 注意**：在 WSL 里跑，Windows 浏览器直接访问 `http://127.0.0.1:8787` 即可（WSL2 会把 localhost 转发过去）。
> 工作区**放在 Linux 文件系统里**（`~/...`），别放 `/mnt/c` —— 跨文件系统 IO 慢，而且文件和权限行为不一致。
>
> **Windows 注意**：工作区放本地盘，别放 OneDrive / 网络盘 —— 同步会锁文件，路径也可能超长。

---

## S7. 后面几课的平台差异（做到时回来查）

| 哪一课 | Linux 写法 | Windows 改法 |
|---|---|---|
| Lab 2 `sys_info` | `uname -srm` | 没有 `uname` → `argv: ['cmd', '/c', 'ver']` |
| Lab 4 / Lab 6 产物 | `filename + '.bin'` | 改成 `filename + '.exe'`（Windows 按扩展名找可执行文件最稳） |
| 路径拼接 | `/` | 插件里用 `path.join` 就不用管；`forge-out/` 也照旧相对插件目录 |
| 跑产物 | `./sum.bin` | `.\sum.exe`（或双击） |
| 命令行 | `mkdir -p` / `curl` | `New-Item -ItemType Directory -Force` / `curl.exe`（让 AI 换） |
| 数据目录 | `~/.dsh` | `%USERPROFILE%\.dsh` |

---

## S8. 验收清单

| 检查 | 命令 | 期望 |
|---|---|---|
| Node 版本够 | `node -v` | `v24.9.0` 以上 |
| pnpm 在 | `pnpm -v` | 有版本号 |
| gcc 在 | `gcc --version` | 有版本号 |
| DSH 在 | `dsh --version` | `0.2.x` 或更新 |
| profile 建好了 | `ls ~/.dsh/profiles/`（Win：`dir %USERPROFILE%\.dsh\profiles`） | 有 `web` |
| GUI 能开 | 浏览器打开打印出的地址 | 能看到对话界面 |

全部通过才能进 Lab 1。

---

## 排错对照表

| 症状 | 原因 / 处理 |
|---|---|
| `spawn pnpm ENOENT`（装插件时） | 没装 pnpm，或者装了但不在 PATH（nvm 切换 / 重开终端后 PATH 会变） |
| `dsh: command not found` / `无法识别` | 全局 bin 目录不在 PATH；`npm root -g` / `npm bin -g` 看装哪了 |
| DSH 起来报 Node 版本不满足 | 用了发行版 Node；`which node` / `where node` 确认是不是 nvm 的那个 |
| GUI 打不开 | 端口被占用 → `--port` 换一个；WSL2 里确认是从 Windows 访问 127.0.0.1；Windows 防火墙首次询问点"允许" |
| 装包特别慢 / 失败 | 加 `--registry=https://registry.npmmirror.com` |
| 工作区里 `ls` 很慢 | 工作区在 `/mnt/c` 上；搬到 Linux 文件系统 |
| `gcc : 无法将"gcc"项识别为 cmdlet…` | Windows 的 PATH 没加，或加了没重开终端；`where gcc` 看它在不在 |
| 编出来的程序双击闪退 | 后缀不是 `.exe`；或 PATH 里混进了别的 MinGW 那套 DLL |
| 路径太长报错 | 工作区挪浅（`C:\dsh-learn` 而不是很深的用户目录） |
| 改了插件文件没反应 | 那是 Lab 1 之后的事：Host 半边需要重载，client 半边需要刷新页面 |

---

## 原理小结

| 概念 | 一句话 |
|---|---|
| `$DSH_HOME` | DSH 的"根目录"：配置、会话、插件树都在这（默认 `~/.dsh`） |
| profile | 一套插件组合（`web` / `headless` / `acp` …） |
| bundle | 一组插件 + 一份 patch 层，装了就进 profile |
| plugin | 插件树上的一个节点，一个入口/服务 |
| `dsh plugin --profile <name> add <pkg>` | 命令行版的插件安装 |
| PATH | 系统去哪找 `node` / `gcc`（Windows 上同理） |

**Lab 0 的结论**：DSH 不是单个二进制，而是"Node 运行时 + 一套 profile（插件组合）+ 一个 Web 宿主"。插件开发就是往这个组合里加自己的节点 —— 这也是为什么后面所有 Lab 的"装/重载"步骤都围绕 profile。
Windows 上同样如此：gcc 只是被 `spawn` 的一个子进程，所以只要 `gcc --version` 能在终端里跑通，后面的课和 Linux 版没本质区别，差异都在 S7 那张表里。
