# Changelog

## 0.6.0 — 2026-09-04

- **Atualização automática + instalador mais fácil de compartilhar.** André quer compartilhar o app com um amigo "de um modo mais profissional" — sem precisar reenviar o instalador toda vez que algo mudar. Perguntei visibilidade do repo (público, pra update sem fricção) e tipo de update (automático de verdade) — confirmou os dois.
  - Adicionado `electron-updater`. `main.js` ganhou `setupAutoUpdater()`: checa uma vez ~10s depois de abrir e depois a cada 4h, baixa em segundo plano, e SÓ pergunta (nunca força) se quer reiniciar pra aplicar quando termina de baixar — pensado especificamente pra não interromper uma automação rodando em alguma das 4 contas no meio de uma caçada. `autoInstallOnAppQuit = true` garante que aplica sozinho da próxima vez que o app fechar, mesmo se a pessoa nunca responder ao aviso. Só roda em build empacotada (`app.isPackaged`) — não faz nada em `npm start` de desenvolvimento.
  - `package.json` → `build.publish` configurado pro GitHub (provider `github`, `owner`/`repo` — André precisa trocar o owner placeholder pelo usuário real dele antes de publicar). Novo script `npm run publish` (`electron-builder --publish always`) gera o instalador E já sobe pro GitHub Releases, desde que a variável de ambiente `GH_TOKEN` (Personal Access Token dele, nunca commitado) esteja setada.
  - `build.nsis` ganhou `oneClick: true` + `perMachine: false`: instalador vira um clique só, sem assistente, sem pedir permissão de administrador (instala só pro usuário atual) — mais fácil pro amigo dele rodar, e evita prompt de UAC quebrar a atualização silenciosa depois.
  - Documentado no README o fluxo completo: criar o repo público, gerar um token, publicar (`npm run publish`), e o que o amigo precisa fazer (baixar o instalador manualmente só a PRIMEIRA vez — depois disso o app se atualiza sozinho).
  - Sem confirmação ao vivo ainda — depende do André criar o repo de verdade, trocar o placeholder do owner, gerar o token e rodar `npm run publish` pela primeira vez.

## 0.5.0 — 2026-09-04

