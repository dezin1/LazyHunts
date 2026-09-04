// main.js — processo principal do Electron.
//
// Cria a janela única do app e serve o HTML/JS da pasta renderer/, que é
// quem monta a barra de abas e os <webview> (um por conta). A ideia central
// do app inteiro é essa: cada <webview> recebe uma PARTIÇÃO própria
// (partition="persist:conta-N"), e o Electron isola cookies/localStorage/
// sessionStorage/IndexedDB por partição — é isso, e só isso, que permite N
// contas do Huntera logadas ao mesmo tempo sem uma derrubar a sessão da
// outra. (Contraste com a extensão Chrome: lá, todas as abas do mesmo
// navegador compartilham o mesmo armazenamento por origem — por isso só dava
// pra ter UMA conta logada por vez nesse ambiente. Aqui cada webview é, na
// prática, um "perfil" isolado à parte, mesmo rodando dentro do mesmo app.)
//
// O processo principal (este arquivo) é o único lugar com acesso a Node.js
// de verdade (fs, IPC) — o renderer.js roda em contexto isolado, sem acesso
// direto a nada disso; ele fala com este arquivo só através do preload.js
// (contextBridge) + IPC. É o padrão de segurança recomendado pelo próprio
// Electron.

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { pathToFileURL } = require("url");
// v0.6.0 — atualização automática (ver `setupAutoUpdater` mais abaixo).
const { autoUpdater } = require("electron-updater");

// v0.3.1 tentou usar `force-device-scale-factor` (linha de comando) pra
// deixar o zoom reduzido mais nítido. REVERTIDO: esse switch é GLOBAL —
// afeta TODOS os processos de renderização do app, incluindo a nossa
// própria interface (sidebar/barra de ferramentas), não só o jogo dentro
// dos webviews. Ele muda quantos pixels CSS cabem na janela, então tudo
// refluiu maior/mais grosseiro em vez de só ficar mais nítido no mesmo
// tamanho — confirmado ao vivo pelo André que piorou bem mais do que
// ajudou ("ficou enorme"). v0.3.2 troca pra uma versão ESCOPADA só ao
// webview de cada conta (ver `web-contents-created` abaixo) — mesma ideia
// de "desenhar com mais pixels e reduzir depois", mas sem tocar na nossa
// UI. Ajuste esta constante se precisar mais nitidez (mais pesado em
// CPU/GPU/RAM com as 4 contas abertas) ou menos.
// v0.4.5 — André reportou RAM alta com as 4 contas abertas. Desligado (1 =
// sem override, sem custo extra) a pedido dele: supersampling em 1.5x
// significa cada webview desenhar com 2.25x mais pixels reais (1.5²) por
// trás, o que infla os framebuffers de GPU/composição — pesa mais ainda no
// modo "Ver juntas" (as 4 renderizando ao mesmo tempo). Some com isso o
// custo natural de manter as 4 contas sempre 100% ativas (v0.4.2/v0.4.4,
// pra não desconectar) — aquele fix por si só já significa mais memória
// residente que o Chromium normalmente liberaria de contas em segundo
// plano. Setar de volta pra ~1.3-1.5 se a nitidez fizer falta e RAM não
// for mais o problema principal.
const RENDER_SUPERSAMPLE = 1;

const TABS_FILE = path.join(app.getPath("userData"), "tabs.json");
const GAME_URL = "https://huntera.com.br/game";
const GAME_ORIGIN = "https://huntera.com.br";

// v0.4.4 — André reportou de novo (mesmas palavras de antes, quase): "ao
// minimizar ou outra tela por cima, perde a conexão". A v0.4.2 já tinha
// desligado o throttling de TIMERS (`setBackgroundThrottling(false)`) em
// cada <webview>, mas isso ataca só uma camada do problema. O Chromium tem
// outras duas camadas de "modo economia" que agem em conjunto quando a
// janela não está visível (minimizada OU coberta por outra janela):
// 1. Rebaixa a PRIORIDADE DO PROCESSO do renderer em segundo plano
//    (`--disable-renderer-backgrounding` desliga isso).
// 2. Trata janela COBERTA por outra (mas não minimizada — "occluded") como
//    se estivesse em segundo plano, mesmo com o app "ativo" pro usuário
//    (`--disable-backgrounding-occluded-windows` desliga isso — é
//    provavelmente o motivo do "outra tela por cima" continuar acontecendo
//    mesmo com o fix da v0.4.2, que só cobria timers).
// Esses dois só podem ser ligados via linha de comando do processo
// (`app.commandLine`), ANTES do app ficar pronto — não tem equivalente por
// webContents individual como o `setBackgroundThrottling`. Mantém o
// `--disable-background-timer-throttling` também (reforça a mesma proteção
// da v0.4.2 a nível de processo, não só de webContents) — juntos, os três
// cobrem timer, prioridade de processo, e occlusion de janela.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");

let mainWindow = null;

