# graao — Master Game Design 2.0

Documento-contrato do produto. Reúne o que o Master Plan 2.0 pedia em `PRODUCT_PILLARS`, `GAMEPLAY_LOOP` e
`COMPETITIVE_INTEGRITY` (um arquivo só, para não duplicar). Contratos técnicos de cada frente nascem quando o marco
dela começa (lista em [BACKLOG.md](BACKLOG.md)); o estado real fica em [MVP_STATUS.md](../MVP_STATUS.md).

"graao" é nome provisório. Nada de rebranding técnico (repositório, domínio, namespaces, instalador) antes da
aprovação explícita de um nome comercial.

## Definição

Um Battle Royale 3D de partidas rápidas, num pequeno planeta brasileiro, com a profundidade estratégica de um MOBA e a
progressão tática de um RPG. Até dez participantes (pessoas + bots), navegador primeiro, hospedagem comunitária na aba
de quem cria a sala (ADR-006).

## Pilares

| Pilar | Regra de design | Como saber que cumprimos |
|---|---|---|
| Entrada imediata | Achar sala, entrar, personalizar e jogar sem entender servidores. Convidado nunca instala nada | Link de sala abre direto no lobby; zero passos técnicos para o convidado |
| Profundidade estratégica | Magias (antes) × armas (durante) × atributos (durante) × posição × cobertura | Builds diferentes vencem partidas (métrica de vitória por build, M8+) |
| Mundo memorável | Minas Gerais como gameplay: ladeiras, viadutos, telhados, praças e relevo criam rotas e emboscadas | Heatmaps (M9) mostram uso de todas as regiões, não só a Vila |
| Progressão justa | Veterano não começa partida com mais Vida, dano, Defesa, Mana ou velocidade | Nenhum valor persistente entra na simulação, só IDs cosméticos e builds validadas |
| Momentos emergentes | Sistemas que se cruzam (entrega disputável, Supremo que desloca, Tormenta) | Boletim do Planeta encontra eventos marcantes reais em boa parte das partidas |
| Social instantâneo | Compartilhar sala por link, jogar de novo com os mesmos amigos | Taxa de revanche (M8) |

## Loop de jogo

```
Menu → Salas (lista ao vivo / link) → Lobby (prontos, bots) → Ability Draft (3 básicas + 1 Supremo)
  → Preparação → OVNI → Queda → [desarmado] baús, creeps, XP, atributos, Suprimentos
  → Arsenal Particular (entrega disputável) → Tormenta fecha → confronto final
  → Boletim do Planeta → Jogar novamente / Lobby
```

Tudo até "Tormenta fecha" e o retorno ao lobby já existe (ver auditoria). Suprimentos, Arsenal Particular, Boletim e
"Jogar novamente" são marcos M7–M8.

Papéis dos sistemas (objetivos iniciais, a validar com métricas — `BALANCE_TARGETS` no M5):

- **Armas:** principal fonte de dano. Cada família com mecânica própria, não só números (M5).
- **Magias:** principal fonte de mudança tática (controle, mobilidade, cobertura, revelação).
- **Farm (creeps):** útil, nunca obrigatório para vencer.
- **Atributos:** vantagem progressiva moderada dentro da partida, zerada na próxima.
- **Arsenal Particular:** conquista intermediária, contestável e visível.
- **Tormenta:** força encontros. Partida-alvo de 8 a 12 minutos (a validar).

## Três progressões separadas

| Recurso | Vida útil | Ganho | Uso | Nunca |
|---|---|---|---|---|
| **XP da partida** | uma partida | creeps e combate (regras atuais em `game-data/progression.ts`) | níveis 1–10 → pontos de atributo | atravessar partidas |
| **Suprimentos** | uma partida | creeps, baús, objetivos, eliminações, eventos (M7) | pedir o Arsenal Particular | ser comprados com moeda persistente; virar XP escondida |
| **Prestígio / Créditos da Oficina** | persistente | participação, desempenho, vitórias **verificadas** (M8) | cosméticos, títulos, emblemas, organização da Oficina | dano, Vida, Defesa, Mana, velocidade ou acessório funcionalmente superior em partida competitiva |

O Arsenal Particular é um **recurso universal da partida**, não um dos dez Supremos: se só um Supremo desse acesso às
armas personalizadas, ele viraria escolha obrigatória.

## Integridade competitiva

A sala comunitária roda no navegador de outro jogador (ou, com o Graao Host religado, no PC dele): quem hospeda
controla o processo e pode, em princípio, alterar regras ou resultados. Portanto:

1. **Salas comunitárias** (Graao Host, salas no navegador): casuais, bots permitidos, regras configuráveis, ranking
   desligado, **nenhuma emissão de Créditos valiosos**. Podem guardar estatísticas marcadas como não verificadas.
2. **Partidas oficiais** (infraestrutura confiável do projeto): regras fixas, resultado verificável pelo servidor,
   ranking e recompensas oficiais. Enquanto não existir infraestrutura oficial, o ranking fica preparado e desligado.
3. Recompensa persistente passa por um **ledger transacional idempotente** (ID de evento único, origem, nível de
   confiança da origem, versão da política, referência de partida) no Postgres, com RLS; sem saldo negativo, sem
   gasto duplo, sem cálculo financeiro no cliente (contrato em `ECONOMY_LEDGER.md`, M8).
