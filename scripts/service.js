import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(root, '.runtime');
const pidFile = path.join(runtimeDir, 'server.pid');
const logFile = path.join(runtimeDir, 'server.log');
const action = process.argv[2] || 'status';

function readPid() {
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearStalePid() {
  const pid = readPid();
  if (pid && !isAlive(pid)) fs.rmSync(pidFile, { force: true });
  return pid && isAlive(pid) ? pid : null;
}

async function waitForServer(child) {
  const port = process.env.PORT || '3000';
  for (let i = 0; i < 25; i++) {
    if (!isAlive(child.pid)) return false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/config`);
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function start() {
  const runningPid = clearStalePid();
  if (runningPid) {
    console.log(`服务已经在运行（PID ${runningPid}）。`);
    return;
  }

  fs.mkdirSync(runtimeDir, { recursive: true });
  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
  fs.writeFileSync(pidFile, String(child.pid));

  if (await waitForServer(child)) {
    console.log(`服务已在后台启动（PID ${child.pid}）：http://localhost:${process.env.PORT || 3000}`);
    console.log('使用 npm stop 手动关停。');
    return;
  }

  fs.rmSync(pidFile, { force: true });
  console.error('服务启动失败，请运行 npm run logs 查看原因。');
  process.exitCode = 1;
}

function stop() {
  const pid = clearStalePid();
  if (!pid) {
    console.log('服务当前没有运行。');
    return;
  }

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    if (result.status !== 0 && isAlive(pid)) {
      console.error(`无法关停服务（PID ${pid}）。`);
      process.exitCode = 1;
      return;
    }
  } else {
    process.kill(-pid, 'SIGTERM');
  }
  fs.rmSync(pidFile, { force: true });
  console.log(`服务已关停（PID ${pid}）。`);
}

function status() {
  const pid = clearStalePid();
  console.log(pid ? `服务正在运行（PID ${pid}）。` : '服务当前没有运行。');
  if (pid) console.log(`http://localhost:${process.env.PORT || 3000}`);
}

function logs() {
  if (!fs.existsSync(logFile)) {
    console.log('还没有服务日志。');
    return;
  }
  const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
  console.log(lines.slice(-100).join('\n'));
}

if (action === 'start') await start();
else if (action === 'stop') stop();
else if (action === 'restart') {
  stop();
  if (!process.exitCode) await start();
} else if (action === 'status') status();
else if (action === 'logs') logs();
else {
  console.error(`未知操作：${action}`);
  process.exitCode = 1;
}
