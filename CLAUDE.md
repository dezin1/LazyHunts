# CLAUDE.md — huntera-multiconta (Swag)

Notas de contexto amplo do projeto (arquitetura, seletores, histórico de features) vivem no `CLAUDE.md` do projeto irmão `huntera-automacao`, seção "Feature: Auto Bestiary por fase (Ladder) — huntera-multiconta (Swag)" e "Desempenho do `huntera-multiconta`". Este arquivo, na raiz do próprio `huntera-multiconta`, guarda regras específicas deste repositório.

## Regra permanente — versionamento visível (TASK-004, 22/09/2026)

Motivo: o app ficou em `0.12.4` por várias entregas seguidas (Bestiário inteiro, redesenho de UI, controle Iniciar/Pausar) porque nenhuma delas tocou `package.json`/`CHANGELOG.md`. Resultado: o André não tinha como dizer "estou testando qual build" — nem pra si mesmo, nem numa eventual conversa de suporte.

1. **Todo conjunto de funcionalidades pronto para teste manual recebe uma versão prerelease visível** (formato `X.Y.Z-<contexto>.N`, ex.: `0.13.0-bestiary.1`) — não espera o release final pra existir um número.
2. **Toda versão prerelease atualiza, juntas, as três coisas**:
   - `package.json` (`version`);
   - `CHANGELOG.md` (nova seção no topo, marcada como prévia de teste — ver formato usado na entrada `0.13.0-bestiary.1`);
   - o indicador visual da versão no app (`#appVersionTag` no rodapé da barra lateral, `renderer/index.html`/`renderer/renderer.js` — lê `app.getVersion()` via IPC, nunca um literal escrito à mão).
3. **Releases finais usam SemVer normal** (`X.Y.Z`, sem sufixo de prerelease) — o sufixo (`-bestiary.1`, `-rc.2`, etc.) é exclusivo de builds de teste.
4. **Não alterar a versão em correções locais que ainda não vão para teste manual** — um fix intermediário dentro do mesmo ciclo de desenvolvimento (ex.: as correções `R2.1`/`R2.2` que vieram depois da primeira leva do Bestiário, todas ainda dentro do mesmo ciclo de teste) não precisa de um número novo a cada commit; o número sobe quando o conjunto está pronto pra alguém de fora testar.
5. **Nunca usar `npm version`** se isso criar tag Git ou alterar o repositório automaticamente sem pedido explícito — a versão é editada à mão no `package.json` (ou por instrução clara do André pra usar o comando).
6. **Antes de finalizar qualquer entrega de release** (prerelease ou final), rodar:
   ```bash
   npm run verify:version
   ```
   Isso confere: versão válida em `package.json`; a mesma versão no topo do `CHANGELOG.md`; e que os pontos de exibição da versão (`main.js`, `preload.js`, `renderer/renderer.js`) continuam lendo `app.getVersion()` dinamicamente, nunca um número hardcoded. Ver `scripts/verificar-versao.mjs`.
