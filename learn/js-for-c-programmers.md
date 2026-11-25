# 给 C 程序员的 JS 速查

只列你会踩的差异。每条都对照 C 写，看到能想起「哦，是那个」。

---

## 1. 类型与变量

```js
const x = 1;        // 绑定不可重新赋值（但对象的字段仍可改）
let y = 2;          // 可重新赋值
y = 3;
// var 别用：函数作用域 + 变量提升，坑多
```

- **动态类型**：变量没有类型，值才有。"类型"是运行时的。
- `const` ≠ 常量对象：`const o = {}; o.a = 1;` 合法；`o = {}` 报错。
- 作用域是**块级**（`{}` 内），不是函数级。

| C | JS |
|---|---|
| `int a[10]` 固定长度 | `const a = []` 动态增长，元素可混合类型 |
| `struct` | 对象字面量 `{ x: 1, y: 2 }` |
| `char*` | 字符串（不可变，UTF-16） |
| `NULL` | `null` / `undefined`（两个不同的东西） |
| `sizeof` | 没有有意义的概念 |

## 2. 相等与真值：最容易被 C 带偏

```js
1 == '1'    // true  ← 隐式转换，别用
1 === '1'   // false ← 永远用这个
NaN === NaN // false ← 特例，用 Number.isNaN(x) 判断
```

**假值只有 6 个**：`false`、`0`、`-0`、`''`、`null`、`undefined`、`NaN`（其实 7 个）。
其余全是真：`'0'`、`[]`、`{}`、`'false'` 都是**真**。

```js
if ('0') { /* 会进来 */ }
if ([]) { /* 也会进来 */ }
```

## 3. 数字

- 只有一种数字类型：64 位浮点。**没有整数除法**：`7 / 2 === 3.5`，要整除用 `Math.floor(7/2)`。
- `0.1 + 0.2 !== 0.3`（和 C 的 double 一样，只是 C 里你习惯不比较浮点）。
- 位运算会先转成 32 位整数：`1 << 31` 是负数。
- `parseInt('08')` 在老环境会按八进制，永远写 `parseInt(x, 10)`。

## 4. 字符串

```js
const name = 'ok';
console.log(`hi ${name}, ${1 + 2}`);  // 模板字符串：反引号 + ${}
'abc'.length        // 3
'a' + 'b'           // 'ab'（不可变，每次拼接产生新串）
'abc'.includes('b') // true
'ABC'.toLowerCase() // 'abc'
```

## 5. 数组：你会写的循环，基本都有现成的

| 意图（C 写法） | JS |
|---|---|
| `for` 遍历改值 → 新数组 | `arr.map(x => x * 2)` |
| 条件收集 | `arr.filter(x => x > 0)` |
| 累加 | `arr.reduce((acc, x) => acc + x, 0)` |
| 查找第一个 | `arr.find(x => x.id === id)` |
| 是否存在 | `arr.some(x => x > 0)` / 全部满足 `arr.every(...)` |
| 排序（`qsort` 要比较函数） | `arr.sort((a, b) => a - b)` |
| 拼接 | `a.concat(b)` 或 `[...a, ...b]` |
| 取一段 | `arr.slice(start, end)`（不改原数组） |
| 原地插入/删除 | `arr.splice(i, 1)`（**改原数组**） |
| 尾部增删 | `arr.push(x)` / `arr.pop()`（**改原数组**） |

三个必记的坑：

1. **`sort` 原地改**，`map`/`filter`/`concat`/`slice` 产生新数组；
2. `sort()` 不传比较函数会**按字符串**排：`[10, 9].sort()` → `[10, 9]`；
3. **越界不崩溃**：`arr[99]` 是 `undefined`，C 里是未定义行为。

## 6. 引用语义 —— React 的核心