// Guarda só rótulo + id de cada aba (ex: "Conta 1") — NUNCA credenciais. O
// login de cada conta fica todo dentro da própria partição isolada do
// Electron (cookies do jogo), gerenciado pelo Chromium embutido, não por nós.
async function loadTabs() {
  try {
    const raw = await fs.readFile(TABS_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data.tabs) && data.tabs.length) {
      // v0.3.0 passou a mostrar "conectado há X" na barra lateral, lido de
      // tab.createdAt — abas salvas por uma versão anterior do app não têm
      // esse campo ainda, então preenche na hora de carregar (não some
      // nada, só evita a etiqueta de tempo ficar em branco).
      return data.tabs.map((t) => ({ createdAt: Date.now(), ...t }));
    }
  } catch (err) {
    // primeira vez rodando (arquivo não existe ainda) ou JSON corrompido —
    // começa do zero com uma aba só, sem travar o app por causa disso.
  }
  return [{ id: "conta-1", label: "Conta 1", createdAt: Date.now() }];
}

async function saveTabs(tabs) {
  await fs.writeFile(TABS_FILE, JSON.stringify({ tabs }, null, 2), "utf-8");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Huntera Multiconta",
    backgroundColor: "#14161d",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Desligado por padrão no Electron desde a v5 — precisa ligar
      // explicitamente pra poder usar a tag <webview> no renderer.
      webviewTag: true,
      // v0.4.2 — sem isso, o Chromium reduz MUITO a frequência dos timers
      // (setTimeout/setInterval/requestAnimationFrame) da nossa própria UI
      // assim que a janela é minimizada ou perde o foco. Não é o principal
      // causador da desconexão do jogo (isso é por webview, ver abaixo),
      // mas evita a barra lateral (relógio de "conectado há X", etc.)
      // congelar enquanto o app está minimizado.
      backgroundThrottling: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// Segurança: cada <webview> carrega o SITE DE VERDADE do Huntera, que é
// conteúdo de terceiro rodando dentro do nosso app. Trava dois
// comportamentos perigosos que a página do jogo (ou qualquer script nela)
// poderia tentar: abrir janelas novas sem controle nenhum (setWindowOpenHandler
// nega tudo) e navegar pra fora do domínio do Huntera (will-navigate barra
// qualquer URL que não comece com https://huntera.com.br). Isso roda pra
// TODO webview criado no app, não importa qual conta/partição.
app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith(GAME_ORIGIN)) event.preventDefault();
  });

  // v0.4.2 — ESSE é o ajuste que resolve a desconexão quando o app fica
  // minimizado/em segundo plano. Por padrão, o Chromium trata cada
  // <webview> como uma "aba em background" sempre que a janela do app não
  // está visível (minimizada, ou coberta por outra janela) — e reduz bem
  // agressivamente a frequência de setTimeout/setInterval/rAF de QUALQUER
  // processo nessa condição, mesmo sendo 4 processos de webview
  // independentes. É esse throttling que faz o heartbeat/ping do jogo (que
  // roda inteiramente dentro do processo de cada webview, não no nosso)
  // parar de disparar no tempo certo — daí o servidor entende que o
  // cliente sumiu e derruba a conexão. `setBackgroundThrottling(false)`
  // desliga esse throttling especificamente pra esse webview, então o jogo
  // continua rodando (e conectado) em tempo real mesmo com a janela
  // minimizada ou em outra aba do Windows. Custo: um pouco mais de CPU
  // enquanto minimizado (os 4 clientes continuam ativos de verdade, não
  // pausados) — é o trade-off inerente a "quero elas sempre ativas".
  try {
    contents.setBackgroundThrottling(false);
  } catch (err) {
    // Electron mais antigo sem esse método — a conta segue funcionando,
    // só sem essa proteção específica.
  }
  // v0.4.4 — essa proteção aqui é só a CAMADA de timers do webview. Ver os
  // `app.commandLine.appendSwitch(...)` no topo do arquivo pras outras duas
  // camadas (prioridade de processo + occlusion de janela) que faltavam
  // pro cenário "outra tela por cima" continuar desconectando mesmo com
  // isso aqui já ligado.

  // v0.3.2 — nitidez em zoom reduzido, mas SÓ dentro do jogo, sem mexer na
  // nossa interface (sidebar/barra de ferramentas continuam do tamanho
  // normal). Em vez do `force-device-scale-factor` da v0.3.1 (que afetava
  // o app inteiro, incluindo a nossa UI — foi isso que ficou enorme),
  // usamos o protocolo do DevTools (CDP) direto NESSE webview pra emular
  // uma tela de densidade mais alta só pra ele: `deviceScaleFactor` maior
  // faz o Chromium desenhar o jogo com mais pixels de verdade por trás,
  // sem mudar quantos "pixels lógicos" cabem na tela (`width`/`height`: 0 =
  // não sobrescreve as dimensões, só a densidade). Combinado com o zoom
  // reduzido que já aplicamos via `webview.setZoomFactor()` (modo grade ou
  // zoom manual), o resultado é a interface do jogo ficando menor E nítida
  // — o "joguinho de resolução" que o André pediu.
  // v0.4.5 — com RENDER_SUPERSAMPLE = 1 (desligado), nem anexa o debugger:
  // attach de CDP por webview tem custo próprio (memória da sessão de
  // debug, mais um canal aberto por conta) que não vale a pena pagar só
  // pra mandar um override que não muda nada (`deviceScaleFactor: 1` é o
  // padrão). Só ativa esse bloco todo se a constante for maior que 1.
  if (RENDER_SUPERSAMPLE > 1) {
    try {
      if (!contents.debugger.isAttached()) {
        contents.debugger.attach("1.3");
        contents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
          width: 0,
          height: 0,
          deviceScaleFactor: RENDER_SUPERSAMPLE,
          mobile: false,
        });
      }
    } catch (err) {
      // se essa versão do Electron não suportar, ou o attach falhar por
      // qualquer motivo, a conta continua funcionando normal — só sem esse
      // ganho de nitidez. Nunca trava o app por causa disso.
    }
  }
});

