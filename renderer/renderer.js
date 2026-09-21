// renderer.js — barra lateral de contas (estilo "gerenciador multi-conta",
// inspirado no visual do Multi Idle Manager / multidl.online que o André
// mostrou) + os <webview> de cada uma.
//
// A peça central continua sendo a partição de cada webview: partition=
// "persist:<id-da-aba>". O Electron trata cada valor de partição diferente
// como um "perfil" separado de armazenamento (cookies, localStorage,
// sessionStorage, IndexedDB) — é a mesma ideia de perfis separados do
// Chrome, só que dentro de um app só. Por isso dá pra logar até 4 contas
// diferentes do Huntera ao mesmo tempo sem uma derrubar a sessão da outra.
//
// v0.3.0: reescrita da interface (trilha de ícones + barra lateral com
// avatar/status/tempo por conta + barra de ferramentas tipo navegador com
// URL/zoom/voltar/avançar) — a LÓGICA de isolamento por partição e a
// automação injetada em cada webview (automation/content-injected.js) não
// mudam nada aqui, só a casca visual em volta.

const MAX_TABS = 4;
// O jogo não é responsivo pra caber numa célula de 1/4 da tela — no modo
// grade, sem isso, a UI fica pequena/cortada demais pra ler. Zoom de página
// de verdade (não CSS transform) faz o Chromium REFLUIR o layout, então
// texto/ícones ficam legíveis em vez de só "encolhidos" com corte de
// conteúdo. 1.0 = tamanho normal (modo de uma conta só); ajuste
// ZOOM_GRID se ainda estiver pequeno/grande demais depois de testar.
const ZOOM_NORMAL = 1.0;
const ZOOM_GRID = 0.5;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;

// Paleta de cores dos avatares — só pra dar variedade visual entre contas,
// escolhida a partir de um hash simples do id da aba (mesma conta sempre
// cai na mesma cor, sem precisar guardar nada extra).
const AVATAR_COLORS = ["#e0ac4c", "#5fb0e8", "#7ad19a", "#c98be0", "#e88b6a", "#6ad1c9"];

const appEl = document.getElementById("app");
const railEl = document.getElementById("iconRail");
const sidebarEl = document.getElementById("sidebar");
const tabsEl = document.getElementById("tabs");
const containerEl = document.getElementById("webviewContainer");
const mainAreaEl = document.getElementById("mainArea");
const addTabBtn = document.getElementById("addTabBtn");
const railPinBtn = document.getElementById("railPinBtn");
const railAccountsEl = document.getElementById("railAccounts");
const railAccountsDivider = document.getElementById("railAccountsDivider");
const railGridBtn = document.getElementById("railGridBtn");
const railAutomationBtn = document.getElementById("railAutomationBtn");
const groupHeaderToggle = document.getElementById("groupHeaderToggle");
const groupCountEl = document.getElementById("groupCount");
const sidebarFooterReloadBtn = document.getElementById("reloadAllBtn");
const autoLaunchToggle = document.getElementById("autoLaunchToggle");

const accountsGroupEl = document.getElementById("accountsGroup");
const automationPanelEl = document.getElementById("automationPanel");
const automationBackBtn = document.getElementById("automationBackBtn");
const automationAvatarEl = document.getElementById("automationAvatar");
const automationTitleEl = document.getElementById("automationTitle");
const automationDotEl = document.getElementById("automationDot");
const automationStatusTextEl = document.getElementById("automationStatusText");
const automationCyclesEl = document.getElementById("automationCycles");
const automationStaminaEl = document.getElementById("automationStamina");
const automationRefreshBtn = document.getElementById("automationRefreshBtn");
// v0.9.16 — guardado no boot porque o botão troca de conteúdo enquanto a
// varredura roda ("Mapeando 12/55…") e precisa voltar ao normal depois.
const REFRESH_BTN_HTML = automationRefreshBtn.innerHTML;
const automationHuntSelect = document.getElementById("automationHuntSelect");
const automationTierSelect = document.getElementById("automationTierSelect");
const automationCapacityInput = document.getElementById("automationCapacityInput");
const automationStaminaInput = document.getElementById("automationStaminaInput");
const automationAutoSellCityToggle = document.getElementById("automationAutoSellCityToggle");
const automationRotateToggle = document.getElementById("automationRotateToggle");
const automationRotateListEl = document.getElementById("automationRotateList");
// v0.11.8 — aba Treino.
// v0.11.9 — religar depois de queda/server save.
// v0.11.12 — expedição da guild.
const automationExpeditionToggle = document.getElementById("automationExpeditionToggle");
const expedicaoListaEl = document.getElementById("expedicaoLista");
// v0.11.10 — detector de spawn seco (config GLOBAL, não por conta).
const spawnEnabledToggle = document.getElementById("spawnEnabledToggle");
const spawnFieldsEl = document.getElementById("spawnFields");
const spawnMinSecondsInput = document.getElementById("spawnMinSecondsInput");
const spawnFactorInput = document.getElementById("spawnFactorInput");
const automationAutoRestartToggle = document.getElementById("automationAutoRestartToggle");
const automationTrainStaminaToggle = document.getElementById("automationTrainStaminaToggle");
const automationTrainIdleToggle = document.getElementById("automationTrainIdleToggle");
const automationTrainIdleFieldsEl = document.getElementById("automationTrainIdleFields");
const automationTrainIdleInput = document.getElementById("automationTrainIdleInput");
const automationTrainSkillListEl = document.getElementById("automationTrainSkillList");
// Ordem em que o jogo mostra os botões na aba Treino (confirmado ao vivo em
// 12/09/2026). O texto do botão vem com emoji colado, mas o valor guardado é
// só o nome — o content script casa com `includes`.
const TRAIN_SKILLS = [
  "Club Fighting",
  "Sword Fighting",
  "Axe Fighting",
  "Distance Fighting",
  "Shielding",
  "Magic Level",
];
const automationToggleBtn = document.getElementById("automationToggleBtn");
const automationLogEl = document.getElementById("automationLog");

// v0.7.0 — Party (auto-aceitar convite/Friend List, sync Sio+ALVO com o
// Tank, manter alvo atual) — portadas do huntera-automacao (extensão
// Chrome), André confirmou que essas 5 já estão "funcionando de forma
// adequada" lá antes de pedir o porte.
const automationAutoAcceptToggle = document.getElementById("automationAutoAcceptToggle");
const automationAllowlistInput = document.getElementById("automationAllowlistInput");
const automationSyncEkToggle = document.getElementById("automationSyncEkToggle");
const automationKeepTargetToggle = document.getElementById("automationKeepTargetToggle");

// v0.9.6 — auto convidar pra Party (convite de hunt em grupo). Líder é
// marcado manualmente por conta (André confirmou via AskUserQuestion), e o
// auto-convite é um toggle separado do auto-aceite de convites acima.
const automationPartyLeaderToggle = document.getElementById("automationPartyLeaderToggle");
const automationAutoInvitePartyToggle = document.getElementById("automationAutoInvitePartyToggle");
const automationInvitePartyTargetsInput = document.getElementById("automationInvitePartyTargetsInput");

// v0.9.9 — Modo de caçada (Solo/Em grupo), aba Caçada. André: "ligar
// automação não pode estar linkado direto com a caçada solo... devemos ter
// uma funcionalidade caçada solo e caçada em grupo pra funcionar
// independente sem conflitos" — substitui o toggle avulso "Sincronizar
// venda de loot em grupo" da v0.9.8.
const huntModeSegSolo = document.getElementById("huntModeSegSolo");
const huntModeSegGroup = document.getElementById("huntModeSegGroup");
const huntModeHint = document.getElementById("huntModeHint");
const huntModeDetail = document.getElementById("huntModeDetail");
// v0.9.12 — "Iniciar com o time" confirmado ao vivo mandando convite de
// verdade (09/09/2026): o líder agora PODE iniciar a caçada em grupo
// sozinho ("Ligar automação" abre a caçada configurada e manda o convite
// de verdade pro time) — revisa o texto da v0.9.9, que dizia "NUNCA inicia
// sozinha" pra QUALQUER conta em modo grupo. Isso só vale pra quem está
// marcado como líder da party; quem não é líder continua só esperando o
// convite chegar (sem opção de iniciar, o próprio jogo não deixa).
// v0.9.16 — texto longo, mostrado só quando o usuário abre o "?".
function huntModeDetailText(mode, isLeader) {
  if (mode === "solo") {
    return 'Ao ligar, a automação garante que a caçada configurada está ativa, monitora a capacidade, sai pra vender quando bate o limite e volta a caçar sozinha.';
  }
  if (isLeader) {
    return 'Ao ligar, abre a "Caçada"/"Tamanho do pull" escolhidos aqui e clica "Iniciar com o time", mandando o convite de verdade pros personagens da lista "Personagens do time" (aba Party). Depois de sair por capacidade, espera todo o time vender o loot antes de mandar um convite novo.';
  }
  return 'Nunca inicia caçada por conta própria — o jogo só deixa o líder fazer isso. Aceita o convite dele automaticamente, monitora a capacidade depois de já estar caçando e cuida de sair, vender e esperar o próximo convite. "Caçada" e "Tamanho do pull" não têm efeito aqui.';
}

function huntModeHintText(mode, isLeader) {
  // v0.9.16 — resumo de uma linha; o detalhe vive no <details> logo abaixo.
  // Antes esses textos eram parágrafos de 5-8 linhas que ocupavam mais altura
  // que todos os controles da aba somados.
  if (mode === "solo") {
    return "Caça, vende e retoma sozinha, usando as configurações abaixo.";
  }
  if (isLeader) {
    return "Líder: manda o convite de caçada em grupo pro time e sincroniza a venda.";
  }
  return "Membro: espera o convite do líder — nunca inicia caçada sozinha.";
}

// v0.8.0 — auto retomar sessão (porte do huntera-automacao v0.18.0, pedido
// explícito do André confirmado em duas rodadas — ver comentário completo
// em automation/content-injected.js). Mesmo padrão de watcher independente
// do "Ligar automação" das linhas de Party acima.
const automationResumeSessionToggle = document.getElementById("automationResumeSessionToggle");
const automationResumeSessionCharacterSelect = document.getElementById("automationResumeSessionCharacterSelect");
const automationResumeSessionHint = document.getElementById("automationResumeSessionHint");

// Configurações globais (Telegram) — painel próprio, vale pras 4 contas
// juntas em vez de por conta (é um bot/chat só, não faz sentido repetir a
// configuração 4 vezes).
const railCheckUpdateBtn = document.getElementById("railCheckUpdateBtn");
const railSettingsBtn = document.getElementById("railSettingsBtn");
const settingsPanelEl = document.getElementById("settingsPanel");
const botFloatEl = document.getElementById("botFloat");
const botFloatBarEl = document.getElementById("botFloatBar");
const botFloatBodyEl = document.getElementById("botFloatBody");
const botFloatTitleEl = document.getElementById("botFloatTitle");
const botDetachBtn = document.getElementById("botDetachBtn");
const botDockBtn = document.getElementById("botDockBtn");
const settingsBackBtn = document.getElementById("settingsBackBtn");
const telegramEnabledToggle = document.getElementById("telegramEnabledToggle");
const telegramTokenInput = document.getElementById("telegramTokenInput");
const telegramChatIdInput = document.getElementById("telegramChatIdInput");
const telegramNotifyAllToggle = document.getElementById("telegramNotifyAllToggle");
const telegramTestBtn = document.getElementById("telegramTestBtn");
const telegramTestResultEl = document.getElementById("telegramTestResult");

const navReloadBtn = document.getElementById("navReloadBtn");
const railZoomBtn = document.getElementById("railZoomBtn");
const zoomPopover = document.getElementById("zoomPopover");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomLabel = document.getElementById("zoomLabel");
const statusPill = document.getElementById("statusPill");

// v0.11.0 — "dias de uso" (Swag): login + tela de bloqueio.
const swagGateEl = document.getElementById("swagGate");
const swagLoginForm = document.getElementById("swagLoginForm");
const swagEmailInput = document.getElementById("swagEmailInput");
const swagPasswordInput = document.getElementById("swagPasswordInput");
const swagLoginBtn = document.getElementById("swagLoginBtn");
const swagGateSubtitle = document.getElementById("swagGateSubtitle");
const swagGateMessage = document.getElementById("swagGateMessage");
const swagAccountRow = document.getElementById("swagAccountRow");
const swagAccountLabel = document.getElementById("swagAccountLabel");
const swagLogoutBtn = document.getElementById("swagLogoutBtn");
const swagCreateAccountLink = document.getElementById("swagCreateAccountLink");

let tabs = []; // [{ id, label, createdAt }]
let activeTabId = null;
let gridMode = false;
let gameUrl = "https://huntera.com.br/game";
let gameHost = "huntera.com.br";
// v0.2.0: Automação #1 (vender/voltar), anexada em cada webview via
// atributo "preload" — ver automation/content-injected.js.
let automationPreloadPath = "";

// Zoom manual e status de carregamento — só em memória, não precisa
// persistir. `manualZoom` guarda o zoom de cada conta no modo NORMAL (uma
// conta em foco); `gridZoomOverride` é um valor ÚNICO compartilhado pelas 4
// contas quando o modo grade está ligado (ajustar o zoom lá afeta todas de
// uma vez, já que é assim que a grade faz sentido — não daria pra ver 4
// contas em tamanhos diferentes ao mesmo tempo de forma útil).
const manualZoom = new Map(); // tabId -> fator (modo normal)
let gridZoomOverride = null; // fator ou null = usa ZOOM_GRID
const loadedTabs = new Set(); // tabId -> já teve pelo menos 1 dom-ready

// v0.4.0 — automação controlada pelo menu lateral, não mais por um painel
// dentro da tela do jogo. v0.4.1: o painel de automação virou uma tela
// DEDICADA que troca de lugar com a lista de contas (não expande mais
// dentro da linha — André achou horrível, empurrava as outras contas e
// ficava espremido). `automationState` guarda o último estado que CADA
// conta reportou (via IPC — ver ensureWebview()); `guestReady` marca quais
// contas já mandaram pelo menos 1 estado (só depois disso dá pra mandar
// comando pra elas, `webview.send()` antes disso não tem garantia de
// chegar); `selectedAutomationTabId` é a conta cujo painel está aberto no
// momento (null = mostrando a lista de contas normal).
// v0.9.16 — catálogo de caçadas compartilhado (nomes + tamanhos de pull),
// carregado do disco no boot (userData/hunt-catalog.json, ver main.js) e
// mantido em memória aqui. É a fonte que preenche os dois dropdowns na hora,
// antes mesmo de qualquer conta responder — foi o que resolveu o "toda vez
// que eu abro o tamanho do pull vem vazio". Como tiers são do JOGO e não da
// conta, uma varredura só serve pras 4 contas.
let sharedHuntCatalog = { names: [], tiersByHunt: {} };

async function persistSharedCatalog(patch) {
  try {
    sharedHuntCatalog = await window.hunteraFarm.saveHuntCatalog(patch);
  } catch (err) {
    // disco cheio/sem permissão — segue com a cópia em memória
  }
}

// Semeia uma conta com o catálogo do disco, pra ela não precisar remapear.
function seedCatalogInto(tabId) {
  if (!sharedHuntCatalog.names.length && !Object.keys(sharedHuntCatalog.tiersByHunt).length) return;
  sendAutomationCommand(tabId, { type: "seedCatalog", payload: sharedHuntCatalog });
}

const automationState = new Map(); // tabId -> { running, status, huntName, pullLevel, capacityThreshold, staminaResumeThreshold, staminaLeft, cycles, log, huntNames, huntsLoading, tiers, tiersLoading }
const guestReady = new Set();
let selectedAutomationTabId = null;

// v0.11.19 — salva o log do protocolo como .json.
//
// O nome carrega o personagem e o carimbo de tempo porque esses arquivos
// costumam ser comparados entre si depois ("o que mudou entre a conta free e
// a premium?") — e dois arquivos chamados "log.json" não se comparam.
let versaoDoApp = null;
try {
  window.hunteraFarm.getAppVersion().then((v) => { versaoDoApp = v; }).catch(() => {});
} catch (err) {}

