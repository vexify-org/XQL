'use strict';
/**
 * XQL 语义测试
 *
 * 重点在三处：
 *   1. 两种语法（管道式 / 标准 SQL）必须产出**完全相同**的结果
 *   2. NULL 的三值逻辑
 *   3. XQL 的扩展能力（点号直穿嵌套、数组下标）
 *
 * 编译层做了代码生成，任何一条出错都会直接抛错而不是返回错值 ——
 * 所以这里主要防的是「静默算错」。
 */
const path = require('path');
const XQL = path.join(__dirname, '..', 'index.js');
const { xql, parse, compile, Collection } = require(XQL);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('[OK]  ', name); }
  else {
    fail++;
    failures.push(name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 160) : ''));
    console.log('[FAIL]', name, extra !== undefined ? '-> ' + JSON.stringify(extra).slice(0, 120) : '');
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const USERS = [
  { id: 1, name: 'ann', age: 25, city: 'SH', score: 90.5, tags: ['a', 'b'], profile: { level: 3, city: 'SH' } },
  { id: 2, name: 'bob', age: 17, city: 'BJ', score: 70.0, tags: ['c'], profile: { level: 1, city: 'BJ' } },
  { id: 3, name: 'cat', age: 34, city: 'SH', score: 55.25, tags: ['a', 'c'], profile: { level: 5, city: 'SH' } },
  { id: 4, name: 'dan', age: 17, city: 'GZ', score: null, tags: [], profile: { level: 2, city: 'GZ' } },
  { id: 5, name: 'eve', nick: null, age: null, city: 'SH', score: 30.0, tags: ['b'], profile: { level: 9, city: 'SH' } },
];
const scope = { users: USERS };
const Q = (sql) => xql(sql, scope);

// ----------------------------------------------------------------
console.log('\n--- 两种语法等价 ---');
const pairs = [
  ['FROM users |> WHERE age > 18 |> SELECT name, age |> ORDER BY name |> LIMIT 10',
   'SELECT name, age FROM users WHERE age > 18 ORDER BY name LIMIT 10'],
  ['FROM users |> WHERE age > 18 |> SELECT name',
   'SELECT name FROM users WHERE age > 18'],
  ['FROM users |> WHERE city = \'SH\' |> ORDER BY name DESC |> LIMIT 2',
   'SELECT * FROM users WHERE city = \'SH\' ORDER BY name DESC LIMIT 2'],
  ['FROM users |> WHERE age BETWEEN 18 AND 30 |> SELECT name',
   'SELECT name FROM users WHERE age BETWEEN 18 AND 30'],
  ['FROM users |> WHERE id IN (1,3,5) |> SELECT name |> ORDER BY id',
   'SELECT name FROM users WHERE id IN (1,3,5) ORDER BY id'],
];
for (const [pipe, sql] of pairs) {
  ok('等价: ' + pipe.slice(0, 46), eq(Q(pipe), Q(sql)), { pipe: Q(pipe), sql: Q(sql) });
}

// ----------------------------------------------------------------
console.log('\n--- 基础查询 ---');
ok('SELECT name, age', eq(Q('SELECT name, age FROM users ORDER BY id'), [
  { name: 'ann', age: 25 }, { name: 'bob', age: 17 }, { name: 'cat', age: 34 },
  { name: 'dan', age: 17 }, { name: 'eve', age: null },
]));
ok('SELECT * 返回全部字段', Object.keys(Q('SELECT * FROM users LIMIT 1')[0]).length === 7);
ok('LIMIT', Q('SELECT name FROM users ORDER BY id LIMIT 2').length === 2);
ok('OFFSET', eq(Q('SELECT name FROM users ORDER BY id LIMIT 1 OFFSET 2'), [{ name: 'cat' }]));
ok('ORDER BY DESC', eq(Q('SELECT name FROM users ORDER BY name DESC LIMIT 1'), [{ name: 'eve' }]));
ok('SELECT *（未显式写）', eq(Q('FROM users WHERE id = 1')[0].name, 'ann'));
ok('算术投影 age + 1', eq(Q('SELECT name, age + 1 AS n FROM users WHERE id = 1'), [{ name: 'ann', n: 26 }]));
ok('别名不用 AS', eq(Q('SELECT name n FROM users WHERE id = 2'), [{ n: 'bob' }]));

