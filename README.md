# Huntera Multiconta

App desktop (Electron, Windows) **não-oficial** pra manter várias contas do
[Huntera](https://huntera.com.br/game) logadas em paralelo, cada uma isolada,
numa janela só. Projeto de aprendizado — inspirado no
[HunteraFarm](https://cacor11.github.io/HunteraFarm/) (projeto de terceiro,
descontinuado), reescrito do zero pra entender como esse tipo de app
funciona por dentro.

⚠️ O jogo permite até 4 conexões simultâneas por IP — esse app não tenta
burlar limite nenhum, só facilita ter as suas contas permitidas abertas ao
mesmo tempo numa janela só, em vez de 4 abas de navegador separadas.

## Como funciona (a ideia central)

Cada conta roda dentro de um `<webview>` do Electron com sua própria
**partição** (`partition="persist:conta-N"`). O Electron trata cada valor de
partição como um "perfil" de armazenamento totalmente separado — cookies,
localStorage, sessionStorage, IndexedDB, tudo isolado por partição. Na
prática é a mesma ideia de ter vários perfis do Chrome, só que dentro de um
app só: cada webview nem sabe que existem outras contas rodando ao lado.

Isso é bem diferente da extensão de automação (`huntera-automacao/`), onde
todas as abas do MESMO navegador compartilham o mesmo armazenamento por
origem — por isso lá só dava pra ter uma conta logada por vez. Aqui, cada
"aba" do app é o equivalente a abrir o jogo num navegador diferente.

## O que a v0.3.0 faz

- Janela única com **barra lateral de contas** (visual inspirado no app
  "Multi Idle Manager"/multidl.online) — uma linha por conta, com avatar,
  bolinha de status, domínio e tempo desde que a conta foi criada.
- **+** (cabeçalho da barra lateral) — cria uma conta nova com sessão
  isolada (até 4); é só fazer login normalmente dentro dela, como se fosse
  abrir o jogo pela primeira vez.
- Clicar numa conta na lista troca qual está em foco (mostra só ela).
- **⊞ Ver juntas** (trilha de ícones à esquerda) — mostra as 4 contas ao
  mesmo tempo, numa grade 2×2, tipo câmeras — dá pra acompanhar todas sem
  precisar alternar conta.
- **Barra de ferramentas** (voltar/avançar/recarregar/URL/zoom) em cima da
  área do jogo, agindo sobre a conta ativa — desativada no modo grade.
- **Iniciar com o sistema** — abre o app sozinho junto com o login do
  Windows, se ligado (rodapé da barra lateral).
- Fechar uma conta (× ao passar o mouse) remove aquela conta da janela (não
  desloga a conta no servidor, só fecha a sessão local — abrir de novo pede
  login de novo, porque a partição junto foi removida).
- Nome de cada conta é editável (clique no texto) — só cosmético, fica
  salvo localmente.
- A lista de contas (nome + id + data de criação, **nunca** login/senha)
  fica salva localmente entre uma sessão e outra do app — ao reabrir, as
  mesmas contas aparecem (login continua valendo, guardado pela própria
  sessão isolada do Electron).
- Navegação de cada webview travada no domínio do Huntera, e popups
  bloqueados — cuidado básico de segurança por rodar conteúdo de terceiro
  dentro do app.

- **Automação #1 (desde a v0.2.0, controlada pelo menu lateral desde a
  v0.4.0)** — sair da caçada quando a capacidade encher, vender na cidade,
  voltar pra mesma caçada. Roda sozinha dentro de CADA conta; o botão **⚡**
  ao lado do nome de cada conta na barra lateral abre o painel de controle
  (caçada/tier/limiar/log/liga-desliga) — nada fica sobreposto na tela do
  jogo. Config e log ficam salvos por conta (isolados automaticamente pela
  partição do webview); o host só reflete esse estado via IPC.
