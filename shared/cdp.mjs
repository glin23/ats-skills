#!/usr/bin/env node
// cdp.mjs — minimal CDP CLI driver for Chrome DevTools Protocol
// Node 24+ required (uses global WebSocket). Zero deps by design.
// Used by mrweirdo-jobs (Greenhouse / Ashby / Lever apply skills).

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { atsHome } from './paths.mjs';
import { lockFile } from './state_file_lock.mjs';

function resolveCdpHost() {
  if (process.env.CDP_HOST) return process.env.CDP_HOST.replace(/^https?:\/\//, '');
  if (process.env.ATS_CDP_PORT) return `localhost:${process.env.ATS_CDP_PORT}`;
  try {
    const home = atsHome();
    const fromFile = readFileSync(join(home, 'cdp_host'), 'utf8').trim();
    if (fromFile) return fromFile.replace(/^https?:\/\//, '');
  } catch {
    // no persisted host yet
  }
  return 'localhost:9222';
}

const HOST = resolveCdpHost();
const DEFAULT_TIMEOUT = 30_000;
const GOTO_TIMEOUT = 60_000;

const HELP = `cdp.mjs — Chrome DevTools Protocol CLI driver

Commands:
  tabs                                   List tabs as JSON [{id, url, title}]
  goto <url> [tabId]                     Navigate; opens new tab if tabId omitted
  eval <tabId> <js>                      Runtime.evaluate, print result.value (or stack)
  upload <tabId> <selector> <file>       DOM.setFileInputFiles to <selector>
  screenshot <tabId> <out.png>           Page.captureScreenshot → write file
  typetext <tabId> <selector> <text>     Focus + CLEAR (React-safe) + Input.insertText, read back value
  key <tabId> <KeyName>                  Dispatch a trusted key press (Enter|Tab|ArrowDown|ArrowUp|Escape|Backspace)
  cdp <tabId> <Method> <params-json>     Raw CDP call, e.g. cdp X Page.reload '{}'

Env:
  CDP_HOST       default localhost:9222, or ~/.mrweirdo-jobs/cdp_host when present
  ATS_CDP_PORT   alternate port helper, e.g. ATS_CDP_PORT=9223
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
    const abs = pathResolve(outPath);
    writeFileSync(abs, Buffer.from(r.data, 'base64'));
    // Screenshots regularly contain the applicant's name/email/phone in frame.
    // This is the single funnel every screenshot goes through, so it locks at
    // the write (write-side trigger, 设计稿 §13.4 写入侧上锁).
    lockFile(abs);
    process.stdout.write(JSON.stringify({ ok: true, path: abs }) + '\n');
  });
}

async function cmdTypetext(tabId, selector, text) {
  await withSession(tabId, async s => {
    // Focus + CLEAR before typing. A retry or a React-prefilled/formatted value
    // must be wiped first, else Input.insertText appends to stale content and the
    // form keeps flagging the field invalid (the classic stuck_on_same_missing).
    // Clear via the native prototype value setter + a bubbling input event so
    // React/controlled inputs register the emptied state; then insertText types
    // the real value as trusted keystrokes that React picks up.
    const prep = await s.send('Runtime.evaluate', {
      expression: `(() => {
        const e = document.querySelector(${JSON.stringify(selector)});
        if (!e) return 'NOTFOUND';
        e.focus();
        if (document.activeElement !== e) return 'NOFOCUS';
        try {
          const proto = e.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) desc.set.call(e, ''); else e.value = '';
          if (e._valueTracker) e._valueTracker.setValue('x');
          e.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (err) { /* non-input element; nothing to clear */ }
        return 'OK';
      })()`,
      returnByValue: true,
      userGesture: true,
    });
    const v = prep.result?.value;
    if (v === 'NOTFOUND') throw new Error(`Selector not found: ${selector}`);
    if (v !== 'OK') throw new Error(`Failed to focus selector: ${selector} (got ${v})`);
    await s.send('Input.insertText', { text });
    const norm = (x) => String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase();
    const readValue = async () => {
      const r = await s.send('Runtime.evaluate', {
        expression: `(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? String(e.value == null ? '' : e.value) : null; })()`,
        returnByValue: true,
      });
      return r.result?.value;
    };
    // Read back so we never trust a write without confirming it.
    let got = await readValue();
    let method = 'insertText';
    let verified = typeof got === 'string' && norm(got) === norm(text);
    if (!verified) {
      // Self-heal: the trusted keystroke path did not take (React reverted it, or
      // a masked/controlled input). Set via the native prototype value setter +
      // tracker reset + bubbling input/change/blur so React and validation libs
      // register it. This is the canonical React controlled-input fill.
      await s.send('Runtime.evaluate', {
        expression: `(() => {
          const e = document.querySelector(${JSON.stringify(selector)});
          if (!e) return false;
          try {
            const proto = e.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            const prev = e.value;
            if (desc && desc.set) desc.set.call(e, ${JSON.stringify(text)}); else e.value = ${JSON.stringify(text)};
            if (e._valueTracker) e._valueTracker.setValue(prev);
            const b = { bubbles: true };
            e.dispatchEvent(new Event('input', b));
            e.dispatchEvent(new Event('change', b));
            e.dispatchEvent(new Event('blur', b));
            return true;
          } catch (err) { return false; }
        })()`,
        returnByValue: true,
      });
      got = await readValue();
      method = 'nativeSetter';
      verified = typeof got === 'string' && norm(got) === norm(text);
    }
    process.stdout.write(JSON.stringify({ ok: true, len: text.length, value: got, verified, method }) + '\n');
  });
}

const KEY_CODES = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', vk: 9, text: '\t' },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
};

async function cmdKey(tabId, keyName) {
  const k = KEY_CODES[keyName];
  if (!k) throw new Error(`Unsupported key: ${keyName} (supported: ${Object.keys(KEY_CODES).join(', ')})`);
  await withSession(tabId, async s => {
    // Full Puppeteer-style param set — the minimal {key,code,vk} form leaves
    // e.key as "Unidentified" in Chrome; including text/location/isKeypad makes
    // the synthesized event read as a real Enter (e.key=Enter, keyCode=13).
    const base = { key: keyName, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, location: 0, isKeypad: false, autoRepeat: false };
    const down = { type: 'keyDown', ...base };
    if (k.text != null) { down.text = k.text; down.unmodifiedText = k.text; }
    await s.send('Input.dispatchKeyEvent', down);
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    process.stdout.write(JSON.stringify({ ok: true, key: keyName }) + '\n');
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
      case 'key': {
        const [, tabId, keyName] = argv;
        if (!tabId || !keyName) throw new Error('Usage: key <tabId> <KeyName>');
        await cmdKey(tabId, keyName);
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
