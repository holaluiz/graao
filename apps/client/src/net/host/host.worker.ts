/**
 * The host's match room, off the page's main thread: it keeps ticking while the host's tab is in the background
 * (pages throttle their own timers there; dedicated workers keep theirs) and never stalls the host's rendering.
 */
import './processShim';
import { HostRoomDriver } from './HostRoomDriver';
import type { ToRoom } from './hostProtocol';

const scope = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<ToRoom>) => void) | null };
const driver = new HostRoomDriver((m) => scope.postMessage(m));
scope.onmessage = (e) => void driver.handle(e.data);
