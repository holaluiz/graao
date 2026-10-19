# Uso de magias pelos bots

Bots compartilham catálogo, Draft e validação autoritativa com humanos. `BotAbilityController` produz intenção; `GraaoMatchRoom.botAbility` resolve direção/ponto e chama o mesmo `onAbility` usado por um jogador conectado. O bot não aplica dano, cura, movimento ou reconhecimento por um caminho paralelo.

Cada definição possui `bot: BotAbilityProfile`, com função tática, faixa de alcance e condições opcionais de Vida baixa, estar no ar ou ter superfície próxima. O controlador percorre os quatro slots com prioridade rotativa, ignora passivas e verifica Mana/cooldown/fase antes de propor uma ativação. A autoridade repete a validação completa e pode recusar alvos inviáveis sem gastar recursos.

| Perfil | Intenção |
|---|---|
| Mobilidade | Fugir de perigo, alcançar adversário ou buscar a região segura; planagem/salto exigem ar, gancho/ricochete exigem superfície |
| Controle | Usar contra adversário visível na faixa útil, interferindo na aproximação ou fuga |
| Defesa | Curar com Vida baixa, proteger sob pressão ou limpar estados negativos compatíveis |
| Exploração | Consultar recursos reais ou atividade de adversários, conforme a habilidade |
| Passiva | Nunca ativar manualmente; o tick/eventos do servidor aplicam o benefício |
| Supremo | Ativar em confronto útil ou necessidade defensiva; ofensivos exigem alvo e linha de visão |

O ciclo de decisões possui intervalo aproximado de 600ms, com pequeno escalonamento por índice para não concentrar todos os pedidos no mesmo instante. Movimento radial, navegação, uso de portas, busca de baús e Tormenta continuam nos sistemas existentes.

O Draft usa `available()` e as mesmas regras individuais: três básicas distintas, no máximo uma passiva e um Supremo. Escolhas de outros participantes não removem opções. Timeout também produz build válida e não pode travar a partida por bot sem seleção.

## Validação

`BotAbilityController.test.ts` cobre passivas não ativáveis, Mana, cooldown, morte, utilidade dos Supremos ofensivos, recursos, defesa e condição aérea. `abilities-v2.multiplayer.test.ts` verifica Draft legal com 1 humano + 9 bots e 2 humanos + 8 bots e observa eventos de conjuração de bots pertencentes às próprias builds.

Esses testes comprovam o fluxo e uso de habilidades; não comprovam que todas as 40 combinações foram usadas em uma partida, que um bot executa a melhor estratégia possível ou que dez humanos foram testados. A validação de cada família de execução fica nos testes do núcleo.

Para balancear decisões, registrar por ID: oportunidades avaliadas, pedidos, aceitações/rejeições por motivo, gasto de Mana, utilidade observável (cura aproveitada, alvo controlado, recurso encontrado, cobertura atingida, distância de fuga) e ativações sem benefício. Avaliar separadamente bots fora da zona, desarmados, em baixa Vida, no ar e sem inimigo visível. Perfis devem ser ajustados nos dados antes de espalhar exceções por ID no controlador.
