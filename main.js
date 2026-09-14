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

const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { pathToFileURL } = require("url");
const crypto = require("crypto");
const os = require("os");
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
const TELEGRAM_FILE = path.join(app.getPath("userData"), "telegram.json");
// v0.9.16 — André: "a lista de caçadas completas já salva na máquina do
// usuário. toda vez que eu abro o tamanho do pull vem vazio e deveria vir já
// a lista completinha." O catálogo (nomes das caçadas + tamanhos de pull de
// cada uma) é do JOGO, não da conta — os mesmos tiers valem pra qualquer
// personagem. Por isso mora aqui, num arquivo só, compartilhado pelas 4
// contas: basta UMA conta mapear pra todas terem a lista pronta, e sobrevive
// a limpar a partição de uma conta ou reinstalar o app.
const HUNT_CATALOG_FILE = path.join(app.getPath("userData"), "hunt-catalog.json");
// v0.9.23 — histórico do analyzer próprio, por DIA e por personagem. Mesmo
// padrão do catálogo: arquivo único em userData, compartilhado pelas contas.
// Guarda só o que a automação já observa (gold vendido, XP, ciclos, tempo) —
// nada vindo do analisador premium do jogo.
const STATS_FILE = path.join(app.getPath("userData"), "stats.json");
const GAME_URL = "https://huntera.com.br/game";
const GAME_ORIGIN = "https://huntera.com.br";
// v0.11.0 — sessão de login do Swag (conta do PRODUTO, não do jogo — nada
// a ver com as 4 contas do Huntera nos webviews). Guardada separada do resto,
// criptografada com `safeStorage` (chaveiro do SO) quando disponível.
const SWAG_SESSION_FILE = path.join(app.getPath("userData"), "swag-session.bin");
// device_id não é segredo (não precisa do safeStorage) — só identifica ESTA
// instalação pra licença saber se é "o mesmo PC de sempre" ou um diferente.
const SWAG_DEVICE_ID_FILE = path.join(app.getPath("userData"), "swag-device-id.txt");
async function swagGetDeviceId() {
  try {
    const existing = (await fs.readFile(SWAG_DEVICE_ID_FILE, "utf-8")).trim();
    if (existing) return existing;
  } catch (err) {
    // ainda não existe — gera abaixo
  }
  const id = crypto.randomUUID();
  await fs.writeFile(SWAG_DEVICE_ID_FILE, id, "utf-8").catch(() => {});
  return id;
}

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

// v0.7.0 — Notificações no Telegram, portadas do huntera-automacao
// (background.js). Lá era chrome.storage.local; aqui é um arquivo JSON
// próprio (telegram.json), mesmo padrão do tabs.json — config global, uma
// só pro app inteiro (todas as 4 contas mandam notificação pro mesmo
// bot/chat), não por conta.
// v0.11.10 — detector de spawn seco. Config GLOBAL (pedido do André: "talvez
// uma configuração global aqui para esse cara") — o comportamento é do jogo,
// não da conta: personagem forte limpa o spawn mais rápido do que ele nasce e
// fica dando voltas sem matar. Mesmo arquivo-único de userData que o telegram
// e o catálogo de caçadas usam.
const SPAWN_FILE = path.join(app.getPath("userData"), "spawn.json");
const DEFAULT_SPAWN = {
  enabled: false,
  // Piso em segundos: abaixo disso nunca dispara, pra não confundir intervalo
  // normal entre pulls com spawn esgotado.
  minSeconds: 90,
  // Quantas vezes o intervalo TÍPICO de spawn daquela caçada/personagem antes
  // de considerar seco. O limiar real é max(minSeconds, tipico * factor).
  factor: 4,
};

const DEFAULT_TELEGRAM = {
  enabled: false,
  botToken: "",
  chatId: "",
  notifyAll: false, // false = só erros; true = todo evento do log
};

async function loadHuntCatalog() {
  try {
    const raw = await fs.readFile(HUNT_CATALOG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      names: Array.isArray(parsed.names) ? parsed.names : [],
      tiersByHunt: parsed.tiersByHunt && typeof parsed.tiersByHunt === "object" ? parsed.tiersByHunt : {},
      updatedAt: parsed.updatedAt || null,
    };
  } catch (err) {
    return { names: [], tiersByHunt: {}, updatedAt: null };
  }
}

