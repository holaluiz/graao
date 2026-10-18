/** The only bridge between the Graao Host window and the app: named actions, no Node, no raw IPC. */
import { contextBridge, ipcRenderer } from 'electron';

const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('graaoHost', {
  getState: () => call('host:get-state'),
  onState: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('host:state', h);
    return () => ipcRenderer.off('host:state', h);
  },
  onLog: (cb: (line: string) => void) => {
    const h = (_e: unknown, l: unknown) => typeof l === 'string' && cb(l);
    ipcRenderer.on('host:log', h);
    return () => ipcRenderer.off('host:log', h);
  },
  confirmPairing: (accept: boolean) => call('host:confirm-pairing', accept === true),
  stop: () => call('host:stop'),
  retry: () => call('host:retry'),
  dismiss: () => call('host:dismiss'),
  clearNotice: () => call('host:clear-notice'),
  openRoom: () => call('host:open-room'),
  openSite: () => call('host:open-site'),
  download: () => call('host:download'),
  checkUpdates: () => call('host:check-updates'),
  unlink: () => call('host:unlink'),
  logs: () => call('host:logs'),
  setSettings: (s: { launchAtLogin: boolean; minimizeToTray: boolean; devPanel: boolean }) => call('host:set-settings', { launchAtLogin: s.launchAtLogin === true, minimizeToTray: s.minimizeToTray === true, devPanel: s.devPanel === true }),
});
