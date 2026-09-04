// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { findChromium } = await import(pathToFileURL(join(root, "dist", "launcher.js")).href);
const { packIcns, packIco } = await import(pathToFileURL(join(root, "dist", "icons.js")).href);

const chrome = process.env.CHROME || findChromium();
if (!chrome) throw new Error("no Chromium browser found; set CHROME=<path to chrome.exe>");
const master = join(root, "assets", "icon-master.png");
const hasMaster = existsSync(master);
const svg = hasMaster ? "" : readFileSync(join(root, "assets", "icon-vector.svg"), "utf8");
const sizes = [16, 32, 48, 64, 128, 256, 512];
const port = 9360 + Math.floor(Math.random() * 30);
const profile = join(tmpdir(), `viberoom-icon-${process.pid}`);
mkdirSync(profile, { recursive: true });
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=600,600", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      await sleep(250);
    }
  }
  throw new Error("chrome did not start");
}

try {
  const page = (await targets()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Page.enable");
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const icons = [];
  await send("Emulation.setDeviceMetricsOverride", { width: 600, height: 600, deviceScaleFactor: 1, mobile: false });
  const pageFile = join(profile, "render.html");
  for (const size of sizes) {
    const body = hasMaster
      ? `<img src="${pathToFileURL(master).href}" style="display:block;width:${size}px;height:${size}px;border-radius:${(size * 0.21).toFixed(2)}px">`
      : svg.replace(/width="256" height="256"/, `width="${size}" height="${size}"`);
    const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}svg,img{display:block}</style></head><body>${body}</body></html>`;
    writeFileSync(pageFile, html);
    await send("Page.navigate", { url: pathToFileURL(pageFile).href });
    await sleep(hasMaster ? 700 : 300);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 }, fromSurface: true });
    const data = Buffer.from(shot.result.data, "base64");
    writeFileSync(join(root, "assets", `icon-${size}.png`), data);
    icons.push({ size, data });
    console.log(`icon-${size}.png ${data.length} bytes`);
  }
  writeFileSync(join(root, "assets", "icon.ico"), packIco(icons.filter((i) => i.size <= 256)));
  writeFileSync(join(root, "assets", "icon.icns"), packIcns(icons));
  const svgOut = hasMaster
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><image href="data:image/png;base64,${icons.find((i) => i.size === 256).data.toString("base64")}" width="256" height="256"/></svg>\n`
    : svg;
  writeFileSync(join(root, "assets", "icon.svg"), svgOut);
  console.log("icon.ico and icon.icns written");
  ws.close();
} finally {
  if (process.platform === "win32") spawnSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*viberoom-icon-${process.pid}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: "ignore" });
  else browser.kill();
}
