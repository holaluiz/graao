# Backlog técnico — Master Plan 2.0

Ordenado por marco. Cada item diz onde mexe e como saber que terminou. Contratos compartilhados (`game-core`,
`shared`, protocolo, schemas, migrations, balanceamento) têm um responsável por vez; dois trabalhos paralelos nunca
reescrevem o mesmo contrato.

## M1 — Estabilidade (esta entrega)

- [x] Classificar e corrigir as falhas da suíte (auditoria §2): testes de movimento independentes do mapa.
- [x] `MAP_HASH` conferido no join (`MAP_MISMATCH`) e no `WELCOME`.
- [x] F3: creeps, colisores, bots, quedas de conexão, heap JS.
- [ ] Mostrar "mapa incompatível" já na lista de salas (hoje o protocolo aparece na lista e o mapa só no join, com
      mensagem clara). `shared/validate.ts parseRoomListing` + `map` na metadata da sala; para salas do Graao Host
      exige coluna na central (migration nova) e nova versão do app — fazer junto com a próxima release do host.
      Feito quando uma sala de outro mapa aparece indisponível na lista nas três origens (dedicado, navegador, host).
- [ ] Merge de `origin/main` (PR #7, `.env.production`) nesta branch antes do próximo PR.

## M2 — Alfa externa

Ver [HOST_VALIDATION.md](../networking/HOST_VALIDATION.md). Bloqueado por máquinas e redes, não por código.

- [ ] Partida completa entre dois PCs em redes domésticas diferentes (host + convidado), com medidas de RTT/jitter.
- [ ] Host + vários convidados; três hosts simultâneos em máquinas reais.
- [ ] Queda inesperada do host, reconexão do convidado, atualização do app, versão incompatível (agora também mapa).
- [ ] `docs/qa/EXTERNAL_ALPHA_REPORT.md` com resultados reais.

## M3 — Ability Draft visual

- [ ] Grade única com as 30 básicas + grade dos 10 Supremos, sem abas obrigatórias (`apps/client/src/ui/DraftScreen.ts`
      substitui `draftCatalogPage`). Participantes 5 em cima / 5 embaixo com 4 slots e estado.
- [ ] Tooltip gerado do catálogo real (`game-data/abilities.ts`: mana, recarga, alcance, duração, efeitos, tags).
      Proibido texto que não corresponda a um efeito implementado (teste que compara tooltip × `effects`).
- [ ] Sugestões de sinergia por tags, sem bônus escondido.
- [ ] Layout mobile: grade rolável, painel de build fixo, toque para detalhe, botão confirmar.
- Contrato: `docs/gameplay/ABILITY_DRAFT_UX.md` (atualizar `docs/UX/ABILITY_DRAFT.md`, não duplicar).

## M4 — Game feel e áudio

- [ ] `AudioDirector` sobre o `GRAAudioManager` existente (não reescrever): `PannerNode` com o ouvinte orientado pela
      câmera **e pela gravidade local**, distância sobre a esfera, oclusão por raio em frequência limitada + low-pass.
- [ ] Buses do plano mapeados nas 9 categorias atuais; sliders por bus relevante.
- [ ] Catálogo de eventos sonoros (`docs/audio/AUDIO_EVENT_CATALOG.md`): acerto no corpo × escudo × quebra × crítico,
      sem munição, level up, ponto de atributo, magia pronta, Supremo, Tormenta, vitória/derrota.
- [ ] Catálogo de respostas de câmera (já existe intensidade de tremor configurável).

## M5 — Weapon Framework 2.0

- [ ] Separar `WeaponDefinition` (dados) / `WeaponRuntimeState` / `WeaponPresentation` em `game-data/weapons.ts`
      reaproveitando o contrato atual; adicionar `family` e `fireModel` (hitscan, projétil balístico, carregado,
      aquecimento).
- [ ] Projétil autoritativo genérico no servidor (o sistema de habilidades já tem projéteis: reaproveitar).
- [ ] Vertical slice: **Revólver** (6 tiros, recarga marcante), **Arco** (carga → precisão e velocidade, queda),
      **Lança-teia** (efeito de mobilidade/controle, dano baixo). Só depois as outras cinco famílias.
- [ ] Corrigir o "Lança-Foguetes" atual (hitscan sem área) quando o projétil existir.
- Contratos: `docs/gameplay/WEAPON_FRAMEWORK.md`, `docs/gameplay/BALANCE_TARGETS.md`.

## M6 — Oficina

- [ ] `AttachmentDefinition` com trade-offs (todo ganho tem custo), slots por família, limite de 3 funcionais.
- [ ] Tabela `weapon_builds` (IDs apenas, `schema_version`) com RLS de dono; validação no backend; o servidor de
      partida resolve IDs em definições autoritativas.
- [ ] Tela OFICINA com prévia 3D (reaproveitar `CreatorThumbnails`/prévia do criador).
- Contrato: `docs/gameplay/WEAPON_ATTACHMENTS.md`.

## M7 — Arsenal Particular e Suprimentos

- [ ] `SupplyEconomy` em `game-core` (fontes: creeps, baús, eliminações, eventos; separado da XP).
- [ ] `LoadoutRequestValidator` + `DeliverySpawnDirector` + cápsula como entidade autoritativa; uma vez por partida,
      não no início, nunca após eliminação, idempotente por ID de pedido.
- [ ] Apresentação: sinalizador, som, descida, indicador para todos, interação para coletar.
- Contratos: `docs/gameplay/SUPPLY_ECONOMY.md`, `docs/gameplay/LOADOUT_DELIVERY.md`.

## M8 — Progressão permanente

- [ ] Migration do ledger (`currency_events` com unicidade por evento, saldos por função transacional, RLS).
- [ ] Prestígio, nível de conta, maestria por família; recompensas só cosméticas.
- [ ] Partidas oficiais recusam opções de sala não padrão e registram `rules: default` (achado da auditoria).
- [ ] Boletim do Planeta a partir de um Event Ledger da partida (`PLAYER_ELIMINATED`, `CHEST_OPENED`, `LEVEL_UP`…),
      mensagens só de fatos reais; "Jogar novamente".
- Contratos: `docs/progression/PRESTIGE.md`, `WEAPON_MASTERY.md`, `ECONOMY_LEDGER.md`.

## M9 — Mundo e ferramentas

- [ ] Prefab central com variantes e overrides por instância no editor existente (`MapEditor.ts`), sem segundo editor.
- [ ] Telemetria espacial agregada de desenvolvimento + heatmaps no editor.
- [ ] Modo Jogar a partir do editor.

## M10 — Voz por proximidade

- [ ] Prova de conceito 2 → 4 → 10 participantes comparando P2P limitado e SFU; medir conexões, upload, falhas de ICE.
- [ ] Microfone desligado por padrão, push-to-talk, mute/bloqueio/reporte, indicador de microfone.
- Contrato: `docs/audio/PROXIMITY_VOICE.md`. Ativação pública exige aprovação.

## M11 — Pré-lançamento

- [ ] `docs/product/REBRANDING_BRIEF.md` com propostas e critérios; rebranding técnico só após aprovação.
- [ ] Perfis gráficos MOBILE_LOW/MEDIUM/HIGH/DESKTOP, resolução dinâmica, adaptadores de input unificados.
- [ ] Política de privacidade, telemetria (`docs/analytics/GAMEPLAY_EVENTS.md`), rollback documentado.
