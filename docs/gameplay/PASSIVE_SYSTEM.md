# Passivas

As oito passivas são definidas em `packages/game-data/src/abilities.ts`; `packages/game-core/src/passives.ts` calcula seus modificadores. Nenhuma possui custo, conjuração, ativação manual ou cooldown de slot. A regra de uma passiva é validada no Draft e no loadout.

| ID | Benefício | Condição |
|---|---|---|
| `wind_foot` | Corrida ×1,07 | 4s sem disparar nem receber dano |
| `steady_hand` | Recuo e dispersão ×0,88 | Vivo, arma equipada |
| `quick_swap` | Tempo de equipar ×0,75 | Troca real E/Q |
| `backyard_scavenger` | Distância de coleta ×1,35; munição +10% | Transação real de coleta, capacidade validada |
| `soft_step` | Volume dos passos ×0,6 | Passos reais, sem alterar tiros/magias |
| `new_bark` | Escudo +3/s até 50% do máximo | 8s fora de combate; dano ou disparo reinicia a janela |
| `kite_breath` | Controle no ar ×1,2; consequências compatíveis de queda ×0,8 | Não altera gravidade nem concede voo |
| `anti_glue` | Duração de slow/silence −25% | Respeita duração mínima; sem imunidade permanente |

API: `newPassiveRuntime`, `resetPassives`, `recordPassiveCombat`, `passiveModifiers`, `updatePassives` e `pickupAmmoWithPassive`. O runtime acompanha últimos disparo/dano e a fração acumulada da regeneração. A sala chama essas funções no tick e nos eventos já existentes; não há `setInterval` por habilidade.

Somente jogadores vivos recebem modificadores. Morte, reinício e troca de build removem estado transitório e frações pendentes. A regeneração concede pontos inteiros para preservar a representação de escudo e nunca reduz escudo que já esteja acima do teto parcial. A coleta não modifica a quantidade de loot mostrada a outros jogadores; o bônus é aplicado apenas ao aproveitamento da transação autorizada.

Teste automatizado: todas as oito passivas, neutralização na morte, janelas de combate, recuo/dispersão, troca, coleta/munição, passos, controle aéreo, resistência, teto parcial e frações de regeneração.
