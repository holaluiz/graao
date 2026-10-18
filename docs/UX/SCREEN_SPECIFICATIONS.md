# Especificações das telas de preparação

Este documento descreve os componentes de interface implementados no redesign e os critérios para validar sua composição. A jornada e os contratos autoritativos estão em [PRE_MATCH_FLOW.md](PRE_MATCH_FLOW.md); descoberta e ocupação estão em [ROOM_BROWSER.md](ROOM_BROWSER.md).

## Linguagem visual e estrutura compartilhada

As telas preservam o mundo 3D de graao ao fundo, a tipografia forte, papel creme, contornos escuros, sombras deslocadas, botões amarelos e seleção azul. Os tokens de cor continuam definidos em `apps/client/src/styles/main.css`.

`apps/client/src/ui/components.ts` fornece os elementos reutilizados pelo menu, salas, lobby, configurações e preparação:

| Elemento | Contrato visual e interação |
| --- | --- |
| `button` / `.gra-button` | Botão nativo; ação principal amarela; estados desabilitado e foco visível. |
| `.gra-panel` | Painel em papel, contorno escuro, cantos arredondados e sombra rígida. |
| `badge` / `.gra-badge` | Texto de estado com tom neutro, bom, azul ou erro. O texto comunica o significado além da cor. |
| `field` / `.gra-field` | Rótulo associado ao controle nativo por encapsulamento em `label`. |
| `Modal` | Diálogo com `aria-modal`, título acessível, captura de Tab nas extremidades e restauração do foco ao fechar. |
| `Toast` | Mensagem temporária com `role="status"`; duração maior para erro. |
| `focusScreen` | Move o foco para o primeiro controle ao mostrar uma tela. |

O navegador desenha `.room-row`; o lobby desenha `.player-slot`. A personalização tem seus componentes próprios de categoria, miniatura, amostra de cor e área de prévia, com o mesmo vocabulário de cores e contornos. As regras novas de preparação ficam em `apps/client/src/styles/prematch.css`; a personalização usa `apps/client/src/ui/creator.css`.

## Menu principal

Fonte: `apps/client/src/ui/Menu.ts`.

O menu alinha o logo **graao**, o subtítulo “um planetinha · armas, magia e roupas boas” e as ações à esquerda, sem rótulo extra acima do logo. O personagem personalizado e o mundo existente ocupam a área de apresentação ao lado. Esta cena é uma apresentação: o jogador não controla o personagem nem participa de combate.

Ordem das ações:

1. **Jogar**: abre Salas disponíveis.
2. **Personalizar**: abre a oficina de aparência e registra o menu como origem do retorno.
3. **Configurações**: abre o diálogo de opções.
4. **Treinar sozinho**: ação secundária, separada da entrada competitiva.

O componente de perfil mostra o nome atual. Clicar nele abre um formulário curto para alterar o nome; o campo aceita até 16 caracteres. Não há um formulário de bots, código de sala ou FPS misturado às ações principais. A interface pode mostrar uma mensagem de erro ou andamento abaixo do perfil.

## Navegador de salas

Fonte: `apps/client/src/ui/RoomBrowser.ts`.

O painel contém cabeçalho, contagem de salas, estado da descoberta, uma descrição curta, barra de ações, cabeçalho de colunas, listagem e rodapé. As ações **Atualizar**, **Criar sala**, **Entrar por código** e **Voltar** permanecem fora das linhas de sala.

A fonte da lista depende do build ([ROOM_BROWSER.md](ROOM_BROWSER.md)): servidor dedicado (`/rooms`, “● Servidor disponível”) ou lista ao vivo das salas hospedadas no navegador (“● Lista ao vivo”). O selo mostra apenas a descoberta; “Conectado à sala” só aparece no lobby, depois da entrada.

Colunas: **Sala · Participantes · Status · Ping** (o cabeçalho some quando a lista está vazia). Cada linha apresenta:

- Nome da sala, com reticências e texto completo no atributo `title` quando necessário.
- Nome do host e região somente quando recebida do servidor.
- Dez marcadores de vaga (humano amarelo, bot previsto azul tracejado, vaga livre vazia), o texto “N humanos + M bots previstos” e “T / 10 participantes”.
- Estado: Aguardando, Sala cheia, Escolhendo habilidades, Preparando, Em partida, Resultados ou Outra versão.
- Ping: “—”. Nenhuma latência foi medida antes de entrar, então nada é estimado.
- **Entrar →** quando a sala aceita entrada; **Indisponível**, com o motivo no `title`, quando está cheia, em andamento ou em outra versão.

No modo dedicado a consulta usa `/rooms`, sem cache, ao abrir a tela e a cada cinco segundos enquanto ela permanece visível; no modo hospedado a lista é ao vivo e se atualiza sozinha. Sair da tela cancela a consulta, o temporizador ou a assinatura. Não há linha de demonstração.