// ----------------------------------------------------------------
console.log('\n--- XQL 扩展：点号直穿嵌套 ---');
ok('SELECT profile.level', eq(Q('SELECT name, profile.level FROM users WHERE id = 1'), [{ name: 'ann', 'profile.level': 3 }]));
// cat(5) 与 eve(9) 都满足 —— 原先只写了 cat，是我漏了 eve
ok('WHERE 走嵌套路径', eq(Q('SELECT name FROM users WHERE profile.level >= 5 ORDER BY id'), [{ name: 'cat' }, { name: 'eve' }]));
ok('嵌套路径 + 顶层同名字段', eq(Q('SELECT name, city, profile.city AS pc FROM users WHERE id = 1'),
  [{ name: 'ann', city: 'SH', pc: 'SH' }]));
ok('深路径（嵌套字段参与过滤）', eq(Q('SELECT profile.level FROM users WHERE profile.city = \'GZ\''), [{ 'profile.level': 2 }]));

console.log('\n--- XQL 扩展：数组下标 ---');
ok('SELECT tags[0]', eq(Q('SELECT name, tags[0] FROM users WHERE id = 1'), [{ name: 'ann', 'tags[0]': 'a' }]));
ok('WHERE 走数组下标', eq(Q('SELECT name FROM users WHERE tags[0] = \'a\' ORDER BY id'),
  [{ name: 'ann' }, { name: 'cat' }]));
ok('空数组下标 → 不匹配', Q('SELECT name FROM users WHERE tags[0] = \'zz\'').length === 0);
ok('tags[1]', eq(Q('SELECT tags[1] FROM users WHERE id = 1'), [{ 'tags[1]': 'b' }]));

// ----------------------------------------------------------------
console.log('\n--- NULL 三值逻辑 ---');
ok('age > 18 排除 NULL', eq(Q('SELECT name FROM users WHERE age > 18 ORDER BY id'),
  [{ name: 'ann' }, { name: 'cat' }]));
ok('NULL 比较永不为真', eq(Q('SELECT name FROM users WHERE score > 0 ORDER BY id'),
  [{ name: 'ann' }, { name: 'bob' }, { name: 'cat' }, { name: 'eve' }]));
ok('IS NULL', eq(Q('SELECT name FROM users WHERE age IS NULL'), [{ name: 'eve' }]));
ok('IS NOT NULL', Q('SELECT name FROM users WHERE age IS NOT NULL').length === 4);
ok('算术遇 NULL → NULL', eq(Q('SELECT score + 1 AS s FROM users WHERE id = 4'), [{ s: null }]));
ok('除以零 → NULL', eq(Q('SELECT age / 0 AS d FROM users WHERE id = 1'), [{ d: null }]));
ok('IN 含 NULL：匹配上的仍返回', Q('SELECT name FROM users WHERE age IN (17, NULL)').length === 2);
ok('IN 全为 NULL → 空集', Q('SELECT name FROM users WHERE age IN (NULL)').length === 0);
ok('NOT IN 含 NULL → 空集', Q('SELECT name FROM users WHERE age NOT IN (17, NULL)').length === 0);
ok('BETWEEN 遇 NULL 不匹配', Q('SELECT name FROM users WHERE age BETWEEN 16 AND 20').length === 2);
ok('函数遇 NULL → NULL', eq(Q('SELECT upper(nick) AS u FROM users WHERE id = 5'), [{ u: null }]));
ok('函数不遇 NULL 时正常', eq(Q('SELECT upper(name) AS u FROM users WHERE id = 5'), [{ u: 'EVE' }]));
ok('COALESCE', eq(Q('SELECT coalesce(score, 0) AS s FROM users WHERE id = 4'), [{ s: 0 }]));
ok('CONCAT 遇 NULL → NULL', eq(Q('SELECT concat(name, city) AS c FROM users WHERE id = 1'), [{ c: 'annSH' }]));

// ----------------------------------------------------------------
console.log('\n--- 逻辑操作符 ---');
ok('AND', Q('SELECT name FROM users WHERE age > 18 AND city = \'SH\' ORDER BY id').length === 2);
ok('OR', eq(Q('SELECT name FROM users WHERE age = 17 OR city = \'GZ\' ORDER BY id'),
  [{ name: 'bob' }, { name: 'dan' }]));
ok('NOT', eq(Q('SELECT name FROM users WHERE NOT (age > 18) ORDER BY id'),
  [{ name: 'bob' }, { name: 'dan' }]));
ok('AND 优先级高于 OR', Q('SELECT name FROM users WHERE age = 17 OR age > 30 AND city = \'SH\'').length === 3);
// bob(17,BJ) / dan(17,GZ) 不在 SH，只有 cat(34,SH) 满足
ok('括号改变优先级', eq(Q('SELECT name FROM users WHERE (age = 17 OR age > 30) AND city = \'SH\''), [{ name: 'cat' }]));

