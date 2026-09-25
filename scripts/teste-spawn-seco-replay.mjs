// v0.13.4 — replay do detector de spawn seco contra LOGS REAIS do André.
//
// Mesmo método dos outros testes: extrai, por marcador de texto, os blocos
// REAIS de `automation/content-injected.js` (estado + registro de nascimento/
// morte/passo + `avaliarSpawnSeco`) e roda num sandbox `vm` com relógio falso.
// Nada do detector é reimplementado aqui — só o ambiente ao redor dele e o
// "motorista" que alimenta as mensagens do protocolo na mesma ordem em que o
// `spawnLerMensagem` faria.
//
// Compara os parâmetros ANTIGOS (v0.13.3: lote ×3/piso 20s, sem teto de tiles)
// com os NOVOS (v0.13.4: lote ×2/piso 10s, teto de tiles 64) em cada log.
// Logs vivem em `logs/` (gitignorada); os que faltarem são pulados.
//
// Comando: node scripts/teste-spawn-seco-replay.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, "..");
const fonte = readFileSync(path.join(raiz, "automation", "content-injected.js"), "utf8").replace(/\r\n/g, "\n");

function extrair(inicio, fim, nome) {
  const i = fonte.indexOf(inicio);
  const f = fonte.indexOf(fim, i + inicio.length);
  if (i === -1 || f === -1 || f <= i) {
    console.error(`FALHA: marcadores de '${nome}' não encontrados em content-injected.js.`);
    process.exit(1);
  }
  return fonte.slice(i, f);
}