function baixarDiagnostico(tab, pacote) {
  if (!pacote) return;
  try {
    // v0.11.28 — a versão vinha de uma constante chumbada no preload que eu
    // esqueci de atualizar: o log do André dizia "0.11.19" rodando outra coisa,
    // e isso atrapalhou o diagnóstico de verdade. Quem sabe a versão real é o
    // renderer, então é ele que carimba.
    if (versaoDoApp) pacote.versao = versaoDoApp;
    const blob = new Blob([JSON.stringify(pacote, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const quem = (pacote.personagem || tab.label || "conta").replace(/[^\w.-]+/g, "-");
    const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `swag-proto-${quem}-${carimbo}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    // Sem download o diagnóstico não se perde: ele continua gravando na conta.
  }
}

async function baixarBaseline(tab, pacote) {
  if (!pacote) return;
  try {
    if (versaoDoApp) pacote.versao = versaoDoApp;
    // A leitura já existente do Electron entra no mesmo artefato para que o
    // baseline de DOM/WS e CPU/RAM seja comparável por conta.
    pacote.cpuRam = await window.hunteraFarm.getPerfMetrics(mapaDeContasParaMedicao()).catch(() => null);
    const blob = new Blob([JSON.stringify(pacote, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const quem = (tab.label || "conta").replace(/[^\w.-]+/g, "-");
    const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `swag-baseline-${quem}-${carimbo}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {}
}

function sendAutomationCommand(tabId, msg) {
  if (!guestReady.has(tabId)) return;
  const wv = getWebview(tabId);
  if (!wv) return;
  try {
    wv.send("hm:command", msg);
  } catch (err) {
    // conta pode ter fechado/recarregado bem nesse instante — não é motivo
    // pra travar o resto da interface.
  }
}

function nextTabId() {
  let n = 1;
  const used = new Set(tabs.map((t) => t.id));
  while (used.has(`conta-${n}`)) n++;
  return `conta-${n}`;
}

function partitionFor(id) {
  return `persist:${id}`;
}

function getWebview(id) {
  return containerEl.querySelector(`webview[data-tab-id="${id}"]`);
}

function avatarColorFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

// Cria o <webview> de uma aba na primeira vez que ela é vista, e nunca mais
// mexe na partição/src depois disso — trocar o valor de "partition" depois
// de o elemento já estar no DOM não tem efeito nenhum no Electron (a
// partição é fixada na criação do webview), então cada aba precisa manter o
// MESMO id (e portanto a mesma partição) pra sempre, do contrário perderia
// o login já feito nela.
function ensureWebview(tab) {
  let wv = getWebview(tab.id);
  if (wv) return wv;
  wv = document.createElement("webview");
  wv.setAttribute("data-tab-id", tab.id);
  wv.setAttribute("partition", partitionFor(tab.id));
  wv.setAttribute("src", gameUrl);
  wv.setAttribute("allowpopups", "false");
  // v0.4.2 — reforça, já na criação do webview, o mesmo ajuste feito no
  // processo principal (main.js, "web-contents-created"): desliga o
  // throttling de timers do Chromium pra esse webview específico, pra o
  // jogo não cair quando o app fica minimizado/em segundo plano.
  wv.setAttribute("webpreferences", "backgroundThrottling=no");
  if (automationPreloadPath) wv.setAttribute("preload", automationPreloadPath);
  // setZoomFactor só funciona depois que o webview terminou de anexar de
  // verdade — chamar antes disso é ignorado silenciosamente. "dom-ready"
  // dispara toda vez que uma página termina de carregar dentro do webview
  // (login, troca de personagem, etc.), então também garante que o zoom
  // não "reseta" sozinho depois de uma navegação interna do jogo.
  wv.addEventListener("dom-ready", () => {
    applyZoom(wv);
    loadedTabs.add(tab.id);
    updateStatusDot(tab.id);
    if (tab.id === activeTabId) updateToolbarState();
  });
  wv.addEventListener("did-navigate", () => {
    if (tab.id === activeTabId) updateToolbarState();
  });
  wv.addEventListener("did-navigate-in-page", () => {
    if (tab.id === activeTabId) updateToolbarState();
  });
  // Ponte de automação (v0.4.0): a conta (automation/content-injected.js)
  // manda o estado dela por "sendToHost" sempre que algo muda (ligou,
  // desligou, log novo, lista de caçadas carregou, etc) — a gente só
  // atualiza o painel daquela linha na hora, sem precisar redesenhar a
  // barra lateral inteira.
  wv.addEventListener("ipc-message", (e) => {
    // v0.11.13 — o preload do webview roda em MUNDO ISOLADO: o
    // `window.WebSocket` e o `TextDecoder.prototype` de lá são cópias, não os
    // que o jogo usa. Pra ler o protocolo é preciso rodar o gancho no mundo
    // PRINCIPAL da página, e um <script> inline injetado pelo preload esbarra
    // na CSP do site. `executeJavaScript` não esbarra.
    //
    // O código vem pronto do content-injected.js de propósito — aqui é só o
    // cano, pra não existirem duas cópias do mesmo gancho pra manter em dia.
    if (e.channel === "hm:proto-hook") {
      const codigo = (e.args && e.args[0]) || "";
      if (typeof codigo === "string" && codigo) {
        try {
          wv.executeJavaScript(codigo).catch(() => {});
        } catch (err) {
          // webview ainda anexando — o preload reinsiste sozinho.
        }
      }
      return;
    }
    // v0.11.4 — resultado assíncrono de "switchCharacter" (comando remoto do
    // painel) — o único comando que demora/pode falhar de verdade, ver
    // swagInitRemoteCommands mais abaixo no arquivo.
    if (e.channel === "hm:commandResult") {
      const result = (e.args && e.args[0]) || {};
      const commandId = result.commandId;
      if (commandId && swagPendingRemoteCommands.has(commandId)) {
        swagPendingRemoteCommands.delete(commandId);
        window.hunteraFarm.swagCommandResult({ commandId, ok: !!result.ok, error: result.error });
      }
      return;
    }
    // v0.11.19 — pacote do diagnóstico do protocolo. Chega só quando pedido
    // (pode ter megabytes) e vira um .json baixado na hora.
    if (e.channel === "hm:diag") {
      baixarDiagnostico(tab, (e.args && e.args[0]) || null);
      return;
    }
    if (e.channel === "hm:perf") {
      baixarBaseline(tab, (e.args && e.args[0]) || null);
      return;
    }
    if (e.channel !== "hm:state") return;
    const prev = automationState.get(tab.id) || {};
    automationState.set(tab.id, { ...prev, ...e.args[0] });
    const wasReady = guestReady.has(tab.id);
    guestReady.add(tab.id);
    // v0.9.16 — assim que a conta responde pela primeira vez, manda pra ela o
    // catálogo salvo em disco (se já tiver um), pra ela nunca precisar
    // remapear o que outra conta já mapeou.
    if (!wasReady) seedCatalogInto(tab.id);
    absorbCatalogFromState(tab.id, e.args[0] || {});
    absorbStatsFromState(tab.id, e.args[0] || {});
    updateAutoIndicator(tab.id);
    renderDiagStatus(); // v0.11.19 — contador do log do protocolo
    renderPerfDiagStatus();
    if (tab.id === selectedAutomationTabId) syncAutomationPanel();
    checkGroupHuntTeamReady(); // v0.9.8
    // v0.9.2 — André: "mostrar o nome do personagem logado e não Conta 1,
    // Conta 2 por exemplo".
    //
    // v0.9.19 — BUG corrigido: a condição era `/^Conta \d+$/.test(tab.label)`,
    // ou seja, o rótulo só era preenchido enquanto ainda fosse o padrão
    // gerado. Depois que virava um nome de personagem, CONGELAVA PRA SEMPRE —
    // então, ao entrar com outro personagem naquela conta, a lista continuava
    // mostrando o nome antigo. André, com "Kinazinho Zemsta" e "Naj Zemsta"
    // logados: "eu não estou logado nos personagens que está no canto
    // esquerdo. aqui deveria estar o nome dos personagens online no momento".
    // (Dava pra ver que o resto do estado chegava normalmente: vocação e
    // level já eram dos personagens novos, só o nome estava preso.)
    //
    // Agora o rótulo acompanha o personagem logado SEMPRE, com um "freio de
    // mão" (mesmo padrão do `autoResumeSessionManuallyDisabled`): se o André
    // renomear a conta na mão, `labelManual` fica true e o nome dele nunca
    // mais é sobrescrito.
    const characterName = (e.args[0] || {}).characterName;
    if (characterName && !tab.labelManual && tab.label !== characterName) {
      tab.label = characterName;
      persistTabs();
      renderTabs();
    }
    // v0.11.3 — todo hm:state novo é uma chance de o painel remoto (swag-site)
    // ficar mais atualizado. Debounced porque hm:state chega o tempo todo
    // (todo log novo de todas as contas) — sem isso seria uma chamada de IPC
    // por linha de log.
    swagSchedulePushState();
  });
  containerEl.appendChild(wv);
  return wv;
}

function applyZoom(wv) {
  if (typeof wv.setZoomFactor !== "function") return;
  const tabId = wv.getAttribute("data-tab-id");
  const factor = gridMode ? gridZoomOverride ?? ZOOM_GRID : manualZoom.get(tabId) ?? ZOOM_NORMAL;
  wv.setZoomFactor(factor);
  if (tabId === activeTabId) updateZoomLabel(factor);
}

function clampZoom(v) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +v.toFixed(2)));
}

function applyZoomToAll() {
  tabs.forEach((tab) => {
    const wv = getWebview(tab.id);
    if (wv) applyZoom(wv);
  });
}

function updateZoomLabel(factor) {
  zoomLabel.textContent = `${Math.round(factor * 100)}%`;
}

function updateStatusDot(tabId) {
  const dot = tabsEl.querySelector(`.acct[data-tab-id="${tabId}"] .acctStatusDot`);
  if (dot) dot.classList.toggle("online", loadedTabs.has(tabId));
}

// Só acende/apaga o raiozinho ⚡ de UMA linha da lista (indica "automação
// ligada nessa conta" de relance, sem precisar abrir o painel dela).
function updateAutoIndicator(tabId) {
  const btn = tabsEl.querySelector(`.acct[data-tab-id="${tabId}"] .acctAutoBtn`);
  if (btn) btn.classList.toggle("on", !!automationState.get(tabId)?.running);
  updateAcctStatusLine(tabId);
}

// v0.9.16 — a sub-linha de cada conta mostrava `huntera.com.br` — idêntico
// nas 4 contas, sempre — e o tempo de sessão. Ou seja, o app que existe pra
// ficar rodando enquanto você faz outra coisa não dizia NADA de relance:
// pra saber se uma conta travou era preciso entrar conta por conta. Agora
// essa linha mostra o estado real (Caçando, Aguardando o time, Erro...),
// com cor, que é a informação que se olha de canto de olho.
// v0.9.16 — André: "seria legal é nessa parte ter qual a vocação do
// personagem". Abreviado no padrão que todo mundo usa no jogo (o chat global
// é só "EK", "ED", "MS", "RP") — cabe na barra estreita e é lido na hora.
const VOCATION_SHORT = {
  "elder druid": "ED",
  "druid": "D",
  "elite knight": "EK",
  "knight": "K",
  "master sorcerer": "MS",
  "sorcerer": "S",
  "royal paladin": "RP",
  "paladin": "P",
};

function vocationBadge(state) {
  if (!state) return "";
  const voc = (state.characterVocation || "").trim();
  const lvl = state.characterLevel;
  // v0.9.19 — personagem novo aparece como "Sem vocação", e a abreviação
  // genérica transformava isso em "SEM 6", que não quer dizer nada. Nesse
  // caso mostra só o level.
  const semVocacao = /^sem\s+voca/i.test(voc);
  if (!voc || semVocacao) return lvl ? `Lv ${lvl}` : "";
  const short = VOCATION_SHORT[voc.toLowerCase()] || voc.slice(0, 3).toUpperCase();
  return lvl ? `${short} ${lvl}` : short;
}

// v0.9.24 — André, com dois personagens caçando juntos em party mas um deles
// aparecendo como "Automação desligada": "se está caçando em PT está caçando
// e não mostrar que está com automação desligada".
//
// O texto reportava o estado do BOT, não o do PERSONAGEM. Com a automação
// desligada, tanto faz o que estivesse acontecendo no jogo: aparecia sempre a
// mesma coisa. Agora o personagem vem primeiro — se está caçando, está
// caçando, com ou sem bot. Que a automação está desligada continua visível no
// ícone de raio da linha, que é justamente pra isso.
function acctStatusFor(tabId) {
  if (!loadedTabs.has(tabId)) return { text: "carregando…", cls: "" };
  const st = automationState.get(tabId);
  if (!st || !guestReady.has(tabId)) return { text: "carregando…", cls: "" };
  if (st.status === "Erro") return { text: "Erro", cls: "err" };
  if (!st.running) {
    if (!st.characterName) return { text: "Fora do jogo", cls: "" };
    if (st.hunting) return { text: "Caçando (sem bot)", cls: "on" };
    // v0.11.8 — treinar roda sem a automação ligada, então precisa aparecer
    // aqui: senão a conta fica como "Parado na cidade" justamente enquanto
    // está fazendo o que foi configurada pra fazer.
    if (st.training) return { text: `Treinando ${st.trainingSkill || ""}`.trim(), cls: "on" };
    return { text: "Parado na cidade", cls: "" };
  }
  if (st.training && !st.hunting) {
    return { text: `Treinando ${st.trainingSkill || ""}`.trim(), cls: "on" };
  }
  // v0.9.17 — só o estado, sem "· N ciclos": com o badge de vocação do lado,
  // os ciclos empurravam o texto e cortavam o estado no meio ("Caçando · 812
  // c…", "Aguardando o t…"). O número de ciclos continua no painel da conta,
  // onde tem largura pra ele.
  return { text: st.status || "Ligada", cls: "on" };
}

function updateAcctStatusLine(tabId) {
  renderRailAccounts();
  const row = tabsEl.querySelector(`.acct[data-tab-id="${tabId}"]`);
  if (!row) return;
  const el = row.querySelector(".acctStatus");
  if (el) {
    const { text, cls } = acctStatusFor(tabId);
    el.textContent = text;
    el.className = "acctStatus" + (cls ? " " + cls : "");
  }
  const vocEl = row.querySelector(".acctVocation");
  if (vocEl) {
    const badge = vocationBadge(automationState.get(tabId));
    vocEl.textContent = badge;
    vocEl.hidden = !badge;
  }
}

function formatUptime(createdAt) {
  if (!createdAt) return "";
  const ms = Date.now() - createdAt;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return `${hours}h ${remMin}m`;
  const days = Math.floor(hours / 24);
  const remHour = hours % 24;
  return `${days}d ${remHour}h`;
}

function updateUptimeLabels() {
  tabs.forEach((tab) => {
    const el = tabsEl.querySelector(`.acct[data-tab-id="${tab.id}"] .acctUptime`);
    if (el) el.textContent = formatUptime(tab.createdAt);
  });
}

// v0.9.0 — reordenar contas arrastando (pedido do André). A "alça" (ícone
// de grip) é o único elemento arrastável — não a linha inteira — pra não
// atrapalhar a edição do rótulo (contenteditable) nem os outros botões.
let draggedTabId = null;

function reorderTabs(draggedId, targetId, insertAfter) {
  if (!draggedId || draggedId === targetId) return;
  const fromIdx = tabs.findIndex((t) => t.id === draggedId);
  if (fromIdx === -1) return;
  const [moved] = tabs.splice(fromIdx, 1);
  let toIdx = tabs.findIndex((t) => t.id === targetId);
  if (toIdx === -1) {
    tabs.push(moved); // segurança: alvo sumiu no meio do arraste
  } else {
    if (insertAfter) toIdx += 1;
    tabs.splice(toIdx, 0, moved);
  }
  persistTabs();
  renderTabs();
}

function renderTabs() {
  renderRailAccounts();
  tabsEl.innerHTML = "";
  tabs.forEach((tab) => {
    const el = document.createElement("div");
    el.className = "acct" + (tab.id === activeTabId ? " active" : "");
    el.setAttribute("data-tab-id", tab.id);
    const initial = (tab.label.trim()[0] || "?").toUpperCase();
    el.innerHTML = `
      <div class="acctRow">
        <button type="button" class="acctDragHandle" title="Arraste a linha para reordenar" tabindex="-1">
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="2" r="1.3"/><circle cx="8" cy="2" r="1.3"/><circle cx="2" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="2" cy="14" r="1.3"/><circle cx="8" cy="14" r="1.3"/></svg>
        </button>
        <div class="acctAvatar" style="background:${avatarColorFor(tab.id)}">
          ${escapeHtml(initial)}
          <span class="acctStatusDot${loadedTabs.has(tab.id) ? " online" : ""}"></span>
        </div>
        <div class="acctInfo">
          <div class="acctTopRow">
            <span class="acctLabel" contenteditable="true" spellcheck="false">${escapeHtml(tab.label)}</span>
            <button type="button" class="acctAutoBtn${automationState.get(tab.id)?.running ? " on" : ""}" title="Automação"><svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M11 2 4 12h5l-1 6 8-11h-5l0-5Z"/></svg></button>
            <button type="button" class="acctClose" title="Fechar conta">×</button>
          </div>
          <div class="acctSubRow">
            <span class="acctStatus"></span>
            <span class="acctVocation" title="Vocação e level"></span>
          </div>
        </div>
      </div>
    `;
    el.addEventListener("click", (e) => {
      // v0.9.16 — a alcinha saiu da lista de exceções: com a linha inteira
      // arrastável ela é só um indicador visual, então clicar nela também
      // troca de personagem, como em qualquer outro ponto da linha.
      if (e.target.closest(".acctClose") || e.target.closest(".acctLabel") || e.target.closest(".acctAutoBtn")) {
        return;
      }
      setActiveTab(tab.id);
    });
    el.querySelector(".acctClose").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    const labelEl = el.querySelector(".acctLabel");
    labelEl.addEventListener("blur", () => {
      const typed = labelEl.textContent.trim();
      if (typed && typed !== tab.label) {
        tab.label = typed;
        // v0.9.19 — renomeou na mão: a partir daqui o nome é dele, e o
        // personagem logado não sobrescreve mais. Apagar o texto e sair
        // (campo vazio) devolve o controle pro automático.
        tab.labelManual = true;
      } else if (!typed) {
        tab.labelManual = false;
        const live = automationState.get(tab.id)?.characterName;
        if (live) tab.label = live;
      }
      labelEl.textContent = tab.label;
      persistTabs();
      renderTabs();
    });
    labelEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        labelEl.blur();
      }
    });
    el.querySelector(".acctAutoBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      openAutomationPanel(tab.id);
    });

    // v0.9.16 — preenche status + vocação já no primeiro render.
    {
      const stEl = el.querySelector(".acctStatus");
      const { text, cls } = acctStatusFor(tab.id);
      stEl.textContent = text;
      stEl.className = "acctStatus" + (cls ? " " + cls : "");
      const vocEl = el.querySelector(".acctVocation");
      const badge = vocationBadge(automationState.get(tab.id));
      vocEl.textContent = badge;
      vocEl.hidden = !badge;
    }

    // v0.9.16 — André: "essa linha poderia ser toda clicável para selecionar
    // e toda clicável para arrastar. ou seja, se o usuário só clicar ele já
    // executa o switch de personagem, se clicar e segurar libera o arrastar".
    //
    // Antes só a alcinha de pontinhos arrastava — um alvo de ~10px que ainda
    // por cima só aparecia no hover. Agora a linha inteira é a área de drag.
    //
    // O `draggable` é ligado no mousedown em vez de ficar fixo no HTML de
    // propósito: com um ancestral sempre arrastável, o nome da conta (que é
    // `contenteditable`) perde a seleção de texto — arrastar pra selecionar
    // vira arrastar a linha. Ligando só quando o clique começa FORA do nome e
    // dos botões, renomear continua funcionando normalmente.
    const labelSel = ".acctLabel, .acctClose, .acctAutoBtn";
    el.addEventListener("mousedown", (e) => {
      el.draggable = !e.target.closest(labelSel);
    });
    el.addEventListener("mouseup", () => {
      el.draggable = false;
    });
    el.addEventListener("dragstart", (e) => {
      if (!el.draggable) {
        e.preventDefault();
        return;
      }
      draggedTabId = tab.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tab.id);
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => {
      el.draggable = false;
      el.classList.remove("dragging");
      tabsEl.querySelectorAll(".acct").forEach((row) => row.classList.remove("dragOverTop", "dragOverBottom"));
      draggedTabId = null;
    });

    const handleEl = el.querySelector(".acctDragHandle");
    handleEl.addEventListener("click", (e) => e.stopPropagation());
    el.addEventListener("dragover", (e) => {
      if (!draggedTabId || draggedTabId === tab.id) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const after = e.clientY - rect.top > rect.height / 2;
      el.classList.toggle("dragOverBottom", after);
      el.classList.toggle("dragOverTop", !after);
    });
    el.addEventListener("dragleave", () => {
      el.classList.remove("dragOverTop", "dragOverBottom");
    });
    el.addEventListener("drop", (e) => {
      if (!draggedTabId || draggedTabId === tab.id) return;
      e.preventDefault();
      const insertAfter = el.classList.contains("dragOverBottom");
      el.classList.remove("dragOverTop", "dragOverBottom");
      reorderTabs(draggedTabId, tab.id, insertAfter);
      draggedTabId = null;
    });

    tabsEl.appendChild(el);
  });
  addTabBtn.disabled = tabs.length >= MAX_TABS;
  groupCountEl.textContent = `${tabs.length} conta${tabs.length === 1 ? "" : "s"}`;
}

// ---------- painel de automação DEDICADO (v0.4.1) ----------
// Troca de conteúdo com a lista de contas dentro do próprio menu lateral —
// nunca fica sobreposto na tela do jogo, e nunca mais "espremido" dentro
// da linha da conta (era assim na v0.4.0, o André não curtiu).

// v0.7.0 — três "telas" dividem o mesmo espaço do menu lateral (lista de
// contas / automação de uma conta / configurações globais), sempre só uma
// visível por vez. Centraliza a troca aqui em vez de cada open/close mexer
// nas três hidden flags espalhado — mais fácil de garantir que nunca fica
// duas abertas ao mesmo tempo por engano.
function showAccountsList() {
  // Destacado, o painel não faz parte do rodízio de "telas" da barra lateral.
  if (!botDetached) automationPanelEl.hidden = true;
  settingsPanelEl.hidden = true;
  accountsGroupEl.hidden = false;
  railAutomationBtn.classList.remove("on");
  railSettingsBtn.classList.remove("on");
}

function openAutomationPanel(tabId) {
  selectedAutomationTabId = tabId;
  // ...e o caminho inverso: abrir o painel de uma conta traz o personagem
  // dela pra tela (clicar no raio de uma conta que não é a ativa).
  if (tabId && activeTabId !== tabId && !sincronizandoSelecao) {
    sincronizandoSelecao = true;
    try {
      setActiveTab(tabId);
    } finally {
      sincronizandoSelecao = false;
    }
  }
  const tab = tabs.find((t) => t.id === tabId);
  automationAvatarEl.style.background = avatarColorFor(tabId);
  automationAvatarEl.textContent = (tab?.label.trim()[0] || "?").toUpperCase();
  automationTitleEl.textContent = tab?.label || "";
  // v0.9.17 — destacado, o painel vive no card flutuante: a barra lateral
  // continua mostrando a lista de contas (é o ponto da opção C).
  botFloatTitleEl.textContent = tab?.label ? `${tab.label} · automação` : "Automação";
  accountsGroupEl.hidden = !botDetached ? true : false;
  settingsPanelEl.hidden = true;
  automationPanelEl.hidden = false;
  if (botDetached) botFloatEl.hidden = false;
  railAutomationBtn.classList.add("on");
  railSettingsBtn.classList.remove("on");
  // primeira vez abrindo essa conta — pede a lista de caçadas dela.
  if (!automationState.get(tabId)?.huntNames) {
    sendAutomationCommand(tabId, { type: "refreshHunts" });
  }
  syncAutomationPanel();
}

