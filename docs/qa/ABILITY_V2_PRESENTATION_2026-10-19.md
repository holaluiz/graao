# Ability v2 — apresentação e áudio

Continuação sobre `ab2b3cc`, com base de checkout `43106b4`. Alterações paralelas de mundo e movimentação foram preservadas. Esta rodada corrige falhas de leitura e retorno da conjuração; a validação humana de equilíbrio/áudio e entre máquinas continua pendente.

## Correções

| Problema confirmado | Resultado |
|---|---|
| Farol: luz a 2,6 m, corpo atingível a 1,2 m | Lâmpada e raio autoritativo compartilham `abilityBeaconVolume`, centro radial +2,6 m e raio 0,5 m. O poste fino continua decorativo. Testes verificam quatro orientações, tiro na luz, erro acima dela, dano e destruição. |
| Abrir guarda-chuva apagava as asas de uma planagem ainda válida | Anexos são separados por jogador e canal (movimento, defesa e buff). Cada canal pode expirar/substituir sem apagar os outros; eliminação/reset limpam todos. |
| Roda de Confetes tinha só um flash de conjuração | Um anel com confetes gira ao redor do jogador durante os seis segundos do efeito aceito. A marca permanente do Supremo permanece separada. |
| Banho/Roda preditos e mostrados prontos enquanto voo/guarda-chuva bloqueavam todas as conjurações | HUD e mirror respeitam o bloqueio de mãos. A exceção para limpar silêncio continua funcionando quando não há esse bloqueio. |
| Pulsos repetidos sobrescreviam avisos de impacto no pool de decals | Slots expirados são usados primeiro; depois substituem-se apenas decals sem aviso. Avisos ativos preservam a geometria. O pool continua com 20 slots: se todos contêm avisos ativos, novos decals são descartados até expirar algum. |
| Sons inaudíveis ainda alocavam fontes e disputavam vozes | Master, efeitos ou volume individual zerados impedem síntese/agendamento. Desmutar permite novos cues; mutar ambiente não desliga sons de ação da categoria efeitos. |

Os defeitos do Farol e da previsão foram reproduzidos por testes falhando antes das correções. O teste do Farol tolera a quantização milimétrica da âncora replicada ao comparar a distância de impacto.

## Verificação

- **181/181 testes em 18 arquivos**, 33,62 s. [Resultado bruto](ability-v2-presentation-2026-10-19.json).
- Typecheck completo de raiz, cliente e Host passou.
- Build de cliente e servidor passou, com o aviso anterior de chunks grandes.
- ESLint dos 13 arquivos TypeScript alterados passou.
- Dois clientes SDK independentes continuam cobrindo colisões/coberturas/portal/reconhecimento e composições 1+9 e 2+8 no servidor real.
- Cinco testes do pool submetem geometria real sem GPU: nove emissores de pulsos, estilos próprio/adversário em LOW/HIGH, pool cheio e reuso após expiração.
- Oito testes do mixer incluem todas as **32 magias ativas nas rotas própria e adversária**, onze famílias de cues, limites de vozes, rajadas mutadas, preservação de vozes e retorno depois de desmutar. As oito passivas não são conjuradas manualmente. Isso verifica o grafo e a síntese; não afirma audição humana.

## Navegador e reprodução

Há uma fixture de desenvolvimento em `apps/client/test-fixtures/ability-presentation.html`, disponível no Vite em `/test-fixtures/ability-presentation.html`. Ela usa `AbilityWorldPresentation` e o Farol do `GRAAbilitySystem` reais; tem consultas analíticas ao planeta e bonecos simplificados, sem rede, áudio ou motor de movimento. Não é uma partida completa nem entra no build de produção padrão.

No navegador foram verificados: 60 → 30 → destruição do Farol por dois tiros de 30 na posição **desenhada** da lâmpada; dois anexos simultâneos no boneco com asas/guarda-chuva; Roda visível/girando; avanço de sete segundos removendo todos esses anexos. Não houve avisos/erros no console da fixture. [Captura](../UX/screenshots/abilities-v2-presentation-fixes.png).

O teste de partida completa com nove bots e os tamanhos de tela está no [relatório anterior](ABILITY_V2_VALIDATION_2026-10-19.md). Nesta rodada, a verificação visual é isolada; os confrontos de rede são automatizados. A revisão identificou um limite anterior que permanece: anexos de mobilidade usam a duração máxima da conjuração; encerrar a mobilidade antecipadamente por pouso/água/controle pode deixar asas ou corda visíveis até esse prazo. Corrigir todos os clientes exige sincronizar esse encerramento com os estados/eventos autoritativos, incluindo os remotos.
