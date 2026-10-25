import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function launchChrome(executable) {
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const number = server.address().port; server.close(() => resolve(number)); });
  });
  const profile = mkdtempSync(path.join(os.tmpdir(), 'br-qa-'));
  const chrome = spawn(executable, ['--headless=new', `--remote-debugging-port=${port}`, '--hide-scrollbars',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
  let spawnError;
  chrome.once('error', error => { spawnError = error; });
  const pending = new Map(), listeners = new Set();
  let socket, id = 0, closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    socket?.close();
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Chrome closed')); }
    pending.clear();
    if (chrome.pid && chrome.exitCode === null) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* Already exited. */ }
      } else chrome.kill('SIGTERM');
    }
    // Only the exact unique profile this process created can be removed.
    if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('br-qa-')) {
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome can release files asynchronously. */ }
    }
  };
  try {
    let version;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (spawnError) throw spawnError;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
        version = await response.json(); break;
      } catch { await sleep(100); }
    }
    if (!version) throw new Error('Chrome CDP readiness timed out');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
    const page = targets.find(t => t.type === 'page');
    if (!page) throw new Error('Chrome has no page target');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP socket open timed out')), 5000);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = error => { clearTimeout(timer); reject(error); };
    });
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id); clearTimeout(waiter.timer);
        message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
      } else for (const listener of listeners) listener(message);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timed out after 10000ms`)); }, 10000);
      pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    return { send, evaluate, listen: listener => listeners.add(listener), close, version };
  } catch (error) { await close(); throw error; }
}