function closeAutomationPanel() {
  selectedAutomationTabId = null;
  showAccountsList();
}

function openSettingsPanel() {
  accountsGroupEl.hidden = true;
  automationPanelEl.hidden = true;
  settingsPanelEl.hidden = false;
  railSettingsBtn.classList.add("on");
  railAutomationBtn.classList.remove("on");
  syncSettingsPanel();
  // v0.12.4 — abrir as Configurações é o momento em que alguém vai OLHAR o
  // número de desempenho; medir aqui garante valor fresco em vez de o que
  // sobrou do último ciclo.
  try {
    renderPerfLive();
  } catch (err) {
    // painel ainda não montado — o ciclo de 4s cobre
  }
}

function closeSettingsPanel() {
  showAccountsList();
}

// v0.4.3 — André apontou especificamente pra essa barrinha ("a barrinha
// onde você altera a visualização de multi janela", ou seja, o iconRail
// onde já mora o botão de grade ⊞) como o lugar certo pro bot. O ⚡ de cada
// linha continua existindo (atalho rápido pra abrir a automação já
// naquela conta direto), mas agora o iconRail também tem um botão próprio
// (🤖) que abre/fecha o painel pra conta ATIVA no momento — mesmo padrão
// visual/comportamental do botão de grade ao lado dele (acende em âmbar
// quando ligado).
railAutomationBtn.addEventListener("click", () => {
  if (!automationPanelEl.hidden) {
    closeAutomationPanel();
    return;
  }
  if (!activeTabId) return;
  openAutomationPanel(activeTabId);
});

railSettingsBtn.addEventListener("click", () => {
  if (!settingsPanelEl.hidden) {
    closeSettingsPanel();
    return;
  }
  openSettingsPanel();
});

// v0.7.3 — André: "poderia ter um botão manual de check update". A
// checagem automática já roda sozinha (10s depois de abrir + a cada 4h),
// mas esse botão deixa checar NA HORA (ex: logo depois de publicar uma
// versão nova) sem esperar. Feedback: pisca o ícone (rodando) enquanto
// espera o processo principal, e mostra o resultado por alguns segundos na
// pastilha de status da barra de ferramentas (mesmo lugar que já mostra
// "N/4 contas").
function statusPillDefaultText() {
  return `${tabs.length}/${MAX_TABS} contas`;
}

let statusPillRevertTimer = null;

function showStatusPillMessage(text, durationMs = 6000) {
  statusPill.textContent = text;
  if (statusPillRevertTimer) clearTimeout(statusPillRevertTimer);
  statusPillRevertTimer = setTimeout(() => {
    statusPillRevertTimer = null;
    statusPill.textContent = statusPillDefaultText();
  }, durationMs);
}

railCheckUpdateBtn.addEventListener("click", () => {
  if (railCheckUpdateBtn.disabled) return;
  railCheckUpdateBtn.disabled = true;
  railCheckUpdateBtn.classList.add("checking");
  showStatusPillMessage("Verificando atualização...", 20000);
  window.hunteraFarm
    .checkForUpdates()
    .then((result) => {
      showStatusPillMessage(result?.message || "Não consegui checar atualização.");
    })
    .catch(() => {
      showStatusPillMessage("Não consegui checar atualização.");
    })
    .finally(() => {
      railCheckUpdateBtn.disabled = false;
      railCheckUpdateBtn.classList.remove("checking");
    });
});

automationBackBtn.addEventListener("click", closeAutomationPanel);
settingsBackBtn.addEventListener("click", closeSettingsPanel);
automationHuntSelect.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  const huntName = automationHuntSelect.value;
  sendAutomationCommand(selectedAutomationTabId, { type: "setConfig", payload: { huntName } });
  if (huntName) sendAutomationCommand(selectedAutomationTabId, { type: "requestTiers", payload: { huntName } });
});
automationTierSelect.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, { type: "setConfig", payload: { pullLevel: automationTierSelect.value } });
});
automationCapacityInput.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { capacityThreshold: automationCapacityInput.value },
  });
});
// v0.9.18 — rodízio de personagens por stamina.
automationRotateToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { rotateCharactersEnabled: automationRotateToggle.checked },
  });
});
// v0.11.12 — expedição: liga/desliga por conta e o progresso do dia.
automationExpeditionToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { expeditionEnabled: automationExpeditionToggle.checked },
  });
});

function renderExpedicao(state) {
  const ex = state.expedicoes;
  if (!ex || !ex.entries || !ex.entries.length) {
    expedicaoListaEl.innerHTML =
      '<p class="fieldHint">Sem objetivos à vista. Ou o personagem não está em guild, ou o jogo ainda não mandou a expedição de hoje.</p>';
    return;
  }
  const resta = ex.endsAtMs ? Math.max(0, ex.endsAtMs - Date.now()) : 0;
  const horas = Math.floor(resta / 3600000);
  const min = Math.floor((resta % 3600000) / 60000);
  const linhas = ex.entries.map((e) => {
    const pct = Math.min(100, Math.round((Number(e.progress) / Number(e.quota)) * 100));
    return `<div class="expRow${e.concluido ? " expDone" : ""}">
      <div class="expHead"><span>${escapeHtml(e.label)}</span><b>${fmtNum(e.progress)}/${fmtNum(e.quota)}</b></div>
      <div class="expBar"><div class="expFill" style="width:${pct}%"></div></div>
    </div>`;
  });
  // v0.11.26 — a auto expedição precisa do mapa "objetivo → criaturas", que só
  // existe no painel de expedição do jogo. Sem ele a feature fica ligada e
  // parada, sem dizer nada — foi o que aconteceu. Agora o painel mostra quais
  // objetivos já têm o mapa e o que fazer pelos que faltam.
  const mapa = state.expedicaoMapa;
  if (mapa) {
    // v0.11.28 — mostra também de ONDE veio a lista de criaturas: do painel do
    // jogo (explícito) ou do catálogo por `bestiaryId` (dedução, pode estar
    // incompleta). O usuário merece saber a diferença antes de confiar.
    for (const e of ex.entries) {
      const m = mapa[e.label];
      if (!m || Number(e.progress) >= Number(e.quota)) continue;
      linhas.push(
        `<p class="fieldHint">${escapeHtml(e.label)}: caçando <b>${m.criaturas.map(escapeHtml).join(", ")}</b>` +
          (m.fonte === "catálogo" ? " — deduzido do catálogo, a lista pode estar incompleta." : ".") +
          "</p>"
      );
    }
    const faltando = ex.entries.filter((e) => !mapa[e.label] && Number(e.progress) < Number(e.quota));
    if (faltando.length) {
      const tr = state.expedicaoTracker;
      linhas.push(
        `<p class="fieldHint">Ainda não sei quais criaturas contam para ${faltando
          .map((e) => `<b>${escapeHtml(e.label)}</b>`)
          .join(" e ")}.</p>`
      );
      // v0.11.36 — a instrução fica; o diagnóstico de DOM que estava aqui
      // (quantas linhas o painel do jogo tem, quais rótulos, "me manda este
      // print") saiu. André: "nada que diga como que a gente faz as coisas
      // deveria estar visível".
      if (tr && tr.presente === false) {
        linhas.push('<p class="fieldHint">Abra o painel de expedição do jogo uma vez com esta conta — a partir daí funciona sozinho.</p>');
      }
    }
  }
  if (resta) linhas.push(`<p class="fieldHint">Reseta em ${horas}h ${min}min.</p>`);
  expedicaoListaEl.innerHTML = linhas.join("");
}

// v0.11.10 — detector de spawn seco. Config global: mora num arquivo do
// processo principal (spawn.json), não no localStorage de cada conta, e cada
// automação relê de tempos em tempos.
let spawnCfgLocal = { enabled: false, minSeconds: 90, factor: 4 };

async function carregarSpawnConfig() {
  try {
    const cfg = await window.hunteraFarm.loadSpawnConfig();
    if (cfg) spawnCfgLocal = cfg;
  } catch (err) {
    /* mantém o padrão */
  }
  spawnEnabledToggle.checked = !!spawnCfgLocal.enabled;
  spawnFieldsEl.hidden = !spawnCfgLocal.enabled;
  if (document.activeElement !== spawnMinSecondsInput) spawnMinSecondsInput.value = spawnCfgLocal.minSeconds;
  if (document.activeElement !== spawnFactorInput) spawnFactorInput.value = spawnCfgLocal.factor;
}

async function salvarSpawnConfig(parcial) {
  spawnCfgLocal = { ...spawnCfgLocal, ...parcial };
  try {
    const salvo = await window.hunteraFarm.saveSpawnConfig(spawnCfgLocal);
    if (salvo) spawnCfgLocal = salvo;
  } catch (err) {
    /* melhor seguir com o valor local do que travar a tela */
  }
  spawnFieldsEl.hidden = !spawnCfgLocal.enabled;
}

spawnEnabledToggle.addEventListener("change", () => salvarSpawnConfig({ enabled: spawnEnabledToggle.checked }));

// v0.11.19 — log do protocolo. Diferente do resto das configurações, isto NÃO
// é salvo em disco de propósito: gravar 20 mensagens por segundo não é estado
// que deva sobreviver a um reinício do app por esquecimento. Liga, investiga,
// baixa, desliga.
const diagEnabledToggle = document.getElementById("diagEnabledToggle");
const diagDownloadBtn = document.getElementById("diagDownloadBtn");
const diagStatus = document.getElementById("diagStatus");

function contaDoDiagnostico() {
  // Sempre a conta selecionada no painel — foi a escolha do André, e é o que
  // mantém isso leve.
  return selectedAutomationTabId || activeTabId;
}

function renderDiagStatus() {
  if (!diagStatus) return;
  const tabId = contaDoDiagnostico();
  const st = (tabId && automationState.get(tabId)) || {};
  const ativo = !!st.diagAtivo;
  if (diagEnabledToggle) diagEnabledToggle.checked = ativo;
  if (diagDownloadBtn) diagDownloadBtn.disabled = !st.diagMensagens;
  if (!tabId) {
    diagStatus.textContent = "Selecione uma conta no painel de automação primeiro.";
    return;
  }
  const nome = st.characterName || "a conta selecionada";
  diagStatus.textContent = ativo
    ? `Gravando ${nome}: ${fmtNum(st.diagMensagens || 0)} mensagens, ${st.diagTipos || 0} tipos.`
    : st.diagMensagens
      ? `Parado. ${fmtNum(st.diagMensagens)} mensagens gravadas de ${nome} — ainda dá pra baixar.`
      : "Desligado.";
}

if (diagEnabledToggle) {
  diagEnabledToggle.addEventListener("change", () => {
    const tabId = contaDoDiagnostico();
    if (!tabId) {
      diagEnabledToggle.checked = false;
      renderDiagStatus();
      return;
    }
    sendAutomationCommand(tabId, { type: diagEnabledToggle.checked ? "diagStart" : "diagStop" });
  });
}
if (diagDownloadBtn) {
  diagDownloadBtn.addEventListener("click", () => {
    const tabId = contaDoDiagnostico();
    if (tabId) sendAutomationCommand(tabId, { type: "diagDump" });
  });
}

// Baseline de performance: não captura payload, não muda automação e não fica
// ligado por acidente. O JSON baixado é por conta, para poder comparar 1 × 4.
const perfDiagToggle = document.getElementById("perfDiagToggle");
const perfDiagStatus = document.getElementById("perfDiagStatus");
const perfDiagDownloadBtn = document.getElementById("perfDiagDownloadBtn");
const perfDiagFinalizadoEm = new Map();

function fmtTempoDecorrido(ms) {
  const totalSegundos = Math.max(0, Math.floor(ms / 1000));
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
}

function renderPerfDiagStatus() {
  if (!perfDiagStatus) return;
  const tabId = contaDoDiagnostico();
  const st = (tabId && automationState.get(tabId)) || {};
  if (perfDiagToggle) perfDiagToggle.checked = !!st.perfDiagAtivo;
  if (perfDiagDownloadBtn) perfDiagDownloadBtn.disabled = !st.perfDiagInicio;
  if (!tabId) {
    perfDiagStatus.textContent = "Selecione uma conta no painel de automação primeiro.";
    return;
  }
  if (!st.perfDiagAtivo && !st.perfDiagInicio) {
    perfDiagStatus.textContent = "Desligado. Mede somente enquanto estiver ligado; não grava payloads.";
    return;
  }
  if (st.perfDiagAtivo) {
    perfDiagFinalizadoEm.delete(tabId);
    perfDiagStatus.textContent = `Medindo ${st.characterName || "a conta selecionada"} há ${fmtTempoDecorrido(Date.now() - st.perfDiagInicio)}. Baixe o baseline ao terminar.`;
    return;
  }
  const fim = perfDiagFinalizadoEm.get(tabId) || Date.now();
  perfDiagFinalizadoEm.set(tabId, fim);
  perfDiagStatus.textContent = `Medição encerrada em ${fmtTempoDecorrido(fim - st.perfDiagInicio)}. Baixe o baseline antes de iniciar outra.`;
}

if (perfDiagToggle) perfDiagToggle.addEventListener("change", () => {
  const tabId = contaDoDiagnostico();
  if (!tabId) { perfDiagToggle.checked = false; renderPerfDiagStatus(); return; }
  sendAutomationCommand(tabId, { type: perfDiagToggle.checked ? "perfStart" : "perfStop" });
});
if (perfDiagDownloadBtn) perfDiagDownloadBtn.addEventListener("click", () => {
  const tabId = contaDoDiagnostico();
  if (tabId) sendAutomationCommand(tabId, { type: "perfSnapshot" });
});
spawnMinSecondsInput.addEventListener("change", () => {
  const n = Number(spawnMinSecondsInput.value);
  if (!Number.isNaN(n) && n >= 30) salvarSpawnConfig({ minSeconds: n });
});
spawnFactorInput.addEventListener("change", () => {
  const n = Number(spawnFactorInput.value);
  if (!Number.isNaN(n) && n >= 2) salvarSpawnConfig({ factor: n });
});

// v0.11.9 — religar a automação depois de uma queda (server save).
automationAutoRestartToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { autoRestartAfterOutage: automationAutoRestartToggle.checked },
  });
});

// v0.11.8 — aba Treino: duas condições independentes + minutos de ociosidade.
automationTrainStaminaToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { trainOnStaminaZero: automationTrainStaminaToggle.checked },
  });
});
automationTrainIdleToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  automationTrainIdleFieldsEl.hidden = !automationTrainIdleToggle.checked;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { trainOnIdleInCity: automationTrainIdleToggle.checked },
  });
});
automationTrainIdleInput.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { trainIdleMinutes: automationTrainIdleInput.value },
  });
});

// Skill por personagem. Mesmo padrão do rodízio: a lista vem do que a conta
// realmente tem (capturada na tela de seleção), não de digitar nome à mão.
function renderTrainSkillList(state) {
  const known = Array.isArray(state.knownCharacters) ? state.knownCharacters : [];
  const mapa = state.trainSkillByCharacter || {};
  const atual = state.characterName ? normalizeCharacterName(state.characterName) : null;
  // Mesmo sem a lista capturada ainda, o personagem logado agora já dá pra
  // configurar — é o caso mais comum de "acabei de abrir e quero ligar isso".
  const nomes = known.length ? known : state.characterName ? [state.characterName] : [];

  if (!nomes.length) {
    automationTrainSkillListEl.innerHTML =
      '<p class="fieldHint">Ainda não vi os personagens desta conta. Assim que a tela de seleção aparecer (login, server save ou uma troca), eles aparecem aqui sozinhos.</p>';
    return;
  }

  automationTrainSkillListEl.innerHTML = nomes
    .map((name) => {
      const chave = normalizeCharacterName(name);
      const escolhida = mapa[chave] || "";
      const live = atual && chave === atual;
      const opcoes = ['<option value="">— não treina —</option>']
        .concat(
          TRAIN_SKILLS.map(
            (sk) =>
              `<option value="${escapeHtml(sk)}"${sk === escolhida ? " selected" : ""}>${escapeHtml(sk)}</option>`
          )
        )
        .join("");
      return `<div class="trainSkillItem">
        <div class="trainSkillName">${escapeHtml(name)}${live ? '<span class="rotateNow">agora</span>' : ""}</div>
        <select data-train-character="${escapeHtml(name)}">${opcoes}</select>
      </div>`;
    })
    .join("");

  automationTrainSkillListEl.querySelectorAll("select[data-train-character]").forEach((sel) => {
    sel.addEventListener("change", () => {
      if (!selectedAutomationTabId) return;
      sendAutomationCommand(selectedAutomationTabId, {
        type: "setConfig",
        payload: {
          trainSkill: { character: sel.getAttribute("data-train-character"), skill: sel.value },
        },
      });
    });
  });
}

// v0.9.20 — André: "o próprio app poderia checar o nome dos personagens que
// existem na conta e deixar um checkbox de ciclo, quais são os personagens
// que fazem parte da rotação". Digitar nome à mão era frágil: um typo não
// dava erro nenhum, só fazia o personagem ser ignorado em silêncio.
//
// A lista vem da conta (capturada na tela de seleção pelo content script), e
// a ordem do rodízio é a ordem da própria conta — marcar/desmarcar só decide
// quem entra. Isso mantém intacta a lógica de rodízio que já existe: ela
// continua recebendo o mesmo array `rotateCharacters`.
function renderResumeCharacterSelect(state) {
  if (automationResumeSessionCharacterSelect === document.activeElement) return;
  const known = Array.isArray(state.knownCharacters) ? state.knownCharacters : [];
  const saved = typeof state.autoResumeSessionCharacter === "string" ? state.autoResumeSessionCharacter : "";
  // O nome salvo entra na lista mesmo que ainda não tenhamos visto a conta —
  // senão a configuração existente sumiria da tela até a próxima passagem
  // pela tela de seleção.
  const options = known.slice();
  if (saved && !options.some((n) => n.toLowerCase() === saved.toLowerCase())) options.push(saved);

  automationResumeSessionCharacterSelect.innerHTML =
    '<option value="">— nenhum —</option>' +
    options.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  automationResumeSessionCharacterSelect.value = saved;

  automationResumeSessionHint.textContent = known.length
    ? ""
    : "A lista aparece assim que esta conta passar pela tela de seleção de personagens.";
}

function renderRotateList(state) {
  const known = Array.isArray(state.knownCharacters) ? state.knownCharacters : [];
  const chosen = Array.isArray(state.rotateCharacters) ? state.rotateCharacters : [];

  if (!known.length) {
    automationRotateListEl.innerHTML =
      '<p class="fieldHint">Ainda não vi os personagens desta conta. Eles são lidos na tela de seleção de personagens — assim que ela aparecer (login, server save ou a primeira troca), a lista aparece aqui sozinha.</p>';
    return;
  }

  automationRotateListEl.innerHTML = known
    .map((name, i) => {
      const on = chosen.some((c) => c.toLowerCase() === name.toLowerCase());
      const live = state.characterName && state.characterName.toLowerCase() === name.toLowerCase();
      return `<label class="rotateItem">
        <input type="checkbox" data-rotate-name="${escapeHtml(name)}" id="rotateChk${i}"${on ? " checked" : ""} />
        <span>${escapeHtml(name)}</span>
        ${live ? '<span class="rotateNow">agora</span>' : ""}
      </label>`;
    })
    .join("");

  automationRotateListEl.querySelectorAll("input[data-rotate-name]").forEach((chk) => {
    chk.addEventListener("change", () => {
      if (!selectedAutomationTabId) return;
      const picked = Array.from(automationRotateListEl.querySelectorAll("input[data-rotate-name]"))
        .filter((c) => c.checked)
        .map((c) => c.getAttribute("data-rotate-name"));
      sendAutomationCommand(selectedAutomationTabId, {
        type: "setConfig",
        payload: { rotateCharacters: picked },
      });
    });
  });
}

