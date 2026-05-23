#!/usr/bin/env node
// cdp.mjs — minimal CDP CLI driver for Chrome on :9222
// Node 24+ required (uses global WebSocket). Zero deps by design.
// Used by ats-skills (Greenhouse / Ashby / Lever apply skills).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

const HOST = process.env.CDP_HOST || 'localhost:9222';
const DEFAULT_TIMEOUT = 30_000;
const GOTO_TIMEOUT = 60_000;

const HELP = `cdp.mjs — Chrome DevTools Protocol CLI driver (requires Chrome on :9222)

Commands:
  tabs                                   List tabs as JSON [{id, url, title}]
  goto <url> [tabId]                     Navigate; opens new tab if tabId omitted
  eval <tabId> <js>                      Runtime.evaluate, print result.value (or stack)
  upload <tabId> <selector> <file>       DOM.setFileInputFiles to <selector>
  screenshot <tabId> <out.png>           Page.captureScreenshot → write file
  typetext <tabId> <selector> <text>     Focus selector + Input.insertText (isTrusted=true)
  cdp <tabId> <Method> <params-json>     Raw CDP call, e.g. cdp X Page.reload '{}'

Env:
  CDP_HOST   default localhost:9222
`;

// ---------- HTTP helpers (target discovery) ----------