- **Verificador de stamina — feature nova.** André: "como acabar a stamina o personagem sai da caçada. quero que você cria um verificador de stamina, quando bater X stamina ele volta a rodar novamente". Perguntei se era pro `huntera-automacao` (que já tem a Automação #2 — TROCA de personagem quando a stamina zera) ou pro `huntera-multiconta`; ele confirmou multiconta, onde faz mais sentido (as 4 contas já ficam logadas ao mesmo tempo, não precisa trocar — só esperar a própria stamina regenerar). Implementado em `automation/content-injected.js`:
  - Novo seletor `staminaClock` (`.hud-stamina-clock`) e `parseStaminaClock`/`getStaminaRemainingMinutes` — mesma lógica já confirmada ao vivo na extensão Chrome (`huntera-automacao/content.js`), formato "H:MMh" → minutos restantes.
  - Novo campo de config `staminaResumeThreshold` (minutos, default 60), configurável no mesmo painel da Automação #1 ("Voltar a caçar com stamina ≥ (min)").
  - `monitorTick()`: quando detecta que o personagem não está caçando, agora checa a stamina ANTES de tentar re-entrar — se estiver abaixo do limiar, só loga (throttled, no máximo 1x a cada 5min, pra não floodar) e espera o próximo tick, em vez de tentar entrar de novo a cada 4s com a stamina ainda zerada (mesma classe de bug já resolvida no Auto Bestiary da extensão Chrome, v0.17.5 — "entra e sai" sem sentido).
  - `startBot()`: mesma checagem ao ligar manualmente — se já estiver sem stamina no momento, não força a entrada, só liga o monitor e deixa ele esperar sozinho.
  - Painel lateral mostra a stamina atual ao lado do status ("· stamina 1h05") enquanto a automação está ligada.
  - Sem confirmação ao vivo ainda — depende do André religar a extensão/app e ver o comportamento numa conta que realmente zere a stamina.

## 0.4.5 — 2026-09-04

- **Desligado o supersampling (`RENDER_SUPERSAMPLE`) pra economizar RAM.** André reportou RAM alta com as 4 contas abertas. Levantei que o supersampling 1.5x (v0.3.2, nitidez em zoom reduzido) faz cada webview desenhar com 2.25x mais pixels reais por trás (1.5²) o tempo todo — pesa mais ainda no modo "Ver juntas" (as 4 renderizando ao mesmo tempo) — e que isso soma com o custo natural de manter as 4 contas sempre 100% ativas (v0.4.2/v0.4.4, pra não desconectar), que por si só já significa mais memória residente do que o Chromium liberaria normalmente de contas em segundo plano. Perguntei o que ele preferia (reduzir nitidez geral / só manter nítida a conta ativa / deixar como está) — escolheu reduzir bastante. `RENDER_SUPERSAMPLE` foi pra `1` (sem override — valor padrão do Chromium, sem custo extra), e o bloco que anexa o debugger (CDP) por webview agora só roda se a constante for `> 1`, pra não pagar nem o custo da sessão de debug à toa. Constante continua ajustável em `main.js` se a nitidez fizer falta depois. Sem confirmação ao vivo do quanto isso reduz a RAM na prática.

## 0.4.4 — 2026-09-04

- **Reforçado o fix de desconexão ao minimizar/cobrir janela (v0.4.2 não bastou sozinho).** André reportou de novo, quase com as mesmas palavras de antes: "o multi client ao minimizar ou outra tela por cima, perde a conexão". Ele confirmou que já estava rodando a build com o fix da v0.4.2 (`setBackgroundThrottling(false)` por webview) e mesmo assim continuava desconectando. Causa: aquele fix só desliga uma camada (throttling de timers por `webContents`) — o Chromium tem outras duas camadas independentes de "modo economia" quando a janela não está visível:
  1. Rebaixa a prioridade do processo do renderer em segundo plano.
  2. Trata uma janela COBERTA por outra (mesmo sem estar minimizada — "occluded") como se estivesse em segundo plano.

  Essas duas só têm equivalente via linha de comando do processo inteiro (`app.commandLine.appendSwitch`), não por webContents individual. Adicionado no topo do `main.js`, antes do app ficar pronto:
  - `--disable-renderer-backgrounding`
  - `--disable-backgrounding-occluded-windows`
  - `--disable-background-timer-throttling` (reforça a mesma proteção da v0.4.2, agora também a nível de processo)

  Junto com o `setBackgroundThrottling(false)` já existente, isso cobre as três camadas (timer, prioridade de processo, occlusion de janela). Ainda sem confirmação ao vivo — depende do André rodar `npm install`/gerar build nova e testar minimizando e cobrindo a janela com outra.

## 0.4.3 — 2026-08-31

- **Botão de automação migrou pro iconRail.** André mandou print apontando
  bem específico pra "a barrinha onde você altera a visualização de multi
  janela" — ou seja, a trilha estreita de ícones à esquerda (`#iconRail`),
  onde já morava só o botão de grade ⊞. Adicionado um botão 🤖 ali do lado,
  mesmo estilo/comportamento do ⊞ (acende em âmbar quando ligado): clicar
  nele abre o painel de automação (o mesmo painel dedicado da v0.4.1) pra
  conta que estiver ativa no momento, e clicar de novo fecha. O ⚡ de cada
  linha da lista continua funcionando como atalho (abre a automação já
  naquela conta específica, sem precisar trocar de conta ativa antes) — os
  dois caminhos levam ao mesmo painel, só mudam o ponto de entrada.

## 0.4.2 — 2026-08-31

- **Corrigido: contas desconectando do jogo quando o app fica minimizado.**
  André reportou: "quando o multi client não fica em tela cheia, eu perco a
  conexão com os clientes e eles desconectam do jogo". Causa: por padrão o
  Chromium trata todo `<webview>` como "processo em segundo plano" sempre
  que a janela do app não está visível (minimizada ou coberta), e reduz
  bastante a frequência de timers (`setTimeout`/`setInterval`/rAF) nesse
  estado — inclusive dentro do processo de cada webview, que é onde o jogo
  roda de verdade. É esse throttling que atrasa o heartbeat/ping do jogo o
  suficiente pro servidor entender que o cliente sumiu e derrubar a conexão.
  Ajuste: `contents.setBackgroundThrottling(false)` em cada webview (feito
  no processo principal, `main.js`, dentro do `web-contents-created` já
  existente — reforçado também via o atributo `webpreferences` no
  `<webview>` do lado do renderer, como segunda camada). Com isso os 4
  clientes continuam rodando em tempo real mesmo com o app minimizado ou em
  segundo plano no Windows — trade-off: um pouco mais de CPU nesse estado,
  já que as contas não "pausam" mais.

## 0.4.1 — 2026-08-31

- **Painel de automação virou uma tela dedicada.** Na v0.4.0 o botão ⚡
  expandia um painel DENTRO da própria linha da conta — André reportou
  ("horrível onde você deixou o bot") que isso empurrava as outras contas
  pra baixo e ficava espremido. Agora clicar no ⚡ de uma conta troca o
  CONTEÚDO do menu lateral inteiro: a lista de contas some, entra um
  painel só daquela conta (avatar grande, status, caçada/tier/limiar, log)
  ocupando toda a largura/altura disponível, com um "‹ Contas" no topo pra
  voltar. Cabeçalho (nome do app) e rodapé ("Iniciar com o sistema"/
  "Recarregar todas") continuam sempre visíveis — só a área do meio troca.
  Mesma ponte IPC da v0.4.0 por trás (`hm:state`/`hm:command`), só a
  organização visual mudou.
- Cada conta na lista continua com o ⚡ mostrando de relance se a
  automação está ligada (acende âmbar), mesmo sem abrir o painel dela.

## 0.4.0 — 2026-08-31

- **Automação controlada pelo menu lateral, não mais dentro da tela do
  jogo.** André pediu pra tirar a automação de dentro da interface do
  Huntera — o painel flutuante (pill "Automação" arrastável) foi removido.
  No lugar, cada conta na barra lateral agora tem um botão **⚡** que abre
  um painel expansível ali mesmo (status, caçada, tier, limiar de
  capacidade, log e o botão de ligar/desligar), na coluna do app, nunca
  sobreposto ao jogo.
  - **Como isso foi feito** (fica registrado porque é a base pra próximas
    features cross-conta, tipo a coordenação de Party): a lógica da
    automação continua rodando isolada dentro do `<webview>` de cada conta
    (`automation/content-injected.js`), mas agora ela conversa com o host
    (`renderer.js`) por **IPC do próprio Electron** — a conta manda o
    estado dela (`ipcRenderer.sendToHost("hm:state", ...)`) toda vez que
    algo muda, e o host manda comandos pra ela (`webview.send("hm:command",
    ...)`) quando o André mexe nos controles. Escolhido em vez de
    `webview.executeJavaScript()` (ficaria fazendo polling) — IPC é
    orientado a evento, mais leve e é o canal oficial recomendado pelo
    Electron pra comunicação host↔webview.
  - Config (caçada/tier/limiar) continua salva no `localStorage` da própria
    conta (isolado pela partição) — o host só reflete/edita esse estado,
    não duplica onde a verdade mora.
  - Sem mudança nenhuma na lógica de automação em si (ciclo sair/vender/
    voltar, monitor de capacidade) — só migrou de onde a interface dela
    aparece.

## 0.3.2 — 2026-08-31

- **Corrigida a regressão da v0.3.1** — André confirmou ao vivo que o
  `force-device-scale-factor` deixou o app inteiro "enorme", não só mais
  nítido. Causa: esse switch é global (linha de comando do Chromium) — não
  dá pra escopar só pros webviews, ele muda quantos pixels CSS cabem na
  janela pra TODOS os processos de renderização, inclusive a nossa própria
  interface (sidebar/barra de ferramentas), que refluiu maior/mais
  grosseira.
- **Nova versão do mesmo truque, agora escopada só ao jogo**: cada
  `<webview>` recebe uma emulação de tela de densidade mais alta só pra
  ELE, via protocolo do DevTools (`webContents.debugger` +
  `Emulation.setDeviceMetricsOverride`, com `deviceScaleFactor:
  RENDER_SUPERSAMPLE` e `width`/`height: 0` — não sobrescreve as
  dimensões, só a densidade). A nossa interface (HTML puro, fora dos
  webviews) nunca é tocada por isso, continua sempre no tamanho normal.
  Combinado com o zoom reduzido que já era aplicado via
  `webview.setZoomFactor()` (modo grade ou zoom manual), o resultado é a
  interface do JOGO ficando menor e nítida ao mesmo tempo — sem afetar o
  resto do app. `RENDER_SUPERSAMPLE` continua em `main.js`, mesmo trade-off
  de sempre (mais nítido = mais pesado em CPU/GPU com as 4 contas abertas).

## 0.3.1 — 2026-08-31

- **Qualidade de renderização em zoom reduzido.** André notou que no app de
  referência (Multi Idle Manager) a tela em ~70% de zoom fica nítida,
  diferente do nosso zoom forçado — mesmo já usando zoom de página de
  verdade (`setZoomFactor`, não CSS transform). Causa: sem ajuste extra, o
  Chromium desenha cada webview na mesma densidade de pixels do monitor
  (que em telas comuns, não Retina/4K com escala alta, é relativamente
  baixa) — reduzir o zoom só faz o texto ficar menor com essa mesma
  densidade, então as bordas ficam mais ásperas. Corrigido forçando o app
  inteiro a renderizar numa resolução interna 1.5× mais alta
  (`app.commandLine.appendSwitch("force-device-scale-factor", "1.5")`,
  antes de `app.whenReady()`) e só depois reduzir pra exibir — mesmo
  princípio de uma tela Retina: mais pixels de verdade disponíveis pra
  desenhar fontes/ícones antes de qualquer zoom ser aplicado. Constante
  `RENDER_SUPERSAMPLE` em `main.js`, fácil de subir (mais nítido, mais
  pesado) ou baixar (mais leve, menos nítido) — 4 contas abertas ao mesmo
  tempo custam mais CPU/GPU com isso ligado, então pode precisar ajustar
  dependendo do PC.
- **Zoom liberado no modo grade.** Antes a barra de ferramentas inteira
  (incluindo zoom) travava no modo "Ver juntas". Agora só voltar/avançar/
  recarregar/URL travam (não fazem sentido apontando pra uma conta só com
  as 4 visíveis) — os botões de zoom continuam ativos e passam a ajustar as
  4 contas JUNTAS (um "zoom da grade" único, em vez do valor fixo
  `ZOOM_GRID` do código). Dá pra achar o equilíbrio ideal entre legibilidade
  e ver as 4 contas inteiras direto pela interface, sem editar código.

## 0.3.0 — 2026-08-31

- **Interface reescrita**, inspirada no visual do app "Multi Idle Manager"
  (multidl.online) que o André mostrou em screenshot. A barra de abas
  horizontal virou uma barra lateral estilo gerenciador multi-conta:
  - **Trilha de ícones** à esquerda com o botão **⊞ Ver juntas** (antes era
    um botão de texto no topo).
  - **Barra lateral** com cabeçalho (nome do app + botão "+" de adicionar
    conta), uma seção **"HUNTERA"** (colapsável, clique no cabeçalho)
    listando as contas — cada uma com avatar colorido (inicial do nome),
    bolinha de status (acende quando a página do jogo termina de carregar
    pela primeira vez), domínio (`huntera.com.br`) e **tempo desde que a
    conta foi criada** (`Xh Ym`, `Xd Yh`, etc — calculado a partir de
    quando a aba foi adicionada, persistido em `tabs.json`).
  - Rodapé da barra lateral com **"Iniciar com o sistema"** (liga/desliga
    de verdade via `app.setLoginItemSettings` do Electron — abre o app
    sozinho junto com o login do Windows) e **"Recarregar todas"**.
  - **Barra de ferramentas** em cima da área do jogo, estilo navegador:
    voltar/avançar/recarregar (agem na conta ativa), campo de URL
    (mostra a URL atual da conta ativa ao vivo; dá pra digitar e navegar —
    a trava de domínio do Huntera em `main.js` continua valendo, então só
    funciona pra dentro do próprio jogo) e controles de **zoom manual**
    (−/100%/+, por conta, sobrepõe o zoom automático normal/grade; clicar
    no "100%" volta ao zoom automático). Fica desativada no modo grade
    (não faz sentido apontar pra uma conta só com as 4 na tela ao mesmo
    tempo).
  - Sem "Trial" nem contador de plano (o app original tem porque é um
    produto pago — o nosso não é nada disso) — no lugar, um selo simples
    mostrando quantas contas estão abertas (`N/4 contas`).
  - **Nada da lógica muda**: mesma partição isolada por conta, mesma
    Automação #1 injetada em cada webview, mesmo modo "Ver juntas" (grade
    2×2 com zoom real via `setZoomFactor`).

