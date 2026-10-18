import { describe, expect, it } from 'vitest';
import { dedicatedServer, httpBase, officialServerUrl, serverTarget } from './serverTarget';

describe('match server target', () => {
  const page = { protocol: 'https:', hostname: 'graao.vercel.app' };

  it('uses the build’s VITE_SERVER_URL, else the page host on 2567', () => {
    expect(officialServerUrl({ VITE_SERVER_URL: 'wss://play.example.com/' }, page)).toBe('wss://play.example.com');
    expect(officialServerUrl({}, page)).toBe('wss://graao.vercel.app:2567');
    expect(officialServerUrl({}, { protocol: 'http:', hostname: '192.168.0.12' })).toBe('ws://192.168.0.12:2567');
  });

  it('lets ?server= point a tab elsewhere: any ws in development, only wss in production, never official', () => {
    const official = 'wss://play.example.com';
    expect(serverTarget('?server=ws://localhost:2568', true, official)).toEqual({ url: 'ws://localhost:2568', official: false });
    expect(serverTarget('?server=ws://localhost:2568', false, official)).toEqual({ url: official, official: true });
    expect(serverTarget('?server=wss://abc.trycloudflare.com', false, official)).toEqual({ url: 'wss://abc.trycloudflare.com', official: false });
    expect(serverTarget('?server=wss://play.example.com/', false, official)).toEqual({ url: official, official: true });
    expect(serverTarget('?server=javascript:alert(1)', false, official)).toEqual({ url: official, official: true });
    expect(serverTarget('?server=wss://evil.example.com/path?x=1', false, official)).toEqual({ url: official, official: true });
    expect(serverTarget('', false, official)).toEqual({ url: official, official: true });
  });

  it('lets the room creator host unless the build or ?server= names a dedicated server', () => {
    expect(dedicatedServer('', false, {})).toBe(false);
    expect(dedicatedServer('', false, { VITE_SERVER_URL: 'wss://play.example.com' })).toBe(true);
    expect(dedicatedServer('?server=ws://localhost:2569', true, {})).toBe(true);
    expect(dedicatedServer('?server=ws://localhost:2569', false, {})).toBe(false);
    expect(dedicatedServer('?server=wss://abc.trycloudflare.com', false, {})).toBe(true);
    expect(dedicatedServer('?server=javascript:alert(1)', true, {})).toBe(false);
  });

  it('derives the HTTP base for /health', () => {
    expect(httpBase('wss://play.example.com')).toBe('https://play.example.com');
    expect(httpBase('ws://localhost:2567')).toBe('http://localhost:2567');
  });
});