A listagem pagina pela altura real da janela: `floor((altura − 450) / 72)` linhas, entre 3 e 6 (quatro em 768 px, seis a partir de 882 px). Redimensionar recompõe a página e seus controles. A paginação preserva a lista real; não reduz dados por omissão silenciosa. A validação deve usar uma lista preenchida, porque o estado vazio ocupa muito menos espaço.

Estados desenhados:

| Estado | Apresentação |
| --- | --- |
| Consulta inicial | Carregando salas, com ícone animado (parado para quem pede movimento reduzido). |
| Lista vazia | “Nenhuma sala esperando jogadores” e o botão **Criar a primeira sala**. |
| Servidor ou lista indisponível | Explicação, nova tentativa automática e botão **Tentar de novo**; entrar por código continua possível. |
| Build sem online | “Jogar online não está disponível neste build”; Criar sala e Entrar por código ficam desabilitados. |
| Protocolo incompatível | Solicitação de recarregar o jogo; linhas de outra versão aparecem como “Outra versão”, sem Entrar. |
| Sala cheia ou em andamento | Linha visível, entrada desabilitada com o motivo. |
| Falha de criação ou entrada | Mensagem no painel e, quando aberto, no formulário correspondente. |

**ESC** fecha primeiro o formulário aberto; sem formulário, volta ao menu.

### Criar sala

O formulário é um modal, não uma segunda coluna permanente do navegador.

| Campo | Comportamento |
| --- | --- |
| Nome da sala | Padrão `Sala de [jogador]`; campo obrigatório, até 40 caracteres na UI. |
| Visibilidade | Pública, listada no navegador; privada, acessível por código. |
| Bots desejados | Controle nativo de “Nenhum · só humanos” a 9 bots, com a conta ao vivo: “Você + N bots = N+1 de 10 participantes”. |
| Mapa | Planeta graao fixo, com o modo “último de pé”. |

**Criar sala** envia a intenção à camada de rede. No modo hospedado o formulário avisa que o host mantém a sala na própria aba. No modo dedicado, quando o servidor não responde e há signaling, a alternativa explícita **Criar sala privada neste navegador** continua disponível.

### Entrar por código

O modal tem campo rotulado e botão **Entrar na sala**. O campo normaliza letras para maiúsculas e remove caracteres não permitidos. O prefixo `GR-` pode ser acrescentado na submissão. Erros retornam ao mesmo contexto sem criar um lobby fictício.

## Lobby da sala

Fonte: `apps/client/src/ui/LobbyPanel.ts`.

O lobby é uma tela dedicada sobre a cena de apresentação. Não é uma janela escondida pelo menu de pausa. **Estou pronto** aparece permanentemente no rodapé.

O cabeçalho mostra “LOBBY DA SALA”, o nome da sala, “Host: … · status” (Aguardando jogadores, Aguardando participantes ou Pronta para começar), conexão/reconexão, ocupação (“2 humanos + 8 bots · 10 / 10”) e o código copiável.

O corpo desenha exatamente **dez slots** em duas colunas no desktop. Cada slot mostra índice, avatar, identidade, tipo e preparação. O avatar dos humanos é um busto SVG desenhado com a aparência recebida do servidor (pele, rosto, cabelo, barba, chapéu, óculos e cor da roupa), então uma mudança salva no lobby aparece para todos. O jogador local recebe “(você)” e destaque; slots prontos ganham fundo verde; bots previstos usam contorno tracejado, ícone de robô e o texto **BOT PREVISTO · ENTRA NO DRAFT**; vagas restantes mostram **Vaga aberta**.

Os bots previstos são apenas reserva visual de composição. Eles não são personagens combatendo no cenário. Humanos podem substituir suas vagas antes do Draft, conforme os dados recebidos do servidor.

A lateral apresenta o cartão do mapa e os dados da sala: Mapa, Modo, Capacidade, Bots desejados e Visibilidade. O seletor de bots permanece visível, mas só o host pode alterá-lo; os outros veem “Definido pelo host”. Quando o host pede mais bots do que cabem, a nota explica que humanos têm prioridade. O host recebe também **Iniciar Draft**; outros participantes não recebem esse controle.

O rodapé reúne:

- **Estou pronto** ou **Desfazer pronto** para o próprio participante.
- **Personalizar**, que retorna ao lobby ao salvar ou descartar.
- **Sair da sala**.
- **Iniciar Draft**, somente para o host, habilitado pelo `canStart` autoritativo.

A mensagem ao lado dos controles explica o impedimento atual ou confirma que todos estão prontos. O clique em Pronto não inicia a partida. O mínimo para iniciar são dois participantes totais; todos os humanos precisam confirmar preparação. A UI usa `canStart` e `startReason` recebidos, sem recalcular uma autorização alternativa.

