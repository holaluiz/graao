# Estados de travessia

Contrato da máquina de estados de locomoção vertical (19/10 em diante: `game-core/traversal.ts`, `character.ts`,
`game-data/traversal.ts`). Não existe um segundo controlador: os estados são um modo persistente
(`CharacterState.traversal`) dentro do mesmo `CharacterMotor.step` que roda na predição do cliente e no servidor.

## Estados pedidos × estados reais

| Pedido | No código | Como é reconhecido |
|---|---|---|
| `GROUNDED` | `traversal = NONE` e `grounded` | `MovementState` IDLE/WALK/RUN/SPRINT |
| `JUMPING` | `NONE`, no ar, subindo | `MovementState.JUMP` (vs > 0,5 m/s) |
| `FALLING` | `NONE`, no ar, descendo | `MovementState.FALL` |
| `LEDGE_HANG` | `TraversalMode.HANG` | `MovementState.LEDGE_HANG` (7) |
| `MANTLING` | `TraversalMode.MANTLE` | `MovementState.MANTLE` (8) |
| `CLIMBING` | `TraversalMode.CLIMB` | `MovementState.CLIMB` (9) |
| `GLIDING` | `TraversalMode.GLIDE` | `MovementState.GLIDE` (10) |
| `WIND_LIFT` | não é estado: força do volume de vento sobre quem está no ar (planando sobe, sem pipa só freia a queda) | `wind.ts` + motor |
| `LANDING` | não é estado: o pouso fecha a planagem no mesmo passo e a animação `land` toca por um instante | `CharacterAnimationController` |

`WIND_LIFT` e `LANDING` ficaram fora da máquina de propósito: são efeitos de um passo sobre estados que já existem;
virar estado criaria transições sem regra própria (e mais um valor na rede).

## O que cada estado permite

| Estado | Entrada | Vel. máx. | Gravidade | Colisão | Câmera | Armas | Magias | Stamina | Animação |
|---|---|---|---|---|---|---|---|---|---|
| Chão | WASD, pular, correr | 5,6 (corrida) | contato | controlador | normal | sim | todas | +24/s (+34/s parado) | locomoção |
| Ar (pulo/queda) | WASD (9 m/s²), pulo duplo | terminal 42 | 20 m/s² | controlador | normal | sim | todas | — | `air`/`fall` |
| Pendurado | ↑ sobe, ↓ solta (ou escala se a face for escalável), ←/→ desliza na beirada, pular sobe (ou pula para trás com ↓), correr solta | deslize 1,5 | não | controlador, 5 cm da face | recua 1 m e sobe 0,3 m | não (troca no coldre sim) | só mobilidade (solta a beirada) | −4/s | `hang`; deslizando, `shimmy` (procedurais) |
| Subindo (mantle) | nenhuma (trajetória física) | sobe 4,2, avança 3,0 | não | controlador | recua | não | nenhuma | −4 uma vez | `mantle` (UAL ClimbUp_1m) |
| Escalando | ↑↓←→ na parede, pular salta para fora, correr solta | ↑1,7 ↓2,3 ↔2,0 | não | controlador, 4 cm da face | recua | não (troca sim) | só mobilidade (solta a parede) | ↑18/s ↔10/s ↓6/s parado 3/s | `climb` (ciclo procedural de membros alternados, sentido pela velocidade) |
| Planando | WASD (9 m/s²), soltar pular fecha | 6,6 horizontal, queda 4,8 | 45% até 4,8 m/s de queda | controlador | FOV +6°, recua 0,7 m | não | só mobilidade (assume a planagem) | −8/s | `glide`; subindo numa corrente, `updraft` (corpo ereto, pernas soltas) + pipa |

Permissões em `TRAVERSAL_ACTIONS` (game-data); o servidor recusa tiro, soco, recarga, interação, troca de arma e
magia conforme a tabela (`GraaoMatchRoom`), e o cliente bloqueia antes com o aviso "PENDURADO · MÃOS OCUPADAS".
Não há tiro completo em nenhum estado de travessia.

**Magia na parede (desde 20/10):** pendurado ou escalando, só magias de mobilidade, que soltam a parede — a saída de
quem é atacado sem armas na mão: o Ricochete chuta para longe da face, o Pulo de Pipa sobe uma vez, a Linha de Varal
leva a outro ponto, o Passo de Vento sai de lado. Elas deixam a espera normal de reagarre (0,35 s): sem ela, quem
continuava empurrando a parede a agarrava de novo no mesmo passo e a magia sumia. Subindo (mantle), nada. Bots não
lançam magia enquanto tomam uma ligação de travessia.

## Transições (prioridade de cima para baixo, no passo)

1. **Fim forçado** (qualquer modo de parede): água, mergulho do OVNI, enraizamento, dash ou movimento de magia →
   `releaseTraversal` (cai, com espera de 0,35 s para reagarrar). Empurrão (`applyKnockback`) idem.
2. **Pendurado/subindo/escalando** possuem o passo: nada mais é avaliado.
3. **Planagem fecha** se soltar pular, pousar, entrar na água, dash, magia de movimento, enraizado, tempo de planagem
   (2,6 s fora de corrente) ou stamina zerada.
