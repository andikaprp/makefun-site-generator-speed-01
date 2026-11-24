// makefun-site 1.0.0 reimplemented from its published spec for speed.
// Single dependency-free module: run(input) -> { outputPath: text }.
// All state lives inside one run() call; nothing is shared between cases.

// ---------------------------------------------------------------- text rules

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escHtml(s) {
  // Fast path: most strings need no escaping at all.
  let bad = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) { bad = i; break; }
  }
  if (bad === -1) return s;
  let out = s.slice(0, bad);
  for (let i = bad; i < s.length; i++) {
    const ch = s[i];
    const e = ESC[ch];
    out += e === undefined ? ch : e;
  }
  return out;
}

function escChar(c) {
  const e = ESC[c];
  return e === undefined ? c : e;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(date) {
  const dash1 = date.indexOf('-');
  const dash2 = date.indexOf('-', dash1 + 1);
  const y = date.slice(0, dash1);
  const m = Number(date.slice(dash1 + 1, dash2));
  const d = Number(date.slice(dash2 + 1));
  return d + ' ' + MONTH_NAMES[m - 1] + ' ' + y;
}

// Slug worker; results are memoised by the caller-supplied cache (per run).
function slugCompute(text) {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      if (out.length > 0) gap = true;
      continue;
    }
    if (gap) { out += '-'; gap = false; }
    out += keep;
  }
  if (out.length > 64) out = out.slice(0, 64);
  // Drop a trailing run of '-' (only possible at the cut, or never).
  let end = out.length;
  while (end > 0 && out.charCodeAt(end - 1) === 45) end--;
  if (end !== out.length) out = out.slice(0, end);
  return out === '' ? 'untitled' : out;
}

function uniqueIn(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = slug + '-' + n;
  taken.add(out);
  return out;
}

const cmpCU = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ------------------------------------------------------------ front matter

const FM_KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);

function daysInMonth(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

// A title/summary value: quoted with only \" and \\ escapes, or bare.
// Returns the string, or null after setting err.msg.
function fmString(raw, err) {
  if (raw.charCodeAt(0) === 34) { // "
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) {
      err.msg = 'a quoted string is not closed';
      return null;
    }
    let out = '';
    const last = raw.length - 1;
    for (let i = 1; i < last; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === last) {
          err.msg = 'a quoted string holds an escape other than \\" or \\\\';
          return null;
        }
        out += n;
        i++;
      } else if (c === '"') {
        err.msg = 'a quoted string holds a stray quote';
        return null;
      } else out += c;
    }
    return out;
  }
  if (raw.charCodeAt(0) === 91) { // [
    err.msg = 'a bare string opens on [';
    return null;
  }
  return raw;
}

