# 工作单 · Lab 0（Windows）—— 在 Windows 上把环境搭起来

> 目标：一台 Windows 10/11，从零到 `dsh web` 能打开 GUI，并且有可用的 gcc。
> 和 [`lab0-task.md`](lab0-task.md)（Linux / WSL2 版）**二选一**，做完直接接 Lab 1。
> 和 Linux 版的区别只有两处：gcc 怎么装、以及后面几课里几处平台差异（见最后一张表）。

---

## 0. 先选路线

| 你手上是 | 建议 |
|---|---|
| 已经有 WSL2 | 直接做 Linux 版 `lab0-task.md`，省掉下面所有 Windows 适配 |
| 只有 Windows | 做本课。gcc 选 **w64devkit**（解压即用）或 **MSYS2**（要包管理时用） |

本套工作单里的命令都是 Linux 风格（`mkdir -p`、`curl`、`./x.bin`）。在 Windows 上让 AI 用 PowerShell 跑对应命令即可，语义一样。

---

## S1. 系统自带的

Windows 10/11 自带 `curl.exe` 和 PowerShell，不用装。
git 可选——本套实验不用 git。

---

## S2. Node

任选一种：

```powershell
winget install OpenJS.NodeJS.LTS
```

或者去 nodejs.org 下 LTS 的 `.msi`，**勾上 "Add to PATH"**。

重开一个 PowerShell 验证：

```powershell
node -v      # v24.x 或更高；DSH 要求 >= 24.9
```

想换版本的话装 nvm-windows；只用最新 LTS 就不需要。

---

## S3. pnpm

```powershell
npm install -g pnpm --registry=https://registry.npmmirror.com
pnpm -v
```

**必须装**：DSH 的插件安装器会 `spawn pnpm`，没有就报 `spawn pnpm ENOENT`，报错信息完全不提"缺 pnpm"。

---

## S4. gcc（两条路，选一条）

### 路线 A：w64devkit（推荐，免安装）

1. 到 <https://github.com/skeeto/w64devkit/releases> 下 `w64devkit-x64-<版本>.7z.exe`
2. 双击自解压，装到 `C:\w64devkit`（安装器里可以勾"加进 PATH"）
3. 没勾就手动加：`系统属性 → 环境变量 → 用户变量 Path → 新建`，填 `C:\w64devkit`
4. **重开** PowerShell：

```powershell
gcc --version      # 能打印版本
```

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

> 只认 **UCRT64** 这一套。别把 `mingw64\bin`、`usr\bin` 也一起塞进 PATH——三套 DLL 混在一起会出现"编得过、跑不起来"。

---

## S5. 装 DSH

```powershell
npm install -g @deepseek-ai/dsh
dsh --version        # 0.2.x
```

---

## S6. 首次启动

```powershell
mkdir C:\dsh-learn
cd C:\dsh-learn
dsh web
```

- 首次启动自动创建 `%USERPROFILE%\.dsh\profiles\web`
- 浏览器打开终端里打印的地址（默认 `http://127.0.0.1:8787`）
- 工作区**放本地盘**，别放 OneDrive / 网络盘：同步会锁文件，路径也可能超长

---

## S7. 后面几课的平台差异（做到时回来查）

| 哪一课 | Linux 写法 | Windows 改法 |
|---|---|---|
| Lab 2 `sys_info` | `uname -srm` | Windows 没有 `uname` → `argv: ['cmd', '/c', 'ver']` |
| Lab 4 / Lab 6 产物 | `filename + '.bin'` | 改成 `filename + '.exe'`（Windows 按扩展名找可执行文件最稳） |
| 路径拼接 | `/` | 插件里用 `path.join` 就不用管；`forge-out/` 也照旧相对插件目录 |
| 跑产物 | `./sum.bin` | `.\sum.exe`（或双击） |
| 命令行 | `mkdir -p` / `curl` | `New-Item -ItemType Directory -Force` / `curl.exe`（让 AI 换） |
| 数据目录 | `~/.dsh` | `%USERPROFILE%\.dsh` |

---

## S8. 验收清单

| 检查 | 命令 | 期望 |
|---|---|---|
| Node 够新 | `node -v` | `v24.9.0` 以上 |
| pnpm 在 | `pnpm -v` | 有版本号 |
| gcc 在 | `gcc --version` | 有版本号 |
| DSH 在 | `dsh --version` | `0.2.x` |
| profile 建好了 | `dir %USERPROFILE%\.dsh\profiles` | 有 `web` |
| GUI 能开 | 浏览器打开打印出的地址 | 能看到对话界面 |

---

## 排错对照表

| 症状 | 原因 / 处理 |
|---|---|
| `gcc : 无法将"gcc"项识别为 cmdlet…` | PATH 没加，或加了没重开终端；`where gcc` 看它在不在 |
| `spawn pnpm ENOENT`（装插件时） | pnpm 没装，或全局 bin 不在 PATH |
| 编出来的程序双击没反应 / 闪退 | 后缀不是 `.exe`；或 PATH 里混进了别的 MinGW 那套 DLL |
| `dsh: 无法识别` | npm 全局 bin 不在 PATH；`npm root -g` / `npm bin -g` 看装哪了 |
| GUI 打不开 | 端口被占 → `dsh --profile web --port 8080`；防火墙弹窗点"允许" |
| 路径太长报错 | 工作区挪浅（`C:\dsh-learn` 而不是 `C:\Users\你\Documents\...\很深的目录`） |
| 装了 WSL 又想回去 | 两条路线别混：在 Windows 里跑 `dsh web` 就用 Windows 的 gcc；在 WSL 里跑就用 WSL 的 gcc |

---

## 原理小结

| 概念 | 一句话 | OS 类比 |
|---|---|---|
| `%USERPROFILE%\.dsh` | DSH 的"根目录" | `~/.dsh` 的 Windows 版 |
| PATH | 系统去哪找 `gcc.exe` / `node.exe` | `PATH` 环境变量，和 Linux 一样 |
| MinGW | 在 Windows 上产出 PE 程序的 GNU 工具链 | 不是模拟器，就是 Windows 原生 exe |
| `spawn` 找 gcc | 插件调 `resolveExecutable('gcc')`，靠 PATH | 和你在 cmd 里敲 `gcc` 同一套查找规则 |

**Lab 0 的结论**：Windows 上 DSH 还是"Node 进程 + profile + Web 宿主"，gcc 只是被 `spawn` 的一个子进程 ——
所以只要 `gcc --version` 能在 PowerShell 里跑通，后面的课和 Linux 版没本质区别，差异都在 S7 那张表里。
