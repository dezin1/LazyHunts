// TASK-003-F1 — teste isolado: Caçada normal e Bestiário são modos de
// execução MUTUAMENTE EXCLUSIVOS, e o Bestiário não depende mais de
// `running` (a Caçada normal) pra ter o motor rodando.
//
// Mesmo método dos outros testes deste projeto: extrai, por marcador de
// texto, TRÊS blocos REAIS de `automation/content-injected.js`
// (helpers de modo/monitoramento, startBot+stopBot, e applyConfig
// completo) e roda num sandbox `vm` — não reimplementa nenhuma regra de
// decisão, só fornece as poucas dependências externas (loadState/saveState
// como um "banco" em memória, log/sendState/etc. como stubs que só
// registram chamadas).
//
// Comando: node scripts/teste-modo-execucao.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const contentPath = path.join(here, "..", "automation", "content-injected.js");
const source = readFileSync(contentPath, "utf8");

function extrair(inicio, fimExclusivo, nome) {
  const i = source.indexOf(inicio);
  const f = source.indexOf(fimExclusivo, i);
  if (i === -1 || f === -1 || f <= i) {
    console.error(`FALHA: marcadores de '${nome}' não encontrados em content-injected.js.`);
    process.exit(1);
  }
  return source.slice(i, f);
}

const blocoMonitoramento = extrair(
  "let monitoringAtivo = false;",
  "// v0.9.14 — CAUSA RAIZ REAL do",
  "monitoringAtivo..ajustarMonitoramentoConformeModos"
);
const blocoStartStop = extrair(
  "async function startBot() {",
  "// ---------- auto aceitar party",
  "startBot..stopBot"
);
const blocoApplyConfig = extrair(
  "function applyConfig(partial) {",
  "async function handleCommand(msg) {",
  "applyConfig"
);

let falhas = 0;
function assert(cond, msg) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", msg);
  } else {
    console.log("ok:", msg);
  }
}

// ---------- sandbox ----------

const chamadas = { startMonitoring: 0, stopMonitoring: 0, monitorTick: 0, log: [] };
let estadoPersistido = {
  running: false,
  huntName: "Rat Cellars",
  pullLevel: "Bold",
  huntMode: "solo",
  bestiaryLadder: { enabled: false, index: 0, itens: [] },
};

const sandbox = {
  console,
  // "banco" em memória — loadState() sempre devolve CÓPIA (igual ao real:
  // quem chama nunca muta o estado direto, só via saveState).
  loadState: () => ({ ...estadoPersistido, bestiaryLadder: { ...estadoPersistido.bestiaryLadder } }),
  saveState: (partial) => {
    estadoPersistido = { ...estadoPersistido, ...partial };
  },
  log: (msg) => chamadas.log.push(msg),
  sendState: () => {},
  updatePanelRunning: () => {},
  updatePanelStatus: () => {},
  souLider: () => false,
  gravarPerfil: () => {},
  logBestiaryStart: () => {},
  normalizeName: (s) => s,
  guild: { cacadas: [{ name: "Rat Cellars", monsters: [{ name: "Rat" }], tiers: [{ name: "Bold" }] }] },
  // dependências do monitorTick real que NÃO fazem parte deste teste — só
  // registram que foram chamadas, pra provar "sem timer/loop extra".
  tryAttachCapacityObserver: () => {},
  monitorTick: () => {
    chamadas.monitorTick++;
  },
  setInterval: (fn) => {
    chamadas.startMonitoring++; // cada setInterval novo = 1 "start" de verdade
    return chamadas.startMonitoring; // id fake, só pra clearInterval ter o que "limpar"
  },
  clearInterval: () => {
    chamadas.stopMonitoring++;
  },
};

// variáveis livres que startBot/stopBot/applyConfig referenciam, mas que
// pertencem a OUTRAS partes do arquivo real (não extraídas aqui de
// propósito — são estado de runtime simples, não lógica de decisão).
const setupVars = `
  let running = false;
  let isBusy = false;
  let licensed = true;
  let observer = null;
  let observerDebounceTimer = null;
  let pollTimer = null;
  let consecutiveErrors = 0;
  let lastStaminaLogAt = 0;
  let lastNoHuntConfiguredLogAt = 0;
  let waitingForGameUi = false;
  let isAwaitingGroupHuntSync = false;
  let groupHuntSyncStatus = null;
  let pendingGroupHuntName = null;
  let awaitingGroupHuntSyncSince = 0;
  let pendingResumeGroupHunt = false;
  let soldSinceArrivingInCity = false;
  let currentHuntNameCache = null;
`;

