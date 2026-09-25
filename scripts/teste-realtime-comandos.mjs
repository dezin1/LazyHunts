// v0.13.5 — comandos do painel por Realtime + ritmo das escritas (egress do Supabase).
//
// Medido nos logs do Supabase (25/09/2026): 145 mil de 183 mil requisições/dia
// eram o poll de comandos a cada 3s. Este teste roda o módulo REAL
// (renderer/realtime-comandos.js) com um WebSocket falso e relógio falso, e
// confere no main.js que o poll só roda sem Realtime.
//
// (O aperto de mão com o Supabase de verdade foi conferido à parte, com a chave
// pública: phx_reply ok + "Subscribed to PostgreSQL".)
//
// Comando: node scripts/teste-realtime-comandos.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(path.join(raiz, f), "utf8").replace(/\r\n/g, "\n");

let falhas = 0;
function assert(cond, msg) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", msg);
  } else {
    console.log("ok:", msg);
  }
}

// ---------- relógio e WebSocket falsos ----------
function montar() {
  let agora = 0;
  let prox = 1;
  const timers = new Map(); // id -> { quando, fn, repetir }
  const setTimeoutFn = (fn, ms) => (timers.set(prox, { quando: agora + ms, fn, repetir: 0 }), prox++);
  const setIntervalFn = (fn, ms) => (timers.set(prox, { quando: agora + ms, fn, repetir: ms }), prox++);
  const limpar = (id) => timers.delete(id);
  function avancar(ms) {
    const fim = agora + ms;
    for (;;) {
      let proximo = null;
      for (const [id, t] of timers) if (t.quando <= fim && (!proximo || t.quando < proximo[1].quando)) proximo = [id, t];
      if (!proximo) break;
      const [id, t] = proximo;
      agora = t.quando;
      if (t.repetir) t.quando += t.repetir;
      else timers.delete(id);
      t.fn();
    }
    agora = fim;
  }
  const sockets = [];
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.enviadas = [];
      this.fechado = false;
      sockets.push(this);
    }
    send(t) {
      this.enviadas.push(JSON.parse(t));
    }
    close() {
      this.fechado = true;
    }
    abrir() {
      this.readyState = 1;
      this.onopen && this.onopen();
    }
    receber(m) {
      this.onmessage && this.onmessage({ data: JSON.stringify(m) });
    }
    cair() {
      this.readyState = 3;
      this.onclose && this.onclose();
    }
    join() {
      return this.enviadas.find((m) => m.event === "phx_join");
    }
    aceitar() {
      const j = this.join();
      this.receber({ topic: j.topic, event: "phx_reply", ref: j.ref, payload: { status: "ok", response: {} } });
    }
  }
  const ctx = { console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(ler("renderer/realtime-comandos.js"), ctx);
  const avisos = [];
  const status = [];
  const rt = ctx.criarRealtimeComandos({
    WebSocketImpl: FakeWS,
    setTimeoutFn,
    clearTimeoutFn: limpar,
    setIntervalFn,
    clearIntervalFn: limpar,
    aoChegarComando: (m) => avisos.push(m),
    aoMudarStatus: (a) => status.push(a),
  });
  return { rt, sockets, avancar, avisos, status };
}

const CFG = { url: "https://abc.supabase.co", anonKey: "anon", accessToken: "tok1", deviceId: "dev-1" };

// ---------- 1) conecta, entra no canal certo, avisa ----------
{
  const { rt, sockets, avancar, avisos, status } = montar();
  rt.configurar(CFG);
  const ws = sockets[0];
  assert(ws && ws.url === "wss://abc.supabase.co/realtime/v1/websocket?apikey=anon&vsn=1.0.0", "abre o WebSocket do Realtime do projeto, com a chave pública");
  ws.abrir();
  const j = ws.join();
  const pc = j && j.payload.config.postgres_changes[0];
  assert(pc && pc.event === "INSERT" && pc.table === "commands" && pc.filter === "device_id=eq.dev-1", "assina só INSERT em commands DESTE computador");
  assert(j.payload.access_token === "tok1", "entra com o token do usuário (o RLS filtra por dono)");
  assert(rt.ativo === false, "antes da resposta do servidor ainda não conta como ativo");
  ws.aceitar();
  assert(rt.ativo === true && status.join() === "true", "servidor aceitou → ativo (o main para de consultar a cada 10s)");
  assert(avisos.join() === "conectou", "ao conectar, pede UMA busca (comando criado enquanto estava fora)");
  ws.receber({ topic: j.topic, event: "postgres_changes", payload: { data: { type: "INSERT" } } });
  assert(avisos.join() === "conectou,comando", "comando novo no painel → avisa o main na hora");
  ws.receber({ topic: "realtime:outro", event: "postgres_changes", payload: {} });
  assert(avisos.length === 2, "mensagem de outro canal é ignorada");
  const antes = ws.enviadas.length;
  avancar(25000);
  assert(ws.enviadas.slice(antes).some((m) => m.topic === "phoenix" && m.event === "heartbeat"), "manda o sinal de vida a cada 25s (senão o servidor derruba)");

  // ---------- 2) token renovado: não reconecta ----------
  rt.configurar({ ...CFG, accessToken: "tok2" });
  assert(sockets.length === 1, "token renovado não abre conexão nova");
  const at = ws.enviadas.find((m) => m.event === "access_token");
  assert(at && at.payload.access_token === "tok2" && at.topic === j.topic, "token renovado vai pelo evento access_token do canal");

  // ---------- 3) queda: volta sozinho, com espera crescente ----------
  ws.cair();
  assert(rt.ativo === false && status[status.length - 1] === false, "conexão caiu → inativo (o main volta a consultar)");
  avancar(1999);
  assert(sockets.length === 1, "não reconecta em rajada");
  avancar(1);
  assert(sockets.length === 2, "reconecta depois de 2s");
  sockets[1].cair(); // falhou antes de abrir
  avancar(4999);
  assert(sockets.length === 2, "segunda tentativa espera mais (5s)");
  avancar(1);
  assert(sockets.length === 3, "e reconecta aos 5s");
  sockets[2].abrir();
  assert(sockets[2].join().payload.access_token === "tok2", "reconecta já com o token novo");
  sockets[2].aceitar();
  assert(rt.ativo === true, "de volta ao ar");

  // ---------- 4) logout / licença vencida: desliga tudo ----------
  rt.configurar(null);
  assert(rt.ativo === false && sockets[2].fechado, "sem login/licença: fecha a conexão");
  avancar(120000);
  assert(sockets.length === 3, "e não tenta reconectar sozinho");
}

