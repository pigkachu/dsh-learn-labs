/**
 * 参考实现 · @example/forge —— Host 半边
 *
 * 这个目录是给读者**对照**用的答案，不是任何一课的作业。它和跟着工作单写出来的东西
 * 结构一致：
 *
 *   apply(ctx)            入口：注册 4 个工具 + 2 条 /api 路由
 *   gen_c_with_llm(...)   入口层：自然语言 → C 源码（唯一碰模型的地方）
 *   compileC(...)         内核：只认 C 源码，落盘 + gcc + 可选运行
 *   get_builds()          只读：把 forge-out/ 列成数组
 *
 * 三条贯穿全课的约定：
 *   1. 能力写成函数，入口写成薄薄一层 —— 工具和面板复用同一个内核；
 *   2. 跨边界（进程 / HTTP）只传 JSON，Error 对象本身过不去，要先把 message 抄出来；
 *   3. 钱要花在该花的地方：能白嫖的校验（文件名、body 形状）放在调模型之前。
 *
 * ⚠ 它和你自己的插件用同样的工具名和路由路径，**不要同时装进同一个 profile**。
 */
import path from 'node:path';
import { mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';

/** 用到的宿主服务：工具注册 / 子进程 / 模型 / 默认模型选择 / 浏览器 ⇄ Host 通道 */
export const inject = ['tools', 'subprocess', 'llm', 'agentDefaultModel', 'connection'];

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 产物都落在工作区的 forge-out/ 下（不能写 /tmp，见 Lab 4） */
const OUT_DIR = path.join(import.meta.dirname, '..', 'forge-out');

/** 文件名只允许字母、数字、下划线、连字符 —— 不锚定的话 `../evil` 能写到目录外 */
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertName(name) {
  if (name !== undefined && NAME_PATTERN.test(name) === false) {
    throw new Error('文件名只能包含字母、数字、下划线、连字符');
  }
}

/** 从模型回复里抽代码块；没有围栏但有 #include 就把整段当代码 */
function extractCode(text) {
  const fenced = text.match(/```[cC]?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  if (text.includes('#include')) return text.trim();
  throw new Error('模型输出里没有找到 C 代码');
}

/** 边界上只传字符串：把 Error 的对象形态拍平 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** 读子进程的采集输出（只读一次，取全量） */
function readCollected(handle, stream) {
  const reader = handle.collected[stream];
  return reader ? reader.readFrom(0).text : '';
}

// ---------------------------------------------------------------------------
// 入口层：自然语言 → C 源码
// ---------------------------------------------------------------------------

/**
 * @param {string} spec 自然语言描述
 * @param {AbortSignal} signal 调用级取消信号（用户点停止 / 浏览器断连）
 * @param {any} ctx 插件上下文
 * @returns {Promise<string>} 纯 C 源码（已 trim）
 */
async function gen_c_with_llm(spec, signal, ctx) {
  const selection = ctx.agentDefaultModel.currentSelection();
  if (!selection) throw new Error('当前会话还没有选择模型');

  let text = '';
  const stream = ctx.llm.stream({
    provider: selection.provider,
    model: selection.model,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: `只输出一个 \`\`\`c 代码块，不要解释。\n\n任务：${spec}` }],
      },
    ],
    signal,
  });

  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') {
      text += chunk.text;
    } else if (chunk.type === 'finish') {
      // 流不会为失败 throw，而是把原因装进 finish —— 必须自己判
      const kind = chunk.reason.kind;
      if (kind === 'aborted') throw new Error('模型调用被取消');
      if (kind === 'error') throw new Error(`模型调用失败：${chunk.reason.failure?.message ?? kind}`);
    }
  }

  return extractCode(text);
}

// ---------------------------------------------------------------------------
// 内核：编译 / 运行（不碰模型）
// ---------------------------------------------------------------------------

/**
 * @param {string} source C 源码
 * @param {{ name?: string, run?: boolean, stdin?: string, signal?: AbortSignal }} opts
 * @param {any} ctx 插件上下文
 * @returns {Promise<object>} { id, dir, source, binary, code, compile_*, run_* }
 */