4. Antifarm proporcional: limites para bots próprios, partidas combinadas, salas abertas e fechadas em sequência,
   resultados forjados e eventos reenviados.

Achado da auditoria que esta política cobre: o servidor aceita do criador da sala opções que mudam o jogo
(`ultimateChargeMs`, `countdownMs`, `closeSpawns`, tempos de Draft/OVNI, `creepCount`…) e grava a partida no Supabase
sem registrar isso. Antes de qualquer ranking, partidas oficiais devem recusar essas opções e o registro deve dizer
se as regras eram as padrão.

## Roadmap

| Marco | Entregas | Gate | Estado (19/10/2026) |
|---|---|---|---|
| M0 Diagnóstico | Auditoria, matriz, baseline, riscos | Estado real conhecido | DONE — [auditoria](../qa/AUDIT_M0_2026-10-19.md) |
| M1 Estabilidade | Falhas classificadas e corrigidas, hardening de rede, F3, regressão | Gate A | DONE (Gate A cumprido; 2 itens menores no backlog) |
| M2 Alfa externa | Sala hospedada na aba entre redes reais, três hosts, relatório | Gate B | BLOCKED — máquinas/rede ([HOST_VALIDATION](../networking/HOST_VALIDATION.md)) |
| M3 Draft visual | Grade única com 40 magias, 10 participantes, tooltips do catálogo real, mobile | Gate C | PARTIAL (tela atual com abas) |
| M4 Game feel + áudio | Feedback de armas/magias, AudioDirector, espacial com gravidade local, oclusão barata | Gate E | PARTIAL |
| M5 Weapon Framework | Revólver, Arco, Lança-teia sobre contratos data-driven | 3 armas realmente diferentes | NOT_STARTED |
| M6 Oficina | Acessórios com trade-offs, builds salvas e validadas no backend | Criar, salvar, carregar, usar | NOT_STARTED |
| M7 Arsenal Particular | Suprimentos, pedido, cápsula autoritativa, entrega contestável | Gate D | NOT_STARTED |
| M8 Progressão permanente | Prestígio, maestria, ledger, política de confiança, Boletim, revanche | Recompensas sem vantagem | NOT_STARTED |
| M9 Mundo e ferramentas | Prefab central, variantes, overrides, heatmaps, modo Jogar | Mapa mais jogável | PARTIAL (editor dev) |
| M10 Voz | Prova de conceito P2P × SFU, permissões, mute, bloqueio | Voz segura e opcional | NOT_STARTED |
| M11 Pré-lançamento | Nome aprovado, QA completo, privacidade, rollback | Critérios de release | NOT_STARTED |

Ordem obrigatória: M1 → M2 antes de ampliar sistemas; M5 antes de M6/M7 (a Oficina monta armas do framework novo).
M3 e M4 podem andar em paralelo a M2 porque não tocam os mesmos contratos.

## Decisões (ADRs curtos)

- **ADR-001 (19/10/2026) — Mapa faz parte da compatibilidade.** O join envia `MAP_HASH`; servidor e cliente recusam
  mapas diferentes (`MAP_MISMATCH`). Motivo: o Graao Host empacota o mapa; uma edição publicada só no site faria
  predição e servidor colidirem contra geometrias diferentes com o mesmo protocolo. O digest arredonda números para
  uma grade binária (`mapDigest`): motores JS diferentes discordam no último bit de dados calculados.
- **ADR-002 (19/10/2026) — Testes de tempo real não dependem do layout.** Posições de testes de integração vêm de
  busca no mundo estático ou de opções dev (`matchSpawns`, `freeRoamSpawns`), nunca de "o spawn 0 fica numa praça
  aberta". Limites de suavidade não são afrouxados.
- **ADR-003 (19/10/2026) — Arsenal Particular é universal**, não um Supremo (ver acima).
- **ADR-004 (19/10/2026) — Resultado de host comunitário não alimenta ranking nem moeda valiosa** (ver
  Integridade competitiva).
- **ADR-005 (19/10/2026) — Lentidões: vence a mais forte, expirações independentes, piso ×0,3.** É o comportamento
  atual (`statusEffects.ts`) e coincide com a recomendação do plano; mudar exige teste e decisão registrada.
- **ADR-006 (19/10/2026) — O site só oferece hospedagem na aba do navegador.** Criar sala roda o `GraaoMatchRoom` num
  Web Worker de quem cria; convidados conectam por WebRTC ([BROWSER_HOSTED_ROOMS.md](../architecture/BROWSER_HOSTED_ROOMS.md)).
  O Graao Host (app, central, túnel) continua no código e nos testes, desligado no site: `VITE_GRAAO_HOST=on` no
  build traz de volta "Criar e hospedar" e as salas dele na lista. Motivo: um caminho só, ninguém instala nada.
  Custos aceitos: sem TURN, redes com NAT restrito (4G, empresa, escola) não conectam direto; o host sair fecha a
  sala; a física da sala divide o navegador com o jogo do host. Se o M2 mostrar falhas de conexão: primeiro TURN
  (serviço externo, aprovação), depois religar o Graao Host ([HOST_VALIDATION](../networking/HOST_VALIDATION.md)).
