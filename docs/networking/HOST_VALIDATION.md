# M2 — Validação da hospedagem em redes reais

Protocolo do Gate B. Desde 19/10/2026 o site só oferece **sala hospedada na aba de quem cria** (WebRTC + sinalização
Supabase, [BROWSER_HOSTED_ROOMS.md](../architecture/BROWSER_HOSTED_ROOMS.md)); o Graao Host está desligado no site
(`VITE_GRAAO_HOST`, ADR-006 em [MASTER_GAME_DESIGN_2.md](../product/MASTER_GAME_DESIGN_2.md#decisões-adrs-curtos)).
Aqui fica o que falta provar **entre máquinas e redes diferentes**, como medir e o que precisa do dono do projeto.
Resultados vão para `docs/qa/EXTERNAL_ALPHA_REPORT.md` — nada é marcado como feito sem as máquinas.

Já provado num PC só: host + convidado em duas abas até a partida e de volta ao lobby, convidado reconectando em
0,9 s na mesma vaga (0,3 s em 20/10), sala do host seguindo no ritmo com a aba em segundo plano, e o site no ar
(PR #7) hospedando até o Draft com convidado em outra aba. Em 20/10: desistência limitada à janela (19,0 s com a
sinalização travada) e anfitriã fechando a sala ([baseline](../qa/BASELINE_2026_10.md#4-rede-da-sala-na-aba-estados-explícitos-e-prazos-que-não-estouram)). O histórico do Graao Host (três hosts por túnel quick, central de produção, app
empacotado) está em [GRAAO_HOST_TEST_REPORT.md](../hosting/GRAAO_HOST_TEST_REPORT.md).

## O que o dono do projeto precisa providenciar

| Item | Por quê | Bloqueia |
|---|---|---|
| **PC B em outra rede** (outra casa, ou o mesmo PC num celular roteando 4G/5G) com Chrome ou Edge | Convidado real fora da rede do host | Gate B |
| **PC C (e D)** para três hosts reais, idealmente em três redes | Três hosts independentes | Gate B (parte 2) |
| Uma pessoa em cada máquina durante ~40 min (ou acesso remoto) | Jogar Draft → partida → lobby | Gate B |
| Um convidado numa rede restrita (4G de operadora, rede de empresa ou escola) | Saber se a conexão direta basta ou se é preciso TURN | Decisão sobre TURN |
| Serviço TURN (só se o cenário 7 falhar) | Retransmitir quando a conexão direta é bloqueada; é serviço externo, **pedir aprovação** (custo) | Convidados em NAT restrito |

Conta Cloudflare e certificado de assinatura só voltam a importar se o Graao Host for religado.

## Antes da sessão (dá para fazer agora, sem máquinas)

- [x] Segredos: o bundle do cliente não contém chave de serviço, segredo de `record_match`, token da Cloudflare nem
      segredo administrativo do host (busca no `dist/` em 19/10/2026; `sb_secret_` aparece só como prefixo reconhecido
      pela biblioteca supabase-js).
- [x] RLS habilitado em todas as tabelas `public` (`profiles`, `matches`, `match_players`, `host_installations`,
      `host_tickets`, `host_rooms`) e nas `private` do host; `private.server_keys` fica fora da API.
- [x] Mensagens C2S: cada tipo passa por um validador de `@graao/shared/validate.ts` antes de tocar o estado; tipos
      desconhecidos são só registrados. A sala na aba é o mesmo `GraaoMatchRoom`.
- [x] Versões: protocolo (`VERSION_MISMATCH`) e, desde 19/10/2026, mapa (`MAP_MISMATCH`) recusados antes de criar
      estado na sala, com mensagem em português.
- [ ] Build publicado com `VITE_SUPABASE_*` (vem de `apps/client/.env.production`, PR #7 em `main`) e sem
      `VITE_GRAAO_HOST`: conferir no chunk `GraaoApp-*.js` que `supabase.co` aparece e que o formulário mostra só
      **Criar sala**.
- [ ] `VITE_ICE_SERVERS` vazio = só STUN (Google, Cloudflare). Anotar no relatório que a sessão rodou sem TURN.

## Roteiro da sessão

Abra o F3 em todos os clientes (ping, quedas de conexão, tick do servidor, snapshot) e anote no relatório. Anote
também o tipo de rede de cada PC (fibra doméstica, 4G, empresa).

Desde 20/10/2026 o F3 mostra também, em cada convidado:

- **conexão** — estado da ligação com a sala (`SIGNALING`, `CONNECTING`, `CONNECTED`, `RECONNECTING · tentativa n`,
  `FAILED · motivo`, `CLOSED · motivo`) e há quanto tempo está nele. Tabela de transições em
  [BASELINE_2026_10.md §4](../qa/BASELINE_2026_10.md#4-rede-da-sala-na-aba-estados-explícitos-e-prazos-que-não-estouram).
- **rota** — como os bytes chegam: `direta` (mesma rede ou endereço alcançável), `STUN` (atravessou NAT), `relay`
  (passou por TURN; só aparece se `VITE_ICE_SERVERS` tiver um TURN).

E o console (F12) registra cada mudança: `[graao] conexão (sala): A → B · motivo` e `[graao] rota até a sala …`.
Copie essas linhas para o relatório em cada falha.

Como ler uma entrada que não conecta:

| Parou em | Significa | Próximo passo |
|---|---|---|
| `SIGNALING` (ou "O serviço que conecta os jogadores não respondeu") | o navegador não alcança o Supabase Realtime | testar a internet do convidado; não é NAT |
| `FAILED` logo após `SIGNALING` com "Nenhuma sala com esse código" | o host não respondeu no canal do código | conferir o código e se a aba do host está aberta |
| `FAILED` depois de `CONNECTING` com "a rede de um de vocês bloqueia conexões diretas" | ICE sem rota entre as duas redes | **é o caso que só TURN resolve**: registrar as duas redes |
| `CONNECTED` com rota `STUN` | NAT atravessado sem TURN | nada a fazer |

| # | Cenário | Passos | Medir | Passa se |
|---|---|---|---|---|
| 1 | 1 host + 1 convidado, redes diferentes | PC A: site → Jogar → Criar sala (a sala roda na aba). PC B: lista → Entrar. Os dois: Pronto → Draft → OVNI → partida até o fim → Voltar ao lobby | tempo entre Entrar e o lobby, RTT (F3) no lobby e na partida, jitter (variação do ping), quedas | partida termina, os dois voltam ao lobby, 0 quedas |
| 2 | 1 host + vários convidados (+ bots até 10) | Repetir 1 com 2–4 pessoas e o resto bots | tick (F3), CPU da aba do host (Gerenciador de tarefas do navegador, Shift+Esc), upload do host | tick < 16 ms, nenhum convidado cai, o host continua jogável |
| 3 | Três hosts simultâneos | PCs A, C, D hospedam ao mesmo tempo; convidados em cada | o mesmo por sala | três partidas completas e independentes |
| 4 | Queda do host | Fechar a aba do host no meio da partida; noutra rodada, desligar o Wi-Fi do host | tempo até o aviso "Quem criou a sala saiu: a sala fechou." e até a sala sumir da lista | aviso claro, lista limpa em ≤ 30 s |
| 5 | Reconexão do convidado | Desligar a rede do PC B por 5 s e religar; noutra rodada, por 30 s | F3 "quedas conexão", "conexão" (`RECONNECTING · tentativa n`), volta à mesma vaga | 5 s: volta sem perder a partida; 30 s: desiste em ≈ 19 s com "A conexão com a sala caiu." (nunca fica "reconectando…" para sempre) e o host libera a vaga |
| 6 | Host em segundo plano | O host troca de aba (ou minimiza) por 30 s no meio da partida | tick e RTT dos convidados nesse intervalo | convidados seguem jogando sem travar |
| 7 | Rede restrita | Convidado no 4G (celular roteando) ou rede de empresa entra numa sala de PC A | conecta ou mostra "a rede de um de vocês bloqueia conexões diretas"; F3 "rota" quando conecta | conecta; se falhar em `CONNECTING`, registrar as duas redes: é o dado para decidir sobre TURN |
| 8 | Versão incompatível | Host com a aba aberta antes de um deploy × convidado com o build novo | mensagem mostrada | entrada bloqueada com "recarreguem a página", sem estado parcial |

## Critérios de rede (primeira referência, a confirmar com os dados)

- RTT de jogo ≤ 120 ms jogável; ≤ 60 ms bom.
- Jitter (desvio do RTT) ≤ 20 ms; mais que isso aparece como extrapolação (F3 "extrap. remoto").
- Upload do host: um canal de dados por convidado. Referência medida no mesmo PC com o servidor do Graao Host
  (mesma sala, mesmos snapshots): ≈ 1,2 Mbit/s médio com 10 participantes. Conferir na rede doméstica real.

## Se a conexão direta não atender

Ordem de alternativas, sem mexer no jogo (a sala é a mesma nos três caminhos):

1. **TURN** para quem não conecta direto: `VITE_ICE_SERVERS` com um `RTCIceServer` de retransmissão. Serviço
   externo: **pedir aprovação** antes (custo).
2. Religar o **Graao Host** (`VITE_GRAAO_HOST=on` no build): o túnel funciona em qualquer rede, mas o host instala o
   app. Antes, publicar um instalador com a checagem de mapa (o `host-v0.1.0` é anterior a ela) e, para produção,
   o túnel gerenciado da Cloudflare — **publicação externa e conta: pedir aprovação**.
3. Servidor dedicado pago: pedir aprovação.