// v0.9.15 — "Sempre vender ao chegar na cidade" (pedido do André).
automationAutoSellCityToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { autoSellOnCityArrival: automationAutoSellCityToggle.checked },
  });
});
automationStaminaInput.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { staminaResumeThreshold: automationStaminaInput.value },
  });
});
// v0.9.16 — o ↻ passou a mapear o catálogo COMPLETO (todas as caçadas + o
// tamanho do pull de cada uma) em vez de só reler a lista de nomes. Leva um
// ou dois minutos e o resultado fica salvo em disco, valendo pras 4 contas —
// então é uma vez só, não a cada abertura do painel.
automationRefreshBtn.addEventListener("click", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, { type: "buildFullCatalog" });
});

// v0.7.0 — campos de Party. `automationAllowlistInput` guarda uma lista de
// nomes separados por vírgula na tela, mas a config em si (e o
// content-injected.js) trabalha com um array já separado — a conversão
// acontece só aqui, na borda entre UI e IPC.
automationAutoAcceptToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { autoAcceptParty: automationAutoAcceptToggle.checked },
  });
});
automationAllowlistInput.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  const list = automationAllowlistInput.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { autoAcceptPartyAllowlist: list },
  });
});
automationSyncEkToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { syncEkTarget: automationSyncEkToggle.checked },
  });
});
automationKeepTargetToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { autoKeepCurrentTarget: automationKeepTargetToggle.checked },
  });
});

// v0.9.6 — Time (auto convidar pra party). Mesma conversão texto<->array do
// automationAllowlistInput acima pro campo de alvos.
automationPartyLeaderToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { isPartyLeader: automationPartyLeaderToggle.checked },
  });
});
automationAutoInvitePartyToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { autoInvitePartyEnabled: automationAutoInvitePartyToggle.checked },
  });
});
automationInvitePartyTargetsInput.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  const list = automationInvitePartyTargetsInput.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { autoInvitePartyTargets: list },
  });
});
function setHuntMode(mode) {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { huntMode: mode },
  });
}
huntModeSegSolo.addEventListener("click", () => setHuntMode("solo"));
huntModeSegGroup.addEventListener("click", () => setHuntMode("group"));

// v0.8.0 — auto retomar sessão.
automationResumeSessionToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { autoResumeSessionEnabled: automationResumeSessionToggle.checked },
  });
});
automationResumeSessionCharacterSelect.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { autoResumeSessionCharacter: automationResumeSessionCharacterSelect.value.trim() },
  });
});

automationToggleBtn.addEventListener("click", () => {
  if (!selectedAutomationTabId) return;
  const state = automationState.get(selectedAutomationTabId) || {};
  sendAutomationCommand(selectedAutomationTabId, { type: state.running ? "stop" : "start" });
});

// Atualiza os campos do painel FIXO com o estado da conta selecionada —
// chamado a cada novo estado reportado por ela (frequente: todo log novo
// manda um estado novo). Preserva o valor de quem estiver digitando/com um
// select aberto (não sobrescreve enquanto o elemento está em foco).
// v0.9.8/v0.9.9 — André: "sempre que os membros sairem da caçada por falta
// de cap, todos devem vender o loot da cidade e só aceitam o novo convite
// do membro principal depois que todos venderem o loot" — e depois: "ligar
// automação não pode estar linkado direto com a caçada solo... devemos ter
// uma funcionalidade caçada solo e caçada em grupo pra funcionar
// independente sem conflitos" (virou o "Modo de caçada" — `huntMode`, aba
// Caçada — em vez do toggle avulso "Sincronizar venda de loot em grupo" da
// v0.9.8). Cada conta só enxerga o PRÓPRIO jogo (webviews isolados) — quem
// vê o estado de TODAS as contas ao mesmo tempo é este processo
// (renderer.js), por isso a sincronização mora aqui: sempre que qualquer
// conta manda um `hm:state` novo, confere se alguma conta-líder está
// esperando o time (`groupHuntSyncStatus === "leaderWaitingTeam"`) e, se
// todo mundo configurado como time já vendeu (`memberWaitingInvite`), manda
// o comando `resumeGroupHunt` só pra ela — é a retomada da líder que
// dispara o convite de caçada em grupo pros outros de verdade (mecanismo já
// existente do próprio jogo).
//
// Conta do time sem a aba aberta agora, ou não configurada no modo
// "group", NÃO bloqueia a espera (assumida como "não faz parte da
// sincronização agora") — evita a líder ficar travada pra sempre esperando
// uma conta fechada ou ainda em modo Solo.
// v0.9.15 — normalização de nome de personagem usada dos DOIS lados da
// comparação. Antes era só `trim().toLowerCase()`, o que deixava passar
// diferenças invisíveis que fazem o líder achar que um membro "não faz parte
// da sincronização" e retomar cedo (mandando o convite enquanto o membro
// ainda está vendendo): acento em forma Unicode diferente (o "é" digitado no
// app x o colado do jogo), espaço duplo no meio, e espaço não-quebrável.
function normalizeCharacterName(name) {
  if (typeof name !== "string") return "";
  return name
    .normalize("NFC")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function checkGroupHuntTeamReady() {
  for (const [leaderTabId, leaderState] of automationState.entries()) {
    // v0.11.22 — `souLiderEfetivo` é o que o servidor respondeu (tipo 51/72);
    // quando ele está calado, cai no checkbox, que é o comportamento antigo.
    const ehLider =
      leaderState && leaderState.souLiderEfetivo !== undefined && leaderState.souLiderEfetivo !== null
        ? leaderState.souLiderEfetivo
        : leaderState && leaderState.isPartyLeader;
    if (!leaderState || !ehLider || leaderState.huntMode !== "group") continue;
    if (leaderState.groupHuntSyncStatus !== "leaderWaitingTeam") continue;

    const targets = (leaderState.autoInvitePartyTargets || [])
      .map((s) => normalizeCharacterName(s))
      .filter(Boolean);
    // v0.9.15 — antes: `if (!targets.length) continue;` — o líder ficava
    // esperando PRA SEMPRE. A lista de "Personagens do time" mora na aba
    // Party, mas o "Modo de caçada" mora na aba Caçada; nada obriga a
    // preencher uma pra usar o outro, então é trivial cair nesse estado.
    // Lista vazia = não tem ninguém pra esperar → pode retomar já.
    if (!targets.length) {
      sendAutomationCommand(leaderTabId, { type: "resumeGroupHunt" });
      continue;
    }

    const allReady = targets.every((targetName) => {
      const memberEntry = Array.from(automationState.entries()).find(
        ([id, st]) => id !== leaderTabId && normalizeCharacterName(st.characterName) === targetName
      );
      if (!memberEntry) return true; // conta do time não está aberta agora — não bloqueia
      const [, memberState] = memberEntry;
      if (memberState.huntMode !== "group") return true; // esse membro não está no modo Em grupo — não conta
      return memberState.groupHuntSyncStatus === "memberWaitingInvite";
    });

    if (allReady) {
      sendAutomationCommand(leaderTabId, { type: "resumeGroupHunt" });
    }
  }
}

// v0.9.16 — tudo que uma conta descobre sobre o catálogo é gravado no disco
// compartilhado: a varredura completa (`fullCatalog`), a lista de nomes, e os
// tiers da caçada que ela acabou de ler. Assim o catálogo vai se completando
// sozinho com o uso normal, além da varredura explícita.
// ---------- v0.9.23 — analyzer próprio (agregação + histórico) ----------
// Cada conta reporta os TOTAIS da sessão dela. Aqui a gente converte pra
// DELTA (quanto entrou desde a última vez que vimos aquela sessão) e soma no
// balde do dia — somar total direto contaria o mesmo gold várias vezes, já
// que o estado chega repetido a cada evento.
const statsLastSeen = new Map(); // tabId -> { sessionId, gold, xp, cycles, ms }
let statsHistorico = { dias: {} };
const statsPendentes = new Map(); // "dia|personagem" -> delta acumulado
let statsFlushTimer = null;

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function absorbStatsFromState(tabId, state) {
  const st = state && state.stats;
  if (!st || !st.sessionId) return;
  const anterior = statsLastSeen.get(tabId);
  // Sessão nova (boot, troca de personagem) começa do zero: o total dela É o
  // delta. Mesma sessão: delta é a diferença desde a última leitura.
  const base =
    anterior && anterior.sessionId === st.sessionId
      ? anterior
      : { gold: 0, xp: 0, cycles: 0, ms: 0 };
  const delta = {
    gold: Math.max(0, (st.gold || 0) - base.gold),
    xp: Math.max(0, (st.xp || 0) - base.xp),
    cycles: Math.max(0, (st.cycles || 0) - base.cycles),
    ms: Math.max(0, (st.elapsedMs || 0) - base.ms),
  };
  statsLastSeen.set(tabId, {
    sessionId: st.sessionId,
    gold: st.gold || 0,
    xp: st.xp || 0,
    cycles: st.cycles || 0,
    ms: st.elapsedMs || 0,
  });

  if (!delta.gold && !delta.xp && !delta.cycles && !delta.ms) return;
  const personagem = state.characterName || (tabs.find((t) => t.id === tabId) || {}).label || tabId;
  const chave = `${hojeISO()}|${personagem}`;
  const acc = statsPendentes.get(chave) || { gold: 0, xp: 0, cycles: 0, ms: 0 };
  acc.gold += delta.gold;
  acc.xp += delta.xp;
  acc.cycles += delta.cycles;
  acc.ms += delta.ms;
  statsPendentes.set(chave, acc);

  // Grava em disco com folga: o estado chega a cada poucos segundos e não
  // vale um write por evento.
  if (!statsFlushTimer) statsFlushTimer = setTimeout(flushStatsDeltas, 20000);
}

async function flushStatsDeltas() {
  statsFlushTimer = null;
  if (!statsPendentes.size) return;
  const lote = Array.from(statsPendentes.entries());
  statsPendentes.clear();
  for (const [chave, delta] of lote) {
    const [dia, personagem] = chave.split("|");
    try {
      statsHistorico = await window.hunteraFarm.addStats({ dia, personagem, delta });
    } catch (err) {
      // disco indisponível — devolve pro acumulador pra tentar no próximo ciclo
      const atual = statsPendentes.get(chave) || { gold: 0, xp: 0, cycles: 0, ms: 0 };
      statsPendentes.set(chave, {
        gold: atual.gold + delta.gold,
        xp: atual.xp + delta.xp,
        cycles: atual.cycles + delta.cycles,
        ms: atual.ms + delta.ms,
      });
    }
  }
  renderAnalyzer();
}
window.addEventListener("beforeunload", () => { flushStatsDeltas(); });

// Soma o que TODAS as contas abertas estão rendendo agora.
function statsAgregado() {
  let gold = 0, xp = 0, cycles = 0, ms = 0, contas = 0;
  let melhor = null;
  for (const [tabId, st] of automationState.entries()) {
    const s2 = st && st.stats;
    if (!s2) continue;
    contas++;
    gold += s2.gold || 0;
    xp += s2.xp || 0;
    cycles += s2.cycles || 0;
    ms = Math.max(ms, s2.elapsedMs || 0);
    const porHora = s2.elapsedMs > 60000 ? ((s2.gold || 0) / s2.elapsedMs) * 3600000 : 0;
    if (!melhor || porHora > melhor.porHora) {
      melhor = { nome: st.characterName || (tabs.find((t) => t.id === tabId) || {}).label || tabId, porHora };
    }
  }
  return { gold, xp, cycles, ms, contas, melhor };
}

// ---------- v0.9.23 — render do analyzer ----------
const analyzerSessionEl = document.getElementById("analyzerSession");
const analyzerTotalEl = document.getElementById("analyzerTotal");
const analyzerBestEl = document.getElementById("analyzerBest");
const analyzerHistoryEl = document.getElementById("analyzerHistory");
const automationMinimizeAnalyzerToggle = document.getElementById("automationMinimizeAnalyzerToggle");

// Números grandes no formato que o próprio jogo usa (1,6kk / 484,2k), pra não
// virar uma parede de dígitos numa barra de 250px.
function fmtNum(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(".", ",")}kk`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(".", ",")}k`;
  return String(Math.round(v));
}
function fmtDur(ms) {
  const min = Math.floor((Number(ms) || 0) / 60000);
  const h = Math.floor(min / 60);
  return h ? `${h}h${String(min % 60).padStart(2, "0")}` : `${min}min`;
}
function porHora(valor, ms) {
  // Abaixo de um minuto a extrapolação vira ficção — melhor não mostrar.
  if (!ms || ms < 60000) return null;
  return (Number(valor) || 0) / (ms / 3600000);
}
function tile(rotulo, valor, sub) {
  return `<div class="statTile"><b>${escapeHtml(valor)}</b><span>${escapeHtml(rotulo)}</span>${
    sub ? `<em>${escapeHtml(sub)}</em>` : ""
  }</div>`;
}

// v0.11.11 — bloco de lucro real. Vem do protocolo (tipos 55/57/60), não do
// analisador premium do jogo: loot itemizado, custo dos suprimentos (que neste
// jogo é cobrado no uso, em gold) e o saldo pelos dois modos de valoração.
// v0.11.21 — o que saiu da vista do analisador, guardado num bloco fechado.
// Não é lixo: a comparação com o leilão diz o que NÃO vale mandar na venda
// rápida, e a lista item a item é o que permite conferir um número estranho
// (foi assim que apareceu o "fish valendo 5.200 no leilão", que ainda não
// está explicado). Fechado por padrão porque o André pediu simples.
function detalheDoLoot(ec) {
  const partes = [];
  // v0.11.24 — por que os números estão zerados?
  //
  // O André reportou o analisador todo em zero, e as duas explicações
  // possíveis dão a MESMA tela: a sessão acabou de começar, ou ela está sendo
  // zerada repetidamente. Rodando a captura dele pelo motor, os números saem
  // certos (112 mortes, 8.708 XP) — então o defeito não é de leitura. Estas
  // três linhas dizem qual das duas é, sem precisar de mais uma ida e volta.
  const r = ec.resumo;
  if (r && r.sessaoIniciadaEm !== undefined) {
    const idade = r.sessaoIniciadaEm ? Math.round((Date.now() - r.sessaoIniciadaEm) / 1000) : null;
    partes.push('<div class="ecoSub">Diagnóstico</div>');
    partes.push(
      `<div class="ecoRow"><span>Sessão começou há</span><b>${idade === null ? "nunca iniciou" : `${idade}s`}</b></div>`
    );
    partes.push(`<div class="ecoRow"><span>Mensagens do protocolo</span><b>${fmtNum(r.mensagensDoProtocolo || 0)}</b></div>`);
    partes.push(`<div class="ecoRow"><span>Ficha do personagem lida</span><b>${r.amostrasDeXp ? "sim" : "não"}</b></div>`);
    if (idade !== null && idade < 15) {
      partes.push('<p class="fieldHint">A sessão é recente — é normal os números ainda estarem baixos. Se este tempo <b>não passar de alguns segundos</b> enquanto você caça, a sessão está sendo reiniciada e é isso que zera tudo.</p>');
    }
  }
  partes.push(`<div class="ecoRow"><span>Loot (preço de NPC)</span><b>${fmtNum(ec.valorNpc)}</b></div>`);

  // v0.11.25 — O TOTAL DE LEILÃO SAIU, E ISSO É UMA CORREÇÃO, NÃO UM CORTE.
  //
  // A tabela `auction` do tipo 57 é o PREÇO PEDIDO por jogadores, não valor de
  // mercado. Na tabela real do jogo tem `banana skin` com NPC 1 e leilão
  // 6.000.000; `tortoise egg` com NPC 10 e leilão 300.000. Somar isso dava, na
  // sessão do André, "leiloando você ganharia 6,4kk a mais" — um número que
  // não corresponde a dinheiro nenhum que ele conseguiria.
  //
  // Eu validei essa conta com o protection amulet (100 → 1.600), que parecia
  // razoável, e não testei contra o caso absurdo. Lição: quando a fonte é
  // preço pedido por gente, a validação tem que incluir o outlier, não só a
  // amostra que confirma.
  //
  // O que SOBREVIVE é a parte acionável: quais itens do loot valem muito mais
  // no leilão do que na venda rápida. Isso continua útil item a item, mesmo
  // com o preço sendo uma oferta — é um alerta de "olha isso antes de vender",
  // não uma promessa de valor.
  const naoVenda = (ec.itens || [])
    .filter((i) => typeof i.leilao === "number" && typeof i.npc === "number" && i.npc > 0 && i.leilao / i.npc >= 3)
    // Ordena pela RAZÃO leilão/NPC, não por "quanto daria no total" —
    // multiplicar oferta por quantidade é exatamente o erro que esta versão
    // está corrigindo, e ele não pode voltar nem como critério de ordenação.
    .sort((a, b) => b.leilao / b.npc - a.leilao / a.npc)
    .slice(0, 5);
  if (naoVenda.length) {
    partes.push('<div class="ecoSub">Vale olhar antes de vender</div>');
    for (const i of naoVenda) {
      partes.push(
        `<div class="ecoRow"><span>${escapeHtml(i.nome)} ×${fmtNum(i.qtd)}</span><b>${fmtNum(i.npc)} no NPC · <em class="ecoUp">${fmtNum(i.leilao)} pedido no leilão</em></b></div>`
      );
    }
    partes.push('<p class="fieldHint">Preço de leilão é o que <b>alguém está pedindo</b>, não o que você receberia — a tabela do jogo tem item barato anunciado por milhões. Serve pra notar o que não vale a venda rápida, não pra somar.</p>');
  }
  if (ec.itensSemPreco > 0) {
    partes.push(
      `<p class="fieldHint">${ec.itensSemPreco} ${ec.itensSemPreco === 1 ? "item ficou" : "itens ficaram"} de fora da soma por não ter preço na tabela do jogo.</p>`
    );
  }
  if (ec.custos && ec.custos.length) {
    partes.push('<div class="ecoSub">Gasto</div>');
    for (const c of ec.custos) {
      partes.push(
        `<div class="ecoRow"><span>${escapeHtml(c.nome || `${fmtNum(c.valorUnitario)} gp por uso`)} ×${c.vezes}</span><b>${fmtNum(c.total)}</b></div>`
      );
    }
  }
  if (ec.itens && ec.itens.length) {
    partes.push('<div class="ecoSub">Loot</div>');
    for (const i of ec.itens.slice(0, 8)) {
      const v = typeof i.npc === "number" ? fmtNum(i.npc * i.qtd) : "—";
      // v0.11.25 — mostra o preço PEDIDO por unidade, nunca `leilao * qtd`:
      // multiplicar uma oferta pela quantidade sugere um total realizável que
      // não existe.
      const l =
        typeof i.leilao === "number" && typeof i.npc === "number" && i.leilao > i.npc
          ? ` <em class="ecoUp">${fmtNum(i.leilao)} pedido</em>`
          : "";
      partes.push(`<div class="ecoRow"><span>${escapeHtml(i.nome)} ×${fmtNum(i.qtd)}</span><b>${v}${l}</b></div>`);
    }
  }
  if (ec.fonte === "gold") {
    partes.push('<p class="fieldHint">Números reconstruídos pelo Swag — o analisador do jogo é premium e não chega nesta conta.</p>');
  }
  return `<details class="hintMore ecoDetalhe"><summary>Detalhe do loot e do gasto</summary>${partes.join("")}</details>`;
}

