# Graao Host — conexão pública (Cloudflare Tunnel)

O PC do host não abre porta nem mexe no roteador: o `cloudflared` (empacotado, Apache-2.0, versão fixada
**2026.9.3**, SHA-256 conferido e assinatura Authenticode "Cloudflare, Inc." verificada por
`tools/hosting/fetch-cloudflared.mjs`) faz uma conexão de **saída** até a borda da Cloudflare, que entrega HTTPS/WSS
ao servidor local em `127.0.0.1:<porta>`. Os convidados veem só o hostname; o IP do host fica escondido.

## Modos (`tunnel_mode` em `private.host_config`)

| Modo | Para quê | Hostname | Estado |
|---|---|---|---|
| `managed` | **Produção** | estável por instalação: `h-<id>.<GRAAO_HOST_DOMAIN>` | Implementado (Edge Function `graao-host-tunnel` + app); **não executado** — falta conta/zona Cloudflare |
| `quick-test` | Testes | aleatório `*.trycloudflare.com` a cada sessão | Funcionando; padrão da migration até o modo gerenciado existir |
| `direct-dev` | Desenvolvimento local e testes automáticos | `ws://127.0.0.1:<porta>` | Só aceito pela central de desenvolvimento |

O app usa o modo que a central manda (no `claim`); `GRAAO_HOST_TUNNEL=direct|quick` força outro só em desenvolvimento.

## Como o túnel é considerado pronto

1. `cloudflared` imprime o hostname (teste) / recebe o hostname (gerenciado) e registra a primeira conexão;
2. o hostname resolve nos resolvedores públicos (1.1.1.1/8.8.8.8, consultados diretamente — perguntar ao Windows cedo
   demais deixa um NXDOMAIN no cache negativo do sistema por minutos; foi a causa da primeira falha medida);
3. `GET https://<hostname>/health` responde `{ok:true, mode:"DESKTOP"}` pela borda.

Só então a sala é publicada. Prazo total: 45 s.

## Túnel gerenciado — provisionamento

Edge Function `supabase/functions/graao-host-tunnel` (token Cloudflare só nela):

- valida o token de sessão (`host_session_validate`);
- cria (uma vez) o túnel `graao-host-<hostId>` com configuração remota; **gira o segredo a cada sessão**;
- configura o ingress `h-<id>.<domínio> → http://127.0.0.1:<porta>` e `http_status:404` para o resto;
- cria/atualiza o CNAME proxied `h-<id>` → `<tunnel>.cfargotunnel.com`;
- devolve o token do conector; o app o passa ao `cloudflared tunnel run` por variável de ambiente;
- `action: "cleanup"` (com `x-graao-admin`) apaga túnel + DNS de instalações revogadas ou paradas há N dias.

Configurar (dono do projeto):

```bash
supabase login
supabase secrets set --project-ref roxnhqzeznsdnsqjcmmn CF_API_TOKEN=… CF_ACCOUNT_ID=… CF_ZONE_ID=… GRAAO_HOST_DOMAIN=play.graao.com GRAAO_HOST_ADMIN_SECRET=…
supabase functions deploy graao-host-tunnel --project-ref roxnhqzeznsdnsqjcmmn --no-verify-jwt
```

e, no SQL: `update private.host_config set value = '"managed"' where key = 'tunnel_mode';`

Token da Cloudflare com o mínimo: *Account › Cloudflare Tunnel › Edit* e *Zone › DNS › Edit* (só a zona do graao).

## Limites, custos e adequação (pesquisado em 2026-10-18)

| Item | Limite / custo | Fonte |
|---|---|---|
| Túneis por conta | **1.000** (inclui inativos); além disso "Tunnels for Platforms": **US$ 4,50 por túnel/mês** acima de 1.000 | [limites](https://developers.cloudflare.com/cloudflare-one/account-limits/), [Tunnels for Platforms](https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/) |
| Réplicas por túnel | 25 | limites |
| Registros DNS por zona | Grátis: **200** (zonas criadas a partir de 2024-09-01; 1.000 nas anteriores); Pro/Business: 3.500 | [DNS records](https://developers.cloudflare.com/dns/manage-dns-records/) |
| Quick Tunnels | Só teste; sem garantia; **200 requisições em voo**; hostname muda a cada vez; sem SSE | [TryCloudflare](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) |
| Tráfego WebSocket | Medido: ≈ 4,9 MB enviados pelo servidor de um host com 10 pessoas em ~32 s de sessão (lobby → Draft → OVNI → 12 s de partida): ≈ 1,2 Mbit/s de upload em média, mais alto na partida | `docs/hosting/evidence/three-hosts.json` |

Consequências:

- Com um hostname/registro DNS por instalação, uma zona grátis nova comporta **menos de 200 hosts cadastrados**
  (contando outros registros). Para crescer: plano Pro (3.500), reciclagem agressiva (`cleanup`), ou trocar o modelo
  (um túnel por **sessão** com registros temporários). Acima de 1.000 instalações ativas, Tunnels for Platforms (pago).
- Tráfego contínuo de jogo por túneis em plano grátis: os Termos da Cloudflare restringem uso desproporcional de
  conteúdo não-HTML em alguns serviços; **validar com a Cloudflare antes de divulgar em escala**. Não há promessa de
  custo zero ilimitado.
- A interface de conectividade (`TunnelFactory` em `apps/host/src/main/tunnel.ts` + endpoint publicado pela central)
  permite trocar o provedor (outro túnel, relay próprio) sem mexer no jogo.

## Medições (Quick Tunnel, um PC, rede doméstica no Brasil, borda `gig`)

- Sala pronta (link → publicada): **8,1 / 8,3 / 8,5 s** (três hosts ao mesmo tempo; 8,3–11,5 s em outras rodadas).
- Ping de jogo (PING/PONG da sala pelo túnel, ida e volta saindo e voltando pela Cloudflare): **23–31 ms**.
- Três partidas simultâneas por três túneis, 18 clientes: sem desconexões; ver relatório de testes.