const context = vm.createContext(sandbox);
vm.runInContext(setupVars, context, { filename: "setup-vars.js" });
vm.runInContext(blocoMonitoramento, context, { filename: "content-injected-monitoramento.js" });
vm.runInContext(blocoStartStop, context, { filename: "content-injected-start-stop.js" });
vm.runInContext(blocoApplyConfig, context, { filename: "content-injected-applyconfig.js" });

function run(code) {
  return vm.runInContext(code, context, { filename: "teste-modo-execucao-inline.js" });
}

function estado() {
  return run("loadState()");
}

// ============================================================
// Cenário 1 — Iniciar Bestiário com Caçada normal DESLIGADA habilita o
// motor (o loop de tick passa a rodar).
// ============================================================

assert(chamadas.startMonitoring === 0 && chamadas.stopMonitoring === 0, "pré-condição: nenhum monitoramento rodando ainda");
run(`applyConfig({ bestiaryLadder: { enabled: true, index: 0, itens: [{ hunt: "Rat Cellars", criatura: "Rat", faseAlvo: 1, concluido: false }] } });`);
assert(estado().bestiaryLadder.enabled === true, "Bestiário fica habilitado sem exigir running=true antes");
assert(estado().running === false, "Caçada normal continua desligada (não foi ligada por engano)");
assert(chamadas.startMonitoring === 1, `habilitar o Bestiário liga o motor (startMonitoring) — chamado ${chamadas.startMonitoring}x`);
assert(run("monitoringAtivo") === true, "monitoringAtivo fica true");

// ============================================================
// Cenário 3 — Iniciar Caçada normal PAUSA o Bestiário, sem apagar a
// escada (itens/index preservados).
// ============================================================

chamadas.startMonitoring = 0;
chamadas.stopMonitoring = 0;
run("startBot();");
assert(estado().running === true, "Caçada normal liga");
assert(estado().bestiaryLadder.enabled === false, "ligar a Caçada normal desliga o Bestiário");
assert(
  estado().bestiaryLadder.itens.length === 1 && estado().bestiaryLadder.itens[0].hunt === "Rat Cellars",
  "a ESCADA (itens) continua intacta — só `enabled` mudou"
);
// `startMonitoring()` (função já existente, inalterada nesta tarefa) SEMPRE
// zera e recria o timer por design (`stopMonitoringInterno()` no início do
// próprio corpo) — chamar de novo ao trocar de modo por dentro de
// `startBot()` gera 1 clearInterval+1 setInterval de transição, o que não é
// "timer extra": nunca existe mais de um `pollTimer` vivo por vez (a própria
// função garante isso). O que importa de verdade é: no fim da transição, o
// monitoramento está ATIVO — não ficou nem duplicado nem parado.
assert(run("monitoringAtivo") === true, "depois de trocar de Bestiary pra Caçada normal, o monitoramento continua ativo (não ficou órfão)");

// ============================================================
// Cenário 2 — Iniciar Bestiário PAUSA a Caçada normal, sem apagar a
// configuração normal (huntName/pullLevel preservados).
// ============================================================

const huntNameAntes = estado().huntName;
const pullLevelAntes = estado().pullLevel;
run(`applyConfig({ bestiaryLadder: { enabled: true, index: 0, itens: ${JSON.stringify(estado().bestiaryLadder.itens)} } });`);
assert(estado().bestiaryLadder.enabled === true, "Bestiário liga de novo");
assert(estado().running === false, "ligar o Bestiário desliga a Caçada normal");
assert(estado().huntName === huntNameAntes && estado().pullLevel === pullLevelAntes, "huntName/pullLevel da Caçada normal continuam EXATAMENTE como estavam");