Em larguras menores, a lateral do mapa se torna uma faixa compacta e os botões do rodapé podem ocupar duas linhas. Os dez slots continuam acessíveis na mesma tela.

## ESC

| Tela | ESC |
| --- | --- |
| Menu | Fecha o diálogo aberto (nome, configurações). |
| Salas | Fecha o formulário aberto; sem formulário, volta ao menu. |
| Personalização | Descarta o rascunho e volta à origem. |
| Lobby | Abre **Opções**: Continuar, Configurações, Sair da sala. A nota lembra que a vaga continua guardada e que Estou pronto fica no rodapé. |
| Draft e preparação | Abre **Opções** com a nota de que o tempo não para. Sair é sempre um botão explícito. |
| Partida | Abre **Opções** com **Sair da partida** e a nota “A partida continua enquanto este menu está aberto. Ninguém pausa no multiplayer.” |
| Treino sozinho | **Voltar ao menu**. |

ESC nunca é o caminho para a ação principal de uma tela.

## Configurações

Fonte: `apps/client/src/ui/SettingsPanel.ts`.

Configurações abre como modal a partir do menu ou das opções de pausa. Os três grupos são selecionados por botões com estado pressionado:

| Grupo | Controles |
| --- | --- |
| Vídeo | Qualidade baixa/média/alta; limites de FPS do catálogo `FPS_CAPS`, incluindo Máximo. |
| Áudio | Volume geral em controle deslizante de 0 a 1. |
| Controles | Sensibilidade, inversão do eixo vertical e guia de atalhos. |

As alterações chamam o callback de aplicação imediatamente. **Concluir** ou **ESC** fecha o diálogo. As configurações técnicas permanecem fora do menu principal e dos formulários de sala.

O guia lembra WASD, salto, corrida/mergulho, mira/disparo, troca e recarga de armas, habilidades, Tab para placar e ESC para opções. Não redefine os atalhos existentes.

## Personalização

Fontes: `apps/client/src/ui/Creator.ts`, `CreatorThumbnails.ts`, `creatorPreviews.ts` e `creator.css`.

O editor tem três regiões no desktop:

1. **Categorias à esquerda**: Corpo, Rosto, Cabelo, Parte superior, Parte inferior, Calçados, Chapéus e Acessórios. Cada categoria combina ícone e nome. Azul indica a categoria atual.
2. **Prévia central**: maior região da tela, reservada ao personagem 3D já existente. A área fornece `previewBounds()` para a câmera de apresentação. Arrastar gira; a roda aproxima; **Visão frontal** restaura o enquadramento.
3. **Opções à direita**: cards com miniaturas 3D das próprias peças, nome e seleção visível; amostras para pele, cabelo e tecido. Cada miniatura usa a geometria, a paleta e os shaders do personagem, incluindo as peças Blender carregadas. O corpo e as cores escolhidas atualizam as miniaturas; a prévia central permite avaliar a combinação completa.

As miniaturas são PNGs transparentes de 256 × 176 px, produzidos por um único renderizador sob demanda. Somente a página visível entra na fila, com uma imagem por quadro; trocar de página ou fechar o editor cancela pedidos pendentes. Um cache de até 128 imagens evita refazer combinações já vistas e é invalidado pela revisão da biblioteca de peças. Chapéus largos, meias e outros volumes têm enquadramento próprio; mochilas e bandeiras são vistas por trás. Opções sem peça mostram um rótulo explícito. Em falha de renderização, o card informa que a prévia está indisponível.

As opções de rosto alternam Expressão e Barba/bigode. Acessórios alternam Rosto/cabeça e Corpo. A cor do chapéu só aparece quando um chapéu está selecionado; notas explicam materiais cuja cor modifica fitas e enfeites.

O catálogo completo usa páginas de **seis peças** no desktop e **três peças** em largura até 760 px ou altura até 640 px. As amostras de cor permanecem no painel da categoria. Aleatório e Restaurar padrão mudam apenas o rascunho e revelam a página da peça selecionada.

O rodapé é uma linha própria da grade de tela inteira e contém **Descartar** e **Salvar aparência**. Ele não depende da altura da lista de peças.

| Ação | Resultado |
| --- | --- |
| Escolher peça ou cor | Atualiza a cópia local e chama `preview`; preserva o personagem, o rig e a cena. |
| Descartar | Retorna a aparência presente na abertura e volta à tela de origem. |
| Salvar aparência | Emite o rascunho para persistência e volta ao menu ou lobby que abriu o editor. |
| Visão frontal | Reposiciona a apresentação, sem modificar as peças. |

Salvar aparência nunca inicia uma partida. A câmera usa a região livre dos painéis; a arma deve estar oculta durante a edição para permitir avaliação das roupas. A faixa de **Visão frontal** e a dica de rotação ficam abaixo da subárea do avatar e não entram em `previewBounds()`, para não cobrir os calçados.

