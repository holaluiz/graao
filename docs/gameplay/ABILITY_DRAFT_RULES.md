# Ability Draft v2

O Draft possui quatro rodadas simultâneas: três básicas e um Supremo. Os slots preservam a ordem das escolhas e seus bindings. Uma passiva ocupa um dos três slots básicos e funciona automaticamente.

- Exclusividade **individual em qualquer tamanho de sala**: jogadores diferentes podem escolher a mesma magia.
- Uma build contém quatro IDs distintos, três básicos e um Supremo na última posição.
- Cada participante pode equipar no máximo uma passiva.
- O servidor valida rodada, fase, prazo, ID, tipo, duplicação e limite de passivas.
- Escolhas ficam secretas até a revelação. O cliente recebe somente sua própria seleção pendente e os estados de confirmação dos outros.
- No prazo esgotado, a escolha automática usa a mesma lista de opções válidas. Bots obedecem às mesmas regras.

O tempo padrão de escolha é 45 segundos e a revelação dura 1,6 segundo. A rodada resolve antecipadamente quando todos confirmam. Campos antigos de prioridade/repick continuam no protocolo por compatibilidade; `unique`, `repick` e `contested` são sempre falsos no fluxo v2. Não existe disputa global nem redução das opções por escolhas alheias.

Rejeições novas: `PASSIVE_LIMIT` e `EXPIRED`. Os códigos anteriores mantêm seus valores numéricos. `validateLoadout` repete as invariantes para impedir builds inválidas fora da UI.

Verificação: testes determinísticos de quatro rodadas, escolhas idênticas, prazo, privacidade, troca de seleção, abandono, limite de passivas e timeout com 1, 2 e 10 participantes. A suíte multiplayer também verifica escolhas idênticas pelo servidor real.
