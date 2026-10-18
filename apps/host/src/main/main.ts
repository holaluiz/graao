/**
 * Graao Host — Electron main process. Owns the window, the tray, the `graao-host://` links and the narrow IPC surface
 * the window may use; the hosting itself is `HostController`. The match server runs in a utility process; the window
 * is local, sandboxed content with no Node access.
 */
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, safeStorage, shell, Tray, utilityProcess, type IpcMainInvokeEvent } from 'electron';
import { HOST_LINK_SCHEME, createHostCentral, parseHostLink } from '@graao/shared';
import { appConfig, roomUrl } from './config';
import { HostController } from './HostController';
import { handleOf, serverEnv } from './serverProcess';
import { createIdentityStore, loadSettings, saveSettings } from './store';
import { createTunnelFactory } from './tunnel';
import type { HostSettings, HostUiState, ServerHandle } from './types';

const cfg = appConfig();
// Development and multi-installation tests: a separate identity folder per instance.
if (process.env.GRAAO_HOST_USER_DATA) app.setPath('userData', process.env.GRAAO_HOST_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void boot();
}

const logs: string[] = [];
let devPanel = false;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let trayHintShown = false;

function log(line: string): void {
  const l = `${new Date().toISOString().slice(11, 19)} ${line}`;
  logs.push(l);
  if (logs.length > 500) logs.shift();
  if (devPanel) win?.webContents.send('host:log', l);
  if (!app.isPackaged) console.log(`[host] ${line}`);
}

const findLink = (argv: string[]) => argv.find((a) => a.toLowerCase().startsWith(`${HOST_LINK_SCHEME}:`));

function spawnServer(bundle: string): ServerHandle {
  const child = utilityProcess.fork(bundle, [], { serviceName: 'Graao Host - servidor da partida', stdio: 'pipe', env: serverEnv() });
  const pipe = (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => log(`servidor: ${l}`));
  child.stdout?.on('data', pipe);
  child.stderr?.on('data', pipe);
  return handleOf({
    send: (m) => child.postMessage(m),
    kill: () => child.kill(),
    wire: (onMessage, onExit) => {
      child.on('message', onMessage);
      child.once('exit', (code) => onExit(code));
    },
  });
}

/** Every Electron process of the app (window, GPU, utility server) together. */
function appMetrics(): { cpuPercent: number; memoryMB: number } {
  const all = app.getAppMetrics();
  return {
    cpuPercent: Math.round(all.reduce((n, p) => n + p.cpu.percentCPUUsage, 0) * 10) / 10,
    memoryMB: Math.round(all.reduce((n, p) => n + p.memory.workingSetSize, 0) / 1024),
  };
}

function resource(...p: string[]): string {
  return app.isPackaged ? join(process.resourcesPath, ...p) : join(__dirname, '..', 'resources', ...p);
}