## 0.2.2 — 2026-08-27

- **Automação #1 confirmada funcionando ao vivo pelo André** — ciclo
  completo (sair/vender/voltar) rodou de verdade numa conta.
- **Painel agora é arrastável.** O canto superior direito padrão colide com
  os ícones do próprio HUD do jogo em algumas telas (não dá pra prever um
  canto sempre livre). Agora é só clicar e arrastar a pill "Automação" pra
  qualquer lugar da tela — a posição fica salva por conta (localStorage,
  igual o resto da config) e volta pro mesmo lugar da próxima vez que
  aquela conta carregar. Um clique normal (sem arrastar) continua
  abrindo/fechando o painel como antes — só vira "arrastar" se o mouse
  realmente se mover mais que uns pixels.

## 0.2.1 — 2026-08-27

- **Corrigido: "erro ao carregar" na lista de caçadas logo ao abrir uma
  conta.** Causa: o painel injeta e já tenta ler a lista de caçadas quase
  assim que a página começa a carregar — bem antes de a SPA em Angular do
  jogo terminar de montar a barra de navegação (ou até antes do login
  acontecer, se a conta ainda não estava logada), então o botão que abre o
  seletor de caçadas ainda não existia. `ensureHuntWindowOpen()` agora
  espera de verdade até 20s pelo botão aparecer, em vez de checar só uma
  vez — cobre tanto "ainda carregando" quanto "acabou de logar agora".
