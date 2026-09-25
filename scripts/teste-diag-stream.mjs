// v0.13.4 — teste da gravação CONTÍNUA em disco do log do protocolo.
//
// Extrai, por marcador de texto, os blocos REAIS de
// `automation/content-injected.js` (`diagnostico`, `diagRegistrar`,
// `diagStream*`, `diagLigar`) e roda num sandbox `vm` com stubs de
// `sendToHost`, IPC e agendador. Não reimplementa nada do stream.
//
// O que precisa valer (e cada item abaixo vira uma verificação):
//   - o arquivo existe ANTES do primeiro await → nenhuma mensagem se perde na
//     espera pela versão do app;
//   - o cabeçalho é sempre a primeira linha, com a versão real;
//   - uma linha por mensagem, `t_ms<TAB>tipo<TAB>texto`, na ORDEM de chegada;
//   - quebra de linha dentro do texto não parte a linha em duas;
//   - desligar grava `#fim` com os totais, para o timer e devolve o estado;
//   - desligar durante a espera pela versão não deixa timer nem cabeçalho
//     órfão;
//   - SEM janela: 60.000 mensagens entram inteiras (o anel antigo guardava
//     4.000);
//   - o anel antigo (que alimenta "Baixar o log") continua funcionando.
//
// Comando: node scripts/teste-diag-stream.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const fonte = readFileSync(path.join(here, "..", "automation", "content-injected.js"), "utf8").replace(/\r\n/g, "\n");

function extrair(inicio, fim, nome) {
  const i = fonte.indexOf(inicio);
  const f = fonte.indexOf(fim, i + inicio.length);
  if (i === -1 || f === -1 || f <= i) {
    console.error(`FALHA: marcadores de '${nome}' não encontrados em content-injected.js.`);
    process.exit(1);
  }
  return fonte.slice(i, f);
}

const blocoConstantes = extrair("const APP_VERSION_DIAG", "  // Telemetria temporária de baseline.", "constantes + objeto diagnostico");
const blocoFuncoes = extrair("function diagRegistrar(texto)", "function diagPacote()", "diagRegistrar..diagLigar");

let falhas = 0;
function assert(cond, msg) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", msg);
  } else {
    console.log("ok:", msg);
  }
}

