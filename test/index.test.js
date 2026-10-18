'use strict';
/**
 * 索引测试
 *
 * 核心原则：**索引只给候选，WHERE 谓词做最终判定**。
 * 所以这里最重要的不是「索引跑得快」，而是「有索引和无索引的结果**完全一样**」——
 * 顺序、内容、NULL 处理，一个都不能差。
 *
 * 这个文件抓到过三个真 bug：
 *   1. 索引用字符串键排序 → "number:48" 排在 "number:5" 后面 → 范围查询给错结果
 *   2. cmpValue 每次比较都分配两个数组 → 2000 个候选就是 4000 次分配
 *   3. `<=` 的「回退扫相等元素」方向反了 → `age <= 21` 只返回一半
 */
const path = require('path');
const XQL = path.join(__dirname, '..', 'index.js');
const { xql, Collection } = require(XQL);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('[OK]  ', name); }
  else {
    fail++;
    failures.push(name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 150) : ''));
    console.log('[FAIL]', name, extra !== undefined ? '-> ' + JSON.stringify(extra).slice(0, 110) : '');
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ----------------------------------------------------------------
console.log('\n--- 基础：数据构造 ---');
const N = 5000;
const mk = () => {
  const rows = [];
  for (let i = 0; i < N; i++) {
    rows.push({
      id: i + 1,
      name: 'user_' + (i + 1),
      age: 20 + (i % 50),
      city: 'C' + (i % 20),
      score: (i % 1000) / 10,
      vip: i % 97 === 0,
      nick: i % 13 === 0 ? null : 'n' + i,
    });
  }
  return rows;
};
const cNo = new Collection('t', mk());
const cIx = new Collection('t', mk());
ok('同规模集合', cNo.size === cIx.size && cNo.size === N);

// ----------------------------------------------------------------
console.log('\n--- 建索引 ---');
cIx.index('id', 'hash');
cIx.index('age', 'range');
cIx.index('score', 'range');
ok('已建 3 个索引', eq(cIx.indexFields().sort(), ['age', 'id', 'score']));
ok('默认按类型猜：数字字段给 range', new Collection('g', [{ a: 1 }, { a: 2 }]).index('a')._indexes.get('a').type === 'range');
ok('默认按类型猜：字符串字段给 hash', new Collection('g', [{ a: 'x' }]).index('a')._indexes.get('a').type === 'hash');

// ----------------------------------------------------------------
console.log('\n--- 有索引 vs 无索引：结果必须逐字节相同 ---');
const cases = [
  ['FROM t |> WHERE id = 2500', '等值 hash'],
  ['FROM t |> WHERE id = 99999', '等值不命中'],
  ['FROM t |> WHERE id = 0', '等值 0'],
  ['FROM t |> WHERE age = 35', '等值 range'],
  ['FROM t |> WHERE age > 47', '范围 >'],
  ['FROM t |> WHERE age >= 69', '范围 >='],
  ['FROM t |> WHERE age < 21', '范围 <'],
  ['FROM t |> WHERE age <= 21', '范围 <=（曾经只返回一半）'],
  ['FROM t |> WHERE age <= 69', '范围 <= 上界'],
  ['FROM t |> WHERE age >= 20', '范围 >= 下界'],
  ['FROM t |> WHERE score >= 99', '浮点范围'],
  ['FROM t |> WHERE score < 1', '浮点下界'],
  ['FROM t |> WHERE score = 50.5', '浮点等值'],
  ['FROM t |> WHERE vip = true', '布尔等值'],
  ['FROM t |> WHERE nick = null', 'null 等值（应恒不匹配）'],
  ['FROM t |> WHERE age > 30 AND city = \'C3\'', 'AND 双字段'],
  ['FROM t |> WHERE age = 25 AND id = 1', 'AND 互相矛盾'],
  ['FROM t |> WHERE id = 1 OR age = 25', 'OR（不该用索引）'],
  ['FROM t |> WHERE NOT (age = 25)', 'NOT（不该用索引）'],
  ["FROM t |> WHERE city = 'C3'", '无索引字段'],
  ['FROM t |> WHERE id > 4990', 'id 是 hash 但用了 >'],
  ['FROM t |> WHERE age > 30 |> SELECT id, name |> ORDER BY score |> LIMIT 5', '索引+投影+排序+LIMIT'],
  ['FROM t |> WHERE age > 30 |> WHERE city = \'C3\'', '两个 WHERE'],
  ['SELECT name FROM t WHERE age BETWEEN 30 AND 32 ORDER BY id', 'BETWEEN 不走索引但结果要对'],
];
for (const [sql, label] of cases) {
  const a = cNo.query(sql);
  const b = cIx.query(sql);
  ok('一致: ' + label, eq(a, b), { noIdx: JSON.stringify(a).slice(0, 90), idx: JSON.stringify(b).slice(0, 90) });
}