- Adicionado um botão **↻** ao lado do rótulo "Caçada" no painel, pra
  tentar de novo manualmente (útil se a conta simplesmente ainda não
  estava logada quando o painel carregou pela primeira vez — não precisa
  recarregar a aba inteira).
- Mensagem de erro mais clara: "— faça login e clique em ↻ —" em vez de
  "— erro ao carregar —".

## 0.2.0 — 2026-08-27

- **Automação #1 portada pra dentro do app** (sair da caçada quando a
  capacidade encher, vender na cidade, voltar pra mesma caçada) — mesma
  lógica já validada em `huntera-automacao/content.js`, adaptada pra rodar
  sozinha dentro de cada webview isolado, sem depender de popup nenhum:
  - Anexada via o atributo `preload` de cada `<webview>`
    (`automation/content-injected.js`) — roda automaticamente assim que
    cada conta carrega o jogo, continua rodando através de trocas de rota
    internas do jogo (personagem → cidade → caçada, etc, tudo client-side,
    sem recarregar a página de verdade).
  - Configuração (caçada/tier/limiar de capacidade) e log ficam no
    `localStorage` da PRÓPRIA página — já isolado por conta automaticamente
    graças à partição do webview, sem precisar de nenhum mecanismo de
    isolamento extra.
  - Painel flutuante injetado direto na tela do jogo (canto superior
    direito) — uma pill com bolinha de status que expande pra mostrar
    caçada/tier/limiar (lidos ao vivo do jogo, igual os dropdowns da
    extensão), botão Ligar/Desligar e um log dos últimos eventos.
  - Se a automação estava ligada quando o app é fechado e reaberto, religa
    sozinha (lê o `running` salvo no localStorage daquela conta).