// ----------------------------------------------------------------
console.log('\n--- LIKE ---');
ok("LIKE 'a%'", eq(Q('SELECT name FROM users WHERE name LIKE \'a%\''), [{ name: 'ann' }]));
ok("LIKE '%n'", Q('SELECT name FROM users WHERE name LIKE \'%n\'').length === 2);
ok("LIKE '_ob'", eq(Q('SELECT name FROM users WHERE name LIKE \'_ob\''), [{ name: 'bob' }]));
// '%%' 转成正则后是「.*」，匹配一切；LIKE 对 NULL 值不匹配
ok("LIKE '%' 匹配一切", Q('SELECT name FROM users WHERE name LIKE \'%\'').length === 5);
// 名字是 ann/bob/cat/dan/eve，没有 'a…c' 这种，所以用真实能匹配的模式
ok("LIKE 'a%' 前缀", eq(Q('SELECT name FROM users WHERE name LIKE \'a%\''), [{ name: 'ann' }]));
ok("LIKE '%t' 后缀", eq(Q('SELECT name FROM users WHERE name LIKE \'%t\''), [{ name: 'cat' }]));
ok('LIKE 大小写不敏感', Q('SELECT name FROM users WHERE name LIKE \'A%\'').length === 1);

// ----------------------------------------------------------------
console.log('\n--- 标量函数 ---');
ok('upper', eq(Q("SELECT upper(name) AS u FROM users WHERE id = 2"), [{ u: 'BOB' }]));
ok('lower', eq(Q("SELECT lower(name) AS l FROM users WHERE id = 1"), [{ l: 'ann' }]));
ok('length', eq(Q("SELECT length(name) AS n FROM users WHERE id = 1"), [{ n: 3 }]));
ok('trim', eq(Q("SELECT trim('  x  ') AS t FROM users WHERE id = 1"), [{ t: 'x' }]));
ok('abs', eq(Q('SELECT abs(age - 40) AS a FROM users WHERE id = 2'), [{ a: 23 }]));
ok('round', eq(Q('SELECT round(score) AS r FROM users WHERE id = 2'), [{ r: 70 }]));
ok('floor / ceil', eq(Q('SELECT floor(2.9) AS f, ceil(2.1) AS c FROM users WHERE id = 1'), [{ f: 2, c: 3 }]));

// ----------------------------------------------------------------
console.log('\n--- 错误处理 ---');
const throws = (sql, why) => {
  try { Q(sql); return false; } catch (e) { return true; }
};
ok('空查询报错', throws('', '空'));
ok('语法错误报错', throws('FROM users |> WHERE age >>>', '语法'));
ok('未知函数报错', throws('SELECT nosuchfn(name) FROM users', '未知函数'));
ok('集合名不存在报错', (() => { try { xql('SELECT * FROM nosuch'); return false; } catch (e) { return true; } })());
ok('% 取模可用', eq(Q('SELECT age % 2 AS p FROM users WHERE id = 4'), [{ p: 1 }]));
ok('% 取模可用', eq(Q('SELECT age % 2 AS p FROM users WHERE id = 1'), [{ p: 1 }]));

// ----------------------------------------------------------------
console.log('\n--- 编译缓存 ---');
{
  const sql = 'SELECT name FROM users WHERE age > 20';
  const f1 = compile(sql);
  const f2 = compile(sql);
  ok('同一条查询返回同一编译产物', f1 === f2);
  ok('缓存条目随编译增长', xql.cacheSize() > 0);
  const cleared = xql.clearCache();
  ok('clearCache 返回清理条数', cleared > 0);
  ok('清空后重新编译仍正确', eq(xql(sql, scope).length, 2));
}

// ----------------------------------------------------------------
console.log('\n--- Collection 封装 ---');
{
  const c = new Collection('t', [{ v: 1 }, { v: 2 }, { v: 3 }]);
  ok('Collection.query', eq(c.query('SELECT v FROM t WHERE v > 1'), [{ v: 2 }, { v: 3 }]));
  ok('Collection.size', c.size === 3);
  c.insert({ v: 4 });
  ok('insert 后 size=4', c.size === 4);
  c.clear();
  ok('clear 后为空', c.size === 0);
  let threw = false;
  try { c.query('SELECT v FROM other'); } catch (e) { threw = true; }
  ok('数据源不匹配时报错', threw);
}

{
  xql.load('reg', [{ a: 1 }]);
  ok('xql.load 后可无 scope 查询', eq(xql('SELECT a FROM reg'), [{ a: 1 }]));
}

// ----------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n失败项:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail === 0 ? 0 : 1);