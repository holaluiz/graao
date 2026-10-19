# M2 — Validação do Graao Host em redes reais

Protocolo do Gate B. O que já foi testado num PC só (três hosts por túnel quick, central de produção, app empacotado)
está em [GRAAO_HOST_TEST_REPORT.md](../hosting/GRAAO_HOST_TEST_REPORT.md); aqui fica o que falta provar **entre
máquinas e redes diferentes**, como medir e o que precisa do dono do projeto. Resultados vão para
`docs/qa/EXTERNAL_ALPHA_REPORT.md` — nada é marcado como feito sem as máquinas.

## O que o dono do projeto precisa providenciar

| Item | Por quê | Bloqueia |
|---|---|---|
| **PC B em outra rede** (outra casa, ou o mesmo PC num celular roteando 4G/5G) com Chrome ou Edge | Convidado real fora da rede do host | Gate B |
| **PC C (e D)** para três hosts reais, idealmente em três redes | Três hosts independentes | Gate B (parte 2) |
| Uma pessoa em cada máquina durante ~40 min (ou acesso remoto) | Jogar Draft → partida → lobby | Gate B |
| Conta/zona Cloudflare + token mínimo (*Tunnel Edit*, *DNS Edit*) | Túnel gerenciado (hostname estável) em vez do quick de teste | Produção, não o Gate B |
| Certificado de assinatura de código (opcional) | Tirar o aviso do SmartScreen | Lançamento |

O Gate B pode ser cumprido com **túnel quick** (`tunnel_mode = quick-test`, já em produção): ele é suficiente para
provar a partida entre redes, não para escala.

## Antes da sessão (dá para fazer agora, sem máquinas)

- [x] Segredos: o bundle do cliente não contém chave de serviço, segredo de `record_match`, token da Cloudflare nem
      segredo administrativo do host (busca no `dist/` em 19/10/2026; `sb_secret_` aparece só como prefixo reconhecido
      pela biblioteca supabase-js).
- [x] RLS habilitado em todas as tabelas `public` (`profiles`, `matches`, `match_players`, `host_installations`,
      `host_tickets`, `host_rooms`) e nas `private` do host; `private.server_keys` fica fora da API.
- [x] Superfície pelo túnel: o servidor do host escuta só em `127.0.0.1`; pela borda saem `/health`, `/rooms` e o
      matchmaking do Colyseus. Criar sala pela rede é recusado em `HOST_MODE=DESKTOP` (só o app, com a chave do
      processo); dono da sala só com a chave do dono. O app Electron não abre outro servidor HTTP.
- [x] Electron: `contextIsolation`, `sandbox`, `nodeIntegration: false`, `webSecurity` na janela; IPC pelo preload.
- [x] Mensagens C2S: cada tipo passa por um validador de `@graao/shared/validate.ts` antes de tocar o estado; tipos
      desconhecidos são só registrados.
- [x] Versões: protocolo (`VERSION_MISMATCH`) e, desde 19/10/2026, mapa (`MAP_MISMATCH`) recusados antes de criar
      estado na sala, com mensagem em português.
- [ ] Publicar um instalador com a checagem de mapa (o `host-v0.1.0` é anterior a ela). **Publicação externa: pedir
      aprovação.** Enquanto isso, site novo + host 0.1.0 continuam compatíveis (o host antigo ignora o campo `map`).

## Roteiro da sessão

Abra o F3 em todos os clientes (ping, quedas de conexão, tick do servidor, snapshot) e anote no relatório.

| # | Cenário | Passos | Medir | Passa se |
|---|---|---|---|---|
| 1 | 1 host + 1 convidado, redes diferentes | PC A: site → Criar e hospedar → app vincula. PC B: lista → entrar. Os dois: Pronto → Draft → OVNI → partida até o fim → Voltar ao lobby | RTT (F3) no lobby e na partida, jitter (variação do ping), quedas, tempo de "sala pronta" | partida termina, os dois voltam ao lobby, 0 quedas |
| 2 | 1 host + vários convidados (+ bots até 10) | Repetir 1 com 2–4 pessoas e o resto bots | upload do host (painel técnico do app), CPU, tick | tick < 16 ms, nenhum convidado cai |
| 3 | Três hosts simultâneos | PCs A, C, D hospedam ao mesmo tempo; convidados em cada | o mesmo por sala | três partidas completas e independentes |
| 4 | Queda do host | Fechar o Graao Host no meio da partida; noutra rodada, desligar o Wi-Fi do host | tempo até o aviso "O HOST ENCERROU A PARTIDA" e até a sala sumir da lista | aviso claro, lista limpa em ≤ 30 s |
| 5 | Reconexão do convidado | Desligar a rede do PC B por 5 s e religar | F3 "quedas conexão", volta à mesma vaga | volta sem perder a partida (janela de 20 s, `RECONNECT_SECONDS`) |
| 6 | Versão incompatível | Host 0.1.0 × site com protocolo novo (ou mapa novo, quando o host novo existir) | mensagem mostrada | entrada bloqueada com explicação, sem estado parcial |
| 7 | Atualização do app | Instalar a versão nova por cima da 0.1.0 | vínculo e salas continuam | sem reinstalar do zero |

## Critérios de rede (primeira referência, a confirmar com os dados)

- RTT de jogo ≤ 120 ms jogável; ≤ 60 ms bom (medido hoje no mesmo PC: 23–31 ms pela borda `gig`).
- Jitter (desvio do RTT) ≤ 20 ms; mais que isso aparece como extrapolação (F3 "extrap. remoto").
- Upload do host com 10 participantes ≈ 1,2 Mbit/s médio (medido no mesmo PC): conferir na rede doméstica real.

## Se o túnel não atender

Não migrar para WebRTC por preferência nem mudar a topologia antes de esgotar a avaliação. Ordem de alternativas,
todas atrás da interface `TunnelFactory` (`apps/host/src/main/tunnel.ts`), sem mexer no jogo:

1. Túnel **gerenciado** da Cloudflare (hostname estável, sem os limites do quick) — já implementado, falta a conta.
2. Outro provedor de túnel/relay (ex.: relay WSS próprio numa VPS pequena) publicando o mesmo endpoint na central.
3. Só então: salas no navegador (WebRTC, já existem para regressão) como caminho de convidados com NAT difícil.

Custos de qualquer alternativa paga: pedir aprovação antes.