function isDigitStr(s, a, b) {
  for (let i = a; i < b; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

// One key's value. Returns { v } or { e }.
function fmValue(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const err = { msg: null };
      const s = fmString(raw, err);
      return err.msg === null ? { v: s } : { e: 'key "' + key + '": ' + err.msg };
    }
    case 'date': {
      let ok = raw.length === 10 && raw[4] === '-' && raw[7] === '-'
        && isDigitStr(raw, 0, 4) && isDigitStr(raw, 5, 7) && isDigitStr(raw, 8, 10);
      if (ok) {
        const y = Number(raw.slice(0, 4));
        const mo = Number(raw.slice(5, 7));
        const d = Number(raw.slice(8, 10));
        ok = y >= 1970 && y <= 2099 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
      }
      return ok ? { v: raw } : { e: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    }
    case 'tags': {
      if (raw[0] !== '[' || raw[raw.length - 1] !== ']') return { e: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { v: [] };
      const parts = inner.split(',');
      const tags = new Array(parts.length);
      for (let i = 0; i < parts.length; i++) {
        const t = parts[i].trim();
        if (t === '' || t.includes('"') || t.includes('[') || t.includes(']')) {
          return { e: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
        tags[i] = t;
      }
      return { v: tags };
    }
    case 'draft':
      if (raw === 'true') return { v: true };
      if (raw === 'false') return { v: false };
      return { e: 'key "draft": true or false' };
    case 'layout': {
      if (raw.length === 0) return { e: 'key "layout": not a template name' };
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-')) return { e: 'key "layout": not a template name' };
      }
      return { v: raw };
    }
    case 'slug': {
      // [a-z0-9]+(-[a-z0-9]+)* , at most 64 chars.
      let ok = raw.length >= 1 && raw.length <= 64;
      if (ok) {
        let seg = 0;
        for (let i = 0; i < raw.length; i++) {
          const c = raw[i];
          if (c === '-') {
            if (seg === 0) { ok = false; break; }
            seg = 0;
          } else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) seg++;
          else { ok = false; break; }
        }
        if (seg === 0) ok = false;
      }
      return ok ? { v: raw } : { e: 'key "slug": not a slug' };
    }
  }
  return { e: 'unknown key "' + key + '"' };
}

// Parse one source's front matter. Returns { data, body } or { error }.
function parseFrontMatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    // Blank (spaces/tabs only) or comment?
    let blank = true;
    for (let j = 0; j < line.length; j++) {
      const c = line.charCodeAt(j);
      if (c !== 32 && c !== 9) { blank = false; break; }
    }
    if (blank || line.charCodeAt(0) === 35) continue; // '#'
    // "key: value": key of [a-z_]+, a colon, then end or one space + rest.
    let k = 0;
    while (k < line.length) {
      const c = line.charCodeAt(k);
      if ((c >= 97 && c <= 122) || c === 95) k++;
      else break;
    }
    if (k === 0 || line[k] !== ':') return { error: 'line ' + (i + 1) + ' is not "key: value"' };
    let raw;
    if (k + 1 === line.length) raw = '';
    else if (line[k + 1] === ' ') raw = line.slice(k + 2);
    else return { error: 'line ' + (i + 1) + ' is not "key: value"' };
    const key = line.slice(0, k);
    // Trailing spaces/tabs dropped.
    let e = raw.length;
    while (e > 0) {
      const c = raw.charCodeAt(e - 1);
      if (c === 32 || c === 9) e--;
      else break;
    }
    if (e !== raw.length) raw = raw.slice(0, e);
    if (!FM_KEYS.has(key)) return { error: 'unknown key "' + key + '"' };
    if (Object.hasOwn(data, key)) return { error: 'key "' + key + '" is given twice' };
    if (raw === '') return { error: 'key "' + key + '" has no value' };
    const v = fmValue(key, raw);
    if ('e' in v) return { error: v.e };
    data[key] = v.v;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: lines.slice(close + 1).join('\n') };
}

// ---------------------------------------------------------------- markdown

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b) {
    const c = line.charCodeAt(a);
    if (c === 32 || c === 9) a++;
    else break;
  }
  while (b > a) {
    const c = line.charCodeAt(b - 1);
    if (c === 32 || c === 9) b--;
    else break;
  }
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

// Fence opener: ``` + lang chars + spaces/tabs. Returns lang string or null.
function fenceOpen(line) {
  if (!line.startsWith('```')) return null;
  let i = 3;
  const start = i;
  while (i < line.length) {
    const c = line[i];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '+' || c === '-') i++;
    else break;
  }
  const lang = line.slice(start, i);
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === 32 || c === 9) i++;
    else return null;
  }
  return lang;
}

