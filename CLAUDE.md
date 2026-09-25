# CLAUDE.md — huntera-multiconta (Swag)

Notas de contexto amplo do projeto (arquitetura, seletores, histórico de features) vivem no `CLAUDE.md` do projeto irmão `huntera-automacao`, seção "Feature: Auto Bestiary por fase (Ladder) — huntera-multiconta (Swag)" e "Desempenho do `huntera-multiconta`". Este arquivo, na raiz do próprio `huntera-multiconta`, guarda regras específicas deste repositório.

## REGRA DE OURO — identidade dos clientes como Google Chrome (25/09/2026)

Todos os clientes/contas abertos pelo LazyHunts devem se identificar no
`User-Agent` **exclusivamente como Google Chrome de desktop no Windows**. Nunca
expor no `User-Agent` o nome `LazyHunts`, o pacote `huntera-multiconta`, a marca
`Electron` ou qualquer outro identificador próprio do aplicativo.

Formato obrigatório:

```text
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<versão-principal>.0.0.0 Safari/537.36
```

Regras de implementação e manutenção:

1. `<versão-principal>` vem de `process.versions.chrome`, isto é, do Chromium
   realmente embarcado no Electron. Nunca fixar manualmente um major específico.
2. O override permanece global e deve ser configurado por
   `app.userAgentFallback` **antes da criação de qualquer janela**. Assim ele
   cobre todas as contas, partições e janelas de autenticação.
3. Não criar `session.setUserAgent`, `webContents.setUserAgent`, atributo
   `useragent` de `<webview>` nem outro override local que possa substituir ou
   divergir do valor global.
4. Nenhuma mudança futura de nome, versão, empacotamento, Electron ou sistema
   operacional pode acrescentar `LazyHunts`, `huntera-multiconta` ou `Electron`
   ao `User-Agent`.
5. Antes de entregar qualquer mudança que toque `main.js`, criação de janelas,
   sessões, webviews ou headers de rede, rodar obrigatoriamente:

   ```bash
   node scripts/teste-user-agent.mjs
   ```

   O teste confere o formato exato, a ausência das marcas proibidas, a ordem de
   inicialização e a inexistência de overrides locais. Se ele falhar, a mudança
   não pode ser entregue.

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

## Rotina de entrega depois da validação (24/09/2026)

Fluxo combinado com o André: eu lanço uma prévia, ele testa (`npm start`); quando ele disser que **validou** ("validei", "pode publicar"), eu faço o resto sozinho. Esse aviso É a autorização para commit, push e publish daquela versão — não peço de novo, e ela não vale para a versão seguinte.

1. **Fechar a versão**: tirar o sufixo de prerelease (`0.13.4-spawn.5` → `0.13.4`) no `package.json` e no topo do `CHANGELOG.md` (regra 3 acima). `npm run verify:version` tem que passar.
2. **Rodar todos os testes** de `scripts/teste-*.mjs` e `node --check` nos arquivos alterados. Falhou = não segue, e conto o que falhou.
3. **Commit** (mensagem no padrão `chore(release): <versão>`, sem `--no-verify`). Nunca `npm version` (regra 5).
4. **Push** do branch atual pro `origin` (`-u` na primeira vez).
5. **Publish**: `npm run publish` (roda `scripts/publicar.mjs`: confere `verify:version`, escolhe **prévia** para versão com sufixo e **release final** para versão limpa, e chama `electron-builder --publish always`; `-- --dry` só mostra o plano). Cria a Release em `dezin1/MultiAccount`. Precisa de `GH_TOKEN` no ambiente; token nunca é digitado nem colado por mim. Sem token, paro aqui e aviso que o publish fica com o André.
6. **Conferir e reportar**: commit no remoto, Release criada (tag, se está marcada como "Latest") e a versão que os usuários vão receber.

Não faço `git push --force`, não apago Release/tag e não publico sem o aviso de validação do André.