async function boot(): Promise<void> {
  await app.whenReady();
  const dir = app.getPath('userData');
  const identity = createIdentityStore(dir, {
    available: safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b),
  });
  let settings = loadSettings(dir);
  devPanel = settings.devPanel;
  const controller = new HostController({
    central: createHostCentral({ url: cfg.centralUrl, key: cfg.centralKey }),
    identity,
    appVersion: cfg.version,
    tunnelOverride: cfg.tunnelOverride,
    log,
    // The server bundle is unpacked next to app.asar (a utility process loads it as a plain file).
    spawnServer: () => spawnServer(join(__dirname, 'server', 'graao-server.mjs').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')),
    tunnels: createTunnelFactory({ cloudflaredPath: process.env.GRAAO_CLOUDFLARED || resource('bin', 'cloudflared.exe'), log }),
    appMetrics,
  });
  controller.setSettings(settings);
  log(`Graao Host ${cfg.version} · central ${cfg.centralUrl ? new URL(cfg.centralUrl).host : 'não configurada'}${cfg.tunnelOverride ? ` · túnel forçado: ${cfg.tunnelOverride}` : ''}`);

  // The installer registers graao-host:// (and the uninstaller removes it): a copy run from elsewhere never takes it.
  Menu.setApplicationMenu(null);

  const icon = nativeImage.createFromPath(resource('icon.png'));
  const show = () => {
    if (!win) createWindow();
    else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  };
  const createWindow = () => {
    win = new BrowserWindow({
      width: 480,
      height: 760,
      minWidth: 420,
      minHeight: 620,
      title: 'Graao Host',
      icon,
      backgroundColor: '#14223d',
      autoHideMenuBar: true,
      show: !process.argv.includes('--hidden'),
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
    });
    // Local content only: no navigation, no new windows, links go to the system browser through IPC.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    void win.loadFile(join(__dirname, 'renderer', 'index.html'));
    win.on('close', (e) => {
      if (quitting || !controller.busy || !settings.minimizeToTray) return;
      e.preventDefault();
      win?.hide();
      if (!trayHintShown && Notification.isSupported()) {
        trayHintShown = true;
        new Notification({ title: 'Graao Host continua hospedando', body: 'A sala segue aberta. Use o ícone na bandeja para abrir ou encerrar.', icon }).show();
      }
    });
    win.on('closed', () => (win = null));
  };

  const updateTray = (s: HostUiState) => {
    if (!tray) return;
    const hosting = controller.busy;
    tray.setToolTip(hosting && s.room ? `Graao Host · hospedando ${s.room.code} (${s.room.humanCount} + ${s.room.effectiveBotCount} bots)` : 'Graao Host');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Graao Host', click: show },
        { label: 'Abrir sala no navegador', enabled: !!s.room, click: () => void openRoom() },
        { label: 'Encerrar hospedagem', enabled: hosting, click: () => void controller.stop() },
        { type: 'separator' },
        { label: 'Sair', click: () => app.quit() },
      ]),
    );
  };
  tray = new Tray(icon);
  tray.on('click', show);
  updateTray(controller.state);

  controller.onState((s) => {
    win?.webContents.send('host:state', s);
    updateTray(s);
  });

  const openRoom = async () => {
    const code = controller.roomCode;
    if (code) await shell.openExternal(roomUrl(cfg.siteUrl, code, controller.ownerKey));
  };
  const handleRaw = (raw: string) => {
    const link = parseHostLink(raw);
    if (!link) return log('link inválido ignorado');
    show();
    controller.handleLink(link);
  };

  // IPC: only from our own window, every argument checked.
  const own = (e: IpcMainInvokeEvent) => !!win && e.sender === win.webContents && (e.senderFrame?.url ?? '').startsWith('file://');
  const on = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!own(e)) throw new Error('origem não autorizada');
      return fn(...args);
    });
  on('host:get-state', () => controller.state);
  on('host:confirm-pairing', (accept) => controller.confirmPairing(accept === true));
  on('host:stop', () => controller.stop());
  on('host:retry', () => controller.retry());
  on('host:dismiss', () => controller.dismiss());
  on('host:clear-notice', () => controller.clearNotice());
  on('host:open-room', () => openRoom());
  on('host:open-site', () => shell.openExternal(cfg.siteUrl));
  on('host:download', () => {
    const url = controller.state.app.downloadUrl;
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
  });
  on('host:check-updates', () => controller.refreshConfig());
  on('host:unlink', () => controller.unlink());
  on('host:logs', () => (devPanel ? logs.slice(-300) : []));
  on('host:set-settings', (raw) => {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof HostSettings, unknown>>;
    settings = { launchAtLogin: o.launchAtLogin === true, minimizeToTray: o.minimizeToTray !== false, devPanel: o.devPanel === true };
    devPanel = settings.devPanel;
    saveSettings(dir, settings);
    // Starting with Windows only because the person asked for it (and it starts hidden in the tray).
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: ['--hidden'] });
    controller.setSettings(settings);
  });

  createWindow();
  app.on('second-instance', (_e, argv) => {
    const raw = findLink(argv);
    if (raw) handleRaw(raw);
    else show();
  });
  const first = findLink(process.argv);
  if (first) handleRaw(first);
  void controller.refreshConfig();
  setInterval(() => void controller.refreshConfig(), 6 * 3600 * 1000).unref();

  // Quitting while hosting: guests are told and the room leaves the list before the app goes away.
  app.on('before-quit', (e) => {
    if (quitting || !controller.busy) return;
    e.preventDefault();
    quitting = true;
    void Promise.race([controller.stop(), new Promise((r) => setTimeout(r, 8000))]).finally(() => app.quit());
  });
  app.on('window-all-closed', () => {
    if (!controller.busy) app.quit();
  });
}