- **Verificador de stamina (v0.5.0)** — cada personagem tem até 12h de
  stamina, que só esgota caçando; o jogo tira o personagem sozinho da
  caçada quando ela zera. O monitor detecta isso, espera a stamina
  regenerar até um limiar configurável ("Voltar a caçar com stamina ≥ (min)"
  no mesmo painel da Automação #1) e só então volta a entrar na caçada
  sozinho — sem isso, o bot tentava re-entrar a cada poucos segundos com a
  stamina ainda zerada. Diferente da extensão Chrome (que TROCA pra outro
  personagem quando a stamina zera): aqui não precisa trocar, já que as 4
  contas ficam logadas ao mesmo tempo — cada uma só espera a própria
  stamina voltar.

**O que NÃO tem ainda**: expedição da guild com fraqueza elemental,
painéis de estatísticas tipo "Analisador de caçada" do HunteraFarm
original, e a coordenação entre contas via Party (PT) — líder manda
convite, todas aceitam/entram na mesma caçada, e saem/vendem/retornam
juntas quando a líder sai (em investigação/design, ver CHANGELOG e o
histórico do projeto).

## Como rodar (modo desenvolvimento)

Precisa de [Node.js](https://nodejs.org) instalado (18+) no Windows.

```
cd huntera-multiconta
npm install
npm start
```

Isso abre a janela do app direto (sem instalar nada no sistema) — bom pra
testar mudanças rápido.

## Como gerar o instalador (.exe)

```
npm run dist
```

Gera o instalador (NSIS) e uma versão portátil (.zip) na pasta `dist/`, via
[electron-builder](https://www.electron.build/). O instalador é "one-click"
(sem assistente, sem pedir permissão de administrador — instala só pro
usuário atual) pra ficar o mais fácil possível pra quem só quer abrir e
usar. **Não é assinado digitalmente** (assinatura de código custa
dinheiro/burocracia — fora de escopo pra um projeto de aprendizado): o
Windows vai mostrar o aviso "O Windows protegeu o computador" na primeira
vez que alguém rodar o instalador. É clicar em "Mais informações" → "Executar
assim mesmo" — normal pra instaladores não assinados, não é sinal de vírus.

## Distribuir e manter atualizado (v0.6.0)

Desde a v0.6.0 o app tem atualização automática de verdade
([`electron-updater`](https://www.electron.build/auto-update)), pra não
precisar ficar reenviando o instalador toda vez que alguma coisa mudar:

1. **Repositório no GitHub** (público, uma vez só): cria um repo público
   chamado `huntera-multiconta` na sua conta e sobe o código:
   ```
   git init
   git add .
   git commit -m "Huntera Multiconta v0.6.0"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO-GITHUB/huntera-multiconta.git
   git push -u origin main
   ```
   Troca `SEU-USUARIO-GITHUB` (aqui e em `package.json` → `build.publish.owner`)
   pelo seu usuário de verdade antes de publicar.
2. **Token pra publicar releases** (uma vez só): cria um [Personal Access
   Token](https://github.com/settings/tokens) no GitHub com permissão
   `repo` (ou, num token "fine-grained", `Contents: Read and write` no
   repositório). **Nunca commita esse token no código** — guarda só como
   variável de ambiente na sua máquina:
   ```
   $env:GH_TOKEN = "ghp_xxx..."
   ```
   (isso vale só pra sessão atual do PowerShell — repete toda vez que abrir
   um terminal novo pra publicar, ou salva permanente com
   `[Environment]::SetEnvironmentVariable("GH_TOKEN", "ghp_xxx...", "User")`.)
3. **Publicar uma versão nova** (toda vez que quiser mandar uma atualização
   pro seu amigo): sobe a versão em `package.json`, e roda:
   ```
   npm run publish
   ```
   Isso gera o instalador E sobe ele pro GitHub Releases junto com os
   metadados que o app usa pra saber que tem versão nova.
4. **Do lado do seu amigo**: ele baixa e roda o instalador **uma vez só**
   (pega o `.exe` mais recente na aba "Releases" do repositório). Depois
   disso o próprio app confere sozinho se tem versão nova (na abertura, e
   depois a cada 4h enquanto fica aberto), baixa em segundo plano, e
   pergunta se quer reiniciar agora pra aplicar — sem reiniciar sozinho no
   meio de uma automação rodando. Se ele nunca clicar em "Reiniciar
   agora", a atualização entra sozinha da próxima vez que ele fechar o
   app.

## Estrutura

- `main.js` — processo principal do Electron: cria a janela, trava
  navegação/popups dos webviews por segurança, guarda/lê a lista de abas em
  disco (`app.getPath("userData")/tabs.json`) via IPC, e liga/desliga
  "iniciar com o sistema" (`app.setLoginItemSettings`).
- `preload.js` — ponte segura (contextBridge) entre o renderer e o
  `main.js` — expõe só `loadTabs`/`saveTabs`/`getGameUrl`/
  `getAutomationPreloadPath`/`getAutoLaunch`/`setAutoLaunch`, nada mais.
- `renderer/` — a interface: `index.html` (trilha de ícones + barra
  lateral de contas + barra de ferramentas + área dos webviews),
  `renderer.js` (toda a lógica de contas/partições/grade/zoom/navegação),
  `styles.css`.
- `automation/content-injected.js` — a Automação #1, anexada em cada
  `<webview>` via o atributo `preload` (`main.js` expõe o caminho via IPC,
  `renderer.js` aplica em cada webview criado). Roda isolado por conta,
  sem depender de nada do app host além do próprio localStorage da página.

## Decisões técnicas (pra quem for mexer depois)

- **`<webview>` em vez de `BrowserView`/`WebContentsView`**: o time do
  Electron recomenda evitar `<webview>` (documentação oficial chama de
  "legado"), mas ele é declarativo — vive direto no DOM, dá pra posicionar
  com CSS Grid (é assim que o modo "Ver juntas" funciona, de graça). Pra um
  app pequeno de aprendizado, isso pesou mais que a recomendação oficial.
  `BrowserView` exigiria calcular e atualizar manualmente a posição/tamanho
  de cada view via JS no processo principal toda vez que a janela
  redimensiona — mais controle, mais código. Se o projeto crescer e isso
  virar problema de verdade (segurança, performance), vale reconsiderar.
- **Partição fixada na criação do webview**: o Electron só lê o atributo
  `partition` na hora em que o elemento `<webview>` é inserido no DOM —
  mudar o atributo depois não tem efeito. Por isso `renderer.js` nunca
  recria um webview já existente, só esconde/mostra via CSS.
- **Throttling de webview em segundo plano — resolvido (v0.4.2 + v0.4.4)**:
  o Chromium reduz bastante a atividade (timers, prioridade de processo,
  janela coberta por outra) de conteúdo não visível, o que derrubava a
  conexão do jogo com o app minimizado ou coberto (o heartbeat/ping do jogo
  atrasava até o servidor entender que o cliente sumiu). Resolvido em duas
  partes: `contents.setBackgroundThrottling(false)` por webview (v0.4.2,
  cobre timers) + três switches de linha de comando do processo inteiro,
  `app.commandLine.appendSwitch(...)` com `disable-renderer-backgrounding`,
  `disable-backgrounding-occluded-windows` e
  `disable-background-timer-throttling` (v0.4.4, cobre prioridade de
  processo e janela coberta — o v0.4.2 sozinho não bastava pro cenário
  "outra janela por cima"). Trade-off: mais CPU com o app minimizado, já
  que as 4 contas continuam ativas de verdade em vez de pausar.
- Sem framework de UI (React, etc.) de propósito — poucos elementos,
  DOM puro é suficiente e mais fácil de acompanhar linha a linha.

## Histórico

Projeto criado em 27/08/2026, depois de investigar como o HunteraFarm
(app de terceiro, descontinuado) funcionava — confirmado via GitHub que era
Electron + electron-builder pro Windows, com sessões isoladas por conta.
Essa v0.1.0 é uma reescrita do zero da mesma ideia central (partições
isoladas por webview), sem copiar código nenhum do projeto original.