// ---------- 5) canal recusado (ex.: token inválido) ----------
{
  const { rt, sockets, avancar } = montar();
  rt.configurar(CFG);
  sockets[0].abrir();
  const j = sockets[0].join();
  sockets[0].receber({ topic: j.topic, event: "phx_reply", ref: j.ref, payload: { status: "error", response: { reason: "unauthorized" } } });
  assert(rt.ativo === false && sockets[0].fechado, "canal recusado: não conta como ativo e fecha");
  avancar(2000);
  assert(sockets.length === 2, "tenta de novo depois (o main segue consultando a cada 10s enquanto isso)");
  sockets[1].abrir();
  sockets[1].aceitar();
  sockets[1].receber({ topic: sockets[1].join().topic, event: "system", payload: { status: "error", message: "falhou" } });
  assert(rt.ativo === false, "erro de assinatura (system/error) também derruba o 'ativo'");
}

// ---------- 6) main.js: ritmo das consultas e escritas ----------
{
  const main = ler("main.js");
  const bloco = (ini, fim) => {
    const i = main.indexOf(ini);
    return main.slice(i, main.indexOf(fim, i));
  };
  const constantes = bloco("const SWAG_DEVICE_INTERVALO_MS", "async function swagSyncBridge()");
  const ctx = { Date: { now: () => ctx.__agora }, __agora: 0 };
  vm.createContext(ctx);
  const f = vm.runInContext(
    `let swagRealtimeAtivo = false; let swagUltimoPollComandosEm = 0;
     ${constantes}
     ({ precisa: (a) => swagPrecisaConsultarComandos(a), set: (ativo, ultimo) => { swagRealtimeAtivo = ativo; swagUltimoPollComandosEm = ultimo; } })`,
    ctx
  );
  f.set(false, 0);
  assert(f.precisa(9999) === false && f.precisa(10000) === true, "sem Realtime: consulta comandos a cada 10s (antes 3s)");
  f.set(true, 0);
  assert(f.precisa(179999) === false && f.precisa(180000) === true, "com Realtime: só rede de segurança a cada 3 min");

  const laco = bloco("function swagStartBridgeLoop()", 'ipcMain.handle("swag:login"');
  assert(!/\}, 3000\);/.test(laco), "o poll de 3s saiu");
  assert(/if \(!swagPrecisaConsultarComandos\(\)\) return;/.test(laco), "o laço rápido só consulta quando precisa");
  const sync = bloco("async function swagSyncBridge()", "function swagStartBridgeLoop()");
  assert(/SWAG_DEVICE_INTERVALO_MS/.test(sync) && /if \(swagPrecisaConsultarComandos\(\)\) await swagPollCommands/.test(sync), "o ciclo de 20s respeita o ritmo de devices e de comandos");

  const est = bloco("let swagUltimaAssinaturaEstado", "// v0.11.6");
  assert(/if \(rows\.length && \(mudou \|\| venceuReenvio\)\)/.test(est), "character_state só vai quando muda (ou a cada 5 min)");
  assert(/Math\.round\(t\.staminaSeconds \/ 60\) \* 60/.test(est), "stamina arredondada ao minuto (senão mudaria em todo envio)");
  assert(/toDelete/.test(est.slice(est.indexOf("venceuReenvio"))), "apagar personagem que deslogou continua acontecendo mesmo sem reenvio");

  const ctx2 = {};
  vm.createContext(ctx2);
  const assinar = vm.runInContext(bloco("function swagAssinaturaDoEstado(", "async function swagUpsertCharacterStates") + "; swagAssinaturaDoEstado", ctx2);
  const linha = { character_name: "A", level: 10, updated_at: "t1" };
  assert(assinar([linha]) === assinar([{ ...linha, updated_at: "t2" }]), "só o updated_at mudar não conta como mudança");
  assert(assinar([linha]) !== assinar([{ ...linha, level: 11 }]), "mudança de verdade (level) conta");

  assert(/ipcMain\.handle\("swag:commandsHint"/.test(main) && /swagEnviarRealtimeConfig\(\);/.test(bloco("function swagBroadcastStatus()", "let swagRealtimeAtivo")), "main recebe o aviso e renova a config a cada ciclo de licença (token novo)");
  const html = ler("renderer/index.html");
  assert(html.indexOf('src="realtime-comandos.js"') !== -1 && html.indexOf('src="realtime-comandos.js"') < html.indexOf('src="renderer.js"'), "index.html carrega o módulo antes do renderer.js");
  assert(/swagInitRealtimeComandos\(\);/.test(ler("renderer/renderer.js")), "renderer.js inicia o Realtime");
  const preload = ler("preload.js");
  assert(["swagGetRealtimeConfig", "onSwagRealtimeConfig", "swagRealtimeStatus", "swagCommandsHint"].every((k) => preload.includes(k + ":")), "preload expõe as 4 pontes");
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTudo certo.");