const blocoEstado = extrair("const spawnWatch = {", "\n  };\n", "spawnWatch") + "\n  };\n";
const blocoRegistro = extrair(
  "function spawnRessincronizar(",
  "  // Tipos que a automação escuta.",
  "registro de nascimento/morte/passo + perfis"
);
const blocoAvaliar = extrair(
  "function intervaloTipicoDeSpawn()",
  "function startCitySellWatcher()",
  "avaliarSpawnSeco"
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

// Constantes NOVAS estão no arquivo; as ANTIGAS são reconstruídas por troca de
// texto (assim o teste quebra se alguém renomear a constante em vez de passar
// batido comparando a mesma coisa com ela mesma).
function comParametros(codigo, antigo) {
  if (!antigo) return codigo;
  const trocas = [
    ["const LOTE_FATOR = 2;", "const LOTE_FATOR = 3;"],
    ["const LOTE_PISO_MS = 10000;", "const LOTE_PISO_MS = 20000;"],
    ["const TILES_TETO = 64;", "const TILES_TETO = 1e9;"],
    ["const VAZIO_MIN_AMOSTRAS = 8;", "const VAZIO_MIN_AMOSTRAS = 1e9;"],
  ];
  let out = codigo;
  for (const [de, para] of trocas) {
    if (!out.includes(de)) {
      console.error(`FALHA: '${de}' não encontrado — o teste precisa ser atualizado junto com a constante.`);
      process.exit(1);
    }
    out = out.replace(de, para);
  }
  return out;
}

const NL = String.fromCharCode(10);

function criarSandbox(antigo) {
  const relogio = { t: 0 };
  const store = new Map();
  const ctx = {
    console,
    Date: { now: () => relogio.t },
    Math,
    Number,
    JSON,
    Map,
    Set,
    Array,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
  };
  vm.createContext(ctx);
  const codigo = `
    (() => {
      let spawnCfg = { enabled: true, minSeconds: 90, factor: 4 };
      ${comParametros([blocoEstado, blocoRegistro, blocoAvaliar].join(NL), antigo)}
      return { spawnWatch, spawnRessincronizar, spawnRegistrarNascimento, registrarMorteNoPerfil, registrarPasso, avaliarSpawnSeco, zerarDeteccaoDeSpawn, usarPerfilDoCenario, pisoDeTempoDeTiles, TILES_MIN_SEGUNDOS };
    })()
  `;
  const api = vm.runInContext(codigo, ctx);
  return { api, relogio };
}

// Reproduz o que `spawnLerMensagem` faz com 15/18/21 e o que `mundoLerMensagem`
// faz com o 54, e chama `avaliarSpawnSeco()` a cada 1s de tempo simulado —
// como o tick da automação. Devolve o PRIMEIRO disparo de cada instância de
// caçada (na produção, depois dele a automação sai e zera tudo).
function reproduzir(log, antigo) {
  const { api, relogio } = criarSandbox(antigo);
  const w = api.spawnWatch;
  const evs = log.brutos
    .map((b) => {
      let p = null;
      try {
        p = JSON.parse(b.texto)[1];
      } catch (e) {}
      return { t: b.t, tipo: b.tipo, p };
    })
    .sort((a, b) => a.t - b.t);

  // O id do personagem: o que mais anda (mesmo critério que usei ao analisar).
  const cont = {};
  for (const e of evs) if (e.tipo === 21 && e.p) cont[e.p.id] = (cont[e.p.id] || 0) + 1;
  const meu = Number(Object.entries(cont).sort((a, b) => b[1] - a[1])[0][0]);

  w.ativo = true;
  w.meuId = meu;
  w.perfilCenario = "teste";
  const disparos = [];
  let ultimoTick = evs[0].t;
  let instancia = { id: "(antes do log)", ini: evs[0].t };
  let disparou = false;
  let mortes = 0;
  let ultimoSpawn = null;

  const tick = (ate) => {
    while (ultimoTick + 1000 <= ate) {
      ultimoTick += 1000;
      relogio.t = ultimoTick;
      if (disparou || !w.ativo) continue;
      const seco = api.avaliarSpawnSeco();
      if (seco) {
        disparou = true;
        disparos.push({
          instancia: instancia.id,
          t: ultimoTick,
          rel: (ultimoTick - instancia.ini) / 1000,
          motivo: seco.motivo,
          semMatar: w.ultimaMorteEm ? (ultimoTick - w.ultimaMorteEm) / 1000 : null,
          semNascer: (ultimoTick - w.ultimoSpawnEm) / 1000,
          vivos: w.vivos.size,
        });
      }
    }
  };

  for (const e of evs) {
    tick(e.t);
    relogio.t = e.t;
    if (e.tipo === 54 && e.p && instancia.id === e.p.instanceId) {
      // Igual a `mundoLerMensagem`: 54 repetido da MESMA instância = reconexão. O código
      // novo ressincroniza (vivos/relógio); o antigo não fazia nada.
      if (!antigo) api.spawnRessincronizar();
      continue;
    }
    if (e.tipo === 54 && e.p) {
      instancia = { id: e.p.instanceId, ini: e.t };
      // Igual a `mundoLerMensagem`: troca o perfil pela caçada (o aprendizado sobrevive
      // às instâncias da MESMA caçada) e só então zera a contagem.
      api.usarPerfilDoCenario(String(e.p.scenarioId || ""));
      api.zerarDeteccaoDeSpawn();
      disparou = false;
      w.ativo = /-hunt/.test(String(e.p.scenarioId || ""));
      continue;
    }
    if (!w.ativo) continue;
    if (e.tipo === 15 && e.p && e.p.creature && e.p.creature.kind === "monster") {
      api.spawnRegistrarNascimento(e.p.creature.name, e.p.creature.id);
      ultimoSpawn = e.t;
    } else if (e.tipo === 18 && e.p && w.vivos.delete(e.p.id)) {
      w.mortesNaVolta++;
      api.registrarMorteNoPerfil();
      mortes++;
    } else if (e.tipo === 21 && e.p && e.p.id === meu && e.p.to) {
      api.registrarPasso(e.p.to);
    }
  }
  tick(evs[evs.length - 1].t);
  // Invariante que mede o custo do ganho: depois do disparo ainda nasceu criatura
  // NESSA instância? Se sim, o detector teria cortado uma caçada viva.
  for (const d of disparos) {
    let fimInst = Infinity;
    for (const e of evs) if (e.tipo === 54 && e.t > d.t) { fimInst = e.t; break; }
    d.spawnsDepois = evs.filter((e) => e.tipo === 15 && e.p && e.p.creature && e.p.creature.kind === "monster" && e.t > d.t && e.t < fimInst).length;
  }
  return { disparos, mortes, ultimoSpawn };
}

// Gravação contínua (v0.13.4): `#cabecalho`/`#fim` + uma linha `t_ms<TAB>tipo<TAB>texto`.
function lerTsv(texto) {
  const brutos = [];
  for (const l of texto.split(String.fromCharCode(10))) {
    if (!l || l[0] === "#") continue;
    const i = l.indexOf(String.fromCharCode(9));
    const j = l.indexOf(String.fromCharCode(9), i + 1);
    brutos.push({ t: Number(l.slice(0, i)), tipo: Number(l.slice(i + 1, j)), texto: l.slice(j + 1) });
  }
  return { brutos };
}

function ler(nome) {
  const p = path.join(raiz, "logs", nome);
  if (!existsSync(p)) {
    console.log(`(pulado: logs/${nome} não existe nesta máquina)`);
    return null;
  }
  if (nome.endsWith(".tsv")) return lerTsv(readFileSync(p, "utf8"));
  return JSON.parse(readFileSync(p, "utf8"));
}

const relatorio = [];
function comparar(rotulo, log) {
  const velho = reproduzir(log, true);
  const novo = reproduzir(log, false);
  const f = (d) =>
    d.length
      ? d
          .map(
            (x) =>
              `${x.instancia}: disparou aos ${x.rel.toFixed(1)}s da instância (${x.motivo}), ${x.semMatar === null ? "?" : x.semMatar.toFixed(1)}s sem matar, ${x.semNascer.toFixed(1)}s sem nascer`
          )
          .join(" | ")
      : "não disparou";
  relatorio.push(`${rotulo}\n    ANTES: ${f(velho.disparos)}\n    AGORA: ${f(novo.disparos)}`);
  return { velho, novo };
}

// ---------- Hero: caçada que NÃO seca — não pode disparar em nenhum momento ----------
{
  const log = ler("swag-proto-Dezin-Zemsta-2026-09-24T02-42-04.json");
  if (log) {
    const { novo } = comparar("Hero (não seca, ondas a cada ~15s, 4x vivas=0)", log);
    assert(novo.disparos.length === 0, "Hero: o detector NÃO dispara numa caçada que nunca seca (nenhum falso positivo em 88s, com o mapa vazio 4 vezes)");
  }
}

// ---------- Vampire: o teto de tiles tem que cortar o cronômetro escondido de ~25s ----------
{
  const log = ler("swag-proto-Dezin-Zemsta-2026-09-24T03-11-17.json");
  if (log) {
    const { velho, novo } = comparar("Vampire (p90 de tiles = 15 → limiar 120)", log);
    const v = velho.disparos[0];
    const n = novo.disparos[0];
    assert(!!v && !!n, "Vampire: dispara antes e depois");
    if (v && n) {
      assert(v.semMatar >= 24, `Vampire ANTES: ~25s+ sem matar até disparar (deu ${v.semMatar.toFixed(1)}s)`);
      assert(n.semMatar <= 20, `Vampire AGORA: ≤20s sem matar (deu ${n.semMatar.toFixed(1)}s)`);
      assert(n.semMatar >= 15, `Vampire AGORA: nunca antes do piso de 15s de tempo (deu ${n.semMatar.toFixed(1)}s)`);
      assert(n.vivos === 0, "Vampire AGORA: só dispara com o mapa vazio");
    }
  }
}

// ---------- Troll: ondas curtas — continua saindo, e não antes da hora ----------
{
  const log = ler("swag-proto-Dezin-Zemsta-2026-09-24T02-37-02.json");
  if (log) {
    const { velho, novo } = comparar("Troll Hills (ondas a cada ~7s, últimas em ~43,6s)", log);
    const n = novo.disparos[0];
    const v = velho.disparos[0];
    assert(!!n && !!v, "Troll: detecta o fim da caçada antes e depois");
    if (n && v) {
      // O piso de 15s é do critério de TILES. O critério de LOTE (agora ×2, piso
      // 10s) mede outra coisa — silêncio desde o último nascimento — e pode
      // disparar antes dos 15s de "sem matar" se o silêncio já passou de 2× o
      // ritmo aprendido. O que precisa valer é: silêncio real ≥ piso de 10s,
      // mapa vazio, e nunca mais tarde que antes.
      assert(n.semNascer >= 10, `Troll AGORA: silêncio desde o último nascimento ≥ piso de 10s (deu ${n.semNascer.toFixed(1)}s)`);
      assert(n.vivos === 0, "Troll AGORA: só dispara com o mapa vazio");
      assert(n.t <= v.t, `Troll AGORA: não sai mais tarde que ANTES (${n.rel.toFixed(1)}s vs ${v.rel.toFixed(1)}s)`);
    }
  }
}

// ---------- Spider: rajada única — só depois de limpar, em cada uma das duas entradas ----------
{
  const log = ler("swag-proto-Dezin-Zemsta-2026-09-24T02-31-10.json");
  if (log) {
    const { novo } = comparar("Spider Nest (rajada de 47 na entrada, depois nada)", log);
    assert(novo.disparos.length >= 1, "Spider: detecta que secou");
    for (const d of novo.disparos) {
      assert(d.vivos === 0, `Spider (${d.instancia}): só com o mapa vazio`);
      assert(d.semMatar === null || d.semMatar >= 15, `Spider (${d.instancia}): respeita o piso de 15s (deu ${d.semMatar === null ? "?" : d.semMatar.toFixed(1)}s)`);
    }
  }
}

// ---------- Piso de tempo APRENDIDO por caçada (unidade, relógio falso) ----------
{
  const { api, relogio } = criarSandbox(false);
  const w = api.spawnWatch;
  w.ativo = true;
  w.perfilCenario = "mummy-hunt";

  const piso = () => api.pisoDeTempoDeTiles() / 1000;
  assert(piso() === 15, "sem amostra nenhuma, o piso é o de sempre (15s)");

  // 1 onda, o mapa esvazia e volta bicho 3s depois: UMA amostra de 3s (só a
  // primeira criatura da onda conta — as outras 7 nascem no mesmo instante).
  relogio.t = 100000;
  w.vivos.set(1, "Mummy");
  w.vivos.delete(1);
  api.registrarMorteNoPerfil(); // esvaziou
  relogio.t += 3000;
  for (let n = 0; n < 8; n++) api.spawnRegistrarNascimento("Mummy", 100 + n);
  assert(w.perfilVazios.length === 1 && w.perfilVazios[0] === 3000, `mapa vazio por 3s e depois veio bicho: 1 amostra de 3000ms, não 8 (deu ${JSON.stringify(w.perfilVazios)})`);

  // Vazio que NUNCA termina em nascimento (a caçada secou) não vira amostra.
  for (let n = 0; n < 8; n++) w.vivos.delete(100 + n);
  api.registrarMorteNoPerfil();
  assert(w.vazioDesde > 0 && w.perfilVazios.length === 1, "mapa vazio sem nascimento depois: nenhuma amostra (é o que o detector procura)");
  api.zerarDeteccaoDeSpawn();
  assert(w.vazioDesde === 0 && w.perfilVazios.length === 1, "trocar de instância zera a medição em curso, mas o PERFIL fica");

  // Amostra insuficiente: continua 15s.
  w.perfilVazios = [3000, 2000, 1000, 3000, 2500, 900, 3000]; // 7
  assert(piso() === 15, "7 amostras (< 8): ainda o piso de 15s");
  // 8+ amostras: 2 × o MAIOR, entre 8s e 15s.
  w.perfilVazios = [3000, 2000, 1000, 3000, 2500, 900, 3000, 1500];
  assert(piso() === 8, "8 amostras, maior 3s → 2×3=6s, sobe pro mínimo de 8s");
  w.perfilVazios = [3000, 5000, 1000, 3000, 2500, 900, 3000, 1500];
  assert(piso() === 10, "maior 5s → piso 10s");
  w.perfilVazios = [3000, 11400, 1000, 3000, 2500, 900, 3000, 1500];
  assert(piso() === 15, "maior 11,4s (a Mummy) → 22,8s, limitado ao 15s de sempre: NUNCA passa do piso antigo");
  w.perfilVazios = [3000, 30000, 1000, 3000, 2500, 900, 3000, 1500];
  assert(piso() === 15, "um vazio enorme não estica o piso além dos 15s");

  // O perfil sobrevive a ir pra cidade e voltar pra mesma caçada.
  w.perfilVazios = [3000, 2000, 1000, 3000, 2500, 900, 3000, 1500];
  w.perfilSujo = true;
  api.usarPerfilDoCenario("main-city");
  assert(w.perfilVazios.length === 0, "na cidade, o perfil de vazios é outro (vazio)");
  api.usarPerfilDoCenario("mummy-hunt");
  assert(w.perfilVazios.length === 8 && piso() === 8, "de volta na mesma caçada, os vazios aprendidos voltam (persistidos)");

  // E o critério USA o piso aprendido: mapa vazio há 9s, 30 tiles andados.
  const { api: a2, relogio: r2 } = criarSandbox(false);
  const w2 = a2.spawnWatch;
  w2.ativo = true; w2.meuId = 1; w2.perfilCenario = "x";
  w2.perfilTiles = new Array(40).fill(3); // p90=3 → limiar de tiles = piso 25
  w2.perfilVazios = [3000, 2000, 1000, 3000, 2500, 900, 3000, 1500];
  r2.t = 1000000;
  w2.ultimoSpawnEm = r2.t - 12000; // um spawn há 12s
  w2.ultimaMorteEm = r2.t - 9000; // última morte há 9s
  w2.ultimoLoteEm = 0; w2.loteArmado = false;
  for (let i = 0; i < 40; i++) w2.tilesDesdeMorte.add("t" + i);
  const seco = a2.avaliarSpawnSeco();
  assert(!!seco && seco.motivo === "andou", "piso aprendido 8s: 9s sem matar + 40 tiles já dispara (com o piso antigo esperaria 15s)");
  w2.perfilVazios = []; // sem aprendizado
  assert(a2.avaliarSpawnSeco() === null, "sem aprendizado (mesma situação): 9s < 15s, não dispara — o comportamento de antes");
}

// ---------- Sessão longa (gravação contínua em disco): 5 caçadas seguidas ----------
// Giant Spider (seca), Dragon (NÃO seca: 20 ondas em 236s, mapa vazio 16 vezes,
// até 8,1s), 3× Mummy (ondas com o mapa vazio até 11,4s antes de vir mais bicho).
{
  const log = ler("swag-proto-Dezin-Zemsta-2026-09-24T03-28-11.tsv");
  if (log) {
    const { velho, novo } = comparar("Sessão longa: Giant Spider, Dragon, 3× Mummy (590s, gravação contínua)", log);
    const porInst = (d) => Object.fromEntries(d.map((x) => [x.instancia, x]));
    const n = porInst(novo.disparos);
    assert(!n["dragon-hunt-439"], "Dragon (não seca, 20 ondas, mapa vazio 16x): NÃO dispara em nenhum momento");
    for (const id of ["giant-spider-hunt-437", "mummy-hunt-440", "mummy-hunt-441"]) {
      assert(!!n[id], `${id}: detecta que secou`);
      if (n[id]) {
        // O maior tempo com o mapa vazio e ainda vindo mais bicho nesta sessão foi
        // 11,4s (Mummy) — o disparo precisa ficar acima disso, com folga.
        assert(n[id].semMatar >= 15, `${id}: dispara só depois de 15s sem matar (deu ${n[id].semMatar.toFixed(1)}s) — acima dos 11,4s de "mapa vazio, mas vem mais" medidos`);
        assert(n[id].semMatar <= 20, `${id}: e sem demorar (${n[id].semMatar.toFixed(1)}s)`);
      }
    }
  }
}

// ---------- O GANHO do piso aprendido: Giant Spider na 2ª volta, com dados reais ----------
// Uma instância só tem 6 medições de "mapa vazio que ainda veio bicho" (máx 3s):
// abaixo das 8 exigidas, então a 1ª volta usa o piso de 15s. Repetindo a MESMA
// instância real (como o app faz ao renovar), a 2ª já tem 12 medições.
{
  const log = ler("swag-proto-Dezin-Zemsta-2026-09-24T03-28-11.tsv");
  if (log) {
    const evs = log.brutos.map((b) => ({ ...b, p: (() => { try { return JSON.parse(b.texto)[1]; } catch (e) { return null; } })() }));
    const i54 = evs.findIndex((e) => e.tipo === 54 && e.p && e.p.instanceId === "giant-spider-hunt-437");
    const f54 = evs.findIndex((e, k) => k > i54 && e.tipo === 54);
    const cidade = evs.find((e) => e.tipo === 54 && e.p && e.p.scenarioId === "main-city");
    const trecho = log.brutos.slice(i54, f54 + 1);
    const dur = trecho[trecho.length - 1].t - trecho[0].t + 5000;
    const dobra = (n) => trecho.map((b) => ({ ...b, t: b.t + n * dur, texto: b.texto.replace(/giant-spider-hunt-437/g, "giant-spider-hunt-" + (437 + n)) }));
    const duas = { brutos: [...dobra(0), ...dobra(1)] };
    const r = reproduzir(duas, false).disparos;
    const r0 = reproduzir(duas, true).disparos;
    relatorio.push(
      "Giant Spider, 2 voltas seguidas (mesma instância real repetida)\n    ANTES (piso fixo 15s): " +
        r0.map((x) => x.semMatar.toFixed(1) + "s sem matar").join(" | ") +
        "\n    AGORA (piso aprendido): " +
        r.map((x) => x.semMatar.toFixed(1) + "s sem matar").join(" | ")
    );
    assert(r.length === 2 && r0.length === 2, "Giant Spider repetido: dispara nas duas voltas, antes e agora");
    if (r.length === 2) {
      assert(r[0].semMatar >= 15, `1ª volta (6 medições < 8): piso de sempre, ≥15s (deu ${r[0].semMatar.toFixed(1)}s)`);
      assert(r[1].semMatar < r[0].semMatar && r[1].semMatar >= 8, `2ª volta (12 medições, máx ~3s): piso aprendido ≥8s e menor que a 1ª (deu ${r[1].semMatar.toFixed(1)}s)`);
      assert(r.every((d) => d.vivos === 0 && d.spawnsDepois === 0), "e em nenhuma das duas voltas cortou bicho que ainda ia nascer");
    }
    void cidade;
  }
}

// ---------- Skeleton: reconexão na MESMA instância deixava criaturas-fantasma ----------
// No log `bauj` o socket caiu no meio da caçada de Skeleton; o servidor reenviou o 54
// da mesma instância e um 15 só com o personagem. Sem ressincronizar, `vivos` ficava
// com bichos que já não existiam e o spawn seco NUNCA disparava naquela caçada.
{
  const log = ler("swag-proto-Dezin-Zemsta-2026-09-24T03-39-22-bauj.tsv");
  if (log) {
    const { velho, novo } = comparar("Skeleton (reconexão na mesma instância, vivos fantasmas)", log);
    const sk = (r) => r.disparos.filter((d) => d.instancia === "skeleton-hunt-448");
    const t54 = log.brutos.filter((b) => b.tipo === 54 && b.texto.includes("skeleton-hunt-448")).map((b) => b.t);
    assert(t54.length === 2, "o log tem o 54 de Skeleton duas vezes (entrada + reconexão)");
    assert(sk(velho).length === 0, "ANTES: o spawn seco não dispara em Skeleton (vivos fantasmas travam a avaliação)");
    assert(sk(novo).length === 1, "AGORA: dispara em Skeleton");
    if (sk(novo).length === 1 && t54.length === 2) {
      const d = sk(novo)[0];
      const apos = (d.t - t54[1]) / 1000;
      assert(apos >= 0, `AGORA: só depois da reconexão (${apos.toFixed(1)}s depois do 54 repetido)`);
      assert(d.vivos === 0 && d.spawnsDepois === 0, "AGORA: mapa vazio e nenhuma criatura nasceu depois — não cortou caçada viva");
    }
  }
}

// Fiação: o driver acima imita o código; isto garante que o código de verdade o chama.
{
  const iMundo = fonte.indexOf("function mundoLerMensagem(");
  const corpo = fonte.slice(iMundo, fonte.indexOf("function emCacadaPeloProtocolo", iMundo));
  assert(corpo.includes("mundo.instanceId === p.instanceId") && corpo.includes("spawnRessincronizar()"), "mundoLerMensagem ressincroniza no 54 repetido da mesma instância");
  const iConectando = fonte.indexOf('if (estado === "conectando") {');
  assert(iConectando !== -1 && fonte.slice(iConectando, iConectando + 500).includes("spawnRessincronizar()"), "o socket 'conectando' também ressincroniza (vivos do socket antigo não valem)");
}

// ---------- Invariante em TODOS os logs: o detector nunca corta caçada viva ----------
{
  let cortes = 0;
  let disparosTotal = 0;
  for (const nome of [
    "swag-proto-Dezin-Zemsta-2026-09-24T02-31-10.json",
    "swag-proto-Dezin-Zemsta-2026-09-24T02-37-02.json",
    "swag-proto-Dezin-Zemsta-2026-09-24T02-42-04.json",
    "swag-proto-Dezin-Zemsta-2026-09-24T03-11-17.json",
    "swag-proto-Dezin-Zemsta-2026-09-24T03-28-11.tsv",
    "swag-proto-Dezin-Zemsta-2026-09-24T03-39-22-bauj.tsv",
  ]) {
    const log = ler(nome);
    if (!log) continue;
    for (const d of reproduzir(log, false).disparos) {
      disparosTotal++;
      if (d.spawnsDepois > 0) {
        cortes++;
        console.error(`  corte: ${nome} ${d.instancia} disparou aos ${d.rel.toFixed(1)}s e ainda nasceram ${d.spawnsDepois} criaturas depois`);
      }
    }
  }
  assert(cortes === 0, `nenhum dos ${disparosTotal} disparos (6 logs) cortou uma caçada que ainda ia nascer bicho`);
}

console.log("\n=== Comparação ANTES (v0.13.3) × AGORA (v0.13.4), replay do log real ===");
console.log("(perfil aprendido só com a janela do próprio log — o app de verdade também usa amostras de sessões anteriores)");
for (const r of relatorio) console.log("  " + r);

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTudo certo.");