function fenceClose(line) {
  if (!line.startsWith('```')) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// Heading: 1-6 '#', at least one space/tab, non-empty text (trailing blanks cut).
function headingOf(line) {
  let n = 0;
  while (n < line.length && line[n] === '#') n++;
  if (n === 0 || n > 6) return null;
  if (n >= line.length) return null;
  const c = line.charCodeAt(n);
  if (c !== 32 && c !== 9) return null;
  let a = n;
  while (a < line.length) {
    const cc = line.charCodeAt(a);
    if (cc === 32 || cc === 9) a++;
    else break;
  }
  let b = line.length;
  while (b > a) {
    const cc = line.charCodeAt(b - 1);
    if (cc === 32 || cc === 9) b--;
    else break;
  }
  if (b <= a) return null;
  return { depth: n, text: line.slice(a, b) };
}

function isHR(line) {
  let word;
  if (line.startsWith('---')) word = 3;
  else if (line.startsWith('***')) word = 3;
  else return false;
  for (let i = word; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// Bullet marker: "- " or "* ". Returns content start or -1.
function bulletAt(line) {
  const c = line.charCodeAt(0);
  if ((c === 45 || c === 42) && line.charCodeAt(1) === 32) return 2;
  return -1;
}

// Ordered marker: 1-9 digits, ". ". Returns { start, numStart } or null.
function orderedAt(line) {
  let i = 0;
  while (i < line.length && i < 9) {
    const c = line.charCodeAt(i);
    if (c >= 48 && c <= 57) i++;
    else break;
  }
  if (i === 0) return null;
  // A 10th digit means the run is longer than 9: the regex \d{1,9} then '.'
  // cannot match because the char after 9 digits is a digit, not '.'.
  if (line[i] === '.' && line[i + 1] === ' ') return { content: i + 2, num: Number(line.slice(0, i)) };
  return null;
}

function isContinued(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  if (i < 2 || i >= line.length) return false;
  const c = line[i];
  return c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r' && c !== '\v' && c !== '\f';
}

function endsParagraph(line) {
  return isBlankLine(line) || fenceOpen(line) !== null || headingOf(line) !== null || isHR(line);
}

// First index >= from where `what` occurs outside a backslash escape, or -1.
function findUnescaped(s, what, from) {
  const lim = s.length - what.length;
  for (let j = from; j <= lim; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

// First single '*' (not part of a '**' run) outside an escape, or -1.
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (c !== '*') continue;
    if (s[j + 1] === '*') { j++; continue; }
    return j;
  }
  return -1;
}

const WS_RE = /\s/;

// Inline renderer: recursive on strong/em/link spans, as the dialect nests.
function renderInline(s, linkFn) {
  // Chunk-based: plain text between constructs is flushed in one escHtml pass
  // (which returns the slice untouched when it holds no &<>"'), and the result
  // is assembled from parts with one join - no per-character string growth.
  const parts = [];
  const n = s.length;
  let i = 0;
  let runStart = 0;
  const flush = (to) => {
    if (to > runStart) parts.push(escHtml(s.slice(runStart, to)));
  };
  while (i < n) {
    const code = s.charCodeAt(i);
    if (code === 92 && i + 1 < n && ESCAPABLE.has(s[i + 1])) { // backslash escape
      flush(i);
      parts.push(escChar(s[i + 1]));
      i += 2;
      runStart = i;
      continue;
    }
    if (code === 96) { // '`' code span
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        flush(i);
        parts.push('<code>' + escHtml(s.slice(i + 1, j)) + '</code>');
        i = j + 1;
        runStart = i;
      } else {
        i++;
      }
      continue;
    }
    if (code === 42) { // '*' strong / emphasis
      if (s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          flush(i);
          parts.push('<strong>' + renderInline(s.slice(i + 2, j), linkFn) + '</strong>');
          i = j + 2;
          runStart = i;
        } else {
          i += 2;
        }
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        flush(i);
        parts.push('<em>' + renderInline(s.slice(i + 1, j), linkFn) + '</em>');
        i = j + 1;
        runStart = i;
      } else {
        i++;
      }
      continue;
    }
    if (code === 91) { // '[' link
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !WS_RE.test(target)) {
        flush(i);
        parts.push('<a href="' + escHtml(linkFn(target)) + '">' + renderInline(s.slice(i + 1, k), linkFn) + '</a>');
        i = m + 1;
        runStart = i;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  flush(n);
  return parts.join('');
}

// Render one body. slugFn is the run's memoised slugify.
function renderMarkdown(src, linkFn, slugFn) {
  const lines = src.split('\n');
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (isBlankLine(line)) { i++; continue; }
    const lang = fenceOpen(line);
    if (lang !== null) {
      i++;
      const bodyParts = [];
      while (i < n && !fenceClose(lines[i])) { bodyParts.push(escHtml(lines[i])); i++; }
      i++; // the closing fence line, or one past the end
      const body = bodyParts.length === 0 ? '' : bodyParts.join('\n') + '\n';
      blocks.push(lang === '' ? '<pre><code>' + body + '</code></pre>' : '<pre><code class="language-' + escHtml(lang) + '">' + body + '</code></pre>');
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueIn(slugFn(heading.text), ids);
      const html = renderInline(heading.text, linkFn);
      blocks.push('<h' + heading.depth + ' id="' + id + '">' + html + '</h' + heading.depth + '>');
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      i++;
      continue;
    }
    if (isHR(line)) { blocks.push('<hr>'); i++; continue; }
    if (line.charCodeAt(0) === 62) { // '>'
      const kept = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        const raw = lines[i];
        const stripped = raw.charCodeAt(1) === 32 ? raw.slice(2) : raw.slice(1);
        const t = trimLine(stripped);
        if (t !== '') kept.push(t);
        i++;
      }
      blocks.push(kept.length === 0 ? '<blockquote>\n</blockquote>' : '<blockquote>\n<p>' + renderInline(kept.join('\n'), linkFn) + '</p>\n</blockquote>');
      continue;
    }
    const bAt = bulletAt(line);
    const oAt = bAt === -1 ? orderedAt(line) : null;
    if (bAt !== -1 || oAt !== null) {
      const isOrd = oAt !== null;
      const items = [];
      while (i < n) {
        const L = lines[i];
        const mAt = isOrd ? orderedAt(L) : null;
        const mbAt = isOrd ? -1 : bulletAt(L);
        if (isOrd ? mAt !== null : mbAt !== -1) {
          items.push([trimLine(L.slice(isOrd ? mAt.content : mbAt))]);
          i++;
        } else if (isContinued(L)) {
          items[items.length - 1].push(trimLine(L));
          i++;
        } else break;
      }
      const tag = isOrd ? 'ol' : 'ul';
      const open = isOrd && oAt.num !== 1 ? '<ol start="' + oAt.num + '">' : '<' + tag + '>';
      const blockParts = [open];
      for (const parts of items) blockParts.push('<li>' + renderInline(parts.join('\n'), linkFn) + '</li>');
      blockParts.push('</' + tag + '>');
      blocks.push(blockParts.join('\n'));
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) { body.push(trimLine(lines[i])); i++; }
    const html = renderInline(body.join('\n'), linkFn);
    if (excerpt === null) excerpt = html;
    blocks.push('<p>' + html + '</p>');
  }
  const html = blocks.length === 0 ? '' : blocks.join('\n') + '\n';
  return { html, toc, excerpt: excerpt === null ? '' : excerpt };
}

// --------------------------------------------------------------- templates

class TplError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

function tplPath(name, text) {
  if (!PATH_RE.test(text)) throw new TplError('template "' + name + '": ' + JSON.stringify(text) + ' is not a path');
  return text.split('.');
}

function allBlank(s, a, b) {
  for (let i = a; i < b; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function tokenizeTemplate(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === n - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const closer = raw ? '}}}' : '}}';
      const close = src.indexOf(closer, open + (raw ? 3 : 2));
      if (close === -1) throw new TplError('template "' + name + '": a ' + (raw ? '{{{' : '{{') + ' is not closed');
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: tplPath(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TplError('template "' + name + '": a {% is not closed');
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? n : nl;
    const standalone = allBlank(src, lineStart, open) && allBlank(src, end, lineEnd);
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? n : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenizeTemplate(name, src)) {
    if (tok.t === 'text') { body.push({ kind: 'text', text: tok.text }); continue; }
    if (tok.t === 'var' || tok.t === 'raw') { body.push({ kind: tok.t, path: tok.path }); continue; }
    const tag = tok.tag;
    const top = stack[stack.length - 1];
    let m;
    if ((m = FOR_RE.exec(tag)) !== null) {
      const node = { kind: 'for', name: m[1], path: tplPath(name, m[2]), body: [] };
      body.push(node);
      stack.push(node);
      body = node.body;
    } else if ((m = IF_RE.exec(tag)) !== null) {
      const node = { kind: 'if', not: m[1] !== undefined, path: tplPath(name, m[2]), then: [], else: null };
      body.push(node);
      stack.push(node);
      body = node.then;
    } else if (tag === 'else') {
      if (top.kind !== 'if' || top.else !== null) throw new TplError('template "' + name + '": an else outside an if');
      top.else = [];
      body = top.else;
    } else if (tag === 'endfor' || tag === 'endif') {
      const want = tag === 'endfor' ? 'for' : 'if';
      if (top.kind !== want) throw new TplError('template "' + name + '": an ' + tag + ' with no open ' + tag.slice(3));
      stack.pop();
      const parent = stack[stack.length - 1];
      body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
    } else if ((m = INCLUDE_RE.exec(tag)) !== null) {
      body.push({ kind: 'include', name: m[1] });
    } else {
      throw new TplError('template "' + name + '": {% ' + tag + ' %} is not a tag');
    }
  }
  if (stack.length > 1) throw new TplError('template "' + name + '": a ' + stack[stack.length - 1].kind + ' is not closed');
  return root.body;
}

// Scope lookup: nearest scope holding the first name, then own properties.
function lookupPath(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

function valueText(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    const parts = [];
    for (let i = 0; i < v.length; i++) parts.push(valueText(v[i]));
    return parts.join(', ');
  }
  return '';
}

function isTruthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

// Compile a node tree into a JS function (scope, depth, fns) -> string.
// Helpers are module-level and passed in by the generated function's caller
// through closure-free parameters baked below.
function compileTemplate(nodes) {
  const chunks = [];
  let uid = 0;
  const gen = (list, scopeVar) => {
    for (const node of list) {
      switch (node.kind) {
        case 'text':
          chunks.push('o.push(' + JSON.stringify(node.text) + ');');
          break;
        case 'var':
          chunks.push('o.push(E(V(L(' + scopeVar + ',' + JSON.stringify(node.path) + '))));');
          break;
        case 'raw':
          chunks.push('o.push(V(L(' + scopeVar + ',' + JSON.stringify(node.path) + ')));');
          break;
        case 'if': {
          const cond = 'T(L(' + scopeVar + ',' + JSON.stringify(node.path) + '))';
          chunks.push('if((' + cond + ')!==' + node.not + '){');
          gen(node.then, scopeVar);
          if (node.else !== null) {
            chunks.push('}else{');
            gen(node.else, scopeVar);
          }
          chunks.push('}');
          break;
        }
        case 'for': {
          const id = uid++;
          const xs = 'xs' + id;
          const sc = 'sc' + id;
          const kk = 'k' + id;
          const ln = 'n' + id;
          chunks.push('{const ' + xs + '=L(' + scopeVar + ',' + JSON.stringify(node.path) + ');');
          chunks.push('if(Array.isArray(' + xs + ')){const ' + ln + '=' + xs + '.length;');
          chunks.push('for(let ' + kk + '=0;' + kk + '<' + ln + ';' + kk + '++){');
          chunks.push('const vs={};vs[' + JSON.stringify(node.name) + ']=' + xs + '[' + kk + '];');
          chunks.push('vs.loop={index:' + kk + '+1,first:' + kk + '===0,last:' + kk + '===' + ln + '-1,length:' + ln + '};');
          chunks.push('const ' + sc + '={vars:vs,parent:' + scopeVar + '};');
          gen(node.body, sc);
          chunks.push('}}}');
          break;
        }
        case 'include':
          chunks.push('if(d<8){const f=F[' + JSON.stringify(node.name) + '];if(f!==undefined)o.push(f(' + scopeVar + ',d+1,F));}');
          break;
      }
    }
  };
  gen(nodes, 'S');
  const src = 'const o=[];' + chunks.join('') + 'return o.join("");';
  const factory = new Function('L', 'T', 'V', 'E', 'return function(S,d,F){' + src + '};');
  return factory(lookupPath, isTruthy, valueText, escHtml);
}

// ------------------------------------------------------------------- build

const RESERVED_ROOT = ['posts', 'tags', 'page'];

function dirOf(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

// Resolve `rel` against directory `dir`; null when it climbs above the root.
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

function isWsCode(c) {
  return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13
    || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a)
    || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}

function wordCount(text) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (isWsCode(text.charCodeAt(i))) inWord = false;
    else if (!inWord) { inWord = true; count++; }
  }
  return count;
}

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function run(input) {
  const slugCache = new Map();
  const slugFn = (text) => {
    let s = slugCache.get(text);
    if (s === undefined) {
      s = slugCompute(text);
      slugCache.set(text, s);
    }
    return s;
  };

  // Templates, parsed (and compiled) in name order; failures are reported.
  const report = [];
  const templates = new Map(); // name -> nodes (for the layout existence check)
  const fns = Object.create(null); // name -> compiled render function
  const names = Object.keys(input.templates).sort(cmpCU);
  for (const name of names) {
    try {
      const nodes = parseTemplate(name, input.templates[name]);
      templates.set(name, nodes);
      fns[name] = compileTemplate(nodes);
    } catch (err) {
      if (!(err instanceof TplError)) throw err;
      report.push(err.message);
    }
  }

  const base = input.site.base_url.replace(/\/+$/, '');

  // Sources in path order; .md files are sources, everything else static.
  const files = [...input.files].sort((x, y) => cmpCU(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else statics.push({ path: f.path, content: f.content });
  }

  // Front matter and the refusal chain, in the reference's check order.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push('refused ' + s.path + ': ' + fm.error);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let ownDir = null;
    if (s.path.startsWith('tags/')) ownDir = 'tags';
    else if (s.path.startsWith('page/')) ownDir = 'page';
    if (ownDir !== null) {
      report.push('refused ' + s.path + ': ' + ownDir + '/ is the generator\'s own');
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push('refused ' + s.path + ': a post needs a date');
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push('refused ' + s.path + ': layout "' + layout + '" is no template that parses');
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push('draft ' + s.path);
      continue;
    }
    kept.push(s);
  }

  // Permalinks: slug unique per directory, in source order.
  const takenByDir = new Map();
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let taken = takenByDir.get(dir);
    if (taken === undefined) {
      taken = new Set(dir === '' ? RESERVED_ROOT : []);
      takenByDir.set(dir, taken);
    }
    const slug = uniqueIn(s.data.slug ?? slugFn(s.data.title), taken);
    s.slug = slug;
    s.outDir = dir === '' ? slug : dir + '/' + slug;
    s.url = base + '/' + s.outDir + '/';
    bySource.set(s.path, s);
  }

  // Markdown, with link resolution against pages and static files.
  const broken = new Set();
  const staticPaths = new Set();
  for (const f of statics) staticPaths.add(f.path);
  for (const s of kept) {
    const dir = dirOf(s.path);
    const linkFn = (target) => {
      if (SCHEME_RE.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(dir, rel);
      if (path !== null) {
        const page = bySource.get(path);
        if (page !== undefined) return page.url + frag;
        if (staticPaths.has(path)) return base + '/' + path + frag;
      }
      broken.add('broken-link ' + s.path + ' -> ' + target);
      return target;
    };
    const md = renderMarkdown(s.body, linkFn, slugFn);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // Collections: posts newest first, equal dates by slug.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => cmpCU(y.data.date, x.data.date) || cmpCU(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // Tags grouped by slug, named as first met in collection order.
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugFn(name);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  const tagBySlug = new Map();
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugFn(name);
      let tag = tagBySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: base + '/tags/' + slug + '/', posts: [] };
        tagBySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugFn(name);
      return tagBySlug.get(slug) ?? { name, slug, url: '', posts: [] };
    });
  }
  const tagList = [...tagBySlug.values()].sort((x, y) => y.posts.length - x.posts.length || cmpCU(x.slug, y.slug));

  // Cards and pages as templates read them.
  const linkOf = (s) => (s === null ? null : {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
  });
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordCount(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  const cards = new Map();
  for (const p of posts) cards.set(p, cardOf(p));
  const pageOf = (s) => ({
    ...cardOf(s),
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });

  // Layouts.
  const output = {};
  const site = { title: input.site.title, base_url: base };
  const allTags = tagList.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const render = (name, vars) => {
    const fn = fns[name];
    if (fn === undefined) return null;
    return fn({ vars: { site, tags: allTags, recent, ...vars }, parent: null }, 0, fns);
  };
  for (const s of kept) output[s.outDir + '/index.html'] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pageCount = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
  for (let k = 1; k <= pageCount; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: {
        number: k,
        total: pageCount,
        url: indexUrl(k),
        newer_url: k === 1 ? '' : indexUrl(k - 1),
        older_url: k === pageCount ? '' : indexUrl(k + 1),
      },
    });
    if (html !== null) output[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = html;
  }
  for (const t of tagList) {
    const html = render('tag', {
      tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) },
    });
    if (html !== null) output['tags/' + t.slug + '/index.html'] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push('shadowed ' + f.path + ': a built page has its path');
    else output[f.path] = f.content;
  }

  // Report.
  const lines = [...report, ...broken].sort(cmpCU);
  const pageTotal = kept.reduce((acc, s) => acc + (s.post ? 0 : 1), 0);
  lines.push('built ' + pageTotal + ' pages, ' + posts.length + ' posts, ' + tagList.length + ' tags and ' + statics.length + ' static files');
  output['build-report.txt'] = lines.join('\n') + '\n';
  return output;
}
