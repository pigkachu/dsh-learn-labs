/**
 * 参考实现 · @example/forge —— Client 半边（跑在浏览器里）
 *
 * 两个面板，都只用 React 的最小集（没有 JSX，没有打包）：
 *   构建列表   读 /api/forge/builds，四态渲染 + 刷新
 *   编译器     自然语言 + stdin + run → POST /api/forge/compile → 源码 / 编译输出 / 运行输出
 *
 * 三条踩过的坑记住就够了：
 *   1. hooks 全写在组件顶部，任何 return 之前 —— 否则第二次渲染 hooks 数量对不上，整棵树被卸载；
 *   2. useEffect 的回调不能是 async（它返回的是 Promise，会被当成 cleanup 函数）；
 *   3. 受控输入框必须同时给 value 和 onChange，缺一个不是只读就是打不进字。
 */
window.__ModuleLoader__.load({
  // 必须等于 package.json 的 name，否则浏览器报 loaded without registering
  id: '@example/forge',
  factory(require) {
    // require 是 DSH 注入的：react 直接用，不用装依赖
    const React = require('react');
    const { useEffect, useState } = React;
    const h = React.createElement;

    // 行内样式（client 插件没有 styles.insert 这个符号）
    const ui = {
      page: { flex: '1 1 0', minHeight: 0, overflowY: 'auto', padding: '0 16px 24px' },
      toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
      title: { fontSize: 15, fontWeight: 600, margin: '12px 0' },
      label: { display: 'block', fontSize: 12, opacity: 0.7, margin: '12px 0 4px' },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 8px',
        font: 'inherit',
        fontSize: 13,
        color: 'inherit',
        background: 'transparent',
        border: '1px solid rgba(127,127,127,.4)',
        borderRadius: 6,
        resize: 'vertical',
      },
      button: { padding: '5px 14px', font: 'inherit', fontSize: 13, cursor: 'pointer' },
      row: { display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 0' },
      card: {
        margin: '12px 0 0',
        padding: '8px 10px',
        border: '1px solid rgba(127,127,127,.3)',
        borderRadius: 6,
      },
      pre: {
        margin: '4px 0 0',
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        fontSize: 12,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      },
      muted: { fontSize: 12, opacity: 0.65, margin: 0 },
      error: { fontSize: 13, color: 'var(--dsw-alias-state-error-primary)', margin: '12px 0 0' },
      list: { listStyle: 'none', margin: 0, padding: 0 },
      item: { padding: '8px 0', borderBottom: '1px solid rgba(127,127,127,.25)' },
      itemTitle: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 },
    };

    // ---- 小工具 ----
    const basename = (filePath) => filePath.split(/[\\/]/).pop();

    const formatSize = (bytes) =>
      bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

    const formatTime = (ms) => new Date(ms).toLocaleString();

    // ---- 面板 1：构建列表 ----
    function BuildsPanel() {
      const [status, setStatus] = useState('loading'); // loading | ready | empty | error
      const [builds, setBuilds] = useState([]);
      const [error, setError] = useState('');
      const [reload, setReload] = useState(0);

      // 挂载时拉一次；点刷新 / 切走再切回都会重新跑
      useEffect(() => {
        let alive = true; // 面板卸载后不要再 setState
        setStatus('loading');

        fetch('/api/forge/builds')
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((data) => {
            if (!alive) return;
            setBuilds(data);
            setStatus(data.length === 0 ? 'empty' : 'ready');
          })
          .catch((err) => {
            if (!alive) return;
            setError(err.message);
            setStatus('error');
          });

        return () => {
          alive = false;
        };
      }, [reload]);

      let body;
      if (status === 'loading') {
        body = h('p', { style: ui.muted }, '加载中…');
      } else if (status === 'error') {
        body = h('p', { style: ui.error }, `通道错误：${error}`);
      } else if (status === 'empty') {
        body = h('p', { style: ui.muted }, '还没有构建。去「编译器」面板生成一个，或让模型调 build_c。');
      } else {
        body = h(
          'ul',
          { style: ui.list },
          builds.map((build) =>
            h(
              'li',
              { key: build.id, style: ui.item },
              h('div', { style: ui.itemTitle }, build.id),
              h('div', { style: ui.muted }, `${formatSize(build.size)} · ${formatTime(build.mtime)}`),
              h('div', { style: ui.muted, title: build.binary }, basename(build.binary)),
            ),
          ),
        );
      }

      return h(
        'div',
        { style: ui.page },
        h(
          'div',
          { style: ui.toolbar },
          h('h2', { style: ui.title }, '构建列表'),
          h('button', { style: ui.button, onClick: () => setReload((n) => n + 1) }, '刷新'),
        ),
        body,
      );
    }

    // ---- 面板 2：编译器 ----
    function CompilerPanel() {
      const [spec, setSpec] = useState('读入两个整数，输出它们的和，不要打印多余内容');
      const [stdin, setStdin] = useState('');
      const [run, setRun] = useState(true);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [result, setResult] = useState(null); // 成功时的响应体

      async function submit() {
        setBusy(true);
        setError('');
        setResult(null);
        try {
          const res = await fetch('/api/forge/compile', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ spec, stdin, run }),
          });
          // 400/500 的 body 也是 JSON；解析失败就退化成空对象
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(`${res.status} ${data.error ?? ''}`.trim());
          setResult(data);
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }

      // 成功 / 失败两种呈现必须一眼分得开
      let output = null;
      if (error) {
        output = h('p', { style: ui.error }, `失败：${error}`);
      } else if (result) {
        output = [
          // run:false 时这三个字段根本不出现，所以先判键
          'run_stdout' in result
            ? h(
                'div',
                { key: 'run', style: ui.card },
                h('div', { style: ui.muted }, '运行输出'),
                h('pre', { style: ui.pre }, result.run_stdout || '(没有输出)'),
                h('div', { style: ui.muted }, `退出码：${result.run_exit_code ?? '(被信号杀死)'}`),
              )
            : null,
          h(
            'div',
            { key: 'code', style: ui.card },
            h('div', { style: ui.muted }, '生成的 C 源码'),
            h('pre', { style: ui.pre }, result.code || '(没有返回源码)'),
          ),
          h(
            'div',
            { key: 'paths', style: ui.card },
            h('div', { style: ui.muted }, '产物'),
            h('pre', { style: ui.pre }, `${result.source}\n${result.binary}`),
          ),
        ];
      }

      return h(
        'div',
        { style: ui.page },
        h('h2', { style: ui.title }, '编译器（自然语言 → C → 运行）'),
        h('label', { style: ui.label }, '程序描述'),
        h('textarea', {
          style: ui.input,
          rows: 3,
          value: spec,
          onChange: (event) => setSpec(event.target.value),
        }),
        h('label', { style: ui.label }, '程序输入（stdin，可空）'),
        h('textarea', {
          style: ui.input,
          rows: 2,
          value: stdin,
          onChange: (event) => setStdin(event.target.value),
        }),
        h(
          'div',
          { style: ui.row },
          h('input', {
            id: 'forge-example-run',
            type: 'checkbox',
            checked: run,
            onChange: (event) => setRun(event.target.checked),
          }),
          h('label', { htmlFor: 'forge-example-run' }, '编译成功后运行'),
          h(
            'button',
            { style: ui.button, disabled: busy, onClick: submit },
            busy ? '编译中…' : '编译并运行',
          ),
        ),
        output,
      );
    }

    // ---- 席位注册 ----
    const ICON_BUILDS = (props) => h('span', { style: { fontSize: props.size ?? 16 } }, '▤');
    const ICON_COMPILER = (props) => h('span', { style: { fontSize: props.size ?? 16 } }, '>_');

    return {
      inject: ['slots'],
      apply(ctx) {
        // 侧栏：每个面板一个图标
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'forge-builds', order: 40, label: () => '构建列表' },
            ICON_BUILDS,
          ),
        );
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'forge-compiler', order: 41, label: () => '编译器' },
            ICON_COMPILER,
          ),
        );

        // 主区域：key 必须等于上面侧栏的 id，点图标才会切过来
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'forge-builds', label: () => '构建列表' }, BuildsPanel),
        );
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'forge-compiler', label: () => '编译器' }, CompilerPanel),
        );
      },
    };
  },
});