ipcMain.handle("tabs:load", () => loadTabs());
ipcMain.handle("tabs:save", (_event, tabs) => saveTabs(tabs));
ipcMain.handle("game:url", () => GAME_URL);
// Caminho do script de automação (v0.2.0 — Automação #1) que cada <webview>
// carrega via seu atributo "preload". Precisa ser uma URL file:// de
// verdade — um caminho de sistema de arquivos puro não funciona aqui.
ipcMain.handle("automation:preloadPath", () =>
  pathToFileURL(path.join(__dirname, "automation", "content-injected.js")).toString()
);

// "Iniciar com o sistema" (v0.3.0) — liga/desliga o app abrir sozinho junto
// com o login do Windows. `app.setLoginItemSettings` é a API nativa do
// Electron pra isso (mexe no Registro do Windows / Login Items do macOS por
// baixo dos panos); em algumas distros Linux não tem efeito nenhum (a API
// simplesmente não faz nada lá) — por isso os dois handlers ficam num
// try/catch, pra nunca travar o app por causa de uma plataforma que não
// suporta.
ipcMain.handle("app:getAutoLaunch", () => {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
});
ipcMain.handle("app:setAutoLaunch", (_event, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return true;
  } catch {
    return false;
  }
});

// ---------- atualização automática (v0.6.0) ----------
//
// André queria compartilhar o app com um amigo sem precisar ficar mandando
// o instalador toda vez que mudar algo. Solução: `electron-updater`, que lê
// a lista de releases de um repositório público no GitHub (configurado em
// `package.json` → `build.publish`) e, achando uma versão mais nova que a
// instalada, baixa e instala sozinho.
//
// Fluxo de quem PUBLICA (o André): `npm run publish` gera o instalador E
// sobe ele pro GitHub Releases junto com os metadados que o updater lê
// (precisa de `GH_TOKEN` no ambiente — um Personal Access Token do GitHub,
// nunca comitado no repo). Fluxo de quem RECEBE (o amigo): não faz nada —
// o app checa sozinho, baixa em segundo plano, e só pergunta na hora de
// reiniciar (nunca troca a versão embaixo do usuário sem avisar, pra não
// interromper uma automação rodando no meio de uma caçada).
function setupAutoUpdater() {
  // Fora de um app empacotado (`npm start` direto do código-fonte,
  // ambiente de desenvolvimento) não tem instalador nenhum pra atualizar —
  // o updater já detecta isso sozinho e não faz nada, mas evita até logar
  // à toa.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    // Rede fora do ar, GitHub inacessível, etc. — nunca trava o app por
    // causa disso, só loga pra investigar se virar padrão.
    console.log(`[AutoUpdater] Erro checando atualização: ${err && err.message}`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    // Não reinicia sozinho: o personagem pode estar no meio de uma caçada
    // em alguma das 4 contas. Pergunta, com "Depois" como padrão seguro —
    // `autoInstallOnAppQuit` já garante que instala na próxima vez que o
    // usuário fechar o app de qualquer forma, mesmo se ele nunca clicar em
    // "Reiniciar agora".
    if (!mainWindow) return;
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Atualização pronta",
        message: `Huntera Multiconta ${info.version} baixado.`,
        detail:
          "Reiniciar agora pra atualizar? Se preferir, o app atualiza sozinho na próxima vez que for fechado.",
        buttons: ["Reiniciar agora", "Depois"],
        defaultId: 1,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  // Checa uma vez pouco depois de abrir (dá tempo da janela montar) e
  // depois a cada 4h — o app costuma ficar aberto rodando as automações
  // por muito tempo seguido, então não basta checar só na abertura.
  const AUTO_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), AUTO_UPDATE_CHECK_INTERVAL_MS);
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
