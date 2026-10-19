# Ability v2 — validação de 19/10/2026

Base desta rodada: `1b23c26`, sobre a implementação das 40 magias em `cc7962a`. Baseline anterior à migração: tag `baseline-abilities-v2-20261018` (`9ae7cde`). A suíte completa da base já estava registrada como 543/543; esta rodada executou novamente os testes afetados, sem somar execuções repetidas como testes novos.

## Resultado funcional

O catálogo executável contém 30 básicas e 10 Supremos. Cada build tem três básicas e um Supremo, no máximo uma passiva e nenhuma repetição individual; jogadores diferentes podem escolher a mesma magia. Passivas são automáticas e não recebem tecla de conjuração, custo ou cooldown. Bots usam seus próprios slots pela admissão autoritativa da sala.

Os testes cobrem movimento e colisões radiais, controle, escudo temporário, limpeza de estados, coberturas destrutíveis, reconhecimento privado, portais do dono, modificadores de armas/coleta e descarte no fim da partida. A qualificação manual de apresentação, áudio e equilíbrio de cada uma das 40 magias continua **TESTING** no catálogo; estes resultados não substituem partidas humanas em outras máquinas.

## Falhas reproduzidas e corrigidas nesta rodada

- **Meteoro:** eliminar um ator cancelava áreas anteriores durante a iteração, deixando o mesmo impacto pendente para o próximo tick. O caso reproduzido causava 70 em vez de 35 de dano. A iteração agora tolera cancelamento e encerramento síncronos, removendo a área por identidade. Dois testes de regressão cobrem eliminação e `clear` durante o impacto.
- **Nuvem de Giz:** a esfera autoritativa e o volume desenhado diferiam em centro/altura. Um único `abilityCloudVolume` agora define servidor, malha e véu da câmera. Testes cobrem limites laterais/superiores e quatro orientações radiais.
- **Eco dos Passos:** um histórico vazio produzia uma amostra mesmo com o alvo parado, inclusive depois de expirar. Âncoras de movimento separadas do histórico impedem rastros sem deslocamento; morte, saída e reset limpam ambas as estruturas.
- **Draft em tela baixa:** todos os botões estavam dentro de 844×390, mas textos e cartões se sobrepunham. A paginação passa a duas cartas abaixo de 450 px de altura, com detalhes e confirmação compactos. A captura final foi inspecionada visualmente, além da medição de limites.

## Verificações executadas

**158/158 testes em 16 arquivos**, em 23,08 s. Resultado bruto: [ability-v2-focused-2026-10-19.json](ability-v2-focused-2026-10-19.json).

```sh
pnpm exec vitest run packages/game-core/src/abilitySystem.v2.test.ts packages/game-core/src/abilityVolumes.test.ts packages/game-core/src/abilityPhysics.test.ts packages/game-core/src/abilities.test.ts packages/game-core/src/abilitiesV2.test.ts packages/game-core/src/statusEffects.test.ts packages/game-core/src/passives.test.ts packages/game-core/src/lootPassives.test.ts packages/game-core/src/draft.test.ts packages/game-data/src/abilities.test.ts apps/client/src/render/vfx/AbilityWorldPresentation.test.ts apps/client/src/render/vfx/AbilityVisualCatalog.test.ts apps/client/src/ui/DraftScreen.test.ts apps/client/src/game/AbilityController.test.ts apps/client/src/net/AbilityStateCache.test.ts tests/abilities-v2.multiplayer.test.ts
pnpm typecheck
pnpm build
```

Typecheck completo (raiz, cliente e Host), build de cliente/servidor, ESLint dos arquivos TypeScript alterados e `git diff --check` passaram. O build conserva o aviso de chunks grandes do cliente; este trabalho não altera a estratégia de empacotamento.

O teste multiplayer usa dois clientes SDK independentes conectados a um servidor Colyseus real. Verifica dash bloqueado por colisão, tiros contra cobertura destrutível, portal exclusivo do dono, lentidão sem duplicação, proteção temporária, Meteoro de 35 e recursos revelados só ao dono. Também completa Draft e MATCH com **1 cliente + 9 bots** e **2 clientes + 8 bots**, conferindo builds válidos e casts dos bots.

Os dois testes novos do Catador usam a transação real de loot com linha de visão livre controlada: alcance aumentado, bônus de munição, teto de reserva, preservação do restante e impossibilidade de coletar a mesma unidade duas vezes. Não representam um teste novo de oclusão física.

## Navegador

Fluxo real de treino local: menu → nove bots → lobby 10/10 → quatro rodadas → revelação → preparação → OVNI → queda → MATCH → espectador → retorno ao lobby. Build sem HMR usado para a verificação visual final; a reconstrução de produção posterior incorporou as correções finais do engine, já cobertas pelos testes acima.

| Viewport | Evidência |
|---|---|
| 1366×768 | [Draft desktop](../UX/screenshots/abilities-v2-draft-desktop.png), [lobby 1+9](../UX/screenshots/abilities-v2-lobby-ten.png) |
| 390×844 | [catálogo](../UX/screenshots/abilities-v2-draft-mobile.png), [detalhes de passiva](../UX/screenshots/abilities-v2-passive-mobile.png) |
| 844×390 | [Supremo selecionado, detalhes, confirmação e dez participantes](../UX/screenshots/abilities-v2-draft-short.png) |

Nos três tamanhos o documento coube no viewport sem scroll. A imagem final de 844×390 substitui a captura inicial com sobreposição. No MATCH, o HUD mostrou Pé de Algodão como **PASSIVA**, os demais slots com teclas/custos e o Supremo em recarga. Não se reivindica uma conjuração manual de cada magia nesta passagem.

[Captura F3 de MATCH com nove bots](../UX/screenshots/abilities-v2-match-metrics.png): HIGH, 1366×768, dez entidades, 16 creeps, 58 FPS, quadro médio 17,22 ms / pior 71,7 ms, CPU de quadro 7,20 ms, 206 draw calls, 1.996.771 triângulos, 353 VFX ativos, uma entidade persistente de habilidade, dez marcas e heap JS 140 MB. É **uma leitura pontual**, com o navegador controlado em segundo plano e apenas 20 redesenhos de mundo/s naquele instante; não é benchmark sustentado de 60 FPS, nem stress de dez Supremos renderizados. Os contadores de rede zerados desse treino hospedado no navegador não medem tráfego WebSocket.

## Servidor, rede e limites

A [coleta reproduzível](../gameplay/perf/ability-v2-server-network-report-2026-10-19.md) mede 12,019 s de MATCH com dois SDK + oito bots: 18 casts aceitos de bots, cinco de humanos, seis reveals somente aos donos, snapshot médio de 773,69 bytes JSON e custo médio de atualização das habilidades de 0,1727 ms. Um microbenchmark separado aceita os dez Supremos simultaneamente e termina com entidades, pendências, projéteis e colisores de habilidade zerados após `clear`.

Bytes são payloads JSON decodificados, não tráfego no fio. O microbenchmark não contém renderer, motor de personagem ou mapa completo. Nenhum resultado desta rodada comprova dez humanos, redes diferentes, GPU mínima, audição humana dos efeitos ou estabilidade prolongada. Os testes foram locais e preservaram o servidor/aba de desenvolvimento do usuário; a sala e a aba temporárias de QA foram encerradas.
