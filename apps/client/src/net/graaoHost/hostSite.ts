/**
 * The site's side of Graao Host (rooms that run on a player's own PC, see docs/hosting/GRAAO_HOST_ARCHITECTURE.md):
 * the central service client, the public list of those rooms, room code → endpoint resolution, and the hosting
 * request — a one-time ticket created for this player, then the `graao-host://` link that wakes the app.
 *
 * The central service is the graao Supabase project (RPCs), or a development central (VITE_GRAAO_HOST_API). Guests
 * never send their Supabase token to a host's PC: a Graao Host room only ever learns a display name, and the owner's
 * key (the ticket secret) that makes them its host.
 *
 * Off on the site unless the build sets VITE_GRAAO_HOST=on (since 2026-10-19 rooms are hosted in the creator's browser
 * tab, docs/architecture/BROWSER_HOSTED_ROOMS.md): with it off, nothing here is listed, offered or contacted.
 */
import {
  HOST_TICKET_TTL_S,
  HostCentralError,
  PROTOCOL_VERSION,
  buildHostLink,
  createHostCentral,
  publicRoomToListing,
  randomSecret,
  sha256Hex,
  type HostCentral,
  type HostRoomSettings,
  type RoomEndpoint,
  type RoomListing,
} from '@graao/shared';

