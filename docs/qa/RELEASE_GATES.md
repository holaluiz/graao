# Critérios de teste e gates de release

Contrato de qualidade do Master Plan 2.0. Vale para toda frente nova; o estado real de cada sistema fica em
[MVP_STATUS.md](../MVP_STATUS.md) e o último confronto completo em [AUDIT_M0_2026-10-19.md](AUDIT_M0_2026-10-19.md).

## Estados

| Estado | Significa |
|---|---|
| `NOT_STARTED` | nada no código |
| `IN_PROGRESS` | código sendo escrito, não integrado |
| `PARTIAL` | parte das regras ou da interface existe; não cobre o contrato |
| `TESTING` | integrado e com testes automatizados, falta a verificação que o contrato exige (multiplayer externo, mobile, pessoa jogando) |
| `DONE` | os 14 itens do contrato abaixo, com evidência |
| `BLOCKED` | depende de algo fora do código (máquina, conta, credencial, decisão) — dizer o quê |

Não é `DONE`: mock, protótipo visual, ícone sem efeito, sistema multiplayer testado só localmente, configuração que
deveria persistir e fica em memória, teste nunca executado.

## Contrato de "DONE"

1. Código integrado · 2. regras definidas · 3. autoridade correta (servidor decide dano, XP, saldos, inventário) ·
4. interface funcional · 5. feedback de interação · 6. erros tratados · 7. testes unitários · 8. testes de
integração · 9. teste multiplayer quando necessário · 10. teste mobile quando aplicável · 11. performance avaliada ·
12. documentação atualizada · 13. nenhuma regressão crítica conhecida · 14. evidência de funcionamento.

## Categorias de teste

| Categoria | Onde | Critério | Como rodar |
|---|---|---|---|
| Unitário | `packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts` | Determinístico: relógio de simulação passado como argumento (`now`), sem `setTimeout` real, sem depender de layout do mapa salvo quando a regra não é sobre o mapa | `pnpm exec vitest run packages apps` |
| Integração (servidor real + clientes SDK) | `tests/*.multiplayer.test.ts`, `tests/multiplayer.test.ts`, `tests/hostRoom.test.ts` | Servidor Colyseus no processo, clientes reais; nenhum banco real (`setMatchStore`, `setAuthVerifier(null)`); posições de teste escolhidas por busca no mundo (`openSpot`/`clearWish`) ou opções dev (`matchSpawns`, `freeRoamSpawns`) | `pnpm exec vitest run tests` |
| Tempo real | os testes de suavidade/interpolação em `tests/multiplayer.test.ts` | Medem relógio real de propósito; arquivos rodam em sequência (`fileParallelism: false`); métricas impressas com `GRAAO_DEBUG=1 … --silent=false`; limite nunca é afrouxado para passar — investigar a causa | ver AUDIT §6 |
| Host | `tests/hostCentral.test.ts`, `tests/graaoHost.e2e.test.ts`, `apps/server/src/desktop/*.test.ts` | Central em PGlite com a migration real; três instalações; queda do host | `pnpm exec vitest run tests/host*.ts tests/graaoHost*` |
| E2E no navegador | painel de navegador / Playwright (`tools/hosting/app-drive.ts`) | Fluxo completo Menu → Sala → Lobby → Draft → OVNI → Partida → Resultados → Lobby com captura | manual guiado, ver `docs/UX/VERIFICATION.md` |
| Multiplayer externo | duas máquinas, duas redes | Ver [HOST_VALIDATION.md](../networking/HOST_VALIDATION.md); **nunca marcado como feito sem as máquinas** | manual |
| Performance | F3 + `docs/performance/BUDGETS.md` + benchmarks em `docs/UX/*.json` | Medir com o laço pausado e quadros sintéticos quando o painel não tem foco (ver memória de teste); registrar GPU, CPU, draw calls | manual + scripts em `tools/profiling` |

Sempre antes de entregar: `pnpm typecheck`, `pnpm build`, `pnpm exec vitest run`.

## Gates

| Gate | Marco | Critério | Estado em 19/10/2026 |
|---|---|---|---|
| A | M1 Estabilidade | Nenhuma falha sem classificação; build e typecheck íntegros; regressão executada; baseline registrado | **Cumprido** em 19/10/2026: 543/543, typecheck, build ([auditoria](AUDIT_M0_2026-10-19.md)); refeito em 20/10/2026 com a falha de reconexão classificada e corrigida ([baseline](BASELINE_2026_10.md)) |
| B | M2 Alfa externa | Uma partida completa entre PCs em redes diferentes; três hosts independentes quando houver máquinas; falhas registradas | BLOCKED (máquinas/rede) |
| C | M3 Draft visual | 10 participantes visíveis; 40 magias acessíveis sem abas; 4 escolhas válidas; bots finalizam; nenhum Draft trava; mobile utilizável | NOT_STARTED |
| D | M6–M7 Oficina + Arsenal | Montar e salvar arma; baús normais; ganhar Suprimentos; pedir, receber e equipar; outro jogador contesta; inventário consistente em multiplayer | NOT_STARTED |
| E | M4 Áudio | Sons distinguíveis; espacial funcional; volumes; sem picos nem duplicados; performance medida | PARTIAL |
| V | Vertical World & Traversal | Agarrar, subir, escalar, planar e vento com autoridade do servidor; Serra com 3 rotas; ilha acessível sem magia e com saída; editor de ventos; bots sem rotas impossíveis; medido; mobile e partida real | TESTING em 19/10/2026 ([relatório](VERTICAL_TRAVERSAL_TEST_REPORT.md)): falta touch, partida real com combate vertical, latência simulada e redes externas |

## Release público (M11)

Funcionalidade (login → sala → Draft → OVNI → queda → loot → armas → magias → creeps → XP → atributos → Tormenta →
eliminação → espectador → resultados → lobby), estabilidade (build, typecheck, testes críticos, sem perda sistemática
de sessão), rede (externa testada, queda do host tratada, mensagens inválidas rejeitadas, versão e mapa validados),
performance (metas por perfil documentadas, sem vazamento progressivo), UX (nenhuma fase escondida atrás do ESC,
erros explicados, mobile verificado), economia (créditos não duplicáveis, RLS validada, gastos transacionais,
resultados comunitários tratados pela política de confiança), segurança (segredos protegidos, Electron isolado,
endpoints administrativos restritos) e áudio (sem clipping, volumes, `AudioContext` correto, voz opcional).
