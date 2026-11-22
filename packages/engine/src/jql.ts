/** A deliberately small JQL subset: exactly what learned rules and simple imported rules need. */
import { SET_FIELDS, toSet, type Snapshot } from './model';
import { tokenize } from './text';

export type Expr =
  | { op: 'and' | 'or'; args: Expr[] }
  | { op: 'not'; arg: Expr }
  | { op: 'eq' | 'neq'; field: string; value: string }
  | { op: 'in' | 'notin'; field: string; values: string[] }
  | { op: 'empty' | 'notempty'; field: string }
  | { op: 'contains'; field: 'summary' | 'description' | 'text'; value: string };

export class UnsupportedJql extends Error {}

export interface ParseOptions {
  /** lower-case JQL field name → canonical field */
  aliases?: Record<string, string>;
  /** display value → id for a canonical field */
  resolve?: (field: string, value: string) => string;
}

type Tok = { t: 'word' | 'str' | 'sym'; v: string };

function lex(s: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(!=|!~|>=|<=|[=~(),<>!])|([^\s"'(),=~!<>]+))/gy;
  let m: RegExpExecArray | null;
  while (re.lastIndex < s.length && (m = re.exec(s))) {
    if (m[1] !== undefined || m[2] !== undefined) out.push({ t: 'str', v: (m[1] ?? m[2])!.replace(/\\(.)/g, '$1') });
    else if (m[3]) out.push({ t: 'sym', v: m[3] });
    else if (m[4]) out.push({ t: 'word', v: m[4] });
  }
  if (s.slice(re.lastIndex).trim()) throw new UnsupportedJql(`cannot read JQL near "${s.slice(re.lastIndex)}"`);
  return out;
}

const KW = (tok: Tok | undefined, kw: string) => tok?.t === 'word' && tok.v.toLowerCase() === kw;

export function parseJql(s: string, opts: ParseOptions = {}): Expr {
  const toks = lex(s);
  let i = 0;
  const peek = () => toks[i];
  const next = () => {
    const t = toks[i++];
    if (!t) throw new UnsupportedJql('unexpected end of JQL');
    return t;
  };
  const field = (raw: string) => opts.aliases?.[raw.toLowerCase()] ?? raw;
  const value = (f: string, tok: Tok) => {
    if (tok.t === 'sym') throw new UnsupportedJql(`expected a value, got "${tok.v}"`);
    if (toks[i]?.v === '(') throw new UnsupportedJql(`functions are not supported (${tok.v}())`);
    return opts.resolve ? opts.resolve(f, tok.v) : tok.v;
  };

  const primary = (): Expr => {
    if (KW(peek(), 'not')) { i++; return { op: 'not', arg: primary() }; }
    if (peek()?.v === '(' && peek()?.t === 'sym') {
      i++;
      const e = orExpr();
      if (next().v !== ')') throw new UnsupportedJql('missing )');
      return e;
    }
    const ft = next();
    if (ft.t === 'sym') throw new UnsupportedJql(`unexpected "${ft.v}"`);
    const f = field(ft.v);
    const op = next();
    if (op.t === 'sym' && (op.v === '=' || op.v === '!=')) return { op: op.v === '=' ? 'eq' : 'neq', field: f, value: value(f, next()) };
    if (op.t === 'sym' && op.v === '~') {
      if (!['summary', 'description', 'text'].includes(f)) throw new UnsupportedJql(`~ only on summary/description/text, not ${f}`);
      return { op: 'contains', field: f as 'summary', value: next().v };
    }
    if (KW(op, 'is')) {
      const neg = KW(peek(), 'not') ? (i++, true) : false;
      const w = next();
      if (!KW(w, 'empty') && !KW(w, 'null')) throw new UnsupportedJql('IS must be followed by EMPTY');
      return { op: neg ? 'notempty' : 'empty', field: f };
    }
    const negIn = KW(op, 'not') ? (next(), true) : KW(op, 'in') ? false : null;
    if (negIn !== null) {
      if (next().v !== '(') throw new UnsupportedJql('IN needs (');
      const values: string[] = [];
      for (;;) {
        values.push(value(f, next()));
        const sep = next();
        if (sep.v === ')') break;
        if (sep.v !== ',') throw new UnsupportedJql('expected , or )');
      }
      return { op: negIn ? 'notin' : 'in', field: f, values };
    }
    throw new UnsupportedJql(`operator "${op.v}" is not supported`);
  };
  const andExpr = (): Expr => {
    const args = [primary()];
    while (KW(peek(), 'and')) { i++; args.push(primary()); }
    return args.length === 1 ? args[0]! : { op: 'and', args };
  };
  const orExpr = (): Expr => {
    const args = [andExpr()];
    while (KW(peek(), 'or')) { i++; args.push(andExpr()); }
    return args.length === 1 ? args[0]! : { op: 'or', args };
  };

  const e = orExpr();
  if (i < toks.length) throw new UnsupportedJql(`unsupported JQL after "${toks[i - 1]?.v}": "${toks[i]!.v}"`);
  return e;
}

export type Truth = boolean | 'unknown';
export interface EvalContext { description?: string }

export function evalJql(e: Expr, snap: Snapshot, ctx: EvalContext = {}): Truth {
  switch (e.op) {
    case 'and': {
      let unknown = false;
      for (const a of e.args) { const r = evalJql(a, snap, ctx); if (r === false) return false; if (r === 'unknown') unknown = true; }
      return unknown ? 'unknown' : true;
    }
    case 'or': {
      let unknown = false;
      for (const a of e.args) { const r = evalJql(a, snap, ctx); if (r === true) return true; if (r === 'unknown') unknown = true; }
      return unknown ? 'unknown' : false;
    }
    case 'not': {
      const r = evalJql(e.arg, snap, ctx);
      return r === 'unknown' ? r : !r;
    }
    case 'contains': {
      if (e.field !== 'summary' && ctx.description === undefined) return 'unknown';
      const text = e.field === 'summary' ? (snap.summary ?? '') : e.field === 'description' ? (ctx.description ?? '') : `${snap.summary ?? ''} ${ctx.description ?? ''}`;
      const have = new Set(tokenize(text));
      const want = tokenize(e.value);
      return want.length > 0 && want.every((w) => have.has(w));
    }
  }
  if (!(e.field in snap)) return 'unknown';
  const v = snap[e.field] ?? null;
  const vals = SET_FIELDS.has(e.field) ? toSet(v) : v === null ? [] : [v];
  switch (e.op) {
    case 'eq': return vals.includes(e.value);
    case 'neq': return !vals.includes(e.value);
    case 'in': return e.values.some((x) => vals.includes(x));
    case 'notin': return !e.values.some((x) => vals.includes(x));
    case 'empty': return vals.length === 0;
    case 'notempty': return vals.length > 0;
  }
}

const q = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`;

export function toJql(e: Expr, parent?: Expr['op']): string {
  switch (e.op) {
    case 'and':
    case 'or': {
      const s = e.args.map((a) => toJql(a, e.op)).join(e.op === 'and' ? ' AND ' : ' OR ');
      return parent === 'and' && e.op === 'or' ? `(${s})` : parent === 'not' ? `(${s})` : s;
    }
    case 'not': return `NOT ${toJql(e.arg, 'not')}`;
    case 'eq': return `${e.field} = ${q(e.value)}`;
    case 'neq': return `${e.field} != ${q(e.value)}`;
    case 'in': return `${e.field} IN (${e.values.map(q).join(', ')})`;
    case 'notin': return `${e.field} NOT IN (${e.values.map(q).join(', ')})`;
    case 'empty': return `${e.field} IS EMPTY`;
    case 'notempty': return `${e.field} IS NOT EMPTY`;
    case 'contains': return `${e.field} ~ ${q(e.value)}`;
  }
}