function renderEconomia(st) {
  const el = document.getElementById("analyzerEconomia");
  if (!el) return;
  const ec = st && st.economia;
  if (!ec || !ec.escutaAtiva) {
    el.innerHTML =
      '<p class="fieldHint">Lucro real indisponível: a leitura do protocolo do jogo não está ativa nesta conta. Recarregue a conta para religar.</p>';
    return;
  }
  if (!ec.temPrecos) {
    el.innerHTML =
      '<p class="fieldHint">Esperando as tabelas de preço do jogo (elas chegam no login). Assim que chegarem, o lucro aparece aqui.</p>';
    return;
  }
  // v0.11.21 — André: "eu quero um analisador que entregue valor de verdade,
  // eu preciso que seja simples. qual foi o custo, e entregue o lucro/hora,
  // quanto de xp/h". Então o painel mostra SEIS números e mais nada: tempo,
  // mortes, XP, XP/h, custo, lucro e lucro/h.
  //
  // O que saiu da vista (loot a preço de NPC, loot a preço de leilão, a lista
  // item a item) não foi apagado — foi pro "Detalhe", fechado. A comparação
  // com o leilão foi pedida por ele há dois dias e continua útil pra decidir o
  // que NÃO mandar na venda rápida; só não precisa estar na cara o tempo todo.
  const r = ec.resumo;
  if (r) {
    const min = Math.floor(r.duracaoMs / 60000);
    const dur = min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}` : `${min}min`;
    const linhasResumo = [
      `<div class="ecoRow"><span>Tempo</span><b>${dur}</b></div>`,
      `<div class="ecoRow"><span>Mortes</span><b>${fmtNum(r.kills)}</b></div>`,
      `<div class="ecoRow"><span>XP</span><b>${fmtNum(r.xp)}</b></div>`,
      r.xpHora !== null ? `<div class="ecoRow"><span>XP por hora</span><b>${fmtNum(r.xpHora)}</b></div>` : "",
      `<div class="ecoRow"><span>Custo</span><b class="ecoNeg">−${fmtNum(r.custo)}</b></div>`,
      `<div class="ecoRow ecoTotal"><span>Lucro</span><b>${fmtNum(r.lucro)}</b></div>`,
      r.lucroHora !== null ? `<div class="ecoRow ecoTotal"><span>Lucro por hora</span><b>${fmtNum(r.lucroHora)}</b></div>` : "",
    ];
    el.innerHTML = linhasResumo.join("") + detalheDoLoot(ec);
    return;
  }

  const linhas = [];

  // v0.11.15 — quando o tipo 41 está chegando, os números são os do próprio
  // analisador do jogo (o premium), ao vivo e itemizados. Antes disso a gente
  // reconstruía o custo por delta de gold; esse caminho continua existindo pra
  // conta free, e o painel diz qual dos dois está valendo.
  if (ec.fonte === "protocolo" && ec.sessao) {
    const s = ec.sessao;
    const min = Math.floor(s.duracaoMs / 60000);
    const dur = min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}` : `${min}min`;
    linhas.push('<div class="ecoSub">Sessão de caçada (do jogo)</div>');
    linhas.push(`<div class="ecoRow"><span>Tempo</span><b>${dur}</b></div>`);
    linhas.push(`<div class="ecoRow"><span>Mortes</span><b>${fmtNum(s.kills)}</b></div>`);
    linhas.push(`<div class="ecoRow"><span>Experiência</span><b>${fmtNum(s.experience)}</b></div>`);
    if (s.porHora) {
      linhas.push(
        `<div class="ecoRow"><span>Por hora</span><b>${fmtNum(s.porHora.exp)} xp · ${fmtNum(s.porHora.saldo)} gp</b></div>`
      );
    }
    linhas.push('<div class="ecoSub">Resultado</div>');
  } else {
    // v0.11.18 — o André perguntou "será que não vem o tipo 41 na conta free?"
    // e a resposta não estava na tela. Agora está: quem olha o painel sabe se
    // o número veio do analisador do jogo ou da reconstrução por gold.
    linhas.push(
      '<p class="fieldHint">Calculado por diferença de gold — o analisador do jogo (que traz loot e gasto prontos) não chegou nesta conta.</p>'
    );
  }

  // v0.11.25 — "Loot (preço de leilão)" e "Saldo leiloando" saíram daqui pelo
  // mesmo motivo do bloco de detalhe: somar preço PEDIDO por jogadores não dá
  // dinheiro nenhum. Este caminho é legado (hoje o `resumo` sempre existe),
  // mas código morto que mente continua sendo passivo.
  linhas.push(
    `<div class="ecoRow"><span>Loot (preço de NPC)</span><b>${fmtNum(ec.valorNpc)}</b></div>`,
    `<div class="ecoRow"><span>Custo de suprimento</span><b class="ecoNeg">−${fmtNum(ec.custoTotal)}</b></div>`,
    `<div class="ecoRow ecoTotal"><span>Saldo vendendo no NPC</span><b>${fmtNum(ec.saldoNpc)}</b></div>`
  );
  if (ec.itensSemPreco > 0) {
    linhas.push(
      `<p class="fieldHint">${ec.itensSemPreco} ${ec.itensSemPreco === 1 ? "item ficou" : "itens ficaram"} de fora da soma por não ter preço na tabela do jogo.</p>`
    );
  }
  if (ec.custos && ec.custos.length) {
    linhas.push('<div class="ecoSub">Gasto</div>');
    for (const c of ec.custos) {
      linhas.push(
        `<div class="ecoRow"><span>${escapeHtml(c.nome || `${fmtNum(c.valorUnitario)} gp por uso`)} ×${c.vezes}</span><b>${fmtNum(c.total)}</b></div>`
      );
    }
  }
  if (ec.itens && ec.itens.length) {
    linhas.push('<div class="ecoSub">Loot</div>');
    for (const i of ec.itens.slice(0, 8)) {
      const v = typeof i.npc === "number" ? fmtNum(i.npc * i.qtd) : "—";
      const l = typeof i.leilao === "number" && typeof i.npc === "number" && i.leilao > i.npc
        ? ` <em class="ecoUp">${fmtNum(i.leilao)} pedido</em>`
        : "";
      linhas.push(`<div class="ecoRow"><span>${escapeHtml(i.nome)} ×${fmtNum(i.qtd)}</span><b>${v}${l}</b></div>`);
    }
  }
  el.innerHTML = linhas.join("");
}

function renderAnalyzer() {
  const state = selectedAutomationTabId ? automationState.get(selectedAutomationTabId) || {} : {};
  const st = state.stats;

  if (!st) {
    analyzerSessionEl.innerHTML =
      '<p class="fieldHint">Sem dados ainda nesta conta — os números começam a contar assim que ela carrega o jogo.</p>';
  } else {
    const gh = porHora(st.gold, st.elapsedMs);
    const xh = porHora(st.xp, st.elapsedMs);
    analyzerSessionEl.innerHTML = [
      tile("tempo", fmtDur(st.elapsedMs)),
      tile("ciclos", String(st.cycles || 0)),
      tile("gold vendido", fmtNum(st.gold), gh ? `${fmtNum(gh)}/h` : ""),
      tile("xp", fmtNum(st.xp), xh ? `${fmtNum(xh)}/h` : ""),
      tile("level", st.levelNow == null ? "—" : String(st.levelNow), st.levelsGanhos ? `+${st.levelsGanhos} na sessão` : ""),
    ].join("");
  }

  renderEconomia(st);

  const ag = statsAgregado();
  analyzerTotalEl.innerHTML = ag.contas
    ? [
        tile("contas", String(ag.contas)),
        tile("gold vendido", fmtNum(ag.gold), porHora(ag.gold, ag.ms) ? `${fmtNum(porHora(ag.gold, ag.ms))}/h` : ""),
        tile("xp", fmtNum(ag.xp), porHora(ag.xp, ag.ms) ? `${fmtNum(porHora(ag.xp, ag.ms))}/h` : ""),
        tile("ciclos", String(ag.cycles)),
      ].join("")
    : '<p class="fieldHint">Nenhuma conta reportando ainda.</p>';
  analyzerBestEl.textContent =
    ag.melhor && ag.melhor.porHora
      ? `Rendendo mais agora: ${ag.melhor.nome} (${fmtNum(ag.melhor.porHora)} gold/h).`
      : "";

  const dias = (statsHistorico && statsHistorico.dias) || {};
  const chaves = Object.keys(dias).sort().reverse().slice(0, 7);
  analyzerHistoryEl.innerHTML = chaves.length
    ? chaves
        .map((dia) => {
          const doDia = dias[dia] || {};
          const soma = Object.values(doDia).reduce(
            (a, x) => ({ gold: a.gold + (x.gold || 0), xp: a.xp + (x.xp || 0), ms: a.ms + (x.ms || 0) }),
            { gold: 0, xp: 0, ms: 0 }
          );
          const [, m, d] = dia.split("-");
          return `<div class="dayRow"><span class="dayWhen">${escapeHtml(`${d}/${m}`)}</span>
            <span class="dayGold">${escapeHtml(fmtNum(soma.gold))} gold</span>
            <span class="dayXp">${escapeHtml(fmtNum(soma.xp))} xp</span>
            <span class="dayTime">${escapeHtml(fmtDur(soma.ms))}</span></div>`;
        })
        .join("")
    : '<p class="fieldHint">Ainda sem histórico. Cada dia é fechado conforme as contas rodam.</p>';
}

automationMinimizeAnalyzerToggle.addEventListener("change", () => {
  if (!selectedAutomationTabId) return;
  sendAutomationCommand(selectedAutomationTabId, {
    type: "setConfig",
    payload: { minimizeGameAnalyzer: automationMinimizeAnalyzerToggle.checked },
  });
});

function absorbCatalogFromState(tabId, state) {
  const patch = {};
  if (state.fullCatalog) {
    patch.names = state.fullCatalog.names;
    patch.tiersByHunt = state.fullCatalog.tiersByHunt;
  } else {
    if (Array.isArray(state.huntNames) && state.huntNames.length) patch.names = state.huntNames;
    if (Array.isArray(state.tiers) && state.tiers.length && state.huntName) {
      patch.tiersByHunt = { [state.huntName]: state.tiers };
    }
  }
  if (!patch.names && !patch.tiersByHunt) return;

  // Atualiza a cópia em memória na hora (a gravação em disco é assíncrona,
  // mas o dropdown não precisa esperar por ela).
  if (patch.names) sharedHuntCatalog.names = patch.names;
  if (patch.tiersByHunt) {
    sharedHuntCatalog.tiersByHunt = { ...sharedHuntCatalog.tiersByHunt, ...patch.tiersByHunt };
  }
  persistSharedCatalog(patch);

  // Uma conta acabou de mapear o catálogo inteiro — passa pras outras, que
  // assim nunca precisam repetir a varredura.
  if (state.fullCatalog) {
    for (const id of guestReady) {
      if (id !== tabId) seedCatalogInto(id);
    }
  }
}

// v0.11.20 — o que o detector de spawn seco está enxergando AGORA.
//
// Sem isso, "o detector não está legal" não vira diagnóstico: não dá pra saber
// se ele está vendo criatura, qual ritmo aprendeu ou quanto falta pro limiar.
// Dois defeitos sérios (o rastro de posição nunca ligava, e o ritmo aprendido
// era sempre zero) ficaram meses invisíveis por não existir esta linha.
function renderSpawnLive(state) {
  const el = document.getElementById("spawnLive");
  if (!el) return;
  const s = state && state.spawnVivo;
  if (!s) {
    el.textContent = "Sem dados ainda — o detector só mede com o personagem numa caçada.";
    return;
  }
  const partes = [];
  partes.push(`${s.vivos} ${s.vivos === 1 ? "criatura viva" : "criaturas vivas"}`);
  partes.push(`sem nascer há ${Math.round(s.paradoMs / 1000)}s`);

  // v0.11.33 — os dois critérios aprendidos POR CAÇADA, cada um dizendo onde
  // está e do que precisa. O painel antigo só mostrava "aprendendo o ritmo
  // (0/8)" e era exatamente esse 0/8 que denunciava que o critério de tempo
  // nunca calibrava — o texto tem que deixar isso visível, não escondê-lo.
  if (s.loteLimiarMs) {
    partes.push(`lote normal ~${Math.round(s.loteTipicoMs / 1000)}s, sai com ${Math.round(s.loteLimiarMs / 1000)}s`);
  } else {
    partes.push(`aprendendo o ritmo dos lotes (${s.loteAmostras}/${s.loteMinimo})`);
  }
  if (s.tilesLimiar) {
    partes.push(`andou ${s.tilesAndados} tiles sem matar (normal ${s.tilesTipicos}, sai com ${s.tilesLimiar})`);
  } else if (!s.seguindoMeuId) {
    // v0.11.42 — sem o id do personagem não há rastro, e sem rastro o critério
    // de tiles não existe. Dizer "aprendendo o mapa" aqui seria mentira: ele
    // nunca ia aprender.
    partes.push("rastro de posição indisponível — o critério de tiles está desligado");
  } else {
    partes.push(`aprendendo o mapa (${s.tilesAmostras}/${s.tilesMinimo} mortes)`);
  }
  if (s.mortesNaVoltaAnterior !== null && s.mortesNaVoltaAnterior !== undefined) {
    partes.push(`${s.mortesNaVoltaAnterior} mortes na última volta`);
  }
  // Se o id do personagem não foi descoberto, o critério da volta está
  // desligado — e isso precisa aparecer, não ficar em silêncio.
  if (!s.seguindoMeuId) partes.push("posição do personagem indisponível");
  el.textContent = `${s.cacada ? s.cacada + ": " : ""}${partes.join(" · ")}.`;
}

// ---------- v0.12.2 — DESEMPENHO: medir antes de otimizar ----------
//
// André mandou o Gerenciador de Tarefas com 3 contas abertas: "Electron (8)",
// 2.840 MB, 32% de CPU. O Windows soma o app inteiro num número só, e com um
// número só não dá pra decidir nada — não dá pra saber se o custo está no jogo
// de cada conta, no processo de vídeo, ou na nossa interface. Sem essa
// separação, toda otimização daqui pra frente seria chute.
//
// A v0.12.1 atacou TRAVADA (jank), que é outra coisa: gravação síncrona em
// disco e layout forçado dentro da thread que desenha o jogo. Isso não era pra
// mudar o total de RAM, e não mudou. Este painel existe pra parar de confundir
// os dois problemas.

const PERF_INTERVALO_MS = 4000;
const PERF_PURGE_KEY = "hm_perf_purge_v1";
const PERF_PURGE_INTERVALO_MS = 2 * 60000;
let perfPurgeUltimoEm = 0;
let perfPurgeEmAndamento = false;
let perfUltimaAmostraEm = 0;

// Só o renderer sabe qual <webview> é qual conta — o main.js enxerga pids.
function mapaDeContasParaMedicao() {
  const mapa = {};
  for (const tab of tabs) {
    const wv = getWebview(tab.id);
    if (!wv) continue;
    try {
      const wcId = wv.getWebContentsId();
      if (wcId) mapa[tab.label || tab.id] = wcId;
    } catch (err) {
      // webview ainda anexando — entra na próxima medição
    }
  }
  return mapa;
}

function rotuloDoProcesso(tipo) {
  if (tipo === "Browser") return "Núcleo do app";
  if (tipo === "GPU") return "Vídeo (GPU)";
  if (tipo === "Utility") return "Serviço interno";
  if (tipo === "Tab") return "Página sem conta identificada";
  return tipo || "Outro";
}

