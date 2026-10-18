# Ability System v2 — auditoria e baseline

Referência Git anterior à migração: `baseline-abilities-v2-20261018` (`9ae7cde`). O checkout já continha trabalho paralelo em anatomia, corpo 3D, ferramentas de mundo e configuração de execução; esses arquivos foram preservados e não fazem parte desta migração.

| Sistema anterior | Estado | Evidência / decisão |
|---|---|---|
| Catálogo | PARCIAL | 8 básicas e 3 Supremos; ampliar para exatamente 30+10. |
| Mana, cooldown e conjuração | FUNCIONAL | Reutilizar `checkCast`, `spendCast`, `GRAAbilitySystem`, SELF privado. |
| Input e HUD | PARCIAL | Quatro slots com bindings; passivas e estados novos faltavam. |
| Draft | PARCIAL | Quatro rodadas; exclusividade global automática e ausência de limite de passivas. |
| Armas, inventário e baús | FUNCIONAL | Preservar inventário e transações existentes; integrar modificadores. |
| Lentidão | DEFEITUOSO | Um único fator/expiração fazia lentidão forte herdar duração de outra fraca. |
| Vida/escudo | PARCIAL | Escudo normal funcional; proteção temporária separada ausente. |
| Movimento radial e colisão | FUNCIONAL | Reutilizar motor, normais, projeção tangencial e colisão da cápsula. |
| Barreiras e portais | AUSENTE | Necessitam entidades e validação de colocação. Física é compartilhada entre salas: isolar handles. |
| Reconhecimento | AUSENTE | Implementar envio privado autorizado e histórico limitado no servidor. |
| Passivas | AUSENTE | Modificadores derivados do loadout, eventos e tick, sem timers individuais. |
| Tormenta | FUNCIONAL | Dano somente na vida; proteção temporária não o absorve. |
| Bots | PARCIAL | Escolhem builds e usam armas; nunca conjuravam magias. |
| VFX, áudio, animação | FUNCIONAL | Reutilizar famílias e pooling; ampliar ícones, entidades e 10 marcas. |
| Autoridade Colyseus/Host | FUNCIONAL | Ambos executam a mesma sala e regras; cliente envia intenção. |

A primeira etapa jogável verifica Passo de Vento, Seiva Pegajosa, Casulo de Folhas, Mão Firme, Vaga-Lume Explorador e Meteoro Solar antes da expansão por famílias. Os IDs antigos preservados incluem os nove pedidos; `petal_cyclone` passa a representar Festa de Pólen e `dawn_lance`, Arrastão de Vento, evitando quebrar builds antigas sem criar entradas extras.