// ----------------------------------------------------------------
console.log('\n--- NULL 值不进索引，但查询结果不变 ---');
{
  const withNull = new Collection('n', mk().concat([{ id: 99999, age: 35, city: 'ZZ', score: null, vip: false, nick: null }]));
  withNull.index('age', 'range');
  const noIdx = new Collection('n', withNull.rows.map(r => ({ ...r })));
  ok('age=35 含 NULL 索引行时一致',
    eq(withNull.query('FROM n |> WHERE age = 35'), noIdx.query('FROM n |> WHERE age = 35')));
  ok('score=null 不被索引命中',
    eq(withNull.query('FROM n |> WHERE score = null').length, 0));
  ok('score=null 行仍在全扫结果里（age 查询）',
    withNull.query('FROM n |> WHERE age = 35').some(r => r.id === 99999));
}

// ----------------------------------------------------------------
console.log('\n--- 数据变动后索引必须重建 ---');
{
  const c = new Collection('m', [{ id: 1, age: 20 }, { id: 2, age: 30 }]);
  c.index('id', 'hash');
  c.index('age', 'range');
  ok('初始：age=30 命中 1 行', c.query('FROM m |> WHERE age = 30').length === 1);
  c.insert({ id: 3, age: 30 });
  ok('insert 后 age=30 命中 2 行（索引已重建）', c.query('FROM m |> WHERE age = 30').length === 2);
  ok('insert 后 id=3 可查', c.query('FROM m |> WHERE id = 3').length === 1);
  c.reindex();
  ok('reindex 后正常', c.query('FROM m |> WHERE age = 30').length === 2);
}

// 绕过 insert() 直接改 rows 曾经会静默丢数据：
// 索引是快照，给出的候选里没有新行，而谓词只在候选里做判定 —— 新行整个漏掉。
// 现在 query() 会比一次长度，对不上就自动重建。
console.log('\n--- 绕过 insert() 直接改 rows（曾静默丢数据）---');
{
  const rows = [];
  for (let i = 0; i < 1000; i++) rows.push({ id: i + 1, age: 20 + (i % 50) });
  const c = new Collection('m', rows);
  c.index('age', 'range');
  const before = c.query('FROM m |> WHERE age = 35').length;
  c.rows.push({ id: 1001, age: 35 });
  const after = c.query('FROM m |> WHERE age = 35');
  ok('直推 rows 后不丢新行（长度不符自动重建）',
    after.length === before + 1 && after.some(r => r.id === 1001), { before, after: after.length });
}

// ----------------------------------------------------------------
console.log('\n--- Collection API ---');
{
  const c = new Collection('api', mk());
  c.index('id');
  ok('indexFields 返回字段名', c.indexFields().length === 1);
  ok('index() 返回 this（可链式）', c.index('age') === c);
  c.dropIndexes();
  ok('dropIndexes 后清空', c.indexFields().length === 0);
  ok('无索引时结果依旧正确', c.query('FROM api |> WHERE id = 2500').length === 1);
  c.clear();
  ok('clear 后为空', c.size === 0);
}

// ----------------------------------------------------------------
console.log('\n--- 与 xql 全局入口配合 ---');
{
  xql.load('gi', mk().slice(0, 500));
  xql.index('gi', 'id', 'hash');
  ok('xql.index 后查询生效', xql('FROM gi |> WHERE id = 300').length === 1);
  ok('无索引字段照常全扫', xql('FROM gi |> WHERE name = \'user_77\'').length === 1);
  const coll = xql.collection('gi');
  ok('collection() 拿到的是带索引的那个', coll.indexFields().length === 1);
  ok('把 Collection 直接当 scope 传入也能用',
    xql('FROM gi |> WHERE id = 300', coll).length === 1);
}

// ----------------------------------------------------------------
console.log('\n--- 缓存不能串味（有索引 / 无索引是两份生成码）---');
{
  const a = new Collection('cc', mk().slice(0, 200));
  const b = new Collection('cc', mk().slice(0, 200));
  const sql = 'FROM cc |> WHERE id = 5';
  const ra = a.query(sql);
  b.index('id', 'hash');
  const rb = b.query(sql);
  ok('同一 SQL 在有/无索引集合上结果一致', eq(ra, rb), { ra: JSON.stringify(ra), rb: JSON.stringify(rb) });
}

// ----------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n失败项:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail === 0 ? 0 : 1);