function fmtMb(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function renderPerfLiveAge() {
  const el = document.getElementById("perfLiveAge");
  if (!el) return;
  if (!perfUltimaAmostraEm) {
    el.textContent = "Aguardando a primeira amostra.";
    return;
  }
  const segundos = Math.max(0, Math.floor((Date.now() - perfUltimaAmostraEm) / 1000));
  el.textContent = segundos === 0 ? "Atualizado agora." : `Atualizado há ${segundos}s.`;
}

async function renderPerfLive() {
  const el = document.getElementById("perfLive");
  if (!el) return;

  // v0.12.4 — o painel NUNCA pode ficar mudo. Na v0.12.2 ele ficou "Medindo…"
  // pra sempre na máquina do André e não havia como saber de onde: preload
  // velho? handler não registrado? erro no meio? Cada motivo agora tem uma
  // frase própria. Painel de diagnóstico que não diagnostica a si mesmo é o
  // mesmo defeito que o detector de spawn seco teve por meses.
  if (!window.hunteraFarm || typeof window.hunteraFarm.getPerfMetrics !== "function") {
    el.textContent = "Esta versão do app ainda não tem a medição — feche e abra o Swag de novo.";
    return;
  }

  let r = null;
  let erro = null;
  try {
    r = await window.hunteraFarm.getPerfMetrics(mapaDeContasParaMedicao());
  } catch (err) {
    erro = (err && err.message) || String(err);
  }
  if (erro) {
    el.textContent = `Não consegui medir: ${erro}`;
    return;
  }
  if (r && r.erro) {
    el.textContent = `Não consegui medir: ${r.erro}`;
    return;
  }
  if (!r || !r.processos || !r.processos.length) {
    el.textContent = "Não consegui medir agora — nenhum processo foi reportado.";
    return;
  }
  perfUltimaAmostraEm = Date.now();
  const linhas = [
    `<b>${escapeHtml(fmtMb(r.totalMemoriaMb))}</b> e <b>${r.totalCpu}%</b> de CPU em ${r.processos.length} processos.`,
  ];
  for (const p of r.processos) {
    // Processo de poucos MB é ruído de Chromium, não decisão de otimização.
    if (p.memoriaMb < 20) continue;
    const nome = p.conta || rotuloDoProcesso(p.tipo);
    linhas.push(`${escapeHtml(nome)} — ${escapeHtml(fmtMb(p.memoriaMb))} · ${p.cpu}%`);
  }
  el.innerHTML = linhas.join("<br>");
  renderPerfLiveAge();
}

let perfFeedbackVisualTimer = null;
function iniciarFeedbackVisualDeDesempenho() {
  if (perfFeedbackVisualTimer) return;
  perfFeedbackVisualTimer = setInterval(() => {
    renderPerfDiagStatus();
    renderPerfLiveAge();
  }, 1000);
}

// ---------- liberar memória das contas em segundo plano ----------
//
// A v0.4.4 desligou o backgrounding de renderer no app inteiro pra o jogo não
// desconectar com a janela minimizada. O efeito colateral é que o Chromium
// também para de fazer o PURGE de memória que ele faria sozinho numa aba
// parada. Isto pede o purge na mão, só pras contas que não estão na tela.
//
// Conta visível nunca entra: purgar o heap de quem está sendo olhado força uma
// coleta no meio do render.
function contasParaPurgar() {
  const ids = [];
  for (const tab of tabs) {
    // No modo grade todas estão visíveis — não sobra ninguém pra purgar.
    if (gridMode) continue;
    if (tab.id === activeTabId) continue;
    const wv = getWebview(tab.id);
    if (!wv) continue;
    try {
      const wcId = wv.getWebContentsId();
      if (wcId) ids.push(wcId);
    } catch (err) {
      // ainda anexando
    }
  }
  return ids;
}

async function perfPurgar(ids) {
  if (!ids.length || perfPurgeEmAndamento) return null;
  perfPurgeEmAndamento = true;
  try {
    return await window.hunteraFarm.purgeMemory(ids);
  } catch (err) {
    return null;
  } finally {
    perfPurgeEmAndamento = false;
    perfPurgeUltimoEm = Date.now();
  }
}

function perfPurgeLigado() {
  try {
    return localStorage.getItem(PERF_PURGE_KEY) === "1";
  } catch (err) {
    return false;
  }
}

function iniciarPainelDeDesempenho() {
  // v0.12.4 — se qualquer coisa aqui estourar, o painel tem que DIZER, não
  // ficar em "Medindo…". Foi assim que a v0.12.2 falhou em silêncio.
  try {
    montarPainelDeDesempenho();
    iniciarFeedbackVisualDeDesempenho();
  } catch (err) {
    const el = document.getElementById("perfLive");
    if (el) el.textContent = `A medição não iniciou: ${(err && err.message) || err}`;
  }
}

function montarPainelDeDesempenho() {
  const toggle = document.getElementById("perfPurgeToggle");
  const botao = document.getElementById("perfPurgeNowBtn");
  if (toggle) {
    toggle.checked = perfPurgeLigado();
    toggle.addEventListener("change", () => {
      try {
        localStorage.setItem(PERF_PURGE_KEY, toggle.checked ? "1" : "0");
      } catch (err) {
        // localStorage bloqueado — o toggle vale só para esta sessão
      }
    });
  }
  if (botao) {
    botao.addEventListener("click", async () => {
      // No botão manual vale purgar TODAS, inclusive a visível: aqui foi o
      // usuário que pediu, agora, olhando o número.
      const ids = [];
      for (const tab of tabs) {
        const wv = getWebview(tab.id);
        if (!wv) continue;
        try {
          const wcId = wv.getWebContentsId();
          if (wcId) ids.push(wcId);
        } catch (err) {
          // ainda anexando
        }
      }
      botao.disabled = true;
      const antes = await window.hunteraFarm.getPerfMetrics(mapaDeContasParaMedicao()).catch(() => null);
      await perfPurgar(ids);
      const depois = await window.hunteraFarm.getPerfMetrics(mapaDeContasParaMedicao()).catch(() => null);
      botao.disabled = false;
      const el = document.getElementById("perfLive");
      if (el && antes && depois) {
        const ganho = antes.totalMemoriaMb - depois.totalMemoriaMb;
        el.innerHTML =
          `Liberou <b>${escapeHtml(fmtMb(Math.max(0, ganho)))}</b> ` +
          `(${escapeHtml(fmtMb(antes.totalMemoriaMb))} → ${escapeHtml(fmtMb(depois.totalMemoriaMb))}).`;
        // volta pra medição normal na próxima rodada
        setTimeout(renderPerfLive, PERF_INTERVALO_MS);
      } else {
        renderPerfLive();
      }
    });
  }

  // v0.12.4 — mede JÁ. Antes a primeira medição só vinha depois de 4s, e o
  // painel abria em "Medindo…" mesmo quando tudo funcionava.
  renderPerfLive();

  setInterval(() => {
    // v0.12.4 — aqui havia um `el.offsetParent !== null` pra "só medir com a
    // seção aberta". Foi ele que deixou o painel do André mudo por minutos: a
    // condição nunca passou naquela máquina, e como ela ficava ANTES da
    // primeira linha de texto, nada nunca era escrito. Não economizava nada
    // (uma chamada de IPC a cada 4s) e tinha exatamente um modo de falha —
    // esse. Otimização que só podia perder: removida.
    renderPerfLive();

    if (!perfPurgeLigado()) return;
    if (Date.now() - perfPurgeUltimoEm < PERF_PURGE_INTERVALO_MS) return;
    perfPurgar(contasParaPurgar());
  }, PERF_INTERVALO_MS);
}

// ---------- v0.12.3 — FREIO DO LOOP DE RENDER ----------
//
// Ideia do André: "aba minimizada não renderiza o jogo e fica só troca de
// mensagens". Não dá pra fazer trocando o cliente por um WebSocket direto (o
// protocolo é criptografado — ver `codigoDoFreioNaPagina` no
// content-injected.js), mas dá pra fazer o efeito: o caro é o loop do Phaser,
// e ele é separável do socket.
//
// Aqui mora só a DECISÃO de quem freia. O "como" está na página.

const FREIO_KEY = "hm_freio_render_v1";
let janelaVisivel = true;
const freioAplicado = new Map(); // tabId -> boolean, pra não reenviar o mesmo comando

function freioLigado() {
  try {
    return localStorage.getItem(FREIO_KEY) === "1";
  } catch (err) {
    return false;
  }
}

// Uma conta é freada quando NINGUÉM está olhando pra ela:
// - janela minimizada/escondida: ninguém vê nenhuma, nem a selecionada;
// - modo grade: todas estão na tela, ninguém freia;
// - modo normal: freia todas menos a selecionada.
function deveFrear(tabId) {
  if (!freioLigado()) return false;
  if (!janelaVisivel) return true;
  if (gridMode) return false;
  return tabId !== activeTabId;
}

function aplicarFreioDeRender() {
  for (const tab of tabs) {
    const alvo = deveFrear(tab.id);
    if (freioAplicado.get(tab.id) === alvo) continue;
    freioAplicado.set(tab.id, alvo);
    sendAutomationCommand(tab.id, { type: "setRenderBrake", payload: { on: alvo } });
  }
}

// Soltar o freio de todas — usado ao desligar o toggle, pra nenhuma conta
// ficar presa a 2 fps por causa de um estado antigo.
function soltarFreioDeTodas() {
  for (const tab of tabs) {
    freioAplicado.set(tab.id, false);
    sendAutomationCommand(tab.id, { type: "setRenderBrake", payload: { on: false } });
  }
}

function iniciarFreioDeRender() {
  const toggle = document.getElementById("renderBrakeToggle");
  if (toggle) {
    toggle.checked = freioLigado();
    toggle.addEventListener("change", () => {
      try {
        localStorage.setItem(FREIO_KEY, toggle.checked ? "1" : "0");
      } catch (err) {
        // localStorage bloqueado — vale só para esta sessão
      }
      if (toggle.checked) aplicarFreioDeRender();
      else soltarFreioDeTodas();
    });
  }

  try {
    window.hunteraFarm.onAppVisibilityChanged((visivel) => {
      janelaVisivel = visivel;
      aplicarFreioDeRender();
    });
  } catch (err) {
    // versão antiga do preload — o freio segue valendo por conta selecionada
  }

  // Rede de segurança: uma conta que acabou de ficar pronta (ou que recarregou
  // e perdeu o atributo no <html>) precisa receber o estado atual. O comando é
  // barato e `freioAplicado` evita reenvio, mas o mapa é limpo aqui de tempos
  // em tempos pra reconciliar quem recarregou.
  setInterval(() => {
    freioAplicado.clear();
    aplicarFreioDeRender();
  }, 30000);
}

function syncAutomationPanel() {
  const tabId = selectedAutomationTabId;
  if (!tabId) return;
  const state = automationState.get(tabId) || {};
  renderSpawnLive(state);

  automationDotEl.classList.toggle("on", !!state.running || !!state.hunting);
  automationDotEl.classList.toggle("err", state.status === "Erro");
  // v0.9.16 — o texto do status acompanha a cor do ponto (antes só o ponto
  // colorido carregava o estado, num texto cinza de 11.5px).
  const statusLineEl = automationDotEl.parentElement;
  statusLineEl.classList.toggle("on", state.status !== "Erro" && (!!state.running || !!state.hunting));
  statusLineEl.classList.toggle("err", state.status === "Erro");
  // v0.9.24 — mesma lógica da lista: com a automação desligada o painel
  // mostra o que o personagem está fazendo, não "Parado" pra tudo.
  automationStatusTextEl.textContent = guestReady.has(tabId)
    ? state.running
      ? state.status || "Ligada"
      : acctStatusFor(tabId).text
    : "carregando…";
  automationCyclesEl.textContent = state.cycles ? `${state.cycles} ciclo${state.cycles === 1 ? "" : "s"}` : "";

  automationToggleBtn.innerHTML = state.running
    ? '<svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><rect x="5" y="5" width="10" height="10" rx="2"/></svg>Desligar automação'
    : '<svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M5 3.5v13l11-6.5Z"/></svg>Ligar automação';
  automationToggleBtn.className = "autoToggleBtn " + (state.running ? "on" : "off");
  automationToggleBtn.disabled = !guestReady.has(tabId);

  // v0.9.16 — os dois dropdowns caem no catálogo compartilhado do disco
  // quando a conta ainda não respondeu. Antes, "Tamanho do pull" só era
  // preenchido pelo que ESSA conta tivesse acabado de raspar do jogo — por
  // isso vinha vazio o tempo todo.
  const names = (Array.isArray(state.huntNames) && state.huntNames.length)
    ? state.huntNames
    : sharedHuntCatalog.names;
  if (document.activeElement !== automationHuntSelect) {
    if (names.length) {
      automationHuntSelect.innerHTML =
        '<option value="">— escolha —</option>' +
        names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
      automationHuntSelect.value = state.huntName || "";
    } else if (state.huntsLoading) {
      automationHuntSelect.innerHTML = '<option value="">— carregando —</option>';
    } else if (state.huntsError) {
      automationHuntSelect.innerHTML = '<option value="">— faça login e clique em ↻ Mapear —</option>';
    }
  }

  if (document.activeElement !== automationTierSelect) {
    const tiers = (Array.isArray(state.tiers) && state.tiers.length)
      ? state.tiers
      : (state.huntName && sharedHuntCatalog.tiersByHunt[state.huntName]) || null;
    if (tiers && tiers.length) {
      automationTierSelect.innerHTML = tiers
        .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
        .join("");
      if (tiers.includes(state.pullLevel)) automationTierSelect.value = state.pullLevel;
    } else if (state.tiersLoading || state.catalogSweeping) {
      automationTierSelect.innerHTML = '<option value="">— carregando —</option>';
    } else if (state.huntName) {
      automationTierSelect.innerHTML = '<option value="">— clique em ↻ Mapear —</option>';
    } else {
      automationTierSelect.innerHTML = '<option value="">— escolha uma caçada —</option>';
    }
  }

  // Progresso da varredura do catálogo.
  if (state.catalogSweeping) {
    const p = state.catalogProgress;
    automationRefreshBtn.textContent = p ? `Mapeando ${p.done}/${p.total}…` : "Mapeando…";
    automationRefreshBtn.disabled = true;
  } else {
    automationRefreshBtn.innerHTML = REFRESH_BTN_HTML;
    automationRefreshBtn.disabled = false;
  }

  if (document.activeElement !== automationCapacityInput && state.capacityThreshold != null) {
    automationCapacityInput.value = state.capacityThreshold;
  }

  // v0.9.15 — default LIGADO: `undefined` (config antiga, antes do campo
  // existir) tem que aparecer marcado, igual ao que o content script faz com
  // `cfg.autoSellOnCityArrival !== false`.
  automationAutoSellCityToggle.checked = state.autoSellOnCityArrival !== false;
  automationRotateToggle.checked = !!state.rotateCharactersEnabled;
  if (!automationRotateListEl.contains(document.activeElement)) renderRotateList(state);
  // v0.11.9 — default LIGADO (mesmo padrão do "sempre vender na cidade"):
  // config antiga, sem o campo, tem que aparecer marcada.
  automationAutoRestartToggle.checked = state.autoRestartAfterOutage !== false;
  // v0.11.8 — aba Treino. Desligado por padrão: é feature nova, ninguém pediu
  // pra começar treinando sozinho.
  automationExpeditionToggle.checked = !!state.expeditionEnabled;
  renderExpedicao(state);
  automationTrainStaminaToggle.checked = !!state.trainOnStaminaZero;
  automationTrainIdleToggle.checked = !!state.trainOnIdleInCity;
  automationTrainIdleFieldsEl.hidden = !automationTrainIdleToggle.checked;
  if (document.activeElement !== automationTrainIdleInput && state.trainIdleMinutes != null) {
    automationTrainIdleInput.value = state.trainIdleMinutes;
  }
  if (!automationTrainSkillListEl.contains(document.activeElement)) renderTrainSkillList(state);
  automationMinimizeAnalyzerToggle.checked = state.minimizeGameAnalyzer !== false;
  renderAnalyzer();
  if (document.activeElement !== automationStaminaInput && state.staminaResumeThreshold != null) {
    automationStaminaInput.value = state.staminaResumeThreshold;
  }

  // v0.7.0 — campos de Party (checkbox nunca "rouba" foco, então dá pra
  // sincronizar sem guarda; o input de texto segue o mesmo padrão de
  // não-sobrescrever-enquanto-digita dos outros campos acima).
  automationAutoAcceptToggle.checked = !!state.autoAcceptParty;
  if (document.activeElement !== automationAllowlistInput && Array.isArray(state.autoAcceptPartyAllowlist)) {
    automationAllowlistInput.value = state.autoAcceptPartyAllowlist.join(", ");
  }
  automationSyncEkToggle.checked = !!state.syncEkTarget;
  automationKeepTargetToggle.checked = !!state.autoKeepCurrentTarget;

  // v0.9.6 — Time (auto convidar pra party).
  automationPartyLeaderToggle.checked = !!state.isPartyLeader;
  automationAutoInvitePartyToggle.checked = !!state.autoInvitePartyEnabled;
  if (document.activeElement !== automationInvitePartyTargetsInput && Array.isArray(state.autoInvitePartyTargets)) {
    automationInvitePartyTargetsInput.value = state.autoInvitePartyTargets.join(", ");
  }
  const huntMode = state.huntMode === "group" ? "group" : "solo";
  huntModeSegSolo.classList.toggle("active", huntMode === "solo");
  huntModeSegGroup.classList.toggle("active", huntMode === "group");
  huntModeHint.textContent = huntModeHintText(huntMode, !!state.isPartyLeader);
  huntModeDetail.textContent = huntModeDetailText(huntMode, !!state.isPartyLeader);

  // v0.8.0 — auto retomar sessão.
  automationResumeSessionToggle.checked = !!state.autoResumeSessionEnabled;
  // v0.9.21 — "Personagem a retomar" virou lista. Era um campo de texto com
  // o MESMO dado que o rodízio já escolhe por checkbox, e um typo aqui falha
  // calado justo no pior momento: quando a sessão cai e ninguém está olhando.
  // A lista vem da conta (capturada na tela de seleção, v0.9.20).
  renderResumeCharacterSelect(state);

  // v0.5.0 — mostra a stamina atual lida do jogo ao lado do status, só
  // enquanto a automação está ligada (senão fica poluindo à toa).
  automationStaminaEl.textContent =
    state.running && state.staminaLeft != null
      ? `${state.cycles ? " · " : ""}stamina ${formatStaminaLabel(state.staminaLeft)}`
      : "";

  renderAutomationLog(Array.isArray(state.log) ? state.log : [], tabId);
}

// v0.9.30 — histórico com hora. O guest já gravava `at` (Date.now()) em cada
// entrada desde sempre, só que o painel jogava fora — dava pra ver O QUE
// aconteceu, nunca QUANDO. Além disso mostrava só as 8 últimas num painel que
// cabe muito mais (o André: "poderia aproveitar melhor o espaço"), então agora
// desenha o histórico inteiro que o guest guarda e deixa rolar.
function formatLogClock(at) {
  if (!at) return "--:--:--";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function formatLogDay(at) {
  const d = new Date(at);
  const dia = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const hoje = new Date();
  const mesmoDia =
    d.getFullYear() === hoje.getFullYear() &&
    d.getMonth() === hoje.getMonth() &&
    d.getDate() === hoje.getDate();
  const ontem = new Date(hoje.getTime() - 86400000);
  const eOntem =
    d.getFullYear() === ontem.getFullYear() &&
    d.getMonth() === ontem.getMonth() &&
    d.getDate() === ontem.getDate();
  if (mesmoDia) return `Hoje · ${dia}`;
  if (eOntem) return `Ontem · ${dia}`;
  return dia;
}

// Redesenhar 120 linhas a cada `hm:state` (que chega o tempo todo) faria a
// lista piscar e perder a rolagem justo enquanto o André está lendo. Só
// redesenha quando o log de fato mudou.
let logAssinatura = null;
function renderAutomationLog(log, tabId) {
  const assinatura = `${tabId}|${log.length}|${log.length ? log[log.length - 1].at : 0}`;
  if (assinatura === logAssinatura) return;
  logAssinatura = assinatura;
  if (!log.length) {
    automationLogEl.innerHTML = `<p class="logEmpty">Nada registrado ainda nesta conta.</p>`;
    return;
  }
  // Mais recente em cima; separador quando a data muda descendo a lista.
  let diaAtual = null;
  const linhas = [];
  for (const entry of log.slice().reverse()) {
    const dia = entry.at ? formatLogDay(entry.at) : null;
    if (dia && dia !== diaAtual) {
      diaAtual = dia;
      linhas.push(`<div class="logDay">${escapeHtml(dia)}</div>`);
    }
    linhas.push(
      `<div class="logRow"><span class="logTime">${formatLogClock(entry.at)}</span>` +
        `<span class="logMsg">${escapeHtml(entry.message)}</span></div>`,
    );
  }
  automationLogEl.innerHTML = linhas.join("");
}

// v0.7.0 — painel de Configurações (Telegram). É global (uma config só pro
// app inteiro, não por conta — ver comentário nas consts lá em cima), então
// não depende de nenhuma conta selecionada: só busca do processo principal
// (main.js guarda num telegram.json, igual tabs.json) toda vez que o painel
// abre.
function syncSettingsPanel() {
  // v0.11.10 — a aba "Caçada" das Configurações lê a config global do
  // detector de spawn seco toda vez que o painel abre.
  carregarSpawnConfig();
  window.hunteraFarm
    .loadTelegramConfig()
    .then((cfg) => {
      cfg = cfg || {};
      telegramEnabledToggle.checked = !!cfg.enabled;
      if (document.activeElement !== telegramTokenInput) telegramTokenInput.value = cfg.botToken || "";
      if (document.activeElement !== telegramChatIdInput) telegramChatIdInput.value = cfg.chatId || "";
      telegramNotifyAllToggle.checked = !!cfg.notifyAll;
    })
    .catch(() => {
      // Se a leitura falhar por qualquer motivo, deixa os campos como
      // estavam em vez de travar a abertura do painel.
    });
  telegramTestResultEl.textContent = "";
  telegramTestResultEl.className = "telegramTestResult";
}

function saveTelegramField(partial) {
  window.hunteraFarm
    .saveTelegramConfig({
      enabled: telegramEnabledToggle.checked,
      botToken: telegramTokenInput.value.trim(),
      chatId: telegramChatIdInput.value.trim(),
      notifyAll: telegramNotifyAllToggle.checked,
      ...partial,
    })
    .catch(() => {});
}

telegramEnabledToggle.addEventListener("change", () => saveTelegramField({ enabled: telegramEnabledToggle.checked }));
telegramTokenInput.addEventListener("change", () => saveTelegramField({ botToken: telegramTokenInput.value.trim() }));
telegramChatIdInput.addEventListener("change", () => saveTelegramField({ chatId: telegramChatIdInput.value.trim() }));
telegramNotifyAllToggle.addEventListener("change", () =>
  saveTelegramField({ notifyAll: telegramNotifyAllToggle.checked })
);

telegramTestBtn.addEventListener("click", () => {
  telegramTestBtn.disabled = true;
  telegramTestResultEl.textContent = "Enviando…";
  telegramTestResultEl.className = "telegramTestResult";
  window.hunteraFarm
    .testTelegram({
      botToken: telegramTokenInput.value.trim(),
      chatId: telegramChatIdInput.value.trim(),
    })
    .then((result) => {
      if (result && result.ok) {
        telegramTestResultEl.textContent = "✓ Mensagem enviada — confira o Telegram.";
        telegramTestResultEl.className = "telegramTestResult ok";
      } else {
        telegramTestResultEl.textContent = "✗ " + (result?.error || "Falha ao enviar.");
        telegramTestResultEl.className = "telegramTestResult err";
      }
    })
    .catch((err) => {
      telegramTestResultEl.textContent = "✗ " + (err?.message || "Falha ao enviar.");
      telegramTestResultEl.className = "telegramTestResult err";
    })
    .finally(() => {
      telegramTestBtn.disabled = false;
    });
});

const GRID_COUNT_CLASSES = ["count-1", "count-2", "count-3", "count-4"];

// v0.7.1 — layout do modo grade se adapta a quantas contas existem, em vez
// de sempre forçar 2×2 (que sobrava célula vazia com 1-3 contas). Com 3
// contas, a conta ATIVA (a selecionada na lista, `activeTabId`) sempre vira
// a "principal" (maior, linha de cima) — clicar noutra conta na lista
// promove ela pro destaque, mesmo com o modo grade já ligado (ver CSS,
// `#webviewContainer.grid.count-3`).
function renderWebviews() {
  // v0.12.3 — trocar de conta ou entrar/sair do modo grade muda quem está
  // sendo visto, e portanto quem deve ficar com o render freado. Este é o
  // único ponto por onde as duas coisas passam.
  try {
    aplicarFreioDeRender();
  } catch (err) {
    // ainda inicializando — a rede de segurança de 30s reconcilia
  }
  containerEl.classList.toggle("grid", gridMode);
  containerEl.classList.remove(...GRID_COUNT_CLASSES);
  if (gridMode && tabs.length) {
    containerEl.classList.add(GRID_COUNT_CLASSES[Math.min(tabs.length, 4) - 1]);
  }

  tabs.forEach((tab, index) => {
    const wv = ensureWebview(tab);
    wv.classList.remove("gridSlotMain", "gridSlotB", "gridSlotC");
    if (gridMode) {
      wv.classList.remove("active");
      wv.classList.add("gridCell");
    } else {
      wv.classList.remove("gridCell");
      wv.classList.toggle("active", tab.id === activeTabId);
    }
    // v0.9.2 — FIX da tentativa da v0.9.1. André reportou ao vivo: "quando
    // ativa e desativa o multi janelas, está deslogando os personagens.
    // como se fosse abrindo outro navegador" — a v0.9.1 usava
    // `containerEl.appendChild(wv)` pra reordenar os <webview> no DOM, mas
    // mover um <webview> do Electron pra outra posição na árvore do DOM
    // FAZ ELE RECARREGAR DO ZERO (é a guest view atrás dele que reresseta,
    // não um reflow normal de elemento) — daí a sensação de "abriu outro
    // navegador"/perdeu a sessão, além de nunca mostrar a posição nova de
    // verdade (o recarregamento comia o efeito). Fix correto: nunca mexer
    // na posição do <webview> no DOM depois de criado — em vez disso, usar
    // a propriedade CSS `order` (funciona em grid, não só em flex) pra
    // mudar só a posição VISUAL de cada célula, com base no índice dela em
    // `tabs`. Cobre os casos de auto-placement (1/2/4 contas); o layout de
    // 3 contas continua usando `.gridSlotMain/B/C` (grid-area explícito),
    // que ignora `order` e já funcionava certo antes.
    wv.style.order = index;
  });

  if (gridMode && tabs.length === 3) {
    const mainTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
    const others = tabs.filter((t) => t !== mainTab);
    const mainWv = getWebview(mainTab.id);
    if (mainWv) mainWv.classList.add("gridSlotMain");
    const bWv = others[0] && getWebview(others[0].id);
    if (bWv) bWv.classList.add("gridSlotB");
    const cWv = others[1] && getWebview(others[1].id);
    if (cWv) cWv.classList.add("gridSlotC");
  }
}

// v0.9.23 — André: "quando eu estou com o bot aberto, e eu clico lá no
// personagem em cima, ele não altera a janela do bot. a janela do personagem
// e do bot deveriam estar interligadas". Antes eram duas seleções
// independentes: `activeTabId` (qual conta aparece na tela) e
// `selectedAutomationTabId` (de qual conta o painel mostra as configurações).
// Dava pra ficar vendo um personagem e mexendo na configuração de outro.
//
// Agora andam juntas, nos DOIS sentidos. A trava evita o vai-e-vem entre as
// duas funções, que se chamam mutuamente.
let sincronizandoSelecao = false;

function setActiveTab(id) {
  activeTabId = id;
  savePref("activeTabId", id || "");
  // Painel do bot aberto acompanha o personagem selecionado.
  if (id && selectedAutomationTabId && selectedAutomationTabId !== id && !sincronizandoSelecao) {
    sincronizandoSelecao = true;
    try {
      openAutomationPanel(id);
    } finally {
      sincronizandoSelecao = false;
    }
  }
  renderTabs();
  renderWebviews();
  updateToolbarState();
}

// v0.9.17 — André: "poderia ter um botão de switch entre os personagens,
// tipo tab. o tab altera entre os personagens quando está em tela cheia".
// Tab passa pro próximo, Shift+Tab volta, dando a volta no fim da lista.
// Só age no modo tela cheia (uma conta por vez) — no modo grade as quatro já
// estão à vista, então trocar "a ativa" não teria efeito visível.
function cycleActiveTab(direction) {
  if (gridMode || tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === activeTabId);
  const next = tabs[(((i < 0 ? 0 : i) + direction) % tabs.length + tabs.length) % tabs.length];
  if (next) setActiveTab(next.id);
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;
  // Não sequestra o Tab de quem está escrevendo: renomear conta
  // (contenteditable), barra de URL, campos da automação.
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))) return;
  if (gridMode || tabs.length < 2) return;
  e.preventDefault();
  cycleActiveTab(e.shiftKey ? -1 : 1);
});

