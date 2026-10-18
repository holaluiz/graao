/** `node:crypto` for server modules bundled into the host worker: Web Crypto is the same API on `globalThis`. */
export const webcrypto = globalThis.crypto;
