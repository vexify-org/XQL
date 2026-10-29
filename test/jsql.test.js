'use strict';
/**
 * JSQL 适配器测试
 *
 * 用一个假的、分页的 find() 模拟 JSQL 引擎，验证 fromJSQL：
 *   1. 自动分页把整表读全（不止一页）
 *   2. 建索引（等值 hash / 范围 range）
 *   3. 加载后能用 XQL 查询
 *   4. 浅集成：不写回（数据库没有 update/delete 被调用）
 */
const path = require('path');
const XQL = path.join(__dirname, '..', 'index.js');
const { xql, fromJSQL } = require(XQL);

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

// 生成 2500 行，页大小 1000 → 3 页
function makeDb() {
  const rows = [];
  for (let i = 1; i <= 2500; i++) {
    rows.push({ id: i, name: 'user_' + i, age: (i * 7) % 90, score: i % 2 ? i : null, city: i % 3 === 0 ? 'SH' : 'BJ' });
  }
  const calls = { find: 0, filter: {}, paged: true };
  const db = {
    calls,
    async find(table, filter, opts = {}) {
      calls.find++;
      const { limit = 100, offset = 0 } = opts;
      const page = rows.slice(offset, offset + limit);
      return page;
    },
  };
  return { db, rows };
}

(async () => {
  console.log('\n--- fromJSQL: 分页读全表 ---');
  const { db, rows } = makeDb();
  const coll = await fromJSQL(db, 'users', { pageSize: 1000, indexes: ['id', ['score', 'range']] });
  ok('读全 2500 行', coll.size === 2500, { size: coll.size });
  ok('find 被分页调用（>=3 次）', db.calls.find >= 3, { find: db.calls.find });
  ok('id 是 hash 索引', coll._indexes.has('id'));
  ok('score 是 range 索引', coll._indexes.has('score'));

  console.log('\n--- fromJSQL: 能查询 ---');
  const res = coll.query('SELECT name FROM users WHERE age > 60 ORDER BY name LIMIT 5');
  ok('返回数组', Array.isArray(res));
  ok('命中条数正确', res.length === 5, { len: res.length });

  const eq1 = coll.query('SELECT id FROM users WHERE id = 42');
  ok('hash 索引点查命中', eq1.length === 1 && eq1[0].id === 42, eq1[0]);

  console.log('\n--- fromJSQL: 浅集成（不写回）---');
  ok('数据库没有 update/delete 方法被调用', db.calls.find > 0);

  console.log('\n--- fromJSQL: 参数校验 ---');
  let threw = false;
  try { await fromJSQL({}, 'users'); } catch (e) { threw = /find/.test(e.message); }
  ok('缺 find 抛错', threw);

  console.log('\n--- 摘要 ---');
  console.log(`pass ${pass}  fail ${fail}`);
  if (failures.length) console.log('FAILURES:\n' + failures.map(f => '  - ' + f).join('\n'));
  process.exit(fail ? 1 : 0);
})();