function closeTab(id) {
  const wv = getWebview(id);
  if (wv) wv.remove();
  manualZoom.delete(id);
  savePref("manualZoom", JSON.stringify(Object.fromEntries(manualZoom)));
  loadedTabs.delete(id);
  automationState.delete(id);
  guestReady.delete(id);
  if (selectedAutomationTabId === id) closeAutomationPanel();
  tabs = tabs.filter((t) => t.id !== id);
  if (activeTabId === id) {
    activeTabId = tabs.length ? tabs[0].id : null;
    savePref("activeTabId", activeTabId || "");
  }
  persistTabs();
  renderTabs();
  renderWebviews();
  updateToolbarState();
}

function addTab() {
  if (tabs.length >= MAX_TABS) return;
  const id = nextTabId();
  const tab = { id, label: `Conta ${tabs.length + 1}`, createdAt: Date.now() };
  tabs.push(tab);
  activeTabId = id;
  savePref("activeTabId", id);
  persistTabs();
  renderTabs();
  renderWebviews();
  updateToolbarState();
}

function persistTabs() {
  // Rótulo + id + data de criação vão pro disco (ver comentário em
  // main.js) — nunca credenciais. Se a gravação falhar por qualquer
  // motivo, não trava o app.
  window.hunteraFarm.saveTabs(tabs).catch(() => {});
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// v0.5.0 — mesma formatação usada nos logs do content-injected.js, só pro
// texto curto ao lado do status ("· stamina 1h05" / "· stamina 42min").
function formatStaminaLabel(mins) {
  if (mins == null) return "?";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
}

// ---------- barra de ferramentas ----------
// Voltar/avançar/recarregar/URL só fazem sentido apontando pra UMA conta —
// ficam desativados no modo grade. O zoom continua ativo nos dois modos
// (no normal ajusta só a conta em foco; no grade ajusta as 4 juntas, ver
// applyZoom()).
// v0.9.22 — era "updateToolbarState": sincronizava a barra de URL, os botões
// de voltar/avançar e o zoom. A barra saiu inteira (ver index.html), então
// sobrou só o zoom, que é o que ainda depende de qual conta está ativa.
function updateToolbarState() {
  const factor = gridMode
    ? gridZoomOverride ?? ZOOM_GRID
    : activeTabId
    ? manualZoom.get(activeTabId) ?? ZOOM_NORMAL
    : ZOOM_NORMAL;
  updateZoomLabel(factor);
}

navReloadBtn.addEventListener("click", () => {
  const wv = getWebview(activeTabId);
  if (wv) wv.reload();
});

// v0.9.22 — popover do zoom na trilha. Fecha ao clicar fora ou no Esc, como
// qualquer menu — e o botão da trilha reflete se está aberto.
function setZoomPopoverOpen(open) {
  zoomPopover.hidden = !open;
  railZoomBtn.classList.toggle("on", open);
}
railZoomBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setZoomPopoverOpen(zoomPopover.hidden);
});
document.addEventListener("click", (e) => {
  if (zoomPopover.hidden) return;
  if (zoomPopover.contains(e.target) || railZoomBtn.contains(e.target)) return;
  setZoomPopoverOpen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !zoomPopover.hidden) setZoomPopoverOpen(false);
});

// v0.9.0 — persiste zoom (grade e por conta) igual ao resto do estado de
// sessão; savePref/loadPref já existem mais abaixo (função hoisted).
function persistZoomState() {
  savePref("manualZoom", JSON.stringify(Object.fromEntries(manualZoom)));
  savePref("gridZoomOverride", gridZoomOverride == null ? "" : String(gridZoomOverride));
}

function adjustZoom(delta) {
  if (gridMode) {
    gridZoomOverride = clampZoom((gridZoomOverride ?? ZOOM_GRID) + delta);
    applyZoomToAll();
  } else {
    if (!activeTabId) return;
    manualZoom.set(activeTabId, clampZoom((manualZoom.get(activeTabId) ?? ZOOM_NORMAL) + delta));
    const wv = getWebview(activeTabId);
    if (wv) applyZoom(wv);
  }
  updateToolbarState();
  persistZoomState();
}
zoomOutBtn.addEventListener("click", () => adjustZoom(-ZOOM_STEP));
zoomInBtn.addEventListener("click", () => adjustZoom(ZOOM_STEP));
zoomLabel.addEventListener("click", () => {
  if (gridMode) {
    gridZoomOverride = null;
    applyZoomToAll();
  } else if (activeTabId) {
    manualZoom.delete(activeTabId);
    const wv = getWebview(activeTabId);
    if (wv) applyZoom(wv);
  }
  updateToolbarState();
  persistZoomState();
});

// ---------- trilha de ícones + rodapé da barra lateral ----------

// v0.7.1 — André: "faz um botão hamburguer para recolher o menu". Recolhe o
// #sidebar inteiro pra largura 0 (ver CSS: `#app.sidebarCollapsed #sidebar`)
// — a trilha de ícones continua sempre visível (com o próprio ☰), então dá
// sempre pra abrir de volta.
// v0.9.0 — André: "garantir que tudo fique salvo de onde estava o último
// estado do aplicativo". Isso (e gridMode/zoom/tabs-collapsed/aba ativa
// logo abaixo) passou a persistir em localStorage (mesmo padrão dos temas
// da v0.8.0) e é restaurado logo no início do init() (bloco de
// restauração de sessão, ver comentário "v0.9.0 — restaura aba
// ativa/zoom/grade/recolhido" mais abaixo neste arquivo). Antes disso era
// "só de tela" de propósito — não é mais.
// v0.9.17 — "Trilha que expande" (opção B da proposta de layout, aprovada
// pelo André). O hambúrguer saiu: a trilha de 52px É o estado recolhido, e
// passar o mouse nela abre a barra; tirar o mouse recolhe. O antigo ☰ virou
// o "fixar aberto" (⚲), pra quando ele vai mexer em várias coisas seguidas.
//
// Isso resolve a queixa original ("eu não sei se gosto muito desse menu
// hambúrguer") sem o efeito colateral que o ☰ tinha: recolhido, a lista de
// contas sumia inteira e não dava pra notar que uma conta travou. Agora as
// contas moram TAMBÉM na trilha, com o pontinho de status — recolhido você
// continua vendo as 4.
let sidebarPinned = false;
let sidebarHoverTimer = null;
const SIDEBAR_HOVER_DELAY = 180; // evita abrir sem querer ao cruzar a trilha

function setSidebarOpen(open) {
  appEl.classList.toggle("sidebarCollapsed", !open);
}

function openSidebarSoon() {
  clearTimeout(sidebarHoverTimer);
  sidebarHoverTimer = setTimeout(() => setSidebarOpen(true), SIDEBAR_HOVER_DELAY);
}

function closeSidebarIfIdle() {
  clearTimeout(sidebarHoverTimer);
  if (sidebarPinned) return;
  // Não recolhe por baixo de quem está digitando (renomear conta, campos da
  // automação, barra de URL) — o campo continuaria com foco num painel
  // invisível.
  const el = document.activeElement;
  if (el && sidebarEl.contains(el) && (el.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))) {
    return;
  }
  setSidebarOpen(false);
}

function wireSidebarHover(el) {
  el.addEventListener("mouseenter", openSidebarSoon);
  el.addEventListener("mouseleave", (e) => {
    // Passar da trilha pra barra (ou vice-versa) não conta como sair.
    const to = e.relatedTarget;
    if (to && (railEl.contains(to) || sidebarEl.contains(to))) return;
    closeSidebarIfIdle();
  });
}
wireSidebarHover(railEl);
wireSidebarHover(sidebarEl);

function setSidebarPinned(pinned) {
  sidebarPinned = pinned;
  railPinBtn.classList.toggle("on", pinned);
  railPinBtn.title = pinned ? "Desafixar o menu (volta a abrir só no hover)" : "Fixar o menu aberto";
  savePref("sidebarPinned", pinned ? "1" : "0");
  if (pinned) setSidebarOpen(true);
  else closeSidebarIfIdle();
}
railPinBtn.addEventListener("click", () => setSidebarPinned(!sidebarPinned));

// Contas na trilha: inicial + cor da conta + pontinho de status, clicáveis.
// ---------- v0.9.17 — painel do bot destacável (opção C da proposta) ----------
// O #automationPanel é MOVIDO entre a barra lateral e o card flutuante, nunca
// duplicado: assim todos os campos, listeners e o `syncAutomationPanel()` que
// já existem continuam funcionando sem nenhuma alteração.
let botDetached = false;

// As coordenadas são relativas ao #mainArea (o ancestral posicionado), mas o
// card não pode subir por cima da barra de ferramentas — daí o piso ser o
// topo do container das contas, não o topo do #mainArea.
function clampFloatPosition(x, y) {
  const host = mainAreaEl.getBoundingClientRect();
  const w = botFloatEl.offsetWidth || 268;
  const minY = containerEl.offsetTop + 6;
  return {
    x: Math.max(6, Math.min(x, Math.max(6, host.width - w - 6))),
    y: Math.max(minY, Math.min(y, Math.max(minY, host.height - 44))),
  };
}

function applyFloatPosition(x, y) {
  const p = clampFloatPosition(x, y);
  botFloatEl.style.left = p.x + "px";
  botFloatEl.style.top = p.y + "px";
  savePref("botFloatPos", JSON.stringify(p));
}

function detachBotPanel() {
  if (botDetached) return;
  botDetached = true;
  botFloatBodyEl.appendChild(automationPanelEl);
  automationPanelEl.hidden = false;
  botFloatEl.hidden = false;
  // A barra lateral volta pra lista de contas — é isso que dá o ganho:
  // contas encaixadas de um lado, bot flutuando sobre o jogo do outro.
  accountsGroupEl.hidden = false;
  let pos = null;
  try {
    const saved = JSON.parse(loadPref("botFloatPos", "") || "null");
    if (saved && typeof saved.x === "number") pos = saved;
  } catch (err) {
    pos = null;
  }
  if (!pos) {
    // Padrão: canto superior direito da área do jogo.
    const host = mainAreaEl.getBoundingClientRect();
    pos = { x: Math.max(6, host.width - 290), y: containerEl.offsetTop + 10 };
  }
  applyFloatPosition(pos.x, pos.y);
  savePref("botDetached", "1");
  syncAutomationPanel();
}

function dockBotPanel() {
  if (!botDetached) return;
  botDetached = false;
  botFloatEl.hidden = true;
  // Volta pro lugar de origem na barra lateral (antes do painel de config).
  sidebarEl.insertBefore(automationPanelEl, settingsPanelEl);
  savePref("botDetached", "0");
  // Encaixado, o painel só aparece quando a conta está selecionada.
  if (selectedAutomationTabId) openAutomationPanel(selectedAutomationTabId);
  else automationPanelEl.hidden = true;
}

botDetachBtn.addEventListener("click", detachBotPanel);
botDockBtn.addEventListener("click", dockBotPanel);

// Arrastar pela barrinha. `setPointerCapture` é o que faz o arrasto continuar
// funcionando quando o cursor passa por cima do <webview> do jogo — sem isso
// o guest engole os eventos e o card "gruda" no meio do caminho.
let botDrag = null;
botFloatBarEl.addEventListener("pointerdown", (e) => {
  if (e.target === botDockBtn) return;
  const r = botFloatEl.getBoundingClientRect();
  const host = mainAreaEl.getBoundingClientRect();
  botDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top, hostX: host.left, hostY: host.top };
  botFloatBarEl.setPointerCapture(e.pointerId);
  botFloatBarEl.classList.add("dragging");
});
botFloatBarEl.addEventListener("pointermove", (e) => {
  if (!botDrag) return;
  applyFloatPosition(e.clientX - botDrag.hostX - botDrag.dx, e.clientY - botDrag.hostY - botDrag.dy);
});
const endBotDrag = () => {
  botDrag = null;
  botFloatBarEl.classList.remove("dragging");
};
botFloatBarEl.addEventListener("pointerup", endBotDrag);
botFloatBarEl.addEventListener("pointercancel", endBotDrag);
// Redimensionar a janela pode deixar o card fora da área visível.
window.addEventListener("resize", () => {
  if (!botDetached) return;
  applyFloatPosition(parseFloat(botFloatEl.style.left) || 0, parseFloat(botFloatEl.style.top) || 0);
});

function renderRailAccounts() {
  railAccountsEl.innerHTML = "";
  tabs.forEach((tab) => {
    const { cls } = acctStatusFor(tab.id);
    const st = automationState.get(tab.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "railBtn railAcct" + (tab.id === activeTabId ? " active" : "");
    btn.title = `${tab.label}${st && st.status ? " — " + st.status : ""}`;
    btn.innerHTML = `
      <span class="railAcctAv" style="background:${avatarColorFor(tab.id)}">${escapeHtml((tab.label.trim()[0] || "?").toUpperCase())}</span>
      <span class="railAcctDot ${cls}"></span>`;
    btn.addEventListener("click", () => setActiveTab(tab.id));
    railAccountsEl.appendChild(btn);
  });
  railAccountsDivider.hidden = tabs.length === 0;
}

railGridBtn.addEventListener("click", () => {
  gridMode = !gridMode;
  railGridBtn.classList.toggle("on", gridMode);
  renderWebviews();
  applyZoomToAll();
  updateToolbarState();
  savePref("gridMode", gridMode ? "1" : "0");
});

groupHeaderToggle.addEventListener("click", () => {
  const collapsed = tabsEl.classList.toggle("collapsed");
  groupHeaderToggle.classList.toggle("collapsed", collapsed);
  savePref("tabsListCollapsed", collapsed ? "1" : "0");
});

sidebarFooterReloadBtn.addEventListener("click", () => {
  tabs.forEach((tab) => {
    const wv = getWebview(tab.id);
    if (wv) wv.reload();
  });
});

addTabBtn.addEventListener("click", addTab);

autoLaunchToggle.addEventListener("change", () => {
  window.hunteraFarm.setAutoLaunch(autoLaunchToggle.checked).catch(() => {
    // Nem toda plataforma suporta "abrir com o sistema" (ex: em algumas
    // distros Linux é um no-op) — se falhar, não trava o app, só não
    // aplica de verdade.
  });
});

// ---------- v0.8.0 — identidade visual (tema/destaque/densidade + navegação
// em abas) ----------
// Portado do protótipo do canvas de design (Idle Multiaccount Redesign),
// depois do André aprovar as variações ao vivo (accent, densidade da
// barra lateral) e pedir a reorganização por abas do painel de automação e
// do painel de Configurações. Preferência é só de TELA — guardada em
// localStorage (perfil do próprio app, não precisa de IPC/main.js pra
// persistir entre reinícios: o Electron já mantém esse localStorage no
// disco junto do perfil do app).
const VISUAL_PREFS_PREFIX = "hunteraMulticonta:";

function loadPref(key, fallback) {
  try {
    return localStorage.getItem(VISUAL_PREFS_PREFIX + key) || fallback;
  } catch {
    return fallback;
  }
}
function savePref(key, value) {
  try {
    localStorage.setItem(VISUAL_PREFS_PREFIX + key, value);
  } catch {
    // Se o storage estiver bloqueado por algum motivo, a preferência só não
    // persiste — não trava o app.
  }
}

const railThemeBtn = document.getElementById("railThemeBtn");
const themeIconMoon = document.getElementById("themeIconMoon");
const themeIconSun = document.getElementById("themeIconSun");
const themeSegLight = document.getElementById("themeSegLight");
const themeSegDark = document.getElementById("themeSegDark");
const accentSwatches = {
  gold: document.getElementById("accentSwatchGold"),
  sapphire: document.getElementById("accentSwatchSapphire"),
  violet: document.getElementById("accentSwatchViolet"),
};
const densitySegs = {
  default: document.getElementById("densitySegDefault"),
  compact: document.getElementById("densitySegCompact"),
  dock: document.getElementById("densitySegDock"),
};

function setTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  themeIconMoon.hidden = t === "light";
  themeIconSun.hidden = t !== "light";
  themeSegLight.classList.toggle("active", t === "light");
  themeSegDark.classList.toggle("active", t === "dark");
  savePref("theme", t);
}