const API = ((import.meta.env.VITE_GRAAO_HOST_API as string | undefined) || (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '').replace(/\/+$/, '');
const KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

const ENABLED = /^(on|1|true)$/i.test((import.meta.env.VITE_GRAAO_HOST as string | undefined) ?? '');

/** Can this build list and create Graao Host rooms? (Turned on, and a central service to talk to.) */
export const hostApiConfigured = (): boolean => ENABLED && !!API && !!KEY;

let anon: HostCentral | null = null;
const central = (): HostCentral => (anon ??= createHostCentral({ url: API, key: KEY, timeoutMs: 6000 }));

/** Rooms running on Graao Host installations right now (fresh heartbeat, public), as room browser lines. */
export async function graaoHostRooms(): Promise<RoomListing[]> {
  return (await central().publicRooms()).map(publicRoomToListing);
}

/** Room code → the endpoint of its host (null: no live Graao Host room with this code). */
export async function resolveHostRoom(code: string): Promise<RoomEndpoint | null> {
  if (!hostApiConfigured()) return null;
  return central().roomEndpoint(code).catch(() => null);
}

/** Where to download the app: this build's setting, else the central service's. */
export async function hostDownloadUrl(): Promise<string> {
  const own = (import.meta.env.VITE_GRAAO_HOST_DOWNLOAD_URL as string | undefined) ?? '';
  if (own) return own;
  return central()
    .config()
    .then((c) => c.downloadUrl)
    .catch(() => '');
}

export type LaunchState =
  | { s: 'creating' }
  | { s: 'opening' }
  /** The app did not take the request (not installed, blocked, or the person declined the browser prompt). */
  | { s: 'not-detected' }
  | { s: 'starting' }
  | { s: 'ready'; code: string; endpoint: string; hostKey: string }
  | { s: 'failed'; reason: string; update?: boolean; canRetry: boolean };

const REASONS: Record<string, [string, boolean?]> = {
  version_mismatch: ['O Graao Host instalado é de outra versão do jogo. Atualize o aplicativo para hospedar.', true],
  host_busy: ['Seu Graao Host já está hospedando outra sala. Encerre-a no aplicativo antes de criar outra.'],
  tunnel: ['O Graao Host não conseguiu abrir a conexão pública da sala. Confira a internet do PC e tente de novo pelo aplicativo.'],
  tunnel_unconfigured: ['O serviço de conexões públicas do graao ainda não está configurado.'],
  provisioning: ['O serviço central não conseguiu preparar o endereço público da sala.'],
  server_start: ['O servidor da partida não iniciou no seu PC. Veja os detalhes no Graao Host.'],
  server_crashed: ['O servidor da partida parou no seu PC.'],
  conflict: ['Este PC está vinculado a outra conta do graao.'],
  auth: ['O Graao Host não está autorizado para esta conta. Veja as configurações do aplicativo.'],
  network: ['O Graao Host não conseguiu falar com o serviço central.'],
  room_gone: ['A sala foi encerrada no Graao Host.'],
};

/**
 * One "Criar e hospedar": ticket → link → the app claims it (starting) → the room is reachable and listed (ready).
 * Polls the ticket once a second until it is ready, fails or expires; `reopen()` opens the link again (the person
 * installed the app meanwhile); `cancel()` stops waiting and withdraws a ticket nobody took.
 */
export class HostLaunch {
  state: LaunchState = { s: 'creating' };
  onChange: (s: LaunchState) => void = () => {};
  private ticket: { id: string; secret: string; createdAt: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private openedAt = 0;
  private stopped = false;

  constructor(
    private readonly settings: HostRoomSettings,
    private readonly accessToken: () => Promise<string | undefined>,
  ) {}

  private set(s: LaunchState): void {
    this.state = s;
    this.onChange(s);
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.set({ s: 'creating' });
    try {
      const site = createHostCentral({ url: API, key: KEY, accessToken: async () => (await this.accessToken()) ?? null, timeoutMs: 8000 });
      const secret = randomSecret(32);
      const { ticketId } = await site.ticketCreate(await sha256Hex(secret), this.settings, PROTOCOL_VERSION);
      this.ticket = { id: ticketId, secret, createdAt: Date.now() };
      this.open();
    } catch (e) {
      const code = e instanceof HostCentralError ? e.code : '';
      this.set({
        s: 'failed',
        canRetry: true,
        reason:
          code === 'unauthenticated'
            ? 'Não foi possível confirmar sua conta do graao. Recarregue a página e tente de novo.'
            : code === 'rate_limited'
              ? 'Muitos pedidos de sala em pouco tempo. Aguarde um minuto.'
              : code === 'unavailable'
                ? 'O serviço de hospedagem do graao não respondeu. Tente de novo em instantes.'
                : `Não foi possível pedir a sala: ${(e as Error).message}`,
      });
    }
  }

  /** Opens the link again (same ticket while it is still waiting for the app; installing can take longer than it lasts). */
  reopen(): void {
    if (!this.ticket || Date.now() - this.ticket.createdAt > (HOST_TICKET_TTL_S - 30) * 1000) return void this.start();
    this.open();
  }

  private open(): void {
    const t = this.ticket!;
    this.openedAt = Date.now();
    this.set({ s: 'opening' });
    // The browser asks the person before handing a custom link to an app; without the app nothing happens.
    window.location.href = buildHostLink({ action: 'host', ticket: t.id, secret: t.secret });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), 1000);
  }

  private async poll(): Promise<void> {
    const t = this.ticket;
    if (!t || this.stopped) return;
    let next = 1000;
    try {
      const st = await central().ticketStatus(t.id, t.secret);
      if (this.stopped) return;
      if (st.status === 'READY' && st.endpointUrl) return this.set({ s: 'ready', code: st.roomCode, endpoint: st.endpointUrl, hostKey: t.secret });
      if (st.status === 'FAILED') {
        const [reason, update] = REASONS[st.error] ?? [`O Graao Host não conseguiu criar a sala (${st.error || 'erro desconhecido'}).`];
        return this.set({ s: 'failed', reason, update, canRetry: !update });
      }
      if (st.status === 'EXPIRED') return this.set({ s: 'failed', reason: 'O Graao Host não respondeu a tempo. Crie a sala de novo.', canRetry: true });
      if (st.status === 'CANCELLED') return this.set({ s: 'failed', reason: 'A vinculação foi cancelada no Graao Host.', canRetry: true });
      if (st.status === 'CLAIMED' && this.state.s !== 'starting') this.set({ s: 'starting' });
      else if (st.status === 'PENDING' && this.state.s === 'opening' && Date.now() - this.openedAt > 8000) this.set({ s: 'not-detected' });
      if (st.status === 'PENDING' && Date.now() - this.openedAt > HOST_TICKET_TTL_S * 1000) return;
    } catch {
      next = 3000;
    }
    this.timer = setTimeout(() => void this.poll(), next);
  }

  /** Keep watching after a failure (the person may retry in the app). */
  watchAgain(): void {
    if (!this.ticket) return;
    this.stopped = false;
    this.set({ s: 'starting' });
    void this.poll();
  }

  cancel(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    const t = this.ticket;
    if (t && (this.state.s === 'opening' || this.state.s === 'not-detected')) void central().ticketCancel(t.id, t.secret).catch(() => {});
  }
}