```js
const a = [1, 2];
const b = a;        // 同一个数组，不是拷贝
b.push(3);          // a 也变了

const c = [...a];   // 浅拷贝：新数组，内容仍是同样的引用
const o2 = { ...o }; // 对象浅拷贝
```

**为什么这决定 React 行为**：React 用 `===` 判断"数据变没变"。
`current.push(x)` 改了原数组但引用没变 → React 认为没变 → **界面不更新**。
所以正确写法是**产生新数组**：

```js
setNotes([newNote, ...current]);       // 新数组
setNotes(current.filter(n => n.id !== id)); // filter 本来就返回新数组
```

## 7. 函数

```js
function add(a, b) { return a + b; }   // 声明式
const add2 = (a, b) => a + b;          // 箭头函数，单表达式可省 return
const add3 = (a, b) => { return a + b; };

[1, 2].map((n) => n * 2);  // 传函数当参数（相当于 C 的函数指针）
```

- 参数可以不传 / 多传，缺的是 `undefined`，多的被忽略（没有函数重载）。
- 默认参数：`function f(a = 1) {}`。
- **箭头函数没有自己的 `this`**；本插件全程不用 `this`，所以不用关心。
- **闭包**：函数能"记住"定义时外层的变量，这是 `useCallback`/事件回调能工作的基础。

## 8. 对象

```js
const o = { a: 1, b: 'x' };
o.a;            // 1
o['a'];         // 1（键是字符串）
o.c = 3;        // 随时加字段
delete o.c;
const { a, b } = o;            // 解构：取出字段当变量
const { a: renamed } = o;      // 重命名
const copy = { ...o, c: 3 };   // 浅拷贝 + 覆盖
```

## 9. 异常（C 没有，用返回值/errno）

```js
try {
  JSON.parse('不是 JSON');   // 会抛
} catch (error) {
  // 兜底
} finally {
  // 一定执行
}
```

`throw` 出来的可以是任何值，习惯上抛 `Error`。**Promise 的失败也用 `try/catch` 接**（配合 `await`）。

## 10. 异步：唯一需要换脑子的一块

C 的模型：调用 → 阻塞 → 返回。
JS 浏览器主线程：调用 → **立刻返回一个 Promise** → 稍后回调。

```js
async function copyText(text) {
  await navigator.clipboard.writeText(text);  // 等它完成，但线程没被卡住
  return true;                                 // async 函数永远返回 Promise
}

// 调用方：要么 await，要么 .then
const ok = await copyText('hi');
```

- `async` 函数里 `throw` 等价于返回一个「失败态 Promise」；
- `await` 只是把后面的代码挂到"完成之后"，不阻塞渲染；
- 浏览器里 `await` 之后拿到的是**微任务**，UI 不会被冻住。

## 11. 模块

本插件的 `client.js` 用宿主给的 `require` 取 React；而你写的其他 `.mjs` 文件用标准 ESM：

```js
import fs from 'node:fs';        // 取默认导出
export function apply() {}        // 导出
```

同一份代码里不要混用两种风格（`require` 是 CJS，`import` 是 ESM）。

## 12. `typeof` 的坑

```js
typeof 1        // 'number'
typeof 'a'      // 'string'
typeof true     // 'boolean'
typeof undefined// 'undefined'
typeof function(){} // 'function'
typeof null     // 'object'  ← 历史 bug，判断 null 要写 x === null
typeof []       // 'object'  ← 判断数组用 Array.isArray(x)
```

## 13. C 思维陷阱清单（自查）

1. 用 `==` 而不是 `===`；
2. 以为 `'0'` 是假；
3. 以为 `7/2` 是 3；
4. `push` 改原数组后期待 React 更新；
5. 忘记 `arr[99]` 不报错，是 `undefined`；
6. 循环里用 `var` 捕获同一个变量（用 `let`）；
7. 比较 `NaN`；
8. 把 `typeof null` 当 `'null'`；
9. 以为 `const` 对象不可变；
10. 以为 `await` 会阻塞整个页面。