// ============================================================
// Cenário 4 — Pausar Bestiário NÃO religa a Caçada normal.
// ============================================================

run(`applyConfig({ bestiaryLadder: { enabled: false, index: 0, itens: ${JSON.stringify(estado().bestiaryLadder.itens)} } });`);
assert(estado().bestiaryLadder.enabled === false, "Bestiário pausado");
assert(estado().running === false, "pausar o Bestiário NÃO liga a Caçada normal sozinha");

// ============================================================
// Cenário 5 — Pausar Caçada normal NÃO liga o Bestiário.
// Pré-condição real do cenário: Bestiário DESLIGADO e Caçada normal
// LIGADA — só assim "pausar a Caçada" é uma transição de verdade (testar
// stopBot() com running já false, como uma versão anterior deste teste
// fazia, não prova nada sobre o Bestiário não reativar sozinho).
// ============================================================

run(`applyConfig({ bestiaryLadder: { enabled: false, index: 0, itens: ${JSON.stringify(estado().bestiaryLadder.itens)} } });`);
run("startBot();");
assert(estado().running === true && estado().bestiaryLadder.enabled === false, "pré-condição do cenário 5: Caçada normal ligada, Bestiário desligado");
run("stopBot('usuario');");
assert(estado().running === false, "Caçada normal pausada");
assert(estado().bestiaryLadder.enabled === false, "pausar a Caçada normal NÃO liga o Bestiário sozinho");

// ============================================================
// Cenário 6 — NUNCA existem os dois modos ativos ao mesmo tempo, em
// nenhuma sequência de transições.
// ============================================================

function nuncaOsDoisJuntos() {
  const e = estado();
  return !(e.running && e.bestiaryLadder.enabled);
}
run("startBot();");
assert(nuncaOsDoisJuntos(), "após ligar Caçada normal: nunca os dois juntos");
run(`applyConfig({ bestiaryLadder: { enabled: true, index: 0, itens: ${JSON.stringify(estado().bestiaryLadder.itens)} } });`);
assert(nuncaOsDoisJuntos(), "após ligar Bestiário por cima: nunca os dois juntos");
run("startBot();");
assert(nuncaOsDoisJuntos(), "após ligar Caçada normal de novo: nunca os dois juntos");

// ============================================================
// Cenário 8 — alternar de modo não cria timers/loops extras: o número de
// "starts" de monitoramento nunca ultrapassa o de transições reais
// (nenhuma chamada redundante quando o modo já é o mesmo).
// ============================================================

chamadas.startMonitoring = 0;
chamadas.stopMonitoring = 0;
run("startBot();"); // já estava rodando (running já true) — startBot() faz `if (running) return;`
assert(chamadas.startMonitoring === 0, "chamar startBot() com a Caçada JÁ ligada não recria o monitoramento (idempotente)");
run(`applyConfig({ huntName: "Rat Cellars" });`); // um setConfig qualquer, sem mexer no Bestiary
assert(chamadas.startMonitoring === 0 && chamadas.stopMonitoring === 0, "um setConfig que não muda modo nenhum não mexe no monitoramento");

// ============================================================
// Cenário 7 (parcial) — a validação de tier/hunt dentro do applyConfig
// (já coberta em teste-bestiary-tier.mjs) continua funcionando junto com
// a troca de modo: uma hunt inválida não impede a troca de modo, só o
// campo inválido é descartado.
// ============================================================

run("stopBot('usuario');");
run(`applyConfig({ bestiaryLadder: { enabled: true, index: 0, itens: [{ hunt: "Rat Cellars", criatura: "Rat", faseAlvo: 1, concluido: false, tier: "Nivel-Inexistente" }] } });`);
assert(estado().bestiaryLadder.enabled === true, "Bestiário liga mesmo com um tier inválido no item");
assert(estado().running === false, "e a Caçada normal é pausada normalmente nesse caso também");
assert(!("tier" in estado().bestiaryLadder.itens[0]), "o tier inválido é descartado (defesa em profundidade do applyConfig), sem bloquear a troca de modo");

// ============================================================
if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) FALHARAM.`);
  process.exit(1);
}
console.log("\nTODOS OS CENARIOS PASSARAM");
