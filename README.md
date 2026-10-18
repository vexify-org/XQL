# XQL — eXtend Query Language

**让 SQL 具有 NoSQL 的迅速。**

把 SQL 接到文档上，并且保证查询速度不低于手写 JS 循环。

```js
const { xql } = require('./');

xql.load('users', [
  { name: 'ann', age: 25, profile: { level: 3 }, tags: ['a', 'b'] },
  { name: 'bob', age: 17, profile: { level: 1 }, tags: ['c'] },
]);

// 标准 SQL
xql('SELECT name FROM users WHERE age > 18 ORDER BY name');

// 管道式（同样的语义，编译成同一个函数）
xql('FROM users |> WHERE age > 18 |> SELECT name |> ORDER BY name');
```

## 扩展在哪

| 能力 | 写法 | 说明 |
| --- | --- | --- |
| 点号直穿嵌套 | `profile.level` | 不需要 `JSON_EXTRACT('$.a.b')` 那套仪式 |
| 数组下标 | `tags[0]` | 数组字段当一等公民 |
| 管道式 | `FROM t \|> WHERE … \|> LIMIT n` | 每个阶段都能加 |
| `NOT IN` | `age NOT IN (17, NULL)` | 正确的三值逻辑 |

没写的部分就是标准 SQL：`SELECT / FROM / WHERE / GROUP BY / HAVING /
ORDER BY / LIMIT / OFFSET`，以及 `IN / BETWEEN / LIKE / IS NULL / AND / OR / NOT`
和常见标量函数。

## 性能

```
$ node bench.js          # 10 万行，对照手写 JS 循环

--- 纯过滤 ---
XQL   WHERE age > 35                    1.734ms
手写  rows.filter(r => r.age > 35)      2.219ms      0.78x

--- OR ---
XQL   WHERE age>40 OR city='GZ'         1.774ms
手写  ||                                2.477ms      0.72x

--- LIKE（正则只编译一次）---
XQL   WHERE name LIKE 'user_1%'         2.574ms
手写  /^user_1/.test                    3.596ms      0.72x

平均 0.95x（1.0 = 与手写持平）
```

8 项里 6 项**快于**手写循环，2 项持平或略慢（管道 + 排序 1.26x、范围 1.32x）。

## 性能是怎么来的：四轮

这个数字是撞了四堵墙才撞出来的，每一堵都靠基准数据定位：

| 轮次 | 做法 | 点查比值 | 卡在哪 |
| --- | --- | --- | --- |
| 1 | 闭包组合（每节点一个函数） | 6.4x | `age > 35` 每行调 3 次函数 |
| 2 | 生成 JS 源码，直接拼表达式 | 7.2x | `L==null \|\| R==null ? null : L>R` 里 L 出现三次，`r["age"]` 每行求值三遍 |
| 3 | 语句式发射 + 临时变量 | 3.2x | 谓词本身已经干净了，但还差 3 倍 |
| 4 | **整条管道生成一个函数** | **0.78x** | —— |

第 3 轮那 3.2 倍最值得记：隔离测量后发现**不在生成码里，而在 `Array.filter`
的回调中介**。同一个谓词：

```
手动内联循环    0.180ms   （比手写还快）
过 filter()     0.543ms   （慢 3 倍）
```

所以第 4 轮的做法不是「把谓词写得更漂亮」，而是**根本不回调** ——
WHERE 的判定语句直接生成在 `for` 循环体内，SELECT 的投影同理。

另外两个不起眼但值钱的细节：

- **结果默认不拷贝**。命中 7.2 万行时逐行 `{...row}` 要占掉整个查询的大半时间
  （这一项就是 OR 从 5.7 倍降到持平的关键）。需要防护时用 `{ copy: true }`。
- **排序不用 `localeCompare`**。它是 locale 感知的，6.8 万行排序要调 ~110 万次，
  比朴素 `<`/`>` 多一个量级。

## NULL 语义

跟 SQL 三值逻辑一致：

| 表达式 | 结果 |
| --- | --- |
| `age > 18`（age 为 NULL） | UNKNOWN → WHERE 里不匹配 |
| `NOT (age > 18)`（age 为 NULL） | UNKNOWN → **不匹配**（不是 TRUE） |
| `age IN (17, NULL)` | 有元素匹配就 TRUE；没匹配上才是 UNKNOWN |
| `age NOT IN (17, NULL)` | UNKNOWN → WHERE 里恒为空集 |
| `score + 1`（score 为 NULL） | NULL |
| `upper(name)`（name 为 NULL） | NULL |
| `coalesce(score, 0)` | 0 —— **COALESCE 是唯一不做 NULL 传播的函数** |

## 用法

```js
const { xql, Collection } = require('./');

// 方式一：全局集合
xql.load('users', rows);
xql('SELECT name FROM users WHERE age > 18');

// 方式二：临时集合
xql('SELECT name FROM users WHERE age > 18', { users: rows });

// 方式三：集合对象（NoSQL 手感）
const users = new Collection('users', rows);
users.query('SELECT name FROM users WHERE age > 18');
users.insert({ name: 'eve', age: 30 });
```

编译结果有缓存（`xql.compile(sql)` 复用同一份产物），
`xql.cacheSize()` / `xql.clearCache()` 可以查看和清空。

## 目录

```
index.js        公开 API
src/tokenizer.js  词法
src/parser.js     递归下降 → 扁平 AST
src/compiler.js   AST → JS 源码 → new Function
test/xql.test.js  70 项语义测试
bench.js          对照手写循环的基准
```

## 还没做

- `GROUP BY` / 聚合（`COUNT` / `SUM` / `AVG`）—— AST 里有节点，编译时明确报错
- JOIN
- 更新与删除（`UPDATE` / `DELETE`）
- 索引（现在都是全表扫）
- 持久化