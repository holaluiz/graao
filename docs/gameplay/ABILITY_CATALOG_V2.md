# Catálogo oficial — 40 magias

Fonte executável: `packages/game-data/src/abilities.ts`. São exatamente 30 básicas (6 mobilidade, 7 controle, 5 defesa, 4 exploração, 8 passivas) e 10 Supremos. Os IDs antigos permanecem estáveis. `petal_cyclone` e `dawn_lance` recebem os novos comportamentos de Festa de Pólen e Arrastão de Vento.

Valores em segundos e metros. Mana/CD representa custo e cooldown. “—” indica que o parâmetro não se aplica. Os dados e regras foram testados automaticamente; o estado **TESTING** conserva a necessidade de validar apresentação e confrontos multiplayer antes de marcar cada magia DONE. A coluna de testes registra o catálogo; os testes específicos por família estão descritos abaixo.

| ID · Nome | Categoria / tipo | Mana / CD | Duração | Alcance / raio | Efeito principal | Contrajogo | Estado / testes |
|---|---|---|---|---|---|---|---|
| `wind_step` · Passo de Vento | Mobilidade / ativa | 15 / 7 | 0,2 | 6 / — | Dash tangencial de 6m | Paredes bloqueiam; sem invulnerabilidade | TESTING / catálogo + slice |
| `kite_jump` · Pulo de Pipa | Mobilidade / ativa | 15 / 10 | Impulso | — / — | Um salto adicional no ar | Limite por voo e cooldown | TESTING / catálogo |
| `clothesline` · Linha de Varal | Mobilidade / ativa | 25 / 14 | Até 1,2 | 14 / — | Gancho até superfície válida, velocidade 16m/s | Exige âncora; colisão bloqueia | TESTING / catálogo |
| `slide` · Escorrega | Mobilidade / ativa | 15 / 9 | 0,35 | 5 / — | Deslize baixo de 5m | Terreno e obstáculos | TESTING / catálogo |
| `paper_wings` · Asa de Papel | Mobilidade / ativa | 20 / 15 | 4 | — / — | Planagem, gravidade ×0,2 e controle ×1,4 | Só no ar; pouso encerra | TESTING / catálogo |
| `ricochet` · Ricochete | Mobilidade / ativa | 15 / 12 | 0,3 | Parede até 2 / — | Impulso pela normal da superfície | Precisa de parede; sem atravessá-la | TESTING / catálogo |
| `pollen_burst` · Explosão de Pólen | Controle / ativa | 30 / 12 | Slow 3 | 22 / 5 | Lentidão de 30%, sem dano | Aviso de 0,65s; sair da área | TESTING / catálogo + execução |
| `sap_snare` · Seiva Pegajosa | Controle / ativa | 20 / 12 | Poça 5 | 18 / 4 | Lentidão de 35% enquanto atravessa | Evitar/sair da poça; limpeza | TESTING / catálogo + slice |
| `thorn_seed` · Semente de Espinhos | Controle / ativa | 25 / 16 | Armadilha 20; root 0,8 | 8 / 1,8 | Armadilha visível de uso único | Identificar e contornar | TESTING / catálogo + execução |
| `gust_ring` · Anel de Vento | Controle / ativa | 25 / 14 | Impulso | Próprio / 5 | Empurrão tangencial 10m/s | Distância e paredes | TESTING / catálogo + execução |
| `chalk_cloud` · Nuvem de Giz | Controle / ativa | 30 / 18 | 5 | 18 / 5 | Obstrução de visão autoritativa | Reposicionar; duração limitada | TESTING / catálogo |
| `vine_lasso` · Laço de Cipó | Controle / ativa | 25 / 14 | 2,5 | 18 / — | Projétil impede sprint | Desviar; mira/tiros não são bloqueados | TESTING / catálogo |
| `hollow_bell` · Sino Oco | Controle / ativa | 30 / 20 | 0,8 | Próprio / 5 | Interrompe conjuração e silencia | Manter distância; armas continuam | TESTING / catálogo |
| `leaf_shell` · Casulo de Folhas | Defesa / ativa | 30 / 18 | 7 | Próprio / — | 40 de escudo temporário separado | Esgotar proteção/esperar; Tormenta ignora | TESTING / catálogo + slice |
| `bloom` · Florescer | Defesa / ativa | 35 / 20 | 2 | Próprio / 2,5 | Flor cura até 35 de Vida em 5 pulsos | Pressão antes da cura; sair reduz benefício | TESTING / catálogo + execução |
| `paper_wall` · Muro de Papel | Defesa / ativa | 30 / 20 | 9 | 6 / — | Parede 3,2×2,2m, 90 de resistência | Destruir/flanquear | TESTING / catálogo |
| `magic_umbrella` · Guarda-Chuva Mágico | Defesa / ativa | 20 / 18 | 3 | Próprio / setor 120° | Bloqueio frontal e arma bloqueada | Atacar de trás/aguardar | TESTING / catálogo |
| `rain_bath` · Banho de Chuva | Defesa / ativa | 25 / 18 | Resistência 2 | Próprio / — | Limpa slow, silence e noSprint; resistência 65% | Não cura dano nem concede invulnerabilidade | TESTING / catálogo + regras |
| `sun_orb` · Orbe Solar | Exploração / ativa | 20 / 10 | Revelação 4 | 20 / — | Projétil revela primeiro alvo ao conjurador | Desviar/usar cobertura; dano zero | TESTING / catálogo + execução |
| `firefly_scout` · Vaga-Lume Explorador | Exploração / ativa | 15 / 15 | 5 | Próprio / 12 | Revela baús fechados e pickups reais | Não revela oponentes nem cria loot | TESTING / catálogo + slice |
| `footstep_echo` · Eco dos Passos | Exploração / ativa | 20 / 15 | Visual 5; histórico 8 | Próprio / 18 | Rastros reais autorizados | Sair da região; histórico limitado | TESTING / catálogo |
| `backyard_eye` · Olho de Quintal | Exploração / ativa | 30 / 24 | Visual 5; atividade 8 | Próprio / 30 | Direção aproximada de atividade recente | Permanecer sem atirar/conjurar | TESTING / catálogo |
| `wind_foot` · Pé de Vento | Passiva | 0 / — | Condicional | Próprio / — | Corrida +7% após 4s fora de combate | Disparo/dano interrompe | TESTING / catálogo + passivas |
| `steady_hand` · Mão Firme | Passiva | 0 / — | Enquanto vivo | Próprio / — | Recuo e dispersão −12% | Não aumenta dano/cadência | TESTING / catálogo + slice |
| `quick_swap` · Troca-Troca | Passiva | 0 / — | Enquanto vivo | Próprio / — | Tempo de equipar −25% | Tempo mínimo permanece | TESTING / catálogo + passivas |
| `backyard_scavenger` · Catador de Quinta | Passiva | 0 / — | Enquanto vivo | Coleta ×1,35 / — | Aproveitamento de munição +10% | Distância, capacidade e transação validadas | TESTING / catálogo + passivas |
| `soft_step` · Pé de Algodão | Passiva | 0 / — | Enquanto vivo | Próprio / — | Passos 40% mais discretos | Tiros e magias continuam audíveis | TESTING / catálogo + passivas |
| `new_bark` · Casca Nova | Passiva | 0 / — | Após 8s sem combate | Próprio / — | Escudo +3/s até teto de 50% | Dano/disparo reinicia espera | TESTING / catálogo + passivas |
| `kite_breath` · Fôlego de Pipa | Passiva | 0 / — | No ar | Próprio / — | Controle aéreo +20%; queda compatível −20% | Não remove gravidade nem permite voo | TESTING / catálogo + passivas |
| `anti_glue` · Anti-Cola | Passiva | 0 / — | Enquanto vivo | Próprio / — | Slow/silence duram 25% menos | Duração mínima, sem imunidade | TESTING / catálogo + status |
| `sun_meteor` · Meteoro Solar | Supremo | 50 / 90 | Aviso 1 após cast 0,45 | 30 / 6 | Dano 35 e empurrão 7m/s | Aviso claro e cobertura | TESTING / catálogo + slice |
| `dawn_lance` · Arrastão de Vento | Supremo | 50 / 85 | Onda 1,5 | 20 / largura 5 | Empurrão até 15m/s, curva radial | Desviar da faixa/usar paredes | TESTING / catálogo |
| `winter_garden` · Jardim de Inverno | Supremo | 55 / 100 | 12 | 12 / 6 | Cura própria 4/s e duas coberturas de 60 HP | Sair do jardim/derrubar coberturas | TESTING / catálogo |
| `kite_flight` · Voo de Papagaio | Supremo | 45 / 90 | 7 | Próprio / — | Elevação e planagem controladas | Sem atacar; altura e duração limitadas | TESTING / catálogo |
| `paper_city` · Cidade de Papel | Supremo | 55 / 100 | 10 | 8 / — | Três coberturas de 80 HP, 2,5×2m | Destruir/flanquear | TESTING / catálogo |
| `firefly_beacon` · Farol dos Vaga-Lumes | Supremo | 50 / 95 | 10; atualização 2 | Colocação 8 / busca 35 | Farol visível de 60 HP informa direções | Destruir farol; informação aproximada | TESTING / catálogo |
| `petal_cyclone` · Festa de Pólen | Supremo | 50 / 95 | 8 | 22 / 7 | Área persistente de slow 35% | Sair da região/limpar; sem dano | TESTING / catálogo + execução |
| `ink_tide` · Maré de Tinta | Supremo | 55 / 100 | Onda 2 | 25 / largura 4 | Empurrão até 12m/s pela superfície | Desviar da faixa/usar paredes | TESTING / catálogo |
| `confetti_wheel` · Roda de Confetes | Supremo | 45 / 85 | 6 | Próprio / — | Limpeza, velocidade +15%, resistência 65% | Sem imunidade a dano ou Tormenta | TESTING / catálogo + regras |
| `chalk_shortcut` · Atalho de Giz | Supremo | 60 / 110 | 10 | 25 pela superfície / portal 1,15 | Par de portais somente para o conjurador | Extremos visíveis; colisão/prazo/reentrada | TESTING / catálogo |

