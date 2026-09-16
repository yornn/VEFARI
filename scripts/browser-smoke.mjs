// Dependency-free browser test. Runs real DOM, dialog, canvas and HTTP;
// only SillyTavern's host context and image storage endpoints are simulated.
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const candidates = [
    process.env.VEFARI_BROWSER,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].filter(Boolean);
let browser;
for (const candidate of candidates) {
    try { await access(candidate); browser = candidate; break; } catch { /* Try next browser. */ }
}
if (!browser) throw new Error('Chrome/Edge/Chromium not found; set VEFARI_BROWSER to its absolute path.');
const files = new Map();
let reportResult;
const resultReady = new Promise(resolve => { reportResult = resolve; });
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (request.method === 'POST') {
            if (request.headers['x-csrf-token'] !== 'smoke-test') { response.writeHead(403).end(); return; }
            let body = '';
            for await (const chunk of request) body += chunk;
            const data = JSON.parse(body);
            if (pathname === '/test-result') {
                response.writeHead(200).end();
                reportResult(data);
                return;
            }
            if (pathname === '/api/images/upload') {
                const path = `/user/images/${data.ch_name}/${data.filename}.${data.format}`;
                files.set(path, Buffer.from(data.image, 'base64'));
                response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ path }));
                return;
            }
            if (pathname === '/api/images/delete') {
                const deleted = files.delete(`/${data.path}`);
                response.writeHead(deleted ? 200 : 404).end();
                return;
            }
        }
        if (pathname.startsWith('/user/images/')) {
            if (!files.has(pathname)) { response.writeHead(404).end(); return; }
            response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).end(files.get(pathname));
            return;
        }
        const path = resolve(root, `.${pathname}`);
        if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403).end(); return; }
        const content = await readFile(path);
        response.writeHead(200, { 'Content-Type': mimeTypes[extname(path)] || 'text/plain' }).end(content);
    } catch {
        response.writeHead(404).end();
    }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'vefari-browser-'));
const mobile = process.env.VEFARI_MOBILE === '1';
const width = Number(process.env.VEFARI_WIDTH) || (mobile ? 390 : 1280);
const height = Number(process.env.VEFARI_HEIGHT) || (mobile ? 844 : 900);
let child;
let exited;
let timer;
let devtools;

async function connectDevtools() {
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
        try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
        catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    if (!port) throw new Error('Browser debugging endpoint did not start.');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = pages.find(entry => entry.type === 'page');
    if (!page) throw new Error('Browser page not found.');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        const callback = pending.get(message.id);
        if (!callback) return;
        pending.delete(message.id);
        if (message.error) callback.reject(new Error(message.error.message));
        else callback.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    return {
        close: () => socket.close(),
        send(method, params = {}) {
            return new Promise((resolve, reject) => {
                const requestId = ++id;
                pending.set(requestId, { resolve, reject });
                socket.send(JSON.stringify({ id: requestId, method, params }));
            });
        },
    };
}

try {
    const result = await new Promise((resolve, reject) => {
        child = spawn(browser, [
            '--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking',
            `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1280,960', 'about:blank',
        ], { windowsHide: true });
        let stderr = '';
        timer = setTimeout(() => reject(new Error(`Browser timed out. ${stderr}`)), 30000);
        child.stdout.resume();
        child.stderr.on('data', chunk => { stderr += chunk; });
        exited = new Promise(done => {
            child.on('error', error => { reject(error); done(); });
            child.on('exit', code => { reject(new Error(`Browser exited before reporting: ${code}. ${stderr}`)); done(); });
        });
        resultReady.then(resolve);
        (async () => {
            devtools = await connectDevtools();
            if (process.env.VEFARI_OFFLINE_FONTS === '1') {
                await devtools.send('Network.enable');
                await devtools.send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
            }
            await devtools.send('Emulation.setDeviceMetricsOverride', {
                width, height,
                deviceScaleFactor: 1, mobile,
            });
            await devtools.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tests/browser.html` });
        })().catch(reject);
    });
    if (result.status !== 'passed') throw new Error(result.text);
    const evaluate = async expression => {
        const response = await devtools.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
        return response.result.value;
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
        await devtools.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers, text: key === 'Enter' ? '\r' : '' });
        await devtools.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    const shadow = "document.getElementById('vefari_host').shadowRoot";
    await evaluate(`${shadow}.getElementById('vefari_tab_user').focus()`);
    await key('Tab', 'Tab', 9);
    if (!await evaluate(`${shadow}.activeElement?.id === 'vefari_collection_panel'`)) throw new Error('Native Tab did not enter the collection panel.');
    await key('Tab', 'Tab', 9, 8);
    if (!await evaluate(`${shadow}.activeElement?.id === 'vefari_tab_user'`)) throw new Error('Native Shift+Tab did not return to the selected tab.');
    await key('Escape', 'Escape', 27);
    await evaluate(`new Promise((resolve, reject) => {
        let attempts = 0;
        const timer = setInterval(() => {
            if (!document.querySelector('.vefari_popup')) { clearInterval(timer); resolve(); }
            else if (++attempts > 100) { clearInterval(timer); reject(new Error('Escape failed to close the dialog')); }
        }, 20);
    })`);
    if (!await evaluate("document.activeElement?.id === 'vefari_menu'")) throw new Error('Closing did not restore menu focus.');
    await key('Enter', 'Enter', 13);
    if (!await evaluate(`Boolean(document.querySelector('.vefari_popup[open]')) && ${shadow}.activeElement?.id === 'vefari_tab_user'`)) {
        const focus = await evaluate(`({ dialog: Boolean(document.querySelector('.vefari_popup[open]')), documentFocus: document.activeElement?.id, shadowFocus: document.getElementById('vefari_host')?.shadowRoot.activeElement?.id })`);
        throw new Error(`Native Enter did not reopen and focus the wardrobe: ${JSON.stringify(focus)}`);
    }
    console.log('Native Tab, Shift+Tab, Escape, Enter and focus restoration passed.');
    if (process.env.VEFARI_SCREENSHOT) {
        const image = await devtools.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(process.env.VEFARI_SCREENSHOT, Buffer.from(image.data, 'base64'));
        console.log(`Screenshot: ${process.env.VEFARI_SCREENSHOT}`);
    }
    if (process.env.VEFARI_SETTINGS_SCREENSHOT) {
        await evaluate(`${shadow}.getElementById('vefari_settings_toggle').click()`);
        const image = await devtools.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(process.env.VEFARI_SETTINGS_SCREENSHOT, Buffer.from(image.data, 'base64'));
        console.log(`Settings screenshot: ${process.env.VEFARI_SETTINGS_SCREENSHOT}`);
    }
    console.log(`Browser smoke test passed (${mobile ? 'mobile' : 'desktop'} ${width}x${height}, ${browser}):\n${result.text}`);
} finally {
    clearTimeout(timer);
    devtools?.close();
    child?.kill();
    await exited;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}