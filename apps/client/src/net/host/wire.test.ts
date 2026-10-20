import { describe, expect, it, vi } from 'vitest';
import { FrameReader, classifyRoute, routeFromStats, within } from './wire';

const stats = (entries: Record<string, unknown>[]) => new Map(entries.map((e) => [String(e.id), e]));

describe('ICE route of a browser-hosted room', () => {
  it('classifies the selected pair: direct, through NAT (STUN) or relayed (TURN)', () => {
    expect(classifyRoute('host', 'host')).toBe('direta');
    expect(classifyRoute('srflx', 'host')).toBe('STUN');
    expect(classifyRoute('prflx', 'srflx')).toBe('STUN');
    expect(classifyRoute('relay', 'srflx')).toBe('relay');
    expect(classifyRoute('host', 'relay')).toBe('relay');
    expect(classifyRoute(undefined, 'host')).toBe('?');
  });

  it('reads Chromium reports (transport → selected pair) and Firefox ones (the pair marks itself)', () => {
    const chromium = stats([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P2' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1', state: 'failed' },
      { id: 'P2', type: 'candidate-pair', localCandidateId: 'L2', remoteCandidateId: 'R2', state: 'succeeded' },
      { id: 'L1', type: 'local-candidate', candidateType: 'host', protocol: 'udp' },
      { id: 'R1', type: 'remote-candidate', candidateType: 'host' },
      { id: 'L2', type: 'local-candidate', candidateType: 'srflx', protocol: 'udp' },
      { id: 'R2', type: 'remote-candidate', candidateType: 'srflx' },
    ]);
    expect(routeFromStats(chromium)).toBe('STUN · udp');
    const firefox = stats([
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1', nominated: true, state: 'succeeded', selected: true },
      { id: 'L1', type: 'local-candidate', candidateType: 'relay', protocol: 'tcp' },
      { id: 'R1', type: 'remote-candidate', candidateType: 'host' },
    ]);
    expect(routeFromStats(firefox)).toBe('relay · tcp');
    expect(routeFromStats(stats([{ id: 'P1', type: 'candidate-pair', state: 'in-progress' }]))).toBeNull();
  });
});

describe('within (reconnection attempts never outlive the window)', () => {
  it('passes a value or an error through when it comes in time', async () => {
    await expect(within(Promise.resolve(7), 50, 'late')).resolves.toBe(7);
    await expect(within(Promise.reject(new Error('no seat')), 50, 'late')).rejects.toThrow('no seat');
  });

  it('gives up at the deadline and hands a connection that arrives later to the cleanup', async () => {
    vi.useFakeTimers();
    try {
      let open!: (v: string) => void;
      const slow = new Promise<string>((r) => (open = r));
      const closed: string[] = [];
      const attempt = within(slow, 1000, 'reconnection window over', (late) => closed.push(late));
      const outcome = attempt.catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await outcome).toBe('reconnection window over');
      open('pc-1');
      await vi.advanceTimersByTimeAsync(0);
      expect(closed).toEqual(['pc-1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a window already over as an immediate timeout', async () => {
    await expect(within(new Promise(() => {}), -5, 'reconnection window over')).rejects.toThrow('reconnection window over');
  });
});

describe('data channel frames', () => {
  it('reassembles a split frame', () => {
    const r = new FrameReader();
    const whole = JSON.stringify([3, { big: 'x'.repeat(10) }]);
    const parts = [whole.slice(0, 8), whole.slice(8)];
    expect(r.read(JSON.stringify(['~', 1, 0, 2, parts[0]]))).toBeNull();
    expect(r.read(JSON.stringify(['~', 1, 1, 2, parts[1]]))).toEqual([3, { big: 'x'.repeat(10) }]);
    expect(r.read('not json')).toBeNull();
  });
});