async function httpJson(path) {
  const res = await fetch(`http://${HOST}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
  return res.json();
}

async function listTargets() {
  const all = await httpJson('/json');
  return all.filter(t => t.type === 'page');
}

async function newTarget(url) {
  // PUT /json/new?<url> creates a new page target
  const res = await fetch(`http://${HOST}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (res.ok) return res.json();
  // older Chrome uses GET
  const res2 = await fetch(`http://${HOST}/json/new?${encodeURIComponent(url)}`);
  if (!res2.ok) throw new Error(`Failed to create tab: HTTP ${res.status}`);
  return res2.json();
}

// ---------- per-tab WebSocket session ----------

class Session {
  constructor(tabId) {
    this.tabId = tabId;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    const targets = await listTargets();
    const tgt = targets.find(t => t.id === this.tabId);
    if (!tgt) throw new Error(`Tab not found: ${this.tabId}`);
    if (!tgt.webSocketDebuggerUrl) throw new Error(`Tab has no webSocketDebuggerUrl (already attached?): ${this.tabId}`);
    this.ws = new WebSocket(tgt.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true });
    });
    this.ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message || 'CDP error'}${msg.error.data ? ': ' + msg.error.data : ''}`));
        else resolve(msg.result);
      }
    });
    this.ws.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('WebSocket closed'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, timeoutMs = DEFAULT_TIMEOUT) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout (${timeoutMs}ms): ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }
}

async function withSession(tabId, fn) {
  const s = new Session(tabId);
  try {
    await s.connect();
    return await fn(s);
  } finally {
    s.close();
  }
}

// ---------- command handlers ----------

async function cmdTabs() {
  const tabs = await listTargets();
  process.stdout.write(JSON.stringify(tabs.map(t => ({ id: t.id, url: t.url, title: t.title })), null, 2) + '\n');
}

async function cmdGoto(url, tabId) {
  if (!tabId) {
    const t = await newTarget(url);
    process.stdout.write(JSON.stringify({ id: t.id, url: t.url || url }) + '\n');
    return;
  }
  await withSession(tabId, async s => {
    await s.send('Page.enable');
    const r = await s.send('Page.navigate', { url }, GOTO_TIMEOUT);
    if (r.errorText) throw new Error(`Navigate failed: ${r.errorText}`);
    process.stdout.write(JSON.stringify({ id: tabId, url }) + '\n');
  });
}

async function cmdEval(tabId, expr) {
  await withSession(tabId, async s => {
    const r = await s.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails;
      const msg = ex.exception?.description || ex.text || 'eval exception';
      process.stderr.write(msg + '\n');
      process.exit(1);
    }
    const v = r.result?.value;
    if (v === undefined) process.stdout.write('');
    else if (typeof v === 'string') process.stdout.write(v + '\n');
    else process.stdout.write(JSON.stringify(v) + '\n');
  });
}

async function cmdUpload(tabId, selector, file) {
  const abs = pathResolve(file);
  readFileSync(abs); // throws if missing — caught by main()
  await withSession(tabId, async s => {
    await s.send('DOM.enable');
    const { root } = await s.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await s.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`Selector not found: ${selector}`);
    await s.send('DOM.setFileInputFiles', { nodeId, files: [abs] });
    process.stdout.write(JSON.stringify({ ok: true, file: abs }) + '\n');
  });
}

async function cmdScreenshot(tabId, outPath) {
  await withSession(tabId, async s => {
    const r = await s.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(pathResolve(outPath), Buffer.from(r.data, 'base64'));
    process.stdout.write(JSON.stringify({ ok: true, path: pathResolve(outPath) }) + '\n');
  });
}

async function cmdTypetext(tabId, selector, text) {
  await withSession(tabId, async s => {
    const focus = await s.send('Runtime.evaluate', {
      expression: `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return 'NOTFOUND'; e.focus(); return document.activeElement === e ? 'OK' : 'NOFOCUS'; })()`,
      returnByValue: true,
    });
    const v = focus.result?.value;
    if (v === 'NOTFOUND') throw new Error(`Selector not found: ${selector}`);
    if (v !== 'OK') throw new Error(`Failed to focus selector: ${selector} (got ${v})`);
    await s.send('Input.insertText', { text });
    process.stdout.write(JSON.stringify({ ok: true, len: text.length }) + '\n');
  });
}

async function cmdRaw(tabId, method, paramsJson) {
  let params = {};
  if (paramsJson && paramsJson.length) {
    try { params = JSON.parse(paramsJson); }
    catch (e) { throw new Error(`Invalid JSON params: ${e.message}`); }
  }
  await withSession(tabId, async s => {
    const r = await s.send(method, params);
    process.stdout.write(JSON.stringify(r) + '\n');
  });
}

// ---------- dispatcher ----------

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(HELP);
    process.exit(cmd ? 0 : 1);
  }

  try {
    switch (cmd) {
      case 'tabs':
        await cmdTabs();
        break;
      case 'goto': {
        const [, url, tabId] = argv;
        if (!url) throw new Error('Usage: goto <url> [tabId]');
        await cmdGoto(url, tabId);
        break;
      }
      case 'eval': {
        const [, tabId, ...rest] = argv;
        const expr = rest.join(' ');
        if (!tabId || !expr) throw new Error('Usage: eval <tabId> <js>');
        await cmdEval(tabId, expr);
        break;
      }
      case 'upload': {
        const [, tabId, selector, file] = argv;
        if (!tabId || !selector || !file) throw new Error('Usage: upload <tabId> <selector> <file>');
        await cmdUpload(tabId, selector, file);
        break;
      }
      case 'screenshot': {
        const [, tabId, out] = argv;
        if (!tabId || !out) throw new Error('Usage: screenshot <tabId> <out.png>');
        await cmdScreenshot(tabId, out);
        break;
      }
      case 'typetext': {
        const [, tabId, selector, ...rest] = argv;
        const text = rest.join(' ');
        if (!tabId || !selector || rest.length === 0) throw new Error('Usage: typetext <tabId> <selector> <text>');
        await cmdTypetext(tabId, selector, text);
        break;
      }
      case 'cdp': {
        const [, tabId, method, paramsJson] = argv;
        if (!tabId || !method) throw new Error('Usage: cdp <tabId> <Method> <params-json>');
        await cmdRaw(tabId, method, paramsJson || '{}');
        break;
      }
      default:
        process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
        process.exit(1);
    }
  } catch (e) {
    process.stderr.write(`${e.message || e}\n`);
    process.exit(1);
  }
}

main();