4. **Pulo** (buffer 0,12 s, coyote 0,1 s, pulo duplo) — antes de qualquer agarre.
5. **Agarre no ar** (com intenção de movimento ≥ 0,3 contra a parede, espera zerada, stamina ≥ 5): beirada baixa/
   média → MANTLE direto; alta → HANG; face escalável → CLIMB. Uma Linha de Varal lançada na face ou na parte de
   baixo de uma beirada termina na altura de pendurar (`TRAVERSAL.grapple`): empurrando para a parede, agarra.
6. **Planagem abre** com pular segurado, depois de 0,3 s no ar, caindo > 1 m/s e com 2 m livres abaixo — ou, dentro
   de uma corrente ascendente, após 0,12 s no ar, subindo ou não.

Esperas anti-abuso (em passos inteiros de 1/60 s, reconstruídas do snapshot): reagarrar 0,35 s, após mantle 0,2 s,
após exaustão 0,8 s. Sem altura infinita: soltar e pular na mesma beirada nunca ganha altura (teste
`dropping and jumping at the same ledge never gains height`).

Nada fica preso: cada modo de parede reavalia a geometria a cada passo e solta quando a parede some (canto, fim da
rocha), quando o mantle trava (teto imprevisto) ou passa de 1,1 s.

**Chão é apoio caminhável (desde 20/10).** O controlador do Rapier considera chão qualquer contato que não seja
exatamente vertical. Na esfera, uma parede "vertical" voltada para fora do centro da sua peça inclina para trás d/R
(1–2°): encostado nela no alto de um pulo, o personagem ficava "de pé" na parede e pulava de novo — qualquer parede
lisa subia no pulo repetido (8,3 m numa face de 6 m; no mapa real, a face lisa do patamar 2 até o cume, sem nenhuma
capacidade de travessia). Agora o motor só aceita o chão do controlador com apoio caminhável (≤ 52°) até 0,3 m sob o
eixo da cápsula ou sob a sua borda (`TraversalProbe.standsOn`), o critério que a travessia já usava. Teste
`jumping again and again into a plain face never climbs it` (falha sem a correção).

## Controles: teclado e toque

Os dois emitem as mesmas intenções (`Input` → `InputCmd`); nenhum caminho de física próprio.

| Intenção | Teclado | Toque (`apps/client/src/game/TouchControls.ts`) |
|---|---|---|
| Andar / correr | WASD / Shift | joystick flutuante à esquerda (analógico); empurrado até a borda corre |
| Pular / planar | Espaço; segurar em queda abre a pipa | PULAR; o rótulo vira PLANAR quando segurar abriria a pipa, PLANANDO enquanto plana |
| Agarrar / escalar | pular empurrando para a parede | o mesmo, ou o botão contextual ESCALAR/AGARRAR (pula e empurra para a frente) |
| Subir da beirada | pular ou empurrar para a parede | contextual SUBIR |
| Soltar da parede | Shift (borda) ou para trás | contextual SOLTAR |
| Interagir (baú, porta, sino) | F | contextual com o verbo do aviso (ABRIR, TOCAR, PEGAR…) |
| Câmera | mouse com o ponteiro preso | arrastar fora dos botões |
| Combate | mouse, R, E/Q (armas), 1/2/3/4 (magias), Z/X/C (itens) | ATIRAR (segurar), MIRAR (alterna), RECARREGAR; os próprios ícones do HUD (magias, cartões de arma, cinto de itens) são os botões |

Um único botão contextual cobre a travessia e o mundo, pela prioridade: mãos na beirada ou na parede → aviso de
interação → parede ou beirada ao alcance de um pulo (sondas do próprio motor). O modo toque liga no primeiro toque na
tela (ou com `?touch`) e substitui a trava do ponteiro por "tocar no mundo para jogar"; ☰ abre as opções.

**No celular o jogo é horizontal.** O primeiro toque pede tela cheia e trava a orientação em paisagem onde o navegador
permite (Android/Chrome); em retrato numa tela de toque (`pointer: coarse` ou modo toque) um cartão "Gire o celular"
cobre tudo até o aparelho virar, com um botão que tenta a trava de novo (iPhone/Safari não trava: pede para girar). Em
paisagem o HUD se reorganiza para o polegar (`body.touch-ui`): magias no topo à direita, itens no topo à esquerda,
armas embaixo no centro, pad à direita, joystick flutuante à esquerda.

## Rede

`moveState` carrega o modo; `PlayerSnap[20..22]` traz stamina, temporizadores empacotados e o raio da beirada. A
predição reconstrói o estado exato (ver [TRAVERSAL_AUTHORITY](../networking/TRAVERSAL_AUTHORITY.md)).

## Testes

`packages/game-core/src/traversal.test.ts` (31: tabela de transições, beirada, mantle, escalada, planagem,
empurrão, parede não é chão, o que cada estado permite, contrato de predição) e `wind.test.ts` (10: vento, sino, teto,
Tormenta em altitude). Magias saindo da parede e como rotas, em partida real: `tests/vertical.mobility.multiplayer.test.ts`.
