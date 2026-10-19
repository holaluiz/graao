# Efeitos temporários

`statusEffects.ts` mantém listas autoritativas de efeitos com ID, tipo, origem, início, magnitude e expiração. Os dados de habilidade usam segundos; o runtime usa o relógio do servidor em milissegundos.

- **Slow:** vence o menor fator ativo; não se multiplicam lentidões. Quando a fonte forte expira, uma fonte mais fraca ainda ativa volta a valer. Fontes diferentes não compartilham expiração.
- **Velocidade:** vence o maior bônus ativo. O resultado respeita teto ×1,3 e slow mínimo ×0,3.
- **Root/silence:** duração máxima de 800ms, seguida de 1000ms de recuperação antes de outra aplicação do mesmo controle. Reaplicações durante a janela não prolongam a restrição.
- **NoSprint:** bloqueia somente corrida; mira e disparo permanecem disponíveis.
- **Resistência:** reduz duração e tem expiração própria. Anti-Cola afeta slow/silence; limpezas protegem somente as tags informadas. Debuffs conservam duração mínima de 150ms.
- **Limpeza:** remove apenas tags permitidas. Banho de Chuva e Roda de Confetes podem ser usados durante silêncio para removê-lo, mas ainda exigem Mana, cooldown pronto e estado compatível.

`statusModifiers` retorna velocidade, root, silêncio e impedimento de sprint. `updateStatusEffects` remove expirados; morte/reinício limpam efeitos, resistências e recuperação. `AbilityRuntime` também contém o runtime da passiva para manter um único estado por ator.

Escudo temporário pertence a `Vitals` em campos separados. `applyTemporaryShield` substitui/atualiza proteção sem empilhamento aditivo; `expireTemporaryShield` remove a parcela temporária. A absorção é temporário → normal → Vida. Tormenta e afogamento continuam removendo Vida diretamente. O escudo de Casulo nunca vira escudo normal.

Verificação cobre combinações, restauração após expiração, limites, resistência, limpeza seletiva, proteção temporária, Tormenta, morte e reset.