function criar() {
  const relogio = { t: 1_000_000 };
  const chunks = [];
  const timers = new Map();
  let idTimer = 0;
  let resolverVersao = null;
  const attrs = new Map();
  const ctx = {
    console,
    // `new Date()` (carimbo do nome do arquivo) continua real; só `Date.now()`
    // — o que mede t_ms — é o relógio controlado do teste.
    Date: class extends Date {
      static now() {
        return relogio.t;
      }
    },
    Math,
    Number,
    String,
    JSON,
    Map,
    Set,
    Array,
    Promise,
    setInterval: (fn, ms) => {
      const id = ++idTimer;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    document: {
      documentElement: {
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: (k) => attrs.delete(k),
      },
    },
    sendToHost: (canal, dados) => chunks.push({ canal, ...dados }),
    getActiveCharacterName: () => "Dezin Zemsta",
    ipcRenderer: {
      invoke: (canal) =>
        new Promise((res) => {
          resolverVersao = () => res("0.13.4-teste");
        }),
    },
    log: () => {},
    saveState: () => {},
    sendState: () => {},
  };
  vm.createContext(ctx);
  const api = vm.runInContext(
    `(() => {
      const PROTO_MARCA_DIAG = "data-hm-diag";
      ${blocoConstantes}
      ${blocoFuncoes}
      return { diagnostico, diagRegistrar, diagLigar, diagStreamFlush };
    })()`,
    ctx
  );
  return { api, relogio, chunks, timers, liberarVersao: () => resolverVersao && resolverVersao(), attrs };
}

const linhas = (chunks) => chunks.map((c) => c.texto).join("").split("\n").filter(Boolean);

// ---------- 1) nada se perde na espera pela versão; cabeçalho na frente ----------
{
  const { api, relogio, chunks, liberarVersao, timers } = criar();
  api.diagLigar(true);
  assert(!!api.diagnostico.stream.arquivo, "o arquivo é definido de forma síncrona (antes de qualquer await)");
  assert(/^swag-proto-Dezin-Zemsta-.*\.tsv$/.test(api.diagnostico.stream.arquivo), `nome do arquivo: ${api.diagnostico.stream.arquivo}`);

  // Duas mensagens chegam ENQUANTO ainda espera a versão do app.
  relogio.t += 150;
  api.diagRegistrar('[15,{"creature":{"id":1,"kind":"monster","name":"Spider"}}]');
  relogio.t += 50;
  api.diagRegistrar('[18,{"id":1}]');

  liberarVersao();
  await new Promise((r) => setTimeout(r, 0));

  const ls = linhas(chunks);
  assert(ls[0].startsWith("#cabecalho\t"), "o cabeçalho é a PRIMEIRA linha, mesmo com mensagens chegando antes da versão");
  const cab = JSON.parse(ls[0].split("\t")[1]);
  assert(cab.versao === "0.13.4-teste", "o cabeçalho carrega a versão real do app (não a constante velha)");
  assert(cab.personagem === "Dezin Zemsta" && typeof cab.inicioEpochMs === "number", "cabeçalho traz personagem e o instante de início");
  assert(ls[1] === '150\t15\t[15,{"creature":{"id":1,"kind":"monster","name":"Spider"}}]', "1ª mensagem: t_ms, tipo e texto cru, nesta ordem");
  assert(ls[2].startsWith("200\t18\t"), "2ª mensagem vem depois, com t_ms relativo ao início");
  assert(timers.size === 1, "um timer de flush ativo enquanto grava");

  // ---------- 2) o flush periódico manda o que chegou ----------
  const antes = chunks.length;
  relogio.t += 500;
  api.diagRegistrar('[21,{"id":9,"to":{"x":1,"y":2,"z":7}}]');
  [...timers.values()][0].fn();
  assert(chunks.length === antes + 1 && chunks[antes].arquivo === api.diagnostico.stream.arquivo, "o timer envia um pedaço com o nome do arquivo");
  assert(chunks[antes].texto.endsWith("\n") && chunks[antes].texto.split("\n").filter(Boolean).length === 1, "pedaço termina em quebra de linha (não corta mensagem ao meio)");
  const depoisVazio = chunks.length;
  [...timers.values()][0].fn();
  assert(chunks.length === depoisVazio, "sem mensagens novas, não envia pedaço vazio");

  // ---------- 3) quebra de linha no texto não parte a linha ----------
  api.diagRegistrar('[12,{"text":"a\nb"}]');
  api.diagStreamFlush();
  const ult = chunks[chunks.length - 1].texto;
  assert(ult.split("\n").filter(Boolean).length === 1, "quebra de linha crua dentro do texto vira espaço (continua uma linha só)");

  // ---------- 4) o anel antigo segue alimentado ----------
  assert(api.diagnostico.brutos.length === 4, "o anel antigo (Baixar o log) continua recebendo as mensagens");

  // ---------- 5) desligar: #fim com totais, timer parado ----------
  api.diagLigar(false);
  const fim = linhas(chunks).filter((l) => l.startsWith("#fim\t"));
  assert(fim.length === 1, "desligar grava exatamente uma linha #fim");
  const f = JSON.parse(fim[0].split("\t")[1]);
  assert(f.total === 4 && f.linhas === 4 && f.tipos.length === 4, `#fim traz os totais (total=${f.total}, linhas=${f.linhas}, tipos=${f.tipos.length})`);
  assert(timers.size === 0, "desligar para o timer");
  assert(api.diagnostico.stream.arquivo === null && !!api.diagnostico.stream.ultimo, "arquivo atual limpo, mas o último nome fica pra tela mostrar");
}

// ---------- 6) desligar DURANTE a espera pela versão: nada órfão ----------
{
  const { api, chunks, liberarVersao, timers } = criar();
  api.diagLigar(true);
  api.diagLigar(false);
  liberarVersao();
  await new Promise((r) => setTimeout(r, 0));
  assert(timers.size === 0, "desligou durante a espera: nenhum timer fica órfão");
  assert(!linhas(chunks).some((l) => l.startsWith("#cabecalho")), "desligou durante a espera: nenhum cabeçalho é gravado depois do #fim");
}

// ---------- 6b) várias contas no mesmo segundo NÃO dividem arquivo ----------
{
  const nomes = new Set();
  for (let n = 0; n < 40; n++) {
    const { api } = criar();
    api.diagLigar(true);
    nomes.add(api.diagnostico.stream.arquivo);
  }
  assert(nomes.size === 40, `40 contas ligando no mesmo segundo geram 40 nomes diferentes (deu ${nomes.size}) — antes gravavam todas em swag-proto-conta-<segundo>.tsv`);
}

// ---------- 6c) restauração no boot NÃO grava em disco ----------
{
  const { api, chunks, timers, liberarVersao } = criar();
  api.diagLigar(true, { disco: false }); // é o que o init faz com \`diagEnabled\` salvo
  liberarVersao();
  await new Promise((r) => setTimeout(r, 0));
  api.diagRegistrar('[21,{"id":1}]');
  api.diagRegistrar('[15,{"creature":{"id":2}}]');
  assert(api.diagnostico.ativo === true, "restaurado: o anel em memória liga (comportamento de sempre)");
  assert(api.diagnostico.stream.arquivo === null && timers.size === 0, "restaurado: nenhum arquivo e nenhum timer de flush");
  assert(chunks.length === 0, "restaurado: nenhum pedaço é enviado pro disco");
  assert(api.diagnostico.brutos.length === 2, "restaurado: as mensagens continuam indo pro anel (Baixar o log funciona)");
  api.diagLigar(false);
  assert(chunks.length === 0, "desligar um log restaurado não escreve #fim em arquivo nenhum");
  // Clique explícito depois disso: aí sim grava.
  api.diagLigar(true);
  assert(!!api.diagnostico.stream.arquivo, "ligar de novo por clique explícito volta a gravar em disco");
  api.diagLigar(false);
}

// ---------- 7) SEM janela: 60.000 mensagens entram inteiras ----------
{
  const { api, chunks, liberarVersao, timers } = criar();
  api.diagLigar(true);
  liberarVersao();
  await new Promise((r) => setTimeout(r, 0));
  const N = 60000;
  for (let i = 0; i < N; i++) {
    api.diagRegistrar(`[21,{"id":512122,"from":{"x":${i},"y":1,"z":7},"to":{"x":${i + 1},"y":1,"z":7},"durationMs":150}]`);
    if (i % 80 === 79) [...timers.values()][0].fn(); // ~2s de tráfego real por flush
  }
  api.diagLigar(false);
  const msgs = linhas(chunks).filter((l) => !l.startsWith("#"));
  assert(msgs.length === N, `60.000 mensagens gravadas sem perder nenhuma (deu ${msgs.length})`);
  assert(api.diagnostico.brutos.length <= 4000, "o anel em memória continua com teto (4.000) — só o arquivo é ilimitado");
  const ts = msgs.map((l) => Number(l.split("\t")[0]));
  assert(ts.every((t, i) => i === 0 || t >= ts[i - 1]), "as mensagens ficam em ordem de chegada");
}

// ---------- 8) processo principal: pedaços concorrentes ficam em ORDEM no arquivo ----------
{
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const fsp = await import("node:fs/promises");
  const mainSrc = readFileSync(path.join(here, "..", "main.js"), "utf8").replace(/\r\n/g, "\n");
  const i = mainSrc.indexOf("let filaDiagAppend = Promise.resolve();");
  const j = mainSrc.indexOf("// ---------- atualização automática (v0.6.0) ----------");
  if (i === -1 || j === -1 || j <= i) {
    console.error("FALHA: marcadores do handler diag:appendToProject não encontrados em main.js.");
    process.exit(1);
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "swag-logs-"));
  let handler = null;
  const ctx = {
    app: { isPackaged: false },
    ipcMain: {
      handle: (canal, fn) => {
        if (canal === "diag:appendToProject") handler = fn;
      },
    },
    fs: fsp,
    path,
    LOGS_DIR: dir,
    Promise,
    String,
  };
  vm.createContext(ctx);
  vm.runInContext(mainSrc.slice(i, j), ctx);
  assert(typeof handler === "function", "main.js registra o handler diag:appendToProject");

  // 300 pedaços disparados de uma vez, sem esperar um pelo outro (é o que o
  // renderer faz: não dá await entre pedaços).
  const pedidos = [];
  for (let n = 0; n < 300; n++) pedidos.push(handler({}, { filename: "../../teste.tsv", content: n + "\n" }));
  const rs = await Promise.all(pedidos);
  assert(rs.every((r) => r.ok), "todos os 300 pedaços concorrentes foram gravados");
  const conteudo = (await fsp.readFile(path.join(dir, "teste.tsv"), "utf8")).split("\n").filter(Boolean).map(Number);
  assert(conteudo.length === 300 && conteudo.every((v, k) => v === k), "e ficaram na ORDEM em que foram pedidos (a fila serializa os appends)");
  const fora = await handler({}, { filename: "../../fugiu.tsv", content: "x" });
  assert(fora.ok && (await fsp.readdir(dir)).sort().join() === "fugiu.tsv,teste.tsv", "nome com ../ é saneado e o arquivo fica preso dentro de logs/");
  ctx.app.isPackaged = true;
  const emb = await handler({}, { filename: "a.tsv", content: "x" });
  assert(emb.ok === false, "build instalado: recusa (a feature é só de desenvolvimento)");
  ctx.app.isPackaged = false;
  const ruim = await handler({}, { filename: "", content: "x" });
  assert(ruim.ok === false, "entrada inválida: recusa");
  await fsp.rm(dir, { recursive: true, force: true });
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTudo certo.");
