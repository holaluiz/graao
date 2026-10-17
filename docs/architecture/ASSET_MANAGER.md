# GRAAssetManager

`apps/client/src/assets/GRAAssetManager.ts`

- Logical path → versioned URL: `${VITE_ASSET_BASE}/assets/${ASSET_VERSION}/<path>` (R2 in production; Vite `public/`
  in development, same layout).
- `load(id, loader)` caches promises per id (going back to something loaded is instant); `release(id)` drops it.
- `track(promise, label)` feeds the real-progress counter used by the boot screen.
- Groups: CORE, MENU, CHARACTER_CREATOR, DRAFT, MATCH, AUDIO. Nothing preloads the whole game.

Today the only downloaded assets are the two animation packs (913 KB). Characters, props and terrain are generated in
code (zero bytes). When authored GLB parts arrive, the creator loads base body → current outfit → visible category →
the rest lazily (Messenger study §6).