Testes executados nesta etapa:

- `game-data/abilities.test.ts`: quantidade, categorias, oito passivas, IDs compatíveis, 40 ícones, dez marcas, custos/cooldowns e dano concentrado nas armas.
- `game-core/abilitiesV2.test.ts`: primeira vertical, Mana/cooldown, passiva manual rejeitada, proteção temporária, Tormenta, slow e limpeza sob silêncio.
- `game-core/abilities.test.ts`: execução dos efeitos migrados pelo sistema autoritativo, projétil/revelação privada, áreas sem dano, armadilha, HoT e dash.
- `game-core/passives.test.ts` e `statusEffects.test.ts`: todas as passivas, combate, reset/morte, regeneração, limites, camadas, resistência e limpeza.
- `game-core/draft.test.ts`: loadouts válidos, exclusividade individual, prazo, timeout e até dez participantes.

O registro de testes de execução das demais famílias e dos confrontos reais fica na documentação de autoridade e no relatório de validação da implementação. Não assumir dez humanos a partir de dez seats de teste ou de uma sala com bots.

Validação integrada de 19/10/2026: [158 testes focados, navegador e métricas](../qa/ABILITY_V2_VALIDATION_2026-10-19.md).
`abilitySystem.v2.test.ts` exercita as demais famílias, barreiras, portais, reconhecimento, movimento e limpeza;
`abilityPhysics.test.ts` usa física real; `lootPassives.test.ts` verifica as transações do Catador.
`abilities-v2.multiplayer.test.ts` usa dois clientes SDK independentes e completa partidas com 1+9 e 2+8.
Os testes de regressão finais incluem Meteoro sem impacto duplicado, volume compartilhado da nuvem e Eco sem
rastros estacionários. A apresentação foi inspecionada em desktop, retrato e paisagem; isso não substitui a
qualificação manual de cada uma das 40 magias, razão para manter os estados individuais TESTING.