function setAccent(accent) {
  const a = ["gold", "sapphire", "violet"].includes(accent) ? accent : "gold";
  document.documentElement.setAttribute("data-accent", a);
  Object.entries(accentSwatches).forEach(([key, el]) => el.classList.toggle("active", key === a));
  savePref("accent", a);
}

function setDensity(density) {
  const d = ["default", "compact", "dock"].includes(density) ? density : "default";
  tabsEl.classList.remove("density-compact", "density-dock");
  if (d === "compact") tabsEl.classList.add("density-compact");
  if (d === "dock") tabsEl.classList.add("density-dock");
  Object.entries(densitySegs).forEach(([key, el]) => el.classList.toggle("active", key === d));
  savePref("density", d);
}

railThemeBtn.addEventListener("click", () => {
  setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
});
themeSegLight.addEventListener("click", () => setTheme("light"));
themeSegDark.addEventListener("click", () => setTheme("dark"));
Object.entries(accentSwatches).forEach(([key, el]) => el.addEventListener("click", () => setAccent(key)));
Object.entries(densitySegs).forEach(([key, el]) => el.addEventListener("click", () => setDensity(key)));

function initVisualIdentity() {
  setTheme(loadPref("theme", "dark"));
  setAccent(loadPref("accent", "gold"));
  setDensity(loadPref("density", "default"));
}
initVisualIdentity();

// ---------- v0.8.0 — barra de abas (painel de automação e Configurações)
// ----------
// Reorganização pedida pelo André ("não me agrada muito como que está
// organizado" — agrupamento, navegação entre telas, divisão das
// Configurações). Cada barra é independente e simples: clique num
// .tabBtn ativa ele e mostra o .tabPanel de mesmo data-tab, esconde os
// outros. Não precisa persistir entre sessões — sempre abre na primeira
// aba, igual o protótipo.
function wireTabBar(barEl, panelsContainerEl) {
  const buttons = Array.from(barEl.querySelectorAll(".tabBtn"));
  const panels = Array.from(panelsContainerEl.querySelectorAll(".tabPanel"));
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.tab;
      buttons.forEach((b) => b.classList.toggle("active", b === btn));
      panels.forEach((p) => {
        p.hidden = p.dataset.tab !== key;
      });
    });
  });
}
// v0.9.30 — "Ligar automação" agora é filho do painel da aba Caçada (é o que
// ele liga), então aparece/some junto com a aba sem nenhum JS extra. A v0.9.29
// escondia o botão por fora do painel, e isso empurrava a barra de abas pra
// cima e pra baixo a cada troca de aba.
wireTabBar(document.getElementById("automationTabBar"), document.querySelector("#automationPanel .automationScroll"));
wireTabBar(document.getElementById("settingsTabBar"), document.querySelector("#settingsPanel .automationScroll"));

statusPill.textContent = "";

// ---------- v0.11.0 — "dias de uso" (Swag): login + tela de bloqueio ----------
//
// André decidiu transformar a automação num produto pago (ver
// `huntera-mobile-dashboard` na memória do projeto) — trava o PRODUTO
// INTEIRO, não só um botão. `main.js` é quem fala com o Supabase (login,
// refresh de token, checagem de `entitlements`); aqui só reflete o estado
// que ele manda por `onSwagStatusChanged` (e por um fetch imediato no
// início, pra não depender de uma corrida entre a janela abrir e o
// main.js já ter checado alguma coisa).
function formatAccessUntil(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return "";
  }
}

function applySwagStatus(status) {
  const s = status || { licensed: false, reason: "not_logged_in" };
  const licensed = !!s.licensed;
  swagGateEl.hidden = licensed;
  swagAccountRow.hidden = !licensed;
  swagLoginBtn.disabled = false;

  if (licensed) {
    const until = formatAccessUntil(s.accessUntil);
    swagAccountLabel.textContent = s.email ? `${s.email}${until ? ` · até ${until}` : ""}` : "Conta conectada";
    swagGateMessage.hidden = true;
    return;
  }

  // Não licenciado — mensagem varia com o motivo, formulário sempre visível
  // (mesmo se o email/senha já estavam preenchidos de uma tentativa
  // anterior — não limpa os campos sozinho).
  swagGateMessage.hidden = false;
  swagGateMessage.className = "swagGateMessage";
  if (s.reason === "expired") {
    swagGateSubtitle.textContent = "Seus dias de uso acabaram.";
    swagGateMessage.textContent = s.accessUntil
      ? `Acesso válido até ${formatAccessUntil(s.accessUntil)}. Faça uma doação pra renovar.`
      : "Faça uma doação pra liberar dias de uso.";
  } else if (s.reason === "session_expired") {
    swagGateSubtitle.textContent = "Sua sessão expirou — entre de novo.";
    swagGateMessage.hidden = true;
  } else if (s.reason === "device_locked") {
    // Conta já vinculada a outro computador — check_and_bind_device no
    // Supabase decide isso (7 dias de espera pra trocar), nunca o cliente.
    const who = s.boundDeviceLabel ? ` (${s.boundDeviceLabel})` : "";
    const until = s.deviceUnlocksAt ? formatAccessUntil(s.deviceUnlocksAt) : null;
    swagGateSubtitle.textContent = "Sua conta está em uso em outro computador.";
    swagGateMessage.textContent =
      `Esta conta já está vinculada a outro PC${who}.` +
      (until ? ` Você pode trocar de computador a partir de ${until}.` : " Tente de novo mais tarde.");
    swagGateMessage.classList.add("err");
  } else if (s.reason === "network_error") {
    swagGateSubtitle.textContent = "Não consegui confirmar seu acesso agora.";
    swagGateMessage.textContent = "Sem conexão com o servidor do Swag — tentando de novo sozinho. Se voltar a ficar online, isto resolve solo.";
    swagGateMessage.classList.add("err");
  } else {
    swagGateSubtitle.textContent = "Entre com sua conta pra liberar a automação.";
    swagGateMessage.hidden = true;
  }
}

// ---------- v0.11.3 — ponte com o painel remoto (swag-site) ----------
//
// `automationState` (mapa tabId -> estado, montado a cada `hm:state`, ver
// acima) só existe aqui no renderer — o main.js não enxerga <webview> nem
// automationState diretamente. Então este processo é quem monta o "retrato"
// (snapshot) de todas as contas e empurra pro main.js (que é quem de fato
// fala com o Supabase, por já ter swagSession/token — mesma divisão de
// responsabilidade que o Telegram/licença já usam). E do outro lado: quando
// o painel manda um comando (Pausar/Retomar), o main.js lê do Supabase e
// manda pra ESTE processo decidir qual aba corresponde a qual personagem
// (usando `normalizeCharacterName`, já usado noutros lugares do arquivo pra
// mesma comparação) e disparar via a mesma `sendAutomationCommand` que o
// botão local (automationToggleBtn) já usa.
let swagPushStateTimer = null;
// commandId -> tabId, só pro comando "switch_character" (o único que demora
// e pode falhar de verdade — troca de caçada e pausar/retomar são
// configuração local instantânea, respondem na hora). Ver o listener de
// "hm:commandResult" dentro de ensureWebview.
const swagPendingRemoteCommands = new Map();

function swagBuildSnapshot() {
  return {
    tabs: tabs.map((t) => {
      const st = automationState.get(t.id) || {};
      return {
        tabId: t.id,
        accountLabel: t.label || t.id,
        characterName: st.characterName || null,
        vocation: st.characterVocation || null,
        level: st.characterLevel || null,
        // staminaLeft já chega em MINUTOS (mesmo campo usado no rótulo "·
        // stamina 1h05" da barra lateral) — character_state.stamina_seconds
        // é em segundos.
        staminaSeconds: st.staminaLeft != null ? Math.round(st.staminaLeft * 60) : null,
        currentHunt: st.huntName || null,
        isHunting: !!st.hunting,
        running: !!st.running,
        status: st.status || null,
        // v0.11.4 — pro painel oferecer "trocar de caçada"/"trocar de
        // personagem" como dropdown de opções REAIS da conta, em vez de
        // texto livre (que erraria por qualquer diferença de acentuação).
        huntNames: Array.isArray(st.huntNames) ? st.huntNames : [],
        knownCharacters: Array.isArray(st.knownCharacters) ? st.knownCharacters : [],
      };
    }),
  };
}

function swagSchedulePushState() {
  if (swagPushStateTimer) return;
  swagPushStateTimer = setTimeout(() => {
    swagPushStateTimer = null;
    window.hunteraFarm.swagPushState(swagBuildSnapshot()).catch(() => {});
  }, 1500);
}

// Comando remoto == exatamente o mesmo efeito dos controles locais (botão
// Ligar/Desligar, dropdown de caçada, "Sair do jogo" + "Jogar" do rodízio) —
// só que disparado pelo painel em vez de um clique aqui. Nomes vindos do
// painel (ver app/painel/page.js do swag-site): "pause"/"resume" mapeiam
// pra "stop"/"start"; "change_hunt" e "switch_character" são novos
// (v0.11.4).
function swagFindTabIdByCharacterName(name) {
  const target = normalizeCharacterName(name);
  if (!target) return null;
  for (const [tabId, st] of automationState.entries()) {
    if (normalizeCharacterName(st.characterName) === target) return tabId;
  }
  return null;
}

function swagInitRemoteCommands() {
  window.hunteraFarm.onSwagRemoteCommand((cmd) => {
    const tabId = swagFindTabIdByCharacterName(cmd && cmd.characterName);
    if (!tabId) {
      window.hunteraFarm.swagCommandResult({ commandId: cmd.commandId, ok: false, error: "Personagem não encontrado em nenhuma conta aberta." });
      return;
    }
    const st = automationState.get(tabId) || {};

    if (cmd.commandType === "pause") {
      if (st.running) sendAutomationCommand(tabId, { type: "stop" });
      window.hunteraFarm.swagCommandResult({ commandId: cmd.commandId, ok: true });
      return;
    }
    if (cmd.commandType === "resume") {
      if (!st.running) sendAutomationCommand(tabId, { type: "start" });
      window.hunteraFarm.swagCommandResult({ commandId: cmd.commandId, ok: true });
      return;
    }
    if (cmd.commandType === "change_hunt") {
      const huntName = cmd.payload && cmd.payload.huntName;
      if (!huntName) {
        window.hunteraFarm.swagCommandResult({ commandId: cmd.commandId, ok: false, error: "Caçada não informada." });
        return;
      }
      // Mesma sequência que o dropdown local dispara (ver o listener de
      // automationHuntSelect mais acima no arquivo) — muda a caçada
      // configurada e já pede os tiers dela de novo.
      sendAutomationCommand(tabId, { type: "setConfig", payload: { huntName } });
      sendAutomationCommand(tabId, { type: "requestTiers", payload: { huntName } });
      window.hunteraFarm.swagCommandResult({ commandId: cmd.commandId, ok: true });
      return;
    }
    if (cmd.commandType === "go_to_city") {
      // Mesma lógica do "switch_character": ação real no jogo (sai da
      // caçada, confirma chegada na cidade pelo botão de venda rápida) —
      // espera a confirmação real do content-injected.js em vez de
      // responder na hora.
      swagPendingRemoteCommands.set(cmd.commandId, tabId);
      sendAutomationCommand(tabId, {
        type: "goToCity",
        commandId: cmd.commandId,
      });
      setTimeout(() => {
        if (!swagPendingRemoteCommands.has(cmd.commandId)) return; // já respondeu
        swagPendingRemoteCommands.delete(cmd.commandId);
        window.hunteraFarm.swagCommandResult({ commandId: cmd.commandId, ok: false, error: "timeout" });
      }, 20000);
      return;
    }
    if (cmd.commandType === "switch_character") {
      const targetCharacterName = cmd.payload && cmd.payload.targetCharacterName;
      if (!targetCharacterName) {
        window.hunteraFarm.swagCommandResult({ commandId: cmd.commandId, ok: false, error: "Personagem de destino não informado." });
        return;
      }
      // Diferente dos outros: isto é uma ação de verdade no jogo (sai da
      // lista de personagens, entra em outro) — demora alguns segundos e
      // pode falhar de verdade, então espera a confirmação real do
      // content-injected.js (canal hm:commandResult) em vez de responder na
      // hora.
      swagPendingRemoteCommands.set(cmd.commandId, tabId);
      sendAutomationCommand(tabId, {
        type: "switchCharacter",
        commandId: cmd.commandId,
        payload: { targetCharacterName },
      });
      setTimeout(() => {
        if (!swagPendingRemoteCommands.has(cmd.commandId)) return; // já respondeu
        swagPendingRemoteCommands.delete(cmd.commandId);
        window.hunteraFarm.swagCommandResult({ commandId: cmd.commandId, ok: false, error: "timeout" });
      }, 30000);
      return;
    }

    window.hunteraFarm.swagCommandResult({ commandId: cmd.commandId, ok: false, error: `Tipo de comando desconhecido: ${cmd.commandType}` });
  });
  // Heartbeat: garante que `last_seen_at`/o estado de cada conta continuam
  // chegando no painel mesmo em períodos sem nenhum hm:state novo (conta
  // parada na cidade, sem log — o que já é um estado válido de reportar).
  setInterval(() => window.hunteraFarm.swagPushState(swagBuildSnapshot()).catch(() => {}), 20000);
}

swagInitRemoteCommands();

async function initSwagGate() {
  // v0.11.7 — redirecionador pro cadastro no site, direto da tela de login.
  swagCreateAccountLink.addEventListener("click", (e) => {
    e.preventDefault();
    window.hunteraFarm.swagOpenSignupPage();
  });

  swagLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = swagEmailInput.value.trim();
    const password = swagPasswordInput.value;
    if (!email || !password) return;
    swagLoginBtn.disabled = true;
    swagGateMessage.hidden = false;
    swagGateMessage.className = "swagGateMessage";
    swagGateMessage.textContent = "Entrando...";
    try {
      const result = await window.hunteraFarm.swagLogin(email, password);
      if (result && result.ok) {
        swagPasswordInput.value = "";
        applySwagStatus(result.status);
      } else {
        swagGateMessage.classList.add("err");
        swagGateMessage.textContent = (result && result.error) || "Não foi possível entrar.";
        swagLoginBtn.disabled = false;
      }
    } catch (err) {
      swagGateMessage.classList.add("err");
      swagGateMessage.textContent = "Não foi possível entrar. Tente de novo.";
      swagLoginBtn.disabled = false;
    }
  });

  swagLogoutBtn.addEventListener("click", async () => {
    await window.hunteraFarm.swagLogout();
    applySwagStatus({ licensed: false, reason: "not_logged_in" });
  });

  window.hunteraFarm.onSwagStatusChanged(applySwagStatus);
  try {
    applySwagStatus(await window.hunteraFarm.swagGetStatus());
  } catch {
    // main.js ainda não respondeu — a tela de bloqueio já nasce visível
    // por padrão (fail-closed), então não precisa de nada aqui.
  }
}

initSwagGate();

async function init() {
  // v0.9.23 — histórico do analyzer do disco.
  try {
    statsHistorico = await window.hunteraFarm.loadStats();
  } catch (err) {
    statsHistorico = { dias: {} };
  }
  // v0.9.16 — catálogo de caçadas do disco ANTES de qualquer conta abrir, pra
  // os dropdowns já nascerem preenchidos.
  try {
    sharedHuntCatalog = await window.hunteraFarm.loadHuntCatalog();
  } catch (err) {
    sharedHuntCatalog = { names: [], tiersByHunt: {} };
  }
  gameUrl = await window.hunteraFarm.getGameUrl();
  try {
    gameHost = new URL(gameUrl).host;
  } catch {
    gameHost = gameUrl;
  }
  automationPreloadPath = await window.hunteraFarm.getAutomationPreloadPath();
  tabs = await window.hunteraFarm.loadTabs();
  // v0.9.0 — restaura aba ativa/zoom/grade/recolhido de onde o app ficou da
  // última vez, em vez de sempre voltar pro estado "de fábrica". Se a aba
  // salva não existe mais (conta removida enquanto o app estava fechado),
  // cai pra primeira aba disponível — nunca aponta pra um id inexistente.
  const savedActiveTabId = loadPref("activeTabId", "");
  activeTabId = tabs.some((t) => t.id === savedActiveTabId)
    ? savedActiveTabId
    : tabs.length
    ? tabs[0].id
    : null;
  gridMode = loadPref("gridMode", "0") === "1";
  railGridBtn.classList.toggle("on", gridMode);
  // v0.9.17 — o antigo "sidebarCollapsed" deu lugar ao "sidebarPinned":
  // recolhido virou o padrão (a trilha É o estado recolhido), e o que se
  // guarda agora é se ele fixou o menu aberto.
  setSidebarPinned(loadPref("sidebarPinned", "0") === "1");
  if (!sidebarPinned) setSidebarOpen(false);
  // v0.9.17 — o painel do bot volta destacado se foi assim que ele deixou.
  if (loadPref("botDetached", "0") === "1") detachBotPanel();
  const tabsListCollapsed = loadPref("tabsListCollapsed", "0") === "1";
  tabsEl.classList.toggle("collapsed", tabsListCollapsed);
  groupHeaderToggle.classList.toggle("collapsed", tabsListCollapsed);
  try {
    const savedZoom = JSON.parse(loadPref("manualZoom", "{}") || "{}");
    Object.entries(savedZoom).forEach(([tabId, factor]) => manualZoom.set(tabId, factor));
  } catch {
    // valor salvo corrompido/ilegível — segue sem zoom restaurado
  }
  const savedGridZoom = loadPref("gridZoomOverride", "");
  gridZoomOverride = savedGridZoom === "" ? null : Number(savedGridZoom);
  try {
    autoLaunchToggle.checked = await window.hunteraFarm.getAutoLaunch();
  } catch {
    autoLaunchToggle.checked = false;
  }
  renderTabs();
  renderWebviews();
  applyZoomToAll();
  updateToolbarState();
  // v0.12.2 — painel de desempenho (medição + purge das contas em segundo plano).
  iniciarPainelDeDesempenho();
  // v0.12.3 — freio do loop de render das contas que ninguém está vendo.
  iniciarFreioDeRender();
  statusPill.textContent = statusPillDefaultText();
  setInterval(() => {
    updateUptimeLabels();
    // Não pisa em cima de uma mensagem transiente (checagem de atualização
    // em andamento ou resultado recém-mostrado) — só volta ao padrão
    // quando não há timer de reversão pendente.
    if (!statusPillRevertTimer) statusPill.textContent = statusPillDefaultText();
  }, 60000);
}

init();