- Ainda SEM troca de personagem por stamina, expedição da guild ou
  fraqueza elemental (automações #2/#3 da extensão) — ficam pra uma
  próxima versão, depois de validar essa base rodando de verdade.

## 0.1.1 — 2026-08-27

- **Zoom no modo grade.** André reportou: no "Ver juntas", o jogo fica com
  a UI pequena/cortada demais pra ler (o Huntera não é responsivo pra caber
  numa célula de 1/4 da tela). Corrigido aplicando zoom de página de
  verdade em cada webview (`webview.setZoomFactor()`, não CSS transform) —
  50% no modo grade, volta a 100% no modo de uma conta só. Zoom de verdade
  faz o navegador REFLUIR o layout (texto/ícones ficam legíveis, não só
  "encolhidos"), diferente de um `transform: scale()` que só reduziria os
  pixels já renderizados. Reaplica o zoom certo toda vez que um webview
  termina de carregar (login, troca de personagem, etc. não resetam o
  zoom sozinhos). `ZOOM_GRID` em `renderer.js` é fácil de ajustar se ainda
  precisar de mais ou menos zoom.

## 0.1.0 — 2026-08-27

Primeira versão do projeto. Reescrita do zero, inspirada no HunteraFarm
(app de terceiro pra Windows, descontinuado) depois de investigar como ele
funcionava (confirmado via GitHub: Electron + electron-builder).

- App Electron com janela única e barra de abas — uma aba por conta do
  Huntera, até 4.
- Cada aba é um `<webview>` com partição própria (`persist:conta-N`) — é
  isso que dá isolamento real de cookies/localStorage por conta, permitindo
  várias contas logadas ao mesmo tempo sem uma derrubar a sessão da outra.
- Botão **+ Nova conta** (até 4), fechar aba (remove a sessão local daquela
  conta), nome de aba editável.
- Botão **⊞ Ver juntas** — grade 2×2 mostrando as 4 contas ao mesmo tempo.
- Lista de abas (nome + id, nunca credenciais) persistida em
  `app.getPath("userData")/tabs.json`, lida/escrita via IPC
  (`main.js` ↔ `preload.js` ↔ `renderer.js`).
- Navegação de cada webview travada no domínio do Huntera
  (`will-navigate`) e popups bloqueados (`setWindowOpenHandler`) — cuidado
  de segurança básico por rodar conteúdo de terceiro dentro do app.
- Sem automação nenhuma ainda (fica pra v0.2.0, portando a lógica já
  validada em `huntera-automacao/`) e sem painéis de estatísticas (tipo
  "Analisador de caçada" do HunteraFarm original).