// Mescla em vez de sobrescrever: uma conta pode ter mapeado só parte do
// catálogo (varredura interrompida, caçada que falhou a leitura), e o que já
// estava salvo não deve ser perdido por causa disso.
async function saveHuntCatalog(patch) {
  const current = await loadHuntCatalog();
  const names = Array.isArray(patch && patch.names) && patch.names.length ? patch.names : current.names;
  const tiersByHunt = { ...current.tiersByHunt };
  for (const [hunt, tiers] of Object.entries((patch && patch.tiersByHunt) || {})) {
    if (Array.isArray(tiers) && tiers.length) tiersByHunt[hunt] = tiers;
  }
  const merged = { names, tiersByHunt, updatedAt: Date.now() };
  await fs.writeFile(HUNT_CATALOG_FILE, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

async function loadStats() {
  try {
    const raw = await fs.readFile(STATS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.dias === "object" ? { dias: parsed.dias } : { dias: {} };
  } catch (err) {
    return { dias: {} };
  }
}

// Recebe DELTAS já calculados pelo renderer (ver `flushStatsDeltas`) e soma no
// balde do dia. Somar delta em vez de total é o que evita contar duas vezes
// quando a mesma sessão reporta o acumulado de novo.
async function addStats(dia, personagem, delta) {
  const atual = await loadStats();
  const dias = atual.dias || {};
  const doDia = dias[dia] || {};
  const anterior = doDia[personagem] || { gold: 0, xp: 0, cycles: 0, ms: 0 };
  doDia[personagem] = {
    gold: anterior.gold + (Number(delta.gold) || 0),
    xp: anterior.xp + (Number(delta.xp) || 0),
    cycles: anterior.cycles + (Number(delta.cycles) || 0),
    ms: anterior.ms + (Number(delta.ms) || 0),
  };
  dias[dia] = doDia;
  // Mantém os últimos 30 dias — o suficiente pra comparar rendimento sem o
  // arquivo crescer pra sempre.
  const chaves = Object.keys(dias).sort();
  while (chaves.length > 30) delete dias[chaves.shift()];
  const merged = { dias };
  await fs.writeFile(STATS_FILE, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

async function loadTelegramConfig() {
  try {
    const raw = await fs.readFile(TELEGRAM_FILE, "utf-8");
    return { ...DEFAULT_TELEGRAM, ...JSON.parse(raw) };
  } catch (err) {
    return { ...DEFAULT_TELEGRAM };
  }
}

async function loadSpawnConfig() {
  try {
    const raw = await fs.readFile(SPAWN_FILE, "utf-8");
    return { ...DEFAULT_SPAWN, ...JSON.parse(raw) };
  } catch (err) {
    return { ...DEFAULT_SPAWN };
  }
}

async function saveSpawnConfig(cfg) {
  const merged = { ...DEFAULT_SPAWN, ...(cfg || {}) };
  await fs.writeFile(SPAWN_FILE, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

async function saveTelegramConfig(cfg) {
  const merged = { ...DEFAULT_TELEGRAM, ...(cfg || {}) };
  await fs.writeFile(TELEGRAM_FILE, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

// Feito aqui no processo principal (não no content-injected.js de cada
// webview) pelo mesmo motivo do background.js na extensão: um fetch() de
// dentro do preload de um <webview> corre sob a CSP da própria página do
// jogo, que pode bloquear a chamada pra api.telegram.org silenciosamente. O
// processo principal não tem CSP nenhuma — usa o fetch global do Node
// (Electron 32 já embute Node 20+, tem fetch nativo, não precisa de lib
// extra).
async function sendTelegramMessage(text, { ignoreEnabled = false, cfgOverride = null } = {}) {
  const cfg = cfgOverride ? { ...DEFAULT_TELEGRAM, ...cfgOverride } : await loadTelegramConfig();
  if (!ignoreEnabled && !cfg.enabled) {
    return { ok: false, error: "Notificações do Telegram estão desligadas." };
  }
  if (!cfg.botToken || !cfg.chatId) {
    return { ok: false, error: "Token do bot ou Chat ID não configurados." };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      // resposta não veio como JSON — segue com data = null, tratado abaixo
    }
    if (!res.ok || !data || !data.ok) {
      const desc = (data && data.description) || `HTTP ${res.status}`;
      return { ok: false, error: desc };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "Falha de rede ao chamar a API do Telegram." };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Swag",
    // v0.8.0 — ícone da janela/taskbar com a nova identidade visual (leão).
    // O instalador/exe usa `build.icon` no package.json (build/icon.ico,
    // gerado a partir da mesma imagem-fonte); esse aqui é o ícone da janela
    // em tempo de execução — precisa dos dois, um não substitui o outro.
    icon: path.join(__dirname, "renderer", "assets", "app-icon.png"),
    backgroundColor: "#12140f",
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

// v0.6.1 — André reportou: "quando o usuário tenta logar pelo Google, não
// abre a página do Google". Causa raiz: o bloqueio de segurança abaixo
// (desde o começo do projeto) barra QUALQUER popup e QUALQUER navegação pra
// fora de huntera.com.br sem exceção nenhuma — e "Entrar com o Google" do
// Huntera precisa abrir/navegar pra accounts.google.com pra funcionar. Nunca
// tinha sido testado com login do Google até agora. Fix: permite
// especificamente o domínio de autenticação do Google (accounts.google.com
// e subdomínios dele), continua bloqueando qualquer outro popup/navegação
// de fora do jogo — a superfície de ataque que a trava original queria
// evitar continua coberta pra tudo que não seja o próprio fluxo de login.
function isGoogleAuthUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:") return false;
    return hostname === "accounts.google.com" || hostname.endsWith(".accounts.google.com");
  } catch (err) {
    return false;
  }
}

// Segurança: cada <webview> carrega o SITE DE VERDADE do Huntera, que é
// conteúdo de terceiro rodando dentro do nosso app. Trava dois
// comportamentos perigosos que a página do jogo (ou qualquer script nela)
// poderia tentar: abrir janelas novas sem controle nenhum (setWindowOpenHandler
// nega tudo, EXCETO o popup de login do Google — v0.6.1) e navegar pra fora
// do domínio do Huntera (will-navigate barra qualquer URL que não comece com
// https://huntera.com.br OU não seja o domínio de login do Google — v0.6.1).
// Isso roda pra TODO webview criado no app, não importa qual conta/partição.
app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;
  contents.setWindowOpenHandler(({ url }) => {
    // "allow" aqui faz o Electron abrir uma janela nativa separada pra esse
    // popup — como esse popup NÃO é um <webview> nosso, ele nunca passa
    // pelas travas deste mesmo listener (só reage a contents.getType() ===
    // "webview"), então o fluxo de login do Google roda livre dentro dele,
    // sem herdar nenhuma restrição daqui.
    if (isGoogleAuthUrl(url)) return { action: "allow" };
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith(GAME_ORIGIN) && !isGoogleAuthUrl(url)) event.preventDefault();
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

// ---------- v0.11.0 — login e "dias de uso" (Swag) ----------
//
// André decidiu transformar a automação num produto pago (login + doação +
// dias de uso, ver `huntera-mobile-dashboard` na memória do projeto). Esta
// entrega trava o PRODUTO INTEIRO (extensão E multiconta) sem uma conta
// Swag com dias válidos — decisão já tomada antes de codar, não é
// suposição desta entrega.
//
// Backend: Supabase (mesmo projeto do schema já aplicado). Login por
// email/senha via GoTrue (`/auth/v1/token`), leitura de `entitlements` via
// PostgREST com RLS (`auth.uid() = user_id` — só dá pra ler a própria linha).
// A ANON KEY abaixo é PÚBLICA de propósito — é o par da `service_role`, feita
// pra ir em cliente distribuído; NUNCA colocar a `service_role` aqui (ela
// ignora RLS e teria que ficar só em Edge Function, nunca num app instalável).
const SWAG_SUPABASE_URL = "https://cjbslqmvipgirzctjrsl.supabase.co";
const SWAG_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqYnNscW12aXBnaXJ6Y3RqcnNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMzEyMDEsImV4cCI6MjEwNDYwNzIwMX0.3jSTtMpHpUePr6MaZACMYzsi5LLNMj0bLDCoKpscNcQ";

// Estado em memória — `boot()` de cada webview lê isso via
// `ipcRenderer.invoke("swag:getStatus")` (mesmo caminho que já usam pra
// `telegram:notify`/`stats:add`), sem nenhuma chamada de rede saindo do
// preload do webview (ficaria sujeita à CSP da página do jogo — mesmo motivo
// de o Telegram já passar por aqui). O host (renderer.js) escuta
// `swag:statusChanged` pra desenhar a tela de login/bloqueio.
let swagSession = null; // { access_token, refresh_token, expiresAt (epoch ms), userId, email }
let swagLicense = { licensed: false, accessUntil: null, email: null, reason: "not_logged_in" };
let swagLicenseTimer = null;
let swagLastLicensedAt = 0;
// Tolerância só pra FALHA DE REDE (Supabase inalcançável) — nunca pra acesso
// que já venceu de verdade. Sem isso, uma instabilidade de internet do André
// travaria a automação sem culpa nenhuma dele.
const SWAG_OFFLINE_GRACE_MS = 48 * 60 * 60 * 1000;

async function swagSaveSession() {
  try {
    if (!swagSession) {
      await fs.unlink(SWAG_SESSION_FILE).catch(() => {});
      return;
    }
    const json = JSON.stringify(swagSession);
    const buf = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json)
      : Buffer.from(json, "utf-8");
    await fs.writeFile(SWAG_SESSION_FILE, buf);
  } catch (err) {
    // Não é motivo pra travar login — só significa que vai pedir de novo
    // na próxima abertura do app.
  }
}
async function swagLoadSession() {
  try {
    const buf = await fs.readFile(SWAG_SESSION_FILE);
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString("utf-8");
    swagSession = JSON.parse(json);
  } catch (err) {
    swagSession = null;
  }
}

async function swagAuthLogin(email, password) {
  const res = await fetch(`${SWAG_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SWAG_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || "Não foi possível entrar. Confira o email e a senha.");
  }
  swagSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    userId: data.user && data.user.id,
    email: (data.user && data.user.email) || email,
  };
  await swagSaveSession();
}

async function swagAuthRefreshIfNeeded() {
  if (!swagSession) return false;
  if (Date.now() < swagSession.expiresAt - 120000) return true; // ainda folgado, não precisa
  try {
    const res = await fetch(`${SWAG_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SWAG_SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: swagSession.refresh_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return false;
    swagSession = {
      ...swagSession,
      access_token: data.access_token,
      refresh_token: data.refresh_token || swagSession.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
    await swagSaveSession();
    return true;
  } catch (err) {
    return false;
  }
}

// Chama a função check_and_bind_device no Postgres (SECURITY DEFINER) em vez
// de só ler access_until direto — ela decide licensed/expired/device_locked
// no servidor (o cliente nunca escreve em bound_device_id/device_bound_at
// diretamente, não tem policy de UPDATE pra isso; só essa função, via RPC).
async function swagCheckAndBindDevice() {
  const refreshed = await swagAuthRefreshIfNeeded();
  if (!refreshed) throw new Error("session_expired");
  const deviceId = await swagGetDeviceId();
  const deviceLabel = `Multiconta · ${os.hostname()}`;
  const res = await fetch(`${SWAG_SUPABASE_URL}/rest/v1/rpc/check_and_bind_device`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SWAG_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${swagSession.access_token}`,
    },
    body: JSON.stringify({ p_device_id: deviceId, p_device_label: deviceLabel }),
  });
  if (!res.ok) throw new Error("fetch_failed");
  return res.json();
}

function swagBroadcastStatus() {
  if (mainWindow) mainWindow.webContents.send("swag:statusChanged", swagLicense);
}

async function swagRefreshLicense() {
  if (!swagSession) {
    swagLicense = { licensed: false, accessUntil: null, email: null, reason: "not_logged_in" };
    swagBroadcastStatus();
    return swagLicense;
  }
  try {
    const result = await swagCheckAndBindDevice();
    swagLicense = {
      licensed: !!result.licensed,
      accessUntil: result.access_until || null,
      email: swagSession.email,
      reason: result.licensed ? "ok" : result.reason || "expired",
      deviceUnlocksAt: result.device_unlocks_at || null,
      boundDeviceLabel: result.bound_device_label || null,
    };
    if (swagLicense.licensed) swagLastLicensedAt = Date.now();
  } catch (err) {
    if (err.message === "session_expired") {
      swagSession = null;
      await swagSaveSession();
      swagLicense = { licensed: false, accessUntil: null, email: null, reason: "session_expired" };
    } else {
      // Falha de rede/Supabase fora do ar: mantém o último estado bom por até
      // 48h (ver SWAG_OFFLINE_GRACE_MS) — só isso, nunca estende um acesso
      // que já venceu de verdade.
      const withinGrace = swagLicense.licensed && Date.now() - swagLastLicensedAt < SWAG_OFFLINE_GRACE_MS;
      swagLicense = { ...swagLicense, licensed: withinGrace, reason: withinGrace ? "offline_grace" : "network_error" };
    }
  }
  swagBroadcastStatus();
  return swagLicense;
}

function swagStartLicenseLoop() {
  if (swagLicenseTimer) return;
  swagRefreshLicense();
  // 10 min — frequente o bastante pra refletir uma renovação/expiração sem
  // demora perceptível, barato o bastante pra não pesar em background.
  swagLicenseTimer = setInterval(swagRefreshLicense, 10 * 60 * 1000);
}

// ---------- v0.11.3 — ponte multiconta → painel remoto (Supabase) ----------
//
// Depois do login/dias de uso (v0.11.0) e do limite de dispositivo (v0.11.2),
// faltava a última peça pra fechar o loop com o site (`swag-site`/painel): o
// multiconta nunca escrevia em `devices`/`character_state` nem lia
// `commands` — o painel só mostrava "Nenhum computador conectado ainda."
// Esta entrega fecha isso.
//
// O renderer.js (que já agrega `automationState` de cada webview via
// `hm:state`) empurra um retrato (snapshot) de todas as contas pra este
// processo via `swag:pushState` — este processo é quem realmente fala com o
// Supabase (é aqui que mora `swagSession`/token, o mesmo motivo de o
// Telegram já passar por main.js e não pelo webview de cada conta).
let swagLatestSnapshot = { tabs: [] };
// tabId -> último characterName reportado. Serve só pra saber quando uma
// conta DESLOGOU (characterName voltou a null) e apagar a linha antiga de
// character_state — sem isso, um personagem que saiu do jogo ficaria
// "fantasma" no painel pra sempre (a última leitura fica congelada lá).
const swagKnownCharacterByTab = new Map();
// commandId -> timeout handle, enquanto espera o renderer confirmar que
// executou (ver swag:commandResult mais abaixo).
const swagPendingCommands = new Map();

ipcMain.handle("swag:pushState", (_event, snapshot) => {
  swagLatestSnapshot = snapshot && Array.isArray(snapshot.tabs) ? snapshot : { tabs: [] };
  return { ok: true };
});

async function swagPatchCommand(commandId, patch) {
  if (!swagSession) return;
  try {
    await fetch(`${SWAG_SUPABASE_URL}/rest/v1/commands?id=eq.${commandId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SWAG_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${swagSession.access_token}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
  } catch (err) {
    // melhor esforço — se a rede falhar bem aqui, o comando fica travado em
    // "processing" até o timeout do swagPendingCommands resolver sozinho
    // (ver swagPollCommands), nunca preso pra sempre.
  }
}

// Chamado pelo renderer (via preload) depois de tentar executar um comando
// remoto — ver `onSwagRemoteCommand` no renderer.js.
ipcMain.handle("swag:commandResult", (_event, result = {}) => {
  const { commandId, ok, error } = result;
  if (!commandId) return { ok: false };
  const timer = swagPendingCommands.get(commandId);
  if (timer) {
    clearTimeout(timer);
    swagPendingCommands.delete(commandId);
  }
  swagPatchCommand(commandId, ok ? { status: "done" } : { status: "failed", error_message: error || "Falha desconhecida" });
  return { ok: true };
});

async function swagUpsertDevice(deviceId) {
  await fetch(`${SWAG_SUPABASE_URL}/rest/v1/devices?on_conflict=id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SWAG_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${swagSession.access_token}`,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      id: deviceId,
      user_id: swagSession.userId,
      name: `Multiconta · ${os.hostname()}`,
      app_version: app.getVersion(),
      last_seen_at: new Date().toISOString(),
    }),
  });
}

async function swagUpsertCharacterStates(deviceId) {
  const tabsSnapshot = swagLatestSnapshot.tabs || [];
  const rows = [];
  const toDelete = [];
  for (const t of tabsSnapshot) {
    const prevCharacterName = swagKnownCharacterByTab.get(t.tabId) || null;
    if (t.characterName) {
      swagKnownCharacterByTab.set(t.tabId, t.characterName);
      rows.push({
        device_id: deviceId,
        user_id: swagSession.userId,
        account_label: t.accountLabel || t.characterName,
        character_name: t.characterName,
        vocation: t.vocation || null,
        level: t.level || null,
        stamina_seconds: t.staminaSeconds != null ? Math.max(0, Math.round(t.staminaSeconds)) : null,
        current_hunt: t.currentHunt || null,
        is_hunting: !!t.isHunting,
        // v0.11.4 — huntNames/knownCharacters vão dentro do jsonb (em vez de
        // colunas novas) pro painel montar os dropdowns de "trocar
        // caçada"/"trocar personagem" com as opções REAIS dessa conta.
        automations: {
          running: !!t.running,
          status: t.status || null,
          huntNames: Array.isArray(t.huntNames) ? t.huntNames : [],
          knownCharacters: Array.isArray(t.knownCharacters) ? t.knownCharacters : [],
        },
        updated_at: new Date().toISOString(),
      });
    } else if (prevCharacterName) {
      // Estava logado, agora não está mais (deslogou/saiu do jogo nessa
      // aba) — apaga a linha antiga em vez de deixar um personagem
      // "fantasma" parado no painel pra sempre.
      toDelete.push(prevCharacterName);
      swagKnownCharacterByTab.delete(t.tabId);
    }
  }
  if (rows.length) {
    await fetch(`${SWAG_SUPABASE_URL}/rest/v1/character_state?on_conflict=device_id,character_name`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SWAG_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${swagSession.access_token}`,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
  }
  for (const name of toDelete) {
    await fetch(
      `${SWAG_SUPABASE_URL}/rest/v1/character_state?device_id=eq.${deviceId}&character_name=eq.${encodeURIComponent(name)}`,
      {
        method: "DELETE",
        headers: {
          apikey: SWAG_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${swagSession.access_token}`,
          Prefer: "return=minimal",
        },
      }
    ).catch(() => {});
  }
}

// v0.11.6 — André: "os comandos do site estão muito lentos e alguns nem
// executam como deveriam". O timeout aqui embaixo era um valor único
// (15000ms) pra QUALQUER comando, mas switch_character e go_to_city são
// ações reais no jogo com seus próprios timeouts no renderer.js (30000ms e
// 20000ms — ver switchToCharacterNow/goToCityNow) — MAIORES que os 15000ms
// que este processo esperava. Resultado: o comando era marcado "failed:
// timeout" aqui ANTES do renderer sequer ter chance de confirmar sucesso de
// verdade, mesmo quando a ação no jogo ia terminar bem. Cada tipo de
// comando agora tem seu próprio timeout, sempre maior que o do renderer
// correspondente (nunca dispara antes dele).
const SWAG_COMMAND_TIMEOUT_MS = {
  switch_character: 35000, // renderer: 30000ms
  go_to_city: 25000, // renderer: 20000ms
};
const SWAG_DEFAULT_COMMAND_TIMEOUT_MS = 12000; // pause/resume/change_hunt são instantâneos

// Lê comandos pendentes (criados pelo painel — botão Pausar/Retomar em
// app/painel/page.js do swag-site) e repassa pro renderer executar de
// verdade na aba certa, via a mesma ponte hm:command que o botão local já
// usa (sendAutomationCommand). Nunca fala direto com o webview daqui — quem
// sabe qual tabId corresponde a qual personagem é o renderer (automationState
// mora só lá).
async function swagPollCommands(deviceId) {
  const res = await fetch(
    `${SWAG_SUPABASE_URL}/rest/v1/commands?device_id=eq.${deviceId}&status=eq.pending&select=id,character_name,command_type,payload&order=created_at.asc&limit=20`,
    {
      headers: {
        apikey: SWAG_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${swagSession.access_token}`,
      },
    }
  );
  if (!res.ok) return;
  const pending = await res.json().catch(() => []);
  for (const cmd of pending) {
    if (swagPendingCommands.has(cmd.id)) continue; // já em andamento, não duplica
    await swagPatchCommand(cmd.id, { status: "processing" });
    if (!mainWindow) {
      await swagPatchCommand(cmd.id, { status: "failed", error_message: "app_not_ready" });
      continue;
    }
    mainWindow.webContents.send("swag:remoteCommand", {
      commandId: cmd.id,
      characterName: cmd.character_name,
      commandType: cmd.command_type,
      payload: cmd.payload || {},
    });
    // Se o renderer nunca confirmar (aba fechada bem nesse instante, etc.),
    // não deixa o comando preso em "processing" — o botão do painel ficaria
    // girando pra sempre.
    const timeoutMs = SWAG_COMMAND_TIMEOUT_MS[cmd.command_type] || SWAG_DEFAULT_COMMAND_TIMEOUT_MS;
    const timer = setTimeout(() => {
      swagPendingCommands.delete(cmd.id);
      swagPatchCommand(cmd.id, { status: "failed", error_message: "timeout" });
    }, timeoutMs);
    swagPendingCommands.set(cmd.id, timer);
  }
}

async function swagSyncBridge() {
  if (!swagSession || !swagLicense.licensed) return; // sem conta/licença, nada pra sincronizar
  try {
    const deviceId = await swagGetDeviceId();
    await swagUpsertDevice(deviceId);
    await swagUpsertCharacterStates(deviceId);
    await swagPollCommands(deviceId);
  } catch (err) {
    // Rede instável/Supabase fora do ar — nunca trava nada local; a próxima
    // rodada (20s) tenta de novo.
  }
}

function swagStartBridgeLoop() {
  swagSyncBridge();
  // 20s — rápido o bastante pra o painel parecer "quase ao vivo" sem virar
  // um martelo de requisições sobre o Supabase com o app aberto o dia
  // inteiro (a LEITURA no painel já é instantânea via Realtime — isso aqui
  // só controla de quanto em quanto tempo o multiconta manda uma ESCRITA
  // nova, tipo device/character_state).
  setInterval(swagSyncBridge, 20000);

  // v0.11.6 — André: "os comandos do site estão muito lentos". Comandos
  // remotos (Pausar/Retomar/trocar caçada/trocar personagem/ir pra cidade)
  // vinham só do ciclo de 20s acima — ou seja, até 20s de espera SÓ pra
  // notar que um comando novo chegou, antes mesmo da ação em si começar.
  // Comando é diferente de sincronizar estado: o André está esperando na
  // tela vendo o botão girar, então merece um poll bem mais frequente,
  // separado e barato (só lê `commands` pendentes pro device — mesma
  // query de sempre, sem escrever nada pesado). O dedup por
  // `swagPendingCommands.has(cmd.id)` dentro de swagPollCommands já
  // protege contra os dois loops pegarem o mesmo comando duas vezes.
  setInterval(() => {
    if (!swagSession || !swagLicense.licensed) return;
    swagGetDeviceId()
      .then((deviceId) => swagPollCommands(deviceId))
      .catch(() => {});
  }, 3000);
}

ipcMain.handle("swag:login", async (_event, { email, password } = {}) => {
  try {
    await swagAuthLogin(email, password);
    await swagRefreshLicense();
    return { ok: true, status: swagLicense };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle("swag:logout", async () => {
  swagSession = null;
  await swagSaveSession();
  swagLicense = { licensed: false, accessUntil: null, email: null, reason: "not_logged_in" };
  swagBroadcastStatus();
  return { ok: true };
});
ipcMain.handle("swag:getStatus", () => swagLicense);
ipcMain.handle("swag:refreshStatus", () => swagRefreshLicense());

// v0.11.7 — André: "poderia ter um redirecionador na tela de login para o
// site onde cria conta". A janela principal não tem `setWindowOpenHandler`
// liberado pra abrir nada (só os <webview> do jogo têm essa trava — ver
// comentário grande sobre isso mais acima), então um <a target="_blank">
// puro na tela de login não abriria nada sozinho. Handler dedicado + URL
// fixa aqui (não vem do renderer) — mesma lógica de superfície mínima do
// resto da ponte IPC: o processo principal decide pra onde vai, o renderer
// só pede.
const SWAG_SIGNUP_URL = "https://swag-site-andr-pinheiro-schulzs-projects.vercel.app/cadastrar";
ipcMain.handle("swag:openSignupPage", () => {
  shell.openExternal(SWAG_SIGNUP_URL);
});

ipcMain.handle("tabs:load", () => loadTabs());
ipcMain.handle("tabs:save", (_event, tabs) => saveTabs(tabs));
ipcMain.handle("game:url", () => GAME_URL);

// v0.7.0 — telegram:notify é chamado pelo content-injected.js de CADA uma
// das 4 contas (via ipcRenderer.invoke direto do preload do webview — isso
// chega aqui sem passar pelo renderer.js host, o canal de IPC de um webview
// preload fala com o processo principal igual o preload da janela
// principal fala). Fire-and-forget do lado de quem chama; aqui devolve o
// resultado mesmo assim, só que ninguém é obrigado a esperar por ele.
ipcMain.handle("stats:load", () => loadStats());
ipcMain.handle("stats:add", (_event, { dia, personagem, delta } = {}) =>
  addStats(dia, personagem, delta || {})
);
ipcMain.handle("huntCatalog:load", () => loadHuntCatalog());
ipcMain.handle("huntCatalog:save", (_event, patch) => saveHuntCatalog(patch));
// v0.11.10 — lido tanto pelo renderer (tela de Configurações) quanto pelo
// preload de cada <webview> (a automação consulta de tempos em tempos, mesmo
// padrão do `swag:getStatus`).
ipcMain.handle("spawn:load", () => loadSpawnConfig());
ipcMain.handle("spawn:save", (_event, cfg) => saveSpawnConfig(cfg));
ipcMain.handle("telegram:load", () => loadTelegramConfig());
ipcMain.handle("telegram:save", (_event, cfg) => saveTelegramConfig(cfg));
// Por padrão só ERROS viram notificação (pra não spammar o celular do André
// a cada ciclo de venda normal) — "notifyAll" na config manda todo evento do
// log, igual a extensão Chrome. Essa decisão (SE manda) mora aqui, não em
// content-injected.js, porque já precisa carregar a config do disco mesmo
// assim.
ipcMain.handle("telegram:notify", async (_event, { message, isError, characterName } = {}) => {
  const cfg = await loadTelegramConfig();
  if (!cfg.enabled) return { ok: false, error: "Notificações do Telegram estão desligadas." };
  if (!isError && !cfg.notifyAll) return { ok: false, error: "Evento não-erro e 'notificar todo evento' está desligado." };
  const name = characterName || "?";
  const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const prefix = isError ? "⚠️" : "🏹";
  const text = `${prefix} Swag — ${name} (${time})\n${message || ""}`;
  return sendTelegramMessage(text, { cfgOverride: cfg });
});
// Ignora o toggle "Ativar notificações" de propósito (igual o background.js
// da extensão): o teste serve justamente pra confirmar token/Chat ID ANTES
// de ligar de vez, e usa os valores que estão nos campos da tela NA HORA
// (cfgOverride), não os já salvos — assim dá pra testar antes de clicar em
// salvar.
ipcMain.handle("telegram:test", (_event, cfgOverride) =>
  sendTelegramMessage("🧪 Swag: notificação de teste. Deu certo!", {
    ignoreEnabled: true,
    cfgOverride,
  })
);
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
ipcMain.handle("app:getVersion", () => app.getVersion());
// v0.7.3 — botão manual de checar atualização (⬇️, rodapé da trilha de
// ícones). `checkForUpdatesManually()` mora perto de `setupAutoUpdater()`
// mais abaixo no arquivo (mesmo assunto).
ipcMain.handle("app:checkForUpdates", () => checkForUpdatesManually());

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
        message: `Swag ${info.version} baixado.`,
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

// v0.7.3 — André pediu um botão manual de checar atualização, além da
// checagem automática silenciosa (10s depois de abrir + a cada 4h, ver
// acima) — pra não precisar esperar até 4h se ele SOUBER que acabou de
// publicar uma versão nova. `autoUpdater.checkForUpdates()` sozinho não
// devolve "achei"/"não achei" de forma direta pro chamador — só dispara
// eventos (`update-available`/`update-not-available`/`error`) — então essa
// função ouve os 3 UMA VEZ e resolve a Promise com o primeiro que disparar,
// pra devolver uma resposta clara pro clique do usuário (o painel de
// Configurações mostra o resultado).
function checkForUpdatesManually() {
  return new Promise((resolve) => {
    if (!app.isPackaged) {
      resolve({ ok: false, message: "Checagem de atualização só funciona na versão instalada (não em modo de desenvolvimento)." });
      return;
    }
    let settled = false;
    const onAvailable = (info) => settle({ ok: true, message: `Atualização ${info.version} encontrada — baixando em segundo plano...` });
    const onNotAvailable = () => settle({ ok: true, message: "Você já está na versão mais recente." });
    const onError = (err) => settle({ ok: false, message: (err && err.message) || "Erro ao checar atualização." });
    function settle(result) {
      if (settled) return;
      settled = true;
      autoUpdater.removeListener("update-available", onAvailable);
      autoUpdater.removeListener("update-not-available", onNotAvailable);
      autoUpdater.removeListener("error", onError);
      resolve(result);
    }
    autoUpdater.once("update-available", onAvailable);
    autoUpdater.once("update-not-available", onNotAvailable);
    autoUpdater.once("error", onError);
    autoUpdater.checkForUpdates().catch((err) => settle({ ok: false, message: (err && err.message) || "Erro ao checar atualização." }));
    // Se nenhum evento disparar por qualquer motivo (rede muito lenta,
    // GitHub sem responder), não deixa o botão travado "checando..." pra
    // sempre.
    setTimeout(() => settle({ ok: false, message: "Tempo esgotado checando atualização — tente de novo em instantes." }), 20000);
  });
}

// v0.7.2 — André: "tem uns botões em cima, file, edit, view e etc... eles
// não servem para nada. tira por favor". É a barra de menu NATIVA que o
// Electron cria sozinho por padrão em toda BrowserWindow, a menos que a
// gente diga explicitamente que não quer nenhuma — o app nunca usou nada
// dela (nenhum atalho custom foi registrado nela até hoje). `null` remove a
// barra inteira (diferente de `autoHideMenuBar`, que só esconde e ainda
// reaparece com Alt) — precisa ser chamado ANTES de criar qualquer janela.
Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  createWindow();
  setupAutoUpdater();
  await swagLoadSession();
  swagStartLicenseLoop();
  swagStartBridgeLoop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