O enquadramento desloca a lente para essa subárea, mantendo a posição física da câmera acima do chão. Um raycast a partir do torso impede a câmera de entrar nos objetos; o campo de visão compensa a aproximação. A prévia não dissolve o cenário, e os fades de combate são limpos ao entrar nos menus. O deslocamento de lente é removido ao sair da personalização. As animações e as regras de cobertura das peças continuam pertencendo ao sistema de personagem existente.

Em largura até 760 px, as categorias passam para uma faixa superior, a prévia ocupa a região intermediária e o painel de opções compacto aparece abaixo. O enquadramento deve considerar os limites verticais da prévia, além de seu centro horizontal.

As categorias têm semântica de abas, seleção acessível e navegação por setas, Home e End. Peças e cores usam botões com `aria-pressed`; as amostras possuem nomes legíveis por tecnologia assistiva.

## Preparação e transição ao OVNI

Fonte: `apps/client/src/ui/PreparationScreen.ts`.

Após o Draft, a tela apresenta **Preparando a partida**, a etapa atual, um indicador nativo de progresso e quantos humanos já confirmaram o carregamento. A região anuncia alterações com `aria-live="polite"`.

O indicador tem três etapas, não uma porcentagem temporal inventada. O aplicativo atualiza o progresso somente ao completar o trabalho correspondente. A contagem de preparados vem do estado da sala. O cliente envia a confirmação do identificador atual; o servidor libera o OVNI quando todos os humanos terminarem.

Timeout ou erro de carregamento segue a política de recuperação do servidor e retorna os participantes ao lobby. A tela não permite iniciar combate, saltar a preparação ou promover a fase por conta própria. As etapas cedem a vez ao navegador sem depender de `requestAnimationFrame`: um jogador com a aba em segundo plano também confirma o carregamento e não segura a sala.

Atrás do Draft e da preparação, que cobrem o mundo, a cena 3D é redesenhada no máximo quatro vezes por segundo; atrás da lista de salas e do lobby, no máximo 30 vezes. Ver [PERFORMANCE.md](PERFORMANCE.md).

O Draft tem especificação em [../gameplay/ABILITY_DRAFT.md](../gameplay/ABILITY_DRAFT.md), e OVNI/queda em [../gameplay/UFO_DEPLOYMENT.md](../gameplay/UFO_DEPLOYMENT.md).

## Responsividade e ausência de rolagem

O documento do cliente mantém `html, body` sem rolagem, e as telas de preparação se posicionam nos limites do viewport. Isso não constitui, sozinho, validação de encaixe: ocultar conteúdo fora da tela também viola o objetivo.

As telas devem distribuir altura entre cabeçalho, conteúdo e ações. Listas extensas usam páginas; as ações principais ficam fora da lista. Nomes longos usam quebra ou reticências, sem empurrar controles para fora do painel.

Matriz de aceitação visual:

| Viewport CSS | Conteúdo obrigatório na validação |
| --- | --- |
| 1366 × 768 | Menu, três salas e paginação com mais resultados, dez slots, modais, seis miniaturas e paleta de 18 cores, Draft completo, preparação. |
| 1440 × 900 | Mesmos estados, agora com cinco salas por página; avaliar hierarquia e a área reservada ao avatar. |
| 1920 × 1080 | Mesmos estados; preservar limites de largura dos painéis e tamanho legível dos controles. |
| 390 × 844 | Navegador preenchido, dez slots, criação/entrada, opções de personalização e rodapé acessível. |
| 390 × 667 e 844 × 390 | Diagnóstico de janela curta; reduzir densidade por página e composição antes de aceitar conteúdo cortado. |

Verificar também os estados que aumentam a altura: nome de sala longo, erro de entrada em duas linhas, reconexão, alternativa de host no navegador e categorias com seis peças mais duas linhas de cores. Os estados vazios não substituem a verificação de lotação.

Critérios de aprovação:

- Nenhuma barra horizontal ou vertical aparece na página nem nos painéis dessas telas.
- Os limites dos controles visíveis permanecem dentro da área útil da tela, incluindo rodapé, mensagens e sombras.
- Todo card/slot da página atual e todas as ações principais podem ser vistos e acionados sem deslocar a tela.
- Tab percorre controles visíveis, o foco permanece perceptível e um modal não deixa o foco escapar para a tela de fundo.
- Mudanças de página não fabricam salas ou participantes, nem alteram o estado autoritativo da preparação.
- Redimensionar mantém a categoria e a peça selecionadas; o personagem continua enquadrado na região de prévia.
- A verificação registra viewport, estado, captura e resultado. Esta especificação não declara execução bem-sucedida dessas verificações.