async function compileC(source, opts, ctx) {
  const name = opts.name ?? Math.random().toString(36).slice(2, 6);
  const filenameC = `${name}.c`;
  const filenameBin = `${name}.bin`;

  // 1. 每次一个独立子目录：gcc 有中间产物，混在一起会互相覆盖
  await mkdir(OUT_DIR, { recursive: true }); // ← 不要接返回值：目录已存在时是 undefined
  const dir = await mkdtemp(path.join(OUT_DIR, 'forge-'));
  await writeFile(path.join(dir, filenameC), source); // ← 必须 await，否则 gcc 读到空文件

  // 2. 编译：cwd 设在子目录里，argv 用相对文件名
  const gcc = await ctx.subprocess.resolveExecutable('gcc');
  const build = ctx.subprocess.spawn({
    argv: [gcc, filenameC, '-o', filenameBin],
    cwd: dir,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64 * 1024 },
      stderr: { maxBytes: 64 * 1024 },
    },
    graceMs: 10000,
    signal: opts.signal,
  });
  const built = await build.done; // ← 先等退出再读结果
  if (built.exitCode !== 0) {
    throw new Error(`${path.join(dir, filenameC)}: ${readCollected(build, 'stderr')}`);
  }

  const result = {
    id: path.basename(dir),
    dir,
    source: path.join(dir, filenameC),
    binary: path.join(dir, filenameBin),
    code: source, // 浏览器没有 fs，要显示源码就得把内容一起带过去
    compile_stdout: readCollected(build, 'stdout'),
    compile_stderr: readCollected(build, 'stderr'),
  };

  // 3. 可选：跑一次产物。stdin 用 { data } —— 写完即关闭，fscanf 能读到 EOF
  if (opts.run === true) {
    const run = ctx.subprocess.spawn({
      argv: [path.join(dir, filenameBin)],
      cwd: dir,
      stdio: {
        stdin: { data: opts.stdin ?? '' },
        stdout: { maxBytes: 64 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 10000,
      signal: opts.signal,
    });
    const ran = await run.done;
    result.run_stdout = readCollected(run, 'stdout');
    result.run_stderr = readCollected(run, 'stderr');
    // 被信号杀死时 exitCode 是 null，就不给这个字段（schema 里它只能是 number）
    if (ran.exitCode !== null) result.run_exit_code = ran.exitCode;
  }

  return result;
}

// ---------------------------------------------------------------------------
// 只读：列构建
// ---------------------------------------------------------------------------

/** @returns {Promise<Array<{id:string,source:string,binary:string,size:number,mtime:number}>>} */
async function get_builds() {
  let entries;
  try {
    entries = await readdir(OUT_DIR, { withFileTypes: true });
  } catch (error) {
    // 还没构建过：空目录不是错误
    if (error instanceof Error && /** @type {any} */ (error).code === 'ENOENT') return [];
    throw error;
  }

  const builds = [];
  for (const entry of entries) {
    if (entry.isDirectory() === false) continue;

    const dir = path.join(OUT_DIR, entry.name);
    const files = await readdir(dir);
    const cFile = files.find((file) => file.endsWith('.c'));
    const binFile = files.find((file) => file.endsWith('.bin'));
    // 编译失败的残骸（有 .c 没 .bin）跳过
    if (cFile === undefined || binFile === undefined) continue;

    const bin = path.join(dir, binFile);
    const info = await stat(bin);
    builds.push({
      id: entry.name,
      source: path.join(dir, cFile),
      binary: bin,
      size: info.size,
      mtime: info.mtimeMs,
    });
  }

  // 新的排前面
  builds.sort((a, b) => b.mtime - a.mtime);
  return builds;
}

// ---------------------------------------------------------------------------
// 入口：工具
// ---------------------------------------------------------------------------

export function apply(ctx) {
  ctx.tools.register({
    name: 'echo_text',
    description: '把输入的文字原样返回 n 次。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要回显的文字' },
        times: { type: 'integer', description: '回显次数' },
      },
      required: ['text', 'times'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args) => {
      const { text, times } = /** @type {{ text: string, times: number }} */ (args);
      return Array.from({ length: times }, () => text).join('\n');
    },
  });

  ctx.tools.register({
    name: 'sys_info',
    description: '返回宿主机的内核与架构信息（uname -srm）。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (_args, exec) => {
      const uname = await ctx.subprocess.resolveExecutable('uname');
      const handle = ctx.subprocess.spawn({
        argv: [uname, '-srm'],
        cwd: import.meta.dirname,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 4096 },
          stderr: { maxBytes: 4096 },
        },
        graceMs: 5000,
        signal: exec.signal,
      });
      const outcome = await handle.done;
      if (outcome.exitCode !== 0) throw new Error(readCollected(handle, 'stderr'));
      return readCollected(handle, 'stdout').trim();
    },
  });

  ctx.tools.register({
    name: 'gen_c',
    description: '按自然语言描述生成一段 C 代码（只生成，不编译）。',
    parameters: {
      type: 'object',
      properties: {
        spec: { type: 'string', description: '想写的程序描述' },
      },
      required: ['spec'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (args, exec) => {
      const { spec } = /** @type {{ spec: string }} */ (args);
      return gen_c_with_llm(spec, exec.signal, ctx);
    },
  });

  ctx.tools.register({
    name: 'build_c',
    description: '按自然语言描述生成 C 代码，编译成可执行文件，可选运行一次。',
    parameters: {
      type: 'object',
      properties: {
        spec: { type: 'string', description: '想写的程序描述' },
        filename: { type: 'string', description: '产物文件名（字母/数字/_/-）' },
        stdin: { type: 'string', description: '运行时喂给程序的输入' },
        run: { type: 'boolean', description: '编译成功后是否运行' },
      },
      required: ['spec'],
    },
    output: {
      // 成功和失败两种形状都声明；required 留空 = 字段随情况出现
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '构建目录名' },
          dir: { type: 'string', description: '构建目录绝对路径' },
          source: { type: 'string', description: '.c 文件绝对路径' },
          binary: { type: 'string', description: '.bin 文件绝对路径' },
          code: { type: 'string', description: '生成的 C 源码' },
          compile_stdout: { type: 'string' },
          compile_stderr: { type: 'string' },
          run_stdout: { type: 'string' },
          run_stderr: { type: 'string' },
          run_exit_code: { type: 'number' },
          err: { type: 'boolean', description: '失败时为 true' },
          err_log: { type: 'string', description: '失败原因' },
        },
        required: [],
      },
      render: (_args, value) => {
        const result = /** @type {any} */ (value);
        if (result.err) return [{ type: 'text', text: `失败：${result.err_log}` }];
        const lines = [`源码：${result.source}`, `可执行文件：${result.binary}`];
        if ('run_stdout' in result) {
          lines.push(`运行输出：${result.run_stdout || '(空)'}`);
          lines.push(`退出码：${result.run_exit_code ?? '(被信号杀死)'}`);
        }
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    execute: async (args, exec) => {
      try {
        const { spec, filename, stdin, run } = /** @type {any} */ (args);
        assertName(filename); // 花钱之前挡掉非法文件名
        const code = await gen_c_with_llm(spec, exec.signal, ctx);
        return await compileC(code, { name: filename, stdin, run, signal: exec.signal }, ctx);
      } catch (error) {
        // 工具入口把失败变成数据：模型看得懂，也不会把整轮对话搞崩
        return { err: true, err_log: messageOf(error) };
      }
    },
  });

  // -------------------------------------------------------------------------
  // 入口：HTTP（/api 下受认证的 exact 路由）
  // -------------------------------------------------------------------------

  ctx.connection.fetch.register({
    path: '/api/forge/builds',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => Response.json(await get_builds()),
  });

  ctx.connection.fetch.register({
    path: '/api/forge/compile',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      // ① 解析：body 不是 JSON 是客户端的错 → 400
      let payload;
      try {
        payload = await request.json();
      } catch {
        return Response.json({ error: 'body 必须是 JSON' }, { status: 400 });
      }

      // ② 校验：参数不合法也是客户端的错，且必须在调模型之前（省一次模型调用）
      if (typeof payload.spec !== 'string' || payload.spec.trim() === '') {
        return Response.json({ error: 'spec 不能为空' }, { status: 400 });
      }
      try {
        assertName(payload.name);
      } catch (error) {
        return Response.json({ error: messageOf(error) }, { status: 400 });
      }

      // ③ 干活：生成 → 编译 →（可选）运行。这里失败是服务端的失败 → 500
      try {
        const code = await gen_c_with_llm(payload.spec, request.signal, ctx);
        const result = await compileC(
          code,
          { name: payload.name, stdin: payload.stdin, run: payload.run, signal: request.signal },
          ctx,
        );
        return Response.json(result);
      } catch (error) {
        return Response.json({ error: messageOf(error) }, { status: 500 });
      }
    },
  });
}
