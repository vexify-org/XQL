'use strict';
/**
 * XQL 基准：与手写 JS 循环对照。
 *
 * 目的不是「比别人快」，而是验证**编译路线没有白费** ——
 * 编译后的闭包应该逼近手写循环的理论下限。
 */
const { xql } = require('./');

const ROWS = Number(process.argv[2] || 100000);

const data = [];
for (let i = 0; i < ROWS; i++) {
  data.push({
    id: i + 1,
    name: `user_${i + 1}`,
    age: 20 + (i % 50),
    city: i % 3 === 0 ? 'SH' : (i % 3 === 1 ? 'BJ' : 'GZ'),
    score: (i % 10000) / 100,
    active: i % 2 === 0,
    profile: { level: i % 7, tag: `t${i % 11}` },
    tags: [`a${i % 5}`, `b${i % 3}`],
  });
}

const bench = (label, n, fn) => {
  fn();                       // 预热（让 JIT 上场）
  const t = process.hrtime.bigint();
  let hit = 0;
  for (let i = 0; i < n; i++) hit += fn(i).length;
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  console.log('  ' + label.padEnd(46) + (ms / n).toFixed(3) + 'ms/次  (命中 ' + (hit / n).toFixed(0) + ')');
  return ms / n;
};

console.log(`\n  XQL vs 手写 JS  ——  ${ROWS} 行\n`);

const Q_FILTER = 'FROM data |> WHERE age > 35';
const Q_FILTER_SEL = 'FROM data |> WHERE age > 35 |> SELECT name, age |> ORDER BY name |> LIMIT 100';
const Q_RANGE = 'FROM data |> WHERE score > 50';
const Q_NESTED = 'FROM data |> WHERE profile.level >= 4';
const Q_IDX = 'FROM data |> WHERE tags[0] = \'a0\'';
const Q_LIKE = "FROM data |> WHERE name LIKE 'user_1%'";
const Q_IN = 'FROM data |> WHERE age IN (25, 30, 35)';
const Q_OR = 'FROM data |> WHERE age > 40 OR city = \'GZ\'';

const P_FILTER = xql.compile(Q_FILTER);
const P_FILTER_SEL = xql.compile(Q_FILTER_SEL);
const P_RANGE = xql.compile(Q_RANGE);
const P_NESTED = xql.compile(Q_NESTED);
const P_IDX = xql.compile(Q_IDX);
const P_LIKE = xql.compile(Q_LIKE);
const P_IN = xql.compile(Q_IN);
const P_OR = xql.compile(Q_OR);

console.log('  --- 纯过滤 ---');
const a1 = bench('XQL  WHERE age > 35', 50, () => P_FILTER(data));
const b1 = bench('手写 rows.filter(r => r.age > 35)', 50, () => data.filter(r => r.age > 35));
console.log('    比值 ' + (a1 / b1).toFixed(2) + 'x\n');

console.log('  --- 过滤 + 投影 + 排序 + LIMIT ---');
const a2 = bench('XQL  WHERE|SELECT|ORDER BY|LIMIT', 20, () => P_FILTER_SEL(data));
const b2 = bench('手写 filter/map/sort/slice', 20, () =>
  data.filter(r => r.age > 35).map(r => ({ name: r.name, age: r.age })).sort((x, y) => x.name < y.name ? -1 : 1).slice(0, 100));
console.log('    比值 ' + (a2 / b2).toFixed(2) + 'x\n');

console.log('  --- 范围 ---');
const a3 = bench('XQL  WHERE score > 50', 20, () => P_RANGE(data));
const b3 = bench('手写 r.score > 50', 20, () => data.filter(r => r.score > 50));
console.log('    比值 ' + (a3 / b3).toFixed(2) + 'x\n');

console.log('  --- 嵌套点号路径 ---');
const a4 = bench('XQL  WHERE profile.level >= 4', 50, () => P_NESTED(data));
const b4 = bench('手写 r.profile.level >= 4', 50, () => data.filter(r => r.profile.level >= 4));
console.log('    比值 ' + (a4 / b4).toFixed(2) + 'x\n');

console.log('  --- 数组下标 ---');
const a5 = bench('XQL  WHERE tags[0] = \'a0\'', 50, () => P_IDX(data));
const b5 = bench('手写 r.tags[0] === \'a0\'', 50, () => data.filter(r => r.tags[0] === 'a0'));
console.log('    比值 ' + (a5 / b5).toFixed(2) + 'x\n');

console.log('  --- LIKE（正则编译一次）---');
const a6 = bench('XQL  WHERE name LIKE \'user_1%\'', 20, () => P_LIKE(data));
const b6 = bench('手写 /^user_1/.test', 20, () => data.filter(r => /^user_1/.test(r.name)));
console.log('    比值 ' + (a6 / b6).toFixed(2) + 'x\n');

console.log('  --- IN（常量集）---');
const a7 = bench('XQL  WHERE age IN (25,30,35)', 50, () => P_IN(data));
const b7 = bench('手写 Set.has', 50, () => { const s = new Set([25, 30, 35]); return data.filter(r => s.has(r.age)); });
console.log('    比值 ' + (a7 / b7).toFixed(2) + 'x\n');

console.log('  --- OR ---');
const a8 = bench('XQL  WHERE age>40 OR city=\'GZ\'', 50, () => P_OR(data));
const b8 = bench('手写 ||', 50, () => data.filter(r => r.age > 40 || r.city === 'GZ'));
console.log('    比值 ' + (a8 / b8).toFixed(2) + 'x\n');

const ratios = [a1 / b1, a2 / b2, a3 / b3, a4 / b4, a5 / b5, a6 / b6, a7 / b7, a8 / b8];
console.log('  --- 汇总 ---');
console.log('  平均 ' + (ratios.reduce((x, y) => x + y, 0) / ratios.length).toFixed(2) + 'x  '
  + '（1.0 = 与手写持平，越低越好）');
console.log('  编译缓存条目: ' + xql.cacheSize());
console.log();
