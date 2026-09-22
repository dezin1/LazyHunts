// TASK-003-R1 — teste isolado: catálogo do Bestiário nunca cria item sem
// criatura mapeada.
//
// Mesmo método do scripts/teste-freio-ui.mjs: extrai, por marcador de
// texto, os dois trechos REAIS de `renderer/renderer.js` (as consts do
// catálogo + o bloco itensBestiaryLadderPersistiveis..renderBestiaryCatalogo)
// e roda dentro de um sandbox `vm` com DOM/estado falsos — não reimplementa
// a lógica.
//
// Comando: node scripts/teste-bestiary-catalogo.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(here, "..", "renderer", "renderer.js");
const source = readFileSync(rendererPath, "utf8");

function extrair(inicio, fimExclusivo, nome) {
  const i = source.indexOf(inicio);
  const f = source.indexOf(fimExclusivo);
  if (i === -1 || f === -1 || f <= i) {
    console.error(`FALHA: marcadores de '${nome}' não encontrados em renderer.js.`);
    process.exit(1);
  }
  return source.slice(i, f);
}

const constsCatalogo = extrair(
  'const automationBestiaryLadderToggle = document.getElementById("automationBestiaryLadderToggle");',
  "// v0.11.10 — detector de spawn seco",
  "consts do catálogo"
);
const blocoLadder = extrair(
  "function itensBestiaryLadderPersistiveis(itens) {",
  "function renderBestiaryLadder(state) {",
  "bloco itensBestiaryLadderPersistiveis..renderBestiaryCatalogo"
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

function fakeInput(initial = "") {
  return { value: initial, addEventListener() {} };
}
function fakeListEl() {
  return {
    _html: "",
    _botoesCache: [],
    set innerHTML(v) {
      this._html = v;
      // TASK-003-R1 — igual ao DOM real: atribuir innerHTML cria os nós UMA
      // vez. `querySelectorAll` sempre devolve as MESMAS instâncias depois
      // disso, senão um `addEventListener` numa chamada some na próxima
      // (foi exatamente o bug que a primeira versão deste fake tinha).
      const botoes = [];
      const re = /<button type="button" class="bestiaryCreatureAddBtn" data-add-hunt="([^"]*)" data-add-criatura="([^"]*)">([^<]*)<\/button>/g;
      let m;
      while ((m = re.exec(v))) {
        const [, hunt, criatura, texto] = m;
        botoes.push({
          _hunt: hunt,
          _criatura: criatura,
          _texto: texto,
          _handlers: [],
          getAttribute(attr) {
            if (attr === "data-add-hunt") return this._hunt;
            if (attr === "data-add-criatura") return this._criatura;
            return null;
          },
          addEventListener(type, cb) {
            if (type === "click") this._handlers.push(cb);
          },
          clicar() {
            this._handlers.forEach((h) => h());
          },
        });
      }
      this._botoesCache = botoes;
    },
    get innerHTML() {
      return this._html;
    },
    querySelectorAll(sel) {
      // só o seletor que o código realmente usa neste bloco.
      if (sel !== "button[data-add-hunt]") return [];
      return this._botoesCache;
    },
  };
}

const enviosBestiaryLadder = []; // captura toda chamada real a sendAutomationCommand com setConfig.bestiaryLadder

// TASK-003-R1 — as consts do bloco real (`const x = document.getElementById(...)`)
// criam bindings `const` no escopo léxico do contexto `vm`, que SOMBREIAM
// qualquer propriedade igual já setada no objeto sandbox. Por isso os
// elementos falsos têm que vir de dentro de `getElementById`, não como
// propriedade pré-setada no sandbox (a primeira versão deste teste tinha
// esse bug: os elementos viravam `null` assim que o bloco real rodava).
const elementosFalsos = {
  automationBestiaryLadderToggle: { checked: false, addEventListener() {} },
  bestiaryLadderLista: fakeListEl(),
  bestiaryCatalogoSearch: fakeInput(""),
  bestiaryCatalogoLista: fakeListEl(),
};

const sandbox = {
  console,
  document: {
    activeElement: null,
    getElementById: (id) => elementosFalsos[id] || null,
  },
  automationState: new Map(),
  selectedAutomationTabId: "conta-1",
  sendAutomationCommand: (tabId, msg) => {
    enviosBestiaryLadder.push({ tabId, msg });
    return true;
  },
  escapeHtml: (s) => String(s == null ? "" : s),
  fmtNum: (n) => String(n),
};

const context = vm.createContext(sandbox);
vm.runInContext(constsCatalogo, context, { filename: "renderer-bestiary-consts.js" });
vm.runInContext(blocoLadder, context, { filename: "renderer-bestiary-ladder-block.js" });

function run(code) {
  return vm.runInContext(code, context, { filename: "teste-bestiary-inline.js" });
}

// ---------- cenário 1: nenhum botão genérico sobrevive ----------
// Catálogo com uma caçada COM criatura mapeada ("Rat Cellars" -> "Rat") e
// uma SEM nenhuma criatura mapeada ("Caçada Sem Bicho Mapeado").
const state1 = {
  bestiaryCatalogo: [
    { hunt: "Rat Cellars", criaturas: ["Rat"], tiers: ["Tier 1"], forca: 10 },
    { hunt: "Caçada Sem Bicho Mapeado", criaturas: [], tiers: [], forca: null },
  ],
  bestiaryLadder: { enabled: false, index: 0, itens: [] },
};
sandbox.automationState.set("conta-1", state1);
run("renderBestiaryCatalogo(automationState.get(selectedAutomationTabId));");

const htmlGerado = elementosFalsos.bestiaryCatalogoLista.innerHTML;
assert(!/\+ adicionar caçada/i.test(htmlGerado), "nenhum botão '+ adicionar caçada' (genérico) aparece no HTML gerado");
assert(!/data-add-criatura=""/.test(htmlGerado), "nenhum botão é gerado com data-add-criatura vazio");
assert(/Nenhuma criatura mapeada para essa caçada ainda\./.test(htmlGerado), "caçada sem criatura mapeada mostra o aviso exigido");

const botoesNoHtml = elementosFalsos.bestiaryCatalogoLista.querySelectorAll("button[data-add-hunt]");
assert(botoesNoHtml.length === 1, `exatamente 1 botão de ação no HTML (só a criatura mapeada) — encontrados: ${botoesNoHtml.length}`);
assert(botoesNoHtml.every((b) => b._criatura && b._criatura.length > 0), "todo botão de ação presente tem data-add-criatura não vazio");

// `renderBestiaryCatalogo` (chamado acima) já liga os handlers de clique
// sozinho, no final da própria função — não precisa (e não deve) religar
// aqui de novo, senão o clique dispara o handler em dobro.

// ---------- cenário 2: "Rat Cellars" + "Rat" gera exatamente o item esperado ----------
const botoesFinal = elementosFalsos.bestiaryCatalogoLista.querySelectorAll("button[data-add-hunt]");
const botaoRat = botoesFinal.find((b) => b._hunt === "Rat Cellars" && b._criatura === "Rat");
assert(!!botaoRat, "existe um botão real pra 'Rat Cellars' + 'Rat'");
botaoRat.clicar();

assert(enviosBestiaryLadder.length === 1, `exatamente 1 comando setConfig enviado (encontrados: ${enviosBestiaryLadder.length})`);
const payloadEnviado = enviosBestiaryLadder[0].msg.payload.bestiaryLadder.itens;
assert(payloadEnviado.length === 1, "a escada enviada tem exatamente 1 item");
const item = payloadEnviado[0];
assert(
  item.hunt === "Rat Cellars" && item.criatura === "Rat" && item.faseAlvo === 1,
  `item gerado é { hunt: "Rat Cellars", criatura: "Rat", faseAlvo: 1 } — recebido: ${JSON.stringify(item)}`
);

// ---------- cenário 3: caçada sem criatura mapeada não gera item ----------
enviosBestiaryLadder.length = 0;
assert(
  run('typeof adicionarOuAvancarNaEscada("Caçada Sem Bicho Mapeado", "") === "undefined"'),
  "chamar adicionarOuAvancarNaEscada sem criatura não lança e não retorna nada"
);
assert(enviosBestiaryLadder.length === 0, "nenhum comando é enviado quando a criatura está vazia (caçada sem criatura mapeada)");
run('adicionarOuAvancarNaEscada("Caçada Sem Bicho Mapeado", null);');
assert(enviosBestiaryLadder.length === 0, "nenhum comando é enviado quando a criatura é null");
run('adicionarOuAvancarNaEscada("Caçada Sem Bicho Mapeado", undefined);');
assert(enviosBestiaryLadder.length === 0, "nenhum comando é enviado quando a criatura é undefined (fallback removido, não vira hunt)");

// ---------- cenário 4: compatibilidade de leitura pra item legado preservada ----------
// Item legado (criado pela versão antiga, ou por bug anterior) com
// `criatura` ausente — a leitura/normalização não pode quebrar nem descartar
// o item; só a CRIAÇÃO nova é proibida de inventar.
const persistidos = run(`
  itensBestiaryLadderPersistiveis([{ hunt: "Legado Sem Criatura", faseAlvo: 2, concluido: false }])
`);
assert(persistidos.length === 1, "item legado sem `criatura` continua sendo persistido (não é descartado)");
assert(persistidos[0].criatura === "Legado Sem Criatura", "leitura de item legado ainda cai no fallback criatura=hunt (só a criação nova não usa mais isso)");

// ---------- resultado ----------
if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) FALHARAM.`);
  process.exit(1);
}
console.log("\nTODOS OS CENARIOS PASSARAM");
