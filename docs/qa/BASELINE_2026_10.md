# Baseline 20/10/2026 — Master Plan 3.0, Fase A

Confronto entre o **Relatório Completo de Engenharia, Arquitetura e Produto (20/10/2026)** e o repositório em
`049fdf1` (`main`, produção). A auditoria anterior, de 19/10 em `cc7962a`, continua em
[AUDIT_M0_2026-10-19.md](AUDIT_M0_2026-10-19.md); este arquivo registra o que mudou desde então e o que a Fase A fez.
Tudo foi conferido no código ou executado nesta máquina (Windows 10, Node 22, 4 núcleos, RX 570). O que não foi
executado está marcado como tal.

Vocabulário do plano 3.0: `DONE` · `PARTIAL` · `BROKEN` · `NOT_STARTED` · `BLOCKED`. O `TESTING` de
[RELEASE_GATES.md](RELEASE_GATES.md) (integrado e com testes automatizados, faltando a verificação que o contrato
exige: redes externas, celular físico, pessoa jogando) aparece aqui como **`PARTIAL (TESTING)`**: não é `DONE`.

## 1. Estado do repositório

| Item | Situação real | Relatório dizia |
|---|---|---|
| `main` | `049fdf1` (merge do PR #12); deploy da Vercel `success` (`gh api repos/holaluiz/graao/commits/049fdf1/status`) | merge/deploy pendentes |
| `mvp-online-1v1` | 0 commits à frente de `origin/main`: tudo já está em produção | — |
| PRs abertos | nenhum | — |
| `fix/online-empurrao` (`82f3b5a`, 18/10) | **nunca entrou**. Sobe o protocolo para 10 (hoje é 11) e a fila de comandos de 12 para 60 (`MAX_INPUT_BACKLOG = SIM_HZ`). A `main` resolveu o mesmo sintoma de outro jeito só para a sala na aba (`RELAY_BACKLOG`, fila separada para o repasse travado). Não dá para aplicar como está; portar a fila maior para o servidor dedicado exige medida | não citado |
| Worktree `graao-body-wt` (HEAD solto em `9ae7cde`) | alterações **não commitadas** de escultura do corpo (`anatomy.ts`, `head.ts`, `body.ts`, `bodySculpt.ts`, `body-base.glb`) — trabalho de outra frente, não tocado | não citado |
| `graao-env-fix` | pasta sem git | — |
| Dependências | Colyseus core 0.18.19 / SDK 0.18.5, Rapier 0.21, TypeScript 6.0.3, Vite 8.3.4, Vitest 5.0.5 | — |
| Migrations | `0001`–`0004` (jogadores e partidas, grants, Graao Host, ticket expirado); nenhuma de economia | — |
| Chaves de build | `VITE_GRAAO_HOST` desligada (ADR-006); `VITE_ICE_SERVERS` vazia = só STUN; `?server=` / `VITE_SERVER_URL` para servidor dedicado | — |

## 2. Baseline medido

| Verificação | Antes (relatório, 20/10) | Depois da Fase A |
|---|---|---|
| Typecheck (`pnpm typecheck`) | aprovado | ✅ aprovado |
| Build (`pnpm build`) | aprovado | ✅ aprovado |
| Suíte (`pnpm exec vitest run`) | 669 / 670, uma falha intermitente de reconexão | ✅ **695 / 695** em 72 arquivos (496 s), 13 deles novos desta rodada |
| ESLint dos arquivos alterados | — | ✅ limpo |

## 3. A falha intermitente de reconexão — causa e correção

Teste: `multiplayer › dropped connections › keeps the seat while B reconnects` ([tests/multiplayer.test.ts](../../tests/multiplayer.test.ts)).

**Causa (do teste, não do jogo).** No Colyseus 0.18.19 o `onReconnect` da sala roda **antes** de o servidor mandar
`JOIN_ROOM` ao cliente que voltou (`Room._onJoin`, `@colyseus/core/build/Room.mjs`). O nosso `onReconnect` faz
`broadcastRoomState()`; então o `ROOM_STATE` "B voltou" sai para A antes de B saber que reconectou. O teste só
começava a procurar essa mensagem **depois** do `onReconnect` de B, e numa 1×1 parada nada mais marca
`roomStateDirty` em 8 s (só dano, level-up, troca de arma, fase da Tormenta). Quando A lia o socket primeiro, o teste
esperava 8 s por uma mensagem que já tinha chegado e falhava com `timeout waiting for a new message`.

O jogo está certo: B recebe o mesmo `ROOM_STATE` (o Colyseus enfileira mensagens de quem está em `JOINING` e as
entrega depois do `JOIN_ROOM`), além de `SELF`, `LOOT_STATE`, `ABILITY_STATE`, `WORLD_STATE` e `DRAFT_STATE`.

**Medido** (diagnóstico temporário com o servidor real, removido depois):

| Rodada | Reconexões | "B voltou" chegou a A antes do `onReconnect` de B | Algum `ROOM_STATE` depois | Teste antigo falharia |
|---|---|---|---|---|
| máquina ociosa, janela 1,5 s | 30 | 4 (≈ 1 ms antes) | 0 nesses 4 | 4 |
| máquina ociosa, janela 8,2 s (a do teste) | 14 | 1 | 0 | 1 |

≈ 11 % das reconexões (5 em 44). A reconexão do SDK levou 204–229 ms em todas.

**Prova determinística:** atrasando em 50 ms o `onReconnect` de B (o que a carga da suíte faz), a lógica antiga falha
com exatamente `timeout waiting for a new message` e a nova passa.

**Correção:** o `next()` do bloco aceita um índice inicial; "B voltou" é procurado a partir da mensagem de queda,
incluindo o que já chegou. O mesmo vale para o RESULTS do teste vizinho. Nenhum prazo foi afrouxado.

**Estabilidade depois:** 20 / 20 execuções do bloco com 3 dos 4 núcleos ocupados por carga artificial (cada execução
≈ 4–5 s); o arquivo `tests/multiplayer.test.ts` inteiro passa.

## 4. Rede da sala na aba: estados explícitos e prazos que não estouram

O plano pede estados separados, transições documentadas e nenhuma reconexão indefinida. Antes, o estado do convidado
WebRTC (`PeerLink`) estava implícito em três campos (`left`, `reconnecting`, `pipe`), e uma tentativa de reconexão
podia passar muito da janela: cada uma soma até ~50 s de esperas internas (sinalização 8 s, "here" 4 s, ICE 2,5 s,
resposta 10 s, canal 15 s, assento 10 s) e o prazo só era conferido no começo do laço. Uma sinalização que nunca
respondesse deixava "reconectando…" para sempre.

Agora (contrato em [RoomLink.ts](../../apps/client/src/net/RoomLink.ts)):

```
DISCONNECTED → SIGNALING → CONNECTING → CONNECTED ⇄ RECONNECTING
qualquer estado vivo → FAILED (sem host no código, sem rota entre as redes, janela esgotada, vaga não guardada)
                     → CLOSED (SAIR, quem criou a sala fechou)
```

- `FAILED` e `CLOSED` são finais (nem o estado nem o motivo mudam depois). Movimentos fora da tabela são ignorados,
  então o link e a sessão podem relatar o mesmo evento sem conflito.
- Cada tentativa de reconexão é cortada no fim da janela (`within`), e uma conexão que chega atrasada é fechada.
- A recusa explícita da sala ("failed to reconnect") termina como `REFUSED` ("A sala não guardou sua vaga a tempo."),
  não mais como `LOST` ("A conexão com a sala caiu.").
- F3 ganhou **conexão** (estado, motivo, tempo no estado) e **rota**: `direta`, `STUN` (atrás de NAT) ou `relay`
  (TURN), do par de candidatos ICE selecionado. O console registra cada transição (`[graao] conexão (sala): …`) e a
  rota (`[graao] rota até a sala …`). É o dado que a alfa externa usa para decidir sobre TURN.
- O servidor dedicado (Colyseus) usa a mesma tabela, movida pelo `NetSession` a partir de queda/volta/saída.
- O lado do host já tinha prazos limitados (4 s de silêncio, 20 s para abrir o canal) e não mudou.

Testes novos: `apps/client/src/net/RoomLink.test.ts` (tabela, estados finais, motivo congelado, descrição do F3) e
`apps/client/src/net/host/wire.test.ts` (classificação da rota em relatórios do Chromium e do Firefox, `within`
com relógio falso, remontagem de quadros).

**Verificado no navegador** (duas abas do cliente sem HMR, sinalização Supabase real, WebRTC real, mesmo PC):

| Cenário | Resultado |
|---|---|
| Convidada entra na sala GR-23UQ | `DISCONNECTED → SIGNALING → CONNECTING → CONNECTED`; rota `direta · udp`; anfitriã com `CONNECTED · nesta aba` |
| Queda da convidada (fecha a `RTCPeerConnection`) | `RECONNECTING` em 11 ms, `CONNECTED · voltou na tentativa 1` em **308 ms**; rota medida de novo; anfitriã vê as duas sem `dropped` |
| Sinalização travada para sempre + queda | `FAILED · janela de reconexão esgotada` em **19,0 s** (janela de 20 s − 1 s de margem); tela "A conexão com a sala caiu."; a anfitriã libera a vaga ao fim da janela e fica sozinha na sala |
| Anfitriã fecha a sala | convidada vai direto `CONNECTED → CLOSED`, sem tentar reconectar; "Quem criou a sala saiu: a sala fechou." |

**Não verificado (precisa de máquinas):** duas máquinas na mesma LAN, redes diferentes, 4G, celular, aba do host
minimizada por minutos (o Chrome estrangula timers da página principal em segundo plano; o `Worker` da sala não é
estrangulado do mesmo jeito, mas os canais WebRTC vivem na página). Roteiro em
[HOST_VALIDATION.md](../networking/HOST_VALIDATION.md).

## 5. Matriz: sistemas do relatório × estado real

| Sistema | Estado | Evidência |
|---|---|---|
| Monorepo pnpm, TS strict, Vite, Vitest | DONE | typecheck, build e suíte desta rodada |
| Planeta R 100 m, gravidade radial, controlador | DONE | `world.test`, volta completa; idêntico cliente/servidor |
| Multiplayer autoritativo (predição, reconciliação, interpolação) | PARTIAL (TESTING) | integração com clientes reais; **nunca entre redes diferentes** |
| Sala hospedada na aba (ADR-006) | PARTIAL (TESTING) | §4 no navegador, um PC; redes externas BLOCKED |
| Reconexão | DONE no código e testes; BLOCKED fora de um PC | §3 e §4 |
| Graao Host | PARTIAL (desligado no site) | instalador 0.1.0 anterior ao protocolo 11 e à checagem de mapa: não entra em salas deste build; publicar novo exige aprovação |
| 10 participantes, bots | PARTIAL (TESTING) | `prematch.multiplayer` (1+9, 2+8) |
| Personagens personalizáveis | PARTIAL (TESTING) | criador e réplica em sala; perfil na nuvem não revalidado ao vivo |
| Ability Draft (regras, 30 + 10, bots, timeout) | DONE (regras) | `draft.test` + integração |
| Ability Draft visual (grade única estilo Dota) | PARTIAL | tela atual com categorias e páginas; Gate C NOT_STARTED |
| 40 magias no motor autoritativo | DONE (motor) / PARTIAL (apresentação) | teste "all forty catalog abilities…"; qualificação manual de VFX/áudio pendente |
| Armas | PARTIAL | 7 armas, **todas `hitscan`** com o mesmo contrato (`kind: 'projectile'` existe e ninguém usa); "Lança-Foguetes" sem área |
| Baús, desarmado, socos | DONE | `loot.multiplayer`, `unarmed.multiplayer`, `melee.test` |
| Creeps, XP, atributos | DONE | `creeps.test`, `progression.test`, soak em `docs/gameplay/perf` |
| Tormenta | PARTIAL (TESTING) | unitários + integração; vista no navegador |
| Espectador | PARTIAL (TESTING) | testes de seleção/diretor |
| Editor de mapas | PARTIAL | dev-only; família VERTICAL, aba Ventos, travessias de bots; **sem** prefab central com variantes/overrides, heatmaps, modo Jogar |
| Serra do Mirante, Arquipélago dos Sinos, escalada, beirada, pipa, correntes | PARTIAL (TESTING) | Gate V: [relatório vertical](VERTICAL_TRAVERSAL_TEST_REPORT.md); falta celular físico e partida entre redes |
| Navegação vertical de bots | PARTIAL (TESTING) | `traversalLinks`, testes de bots |
| Controles mobile | PARTIAL | `TouchControls.ts` + testes; emulação no navegador; **celular físico nunca testado** |
| Áudio | PARTIAL | 9 categorias, limites de vozes; **sem `PannerNode`**, sem orientação pela gravidade local, sem oclusão |
| F3 | DONE | + conexão e rota nesta rodada |
| Versão de protocolo e mapa | DONE | `VERSION_MISMATCH`, `MAP_MISMATCH` |
| Resultados e retorno ao lobby | PARTIAL (TESTING) | `MATCH_SUMMARY` do servidor; sem "Jogar novamente" nem Boletim |
| Weapon Framework 2.0, acessórios, Oficina 3D | NOT_STARTED | — |
| Arsenal Particular, Suprimentos | NOT_STARTED | — |
| Prestígio, maestria, ledger, partidas oficiais | NOT_STARTED | sem migration de economia |
| Voz por proximidade | NOT_STARTED | — |
| Telemetria de gameplay, heatmaps | NOT_STARTED | nenhum código |
| Perfis gráficos MOBILE_LOW…DESKTOP | NOT_STARTED | — |
| Rebranding | NOT_STARTED (por decisão) | só com nome aprovado |

Nada aparece como `BROKEN`: a única falha conhecida era do teste (§3).

## 6. Bloqueios

| Bloqueio | Depende de | Procedimento |
|---|---|---|
| Gate B (alfa externa) | PC em outra rede, rede restrita (4G/empresa), pessoa em cada máquina | [HOST_VALIDATION.md](../networking/HOST_VALIDATION.md) |
| Decisão sobre TURN | dados do cenário 7 da alfa (rota `relay` necessária?) | TURN é serviço externo: pedir aprovação com custo estimado antes |
| Celular físico (Android Chrome, iPhone Safari) | aparelhos | emulação não conta |
| Instalador novo do Graao Host | aprovação de publicação | só se o Graao Host voltar |

## 7. Como reproduzir

```bash
pnpm typecheck
pnpm build
pnpm exec vitest run
pnpm exec vitest run tests/multiplayer.test.ts -t "dropped connections"
pnpm exec vitest run apps/client/src/net
```
