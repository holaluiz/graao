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
| Pendurado | ↑ sobe, ↓ solta (ou escala se a face for escalável), ←/→ desliza na beirada, pular sobe (ou pula para trás com ↓), correr solta | deslize 1,5 | não | controlador, 5 cm da face | recua 1 m e sobe 0,3 m | não (troca no coldre sim) | nenhuma | −4/s | `hang` (procedural) |
| Subindo (mantle) | nenhuma (trajetória física) | sobe 4,2, avança 3,0 | não | controlador | recua | não | nenhuma | −4 uma vez | `mantle` (UAL ClimbUp_1m) |
| Escalando | ↑↓←→ na parede, pular salta para fora, correr solta | ↑1,7 ↓2,3 ↔2,0 | não | controlador, 4 cm da face | recua | não (troca sim) | nenhuma | ↑18/s ↔10/s ↓6/s parado 3/s | `climb` (ciclo, sentido pela velocidade) |
| Planando | WASD (9 m/s²), soltar pular fecha | 6,6 horizontal, queda 4,8 | 45% até 4,8 m/s de queda | controlador | FOV +6°, recua 0,7 m | não | só mobilidade (assume a planagem) | −8/s | `glide` (procedural) + pipa |

Permissões em `TRAVERSAL_ACTIONS` (game-data); o servidor recusa tiro, soco, recarga, interação, troca de arma e
magia conforme a tabela (`GraaoMatchRoom`), e o cliente bloqueia antes com o aviso "PENDURADO · MÃOS OCUPADAS".
Não há tiro completo em nenhum estado de travessia.

## Transições (prioridade de cima para baixo, no passo)

1. **Fim forçado** (qualquer modo de parede): água, mergulho do OVNI, enraizamento, dash ou movimento de magia →
   `releaseTraversal` (cai, com espera de 0,35 s para reagarrar). Empurrão (`applyKnockback`) idem.
2. **Pendurado/subindo/escalando** possuem o passo: nada mais é avaliado.
3. **Planagem fecha** se soltar pular, pousar, entrar na água, dash, magia de movimento, enraizado, tempo de planagem
   (2,6 s fora de corrente) ou stamina zerada.
4. **Pulo** (buffer 0,12 s, coyote 0,1 s, pulo duplo) — antes de qualquer agarre.
5. **Agarre no ar** (com intenção de movimento ≥ 0,3 contra a parede, espera zerada, stamina ≥ 5): beirada baixa/
   média → MANTLE direto; alta → HANG; face escalável → CLIMB.
6. **Planagem abre** com pular segurado, depois de 0,3 s no ar, caindo > 1 m/s e com 2 m livres abaixo — ou, dentro
   de uma corrente ascendente, após 0,12 s no ar, subindo ou não.

Esperas anti-abuso (em passos inteiros de 1/60 s, reconstruídas do snapshot): reagarrar 0,35 s, após mantle 0,2 s,
após exaustão 0,8 s. Sem altura infinita: soltar e pular na mesma beirada nunca ganha altura (teste
`dropping and jumping at the same ledge never gains height`).

Nada fica preso: cada modo de parede reavalia a geometria a cada passo e solta quando a parede some (canto, fim da
rocha), quando o mantle trava (teto imprevisto) ou passa de 1,1 s.

## Rede

`moveState` carrega o modo; `PlayerSnap[20..22]` traz stamina, temporizadores empacotados e o raio da beirada. A
predição reconstrói o estado exato (ver [TRAVERSAL_AUTHORITY](../networking/TRAVERSAL_AUTHORITY.md)).

## Testes

`packages/game-core/src/traversal.test.ts` (29: tabela de transições, beirada, mantle, escalada, planagem,
empurrão, contrato de predição) e `wind.test.ts` (10: vento, sino, teto, Tormenta em altitude).
