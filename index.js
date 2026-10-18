'use strict';
/**
 * XQL — eXtend Query Language
 * 让 SQL 具有 NoSQL 的迅速。
 *
 * 用法：
 *   const { xql } = require('./');
 *
 *   xql.load('users', rows);
 *   xql('FROM users |> WHERE age > 18 |> SELECT name, age |> ORDER BY name |> LIMIT 10');
 *   xql('SELECT name FROM users WHERE age > 18 ORDER BY name LIMIT 10');
 *   xql('FROM users |> WHERE age > 18', { users: rows });   // 也可以临时传集合
 */

const { parse } = require('./src/parser');
const { compileQuery } = require('./src/compiler');

/** 编译缓存：同一条查询只编译一次，之后直接吃闭包 */
const _cache = new Map();
const CACHE_MAX = 500;

function compile(query) {
  let fn = _cache.get(query);
  if (fn) return fn;
  fn = compileQuery(parse(query));
  if (_cache.size >= CACHE_MAX) _cache.clear();   // 简单防呆，避免无界增长
  _cache.set(query, fn);
  return fn;
}

/** 文档集合 —— NoSQL 手感 */
class Collection {
  constructor(name, rows = []) {
    this.name = name;
    this.rows = Array.isArray(rows) ? rows : [];
    this._compiled = new Map();
  }

  /** 直接吃 XQL 语句，集合自身作为数据源 */
  query(sql) {
    let fn = this._compiled.get(sql);
    if (!fn) {
      fn = compileQuery(parse(sql));
      if (fn.__source !== this.name) {
        throw new Error(`XQL: 查询的数据源是 '${fn.__source}'，但这是集合 '${this.name}'`);
      }
      this._compiled.set(sql, fn);
    }
    return fn(this.rows);
  }

  insert(...docs) { this.rows.push(...docs); return this; }
  clear() { this.rows.length = 0; return this; }
  get size() { return this.rows.length; }
}

/** 全局注册表 */
const _collections = new Map();

function load(name, rows) {
  const c = new Collection(name, rows);
  _collections.set(name, c);
  return c;
}

function collection(name) {
  const c = _collections.get(name);
  if (!c) throw new Error(`XQL: 集合 '${name}' 未加载（先 xql.load('${name}', rows)）`);
  return c;
}

/** 主入口 */
function xql(query, scope) {
  if (typeof query !== 'string') throw new Error('XQL: 第一个参数必须是查询字符串');
  const fn = compile(query);
  const src = fn.__source;

  let rows = null;
  if (scope !== undefined && scope !== null) {
    rows = Array.isArray(scope) ? scope : scope[src];
  } else {
    const c = _collections.get(src);
    if (c) rows = c.rows;
  }

  if (!Array.isArray(rows)) {
    throw new Error(scope !== undefined && scope !== null
      ? `XQL: scope 里没有集合 '${src}'`
      : `XQL: 集合 '${src}' 未加载 —— 先 xql.load('${src}', rows)，或把集合作为第二参数传入`);
  }
  return fn(rows);
}

xql.compile = compile;
xql.parse = parse;
xql.load = load;
xql.collection = collection;
xql.Collection = Collection;
xql.clearCache = () => { const n = _cache.size; _cache.clear(); return n; };
xql.cacheSize = () => _cache.size;
xql.version = '0.1.0';

module.exports = { xql, Collection, compile, parse, load, collection };
