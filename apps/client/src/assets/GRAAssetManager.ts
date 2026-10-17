/**
 * GRAAssetManager: logical asset id → versioned URL, loading with real progress, caching, groups and release.
 * Production serves `/assets/v1/...` from Cloudflare R2 (VITE_ASSET_BASE); development serves the same paths from
 * the Vite public folder. Nothing preloads the whole game: callers load per group.
 */
import { ASSET_VERSION } from '@graao/shared';

export type AssetGroup = 'CORE' | 'MENU' | 'CHARACTER_CREATOR' | 'DRAFT' | 'MATCH' | 'AUDIO';

interface Tracked {
  label: string;
  done: boolean;
}

export class GRAAssetManager {
  private readonly base: string;
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly tracked: Tracked[] = [];
  private readonly listeners = new Set<(p: { done: number; total: number; label: string }) => void>();
  readonly loadedGroups = new Set<AssetGroup>();
  bytesLoaded = 0;

  constructor(base: string = (import.meta.env.VITE_ASSET_BASE as string | undefined) ?? '') {
    this.base = `${base.replace(/\/$/, '')}/assets/${ASSET_VERSION}/`;
  }

  /** Versioned URL for a logical asset path such as `animations/ual1-clips.glb`. */
  url(path: string): string {
    return this.base + path.replace(/^\//, '');
  }

  onProgress(fn: (p: { done: number; total: number; label: string }) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Registers a pending load in the global progress count. */
  track<T>(p: Promise<T>, label: string): Promise<T> {
    const t: Tracked = { label, done: false };
    this.tracked.push(t);
    this.emit(label);
    return p.finally(() => {
      t.done = true;
      this.emit(label);
    });
  }

  /** Cached load keyed by logical id. */
  load<T>(id: string, loader: () => Promise<T>): Promise<T> {
    let p = this.cache.get(id) as Promise<T> | undefined;
    if (!p) {
      p = this.track(loader(), id);
      this.cache.set(id, p);
    }
    return p;
  }

  release(id: string): void {
    this.cache.delete(id);
  }

  async fetchBytes(path: string): Promise<ArrayBuffer> {
    return this.load(path, async () => {
      const res = await fetch(this.url(path));
      if (!res.ok) throw new Error(`asset ${path}: HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      this.bytesLoaded += buf.byteLength;
      return buf;
    });
  }

  private emit(label: string): void {
    const done = this.tracked.filter((t) => t.done).length;
    for (const fn of this.listeners) fn({ done, total: this.tracked.length, label });
  }
}
