// v0.13.7 — XP/h e lucro/h da conta FREE sobre os últimos 15 minutos.
//
// André (25/09/2026): na conta free o por hora era total ÷ duração da sessão
// inteira, e o acumulado de horas "poluía" a análise. Agora é a média de ganho
// nos últimos 15 min de relógio — incluindo cidade e o entra-e-sai de renovar
// spawn seco (pedido explícito: não zerar ao sair da hunt). Conta premium não
// muda (analisador do jogo).
//
// Roda o bloco REAL de automation/content-injected.js num sandbox com relógio
// falso.
//
// Comando: node scripts/teste-analisador-15min.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fonte = readFileSync(path.join(raiz, "automation", "content-injected.js"), "utf8").replace(/\r\n/g, "\n");

let falhas = 0;
function assert(cond, msg) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", msg);
  } else {
    console.log("ok:", msg);
  }
}

function extrair(ini, fim) {
  const i = fonte.indexOf(ini);
  const f = fonte.indexOf(fim, i);
  if (i === -1 || f === -1) {
    console.error(`FALHA: marcador '${ini}' não encontrado`);
    process.exit(1);
  }
  return fonte.slice(i, f);
}

const bloco = extrair("  const JANELA_FREE_MS = 15 * 60000;", "  function economiaParaEnvio() {");

const MIN = 60000;
function criar() {
  const relogio = { t: 1_000_000 };
  const economia = { xp: 0, loot: new Map(), precoNpc: new Map([[100, 50]]), custoTotal: 0, custoDesgaste: 0, sessao: null };
  const ctx = { Date: { now: () => relogio.t }, Math, economia, GOLD_COIN_ITEM_ID: 3031, perfWatcher: (n, i, f, t) => t(), setInterval: () => 1 };
  vm.createContext(ctx);
  const api = vm.runInContext(`${bloco}; ({ janelaFreeTick, janelaFreeTaxas, janelaFreeZerar, lucroFreeAcumulado, janelaFree })`, ctx);
  // Simula `min` minutos ganhando `xpMin` XP e `gpMin` gp de loot (a preço de
  // NPC) por minuto, com o relógio de amostra de 30s rodando.
  function passar(min, xpMin, gpMin) {
    for (let s = 0; s < min * 2; s++) {
      relogio.t += 30000;
      economia.xp += xpMin / 2;
      const atual = economia.loot.get(100) || { qtd: 0 };
      economia.loot.set(100, { qtd: atual.qtd + gpMin / 2 / 50 });
      api.janelaFreeTick();
    }
  }
  return { api, economia, relogio, passar };
}

// ---------- 1) começo: nada de número instável ----------
{
  const { api, passar } = criar();
  passar(1.5, 600, 1000);
  const r = api.janelaFreeTaxas();
  assert(r.xpHora === null && r.lucroHora === null && r.janelaMs > 0, "com menos de 2 min de amostra: 'medindo…' (sem número)");
  passar(1, 600, 1000);
  assert(api.janelaFreeTaxas().xpHora !== null, "a partir de 2 min já mostra o por hora");
}

// ---------- 2) ritmo constante: bate o valor esperado ----------
{
  const { api, passar } = criar();
  passar(20, 600, 1000);
  const r = api.janelaFreeTaxas();
  assert(r.xpHora === 36000, `600 xp/min constante → 36.000 xp/h (deu ${r.xpHora})`);
  assert(r.lucroHora === 60000, `1.000 gp/min de loot → 60.000 gp/h (deu ${r.lucroHora})`);
  assert(r.janelaMs >= 15 * MIN && r.janelaMs < 15.5 * MIN, `a janela cobre 15 min, não a sessão de 20 (cobre ${(r.janelaMs / MIN).toFixed(1)} min)`);
}

// ---------- 3) O CASO DO ANDRÉ: a caçada mudou de ritmo ----------
{
  const { api, economia, passar } = criar();
  passar(120, 100, 200); // 2h fracas
  passar(15, 600, 1000); // 15 min bons
  const r = api.janelaFreeTaxas();
  const mediaSessao = Math.round((economia.xp / 135) * 60);
  console.log(`   (2h a 6.000 xp/h + 15 min a 36.000 xp/h: média da sessão inteira daria ${mediaSessao.toLocaleString("pt-BR")} xp/h; a janela dá ${r.xpHora.toLocaleString("pt-BR")})`);
  assert(r.xpHora === 36000, "depois de 2h fracas, 15 min bons já mostram 36.000 xp/h (antes o acumulado prendia em ~9.300)");
}

// ---------- 4) sair da hunt NÃO zera: entra e sai do spawn seco conta ----------
{
  const { api, passar } = criar();
  passar(10, 600, 1000); // caçada anterior (fica fora da janela)
  passar(12, 600, 1000); // caçando
  passar(3, 0, 0); // cidade/renovação, sem ganho
  const r = api.janelaFreeTaxas();
  assert(r.janelaMs >= 15 * MIN, "a janela continua de 15 min mesmo com a saída da hunt no meio");
  assert(r.xpHora === Math.round((12 * 600 * 60) / 15), `o tempo fora conta: 12 min de caçada em 15 → ${Math.round((12 * 600 * 60) / 15)} xp/h (deu ${r.xpHora})`);
}

// ---------- 5) premium e resets ----------
{
  const { api, economia, passar } = criar();
  passar(5, 600, 1000);
  economia.sessao = { durationMs: 1 };
  api.janelaFreeTick();
  assert(api.janelaFree.amostras.length === 0, "conta com analisador do jogo (tipo 41): a janela free não roda");

  const b = criar();
  b.passar(10, 600, 1000);
  b.economia.xp = 0; // sessão zerou por outro caminho
  b.api.janelaFreeTick();
  assert(b.api.janelaFree.amostras.length === 1, "acumulado andou pra trás: a janela recomeça (não compara sessões diferentes)");
}

// ---------- 6) fiação no arquivo real ----------
{
  const zerar = extrair("  function economiaZerar() {", "  function ");
  assert(/janelaFreeZerar\(\)/.test(fonte.slice(fonte.indexOf("  function economiaZerar() {"), fonte.indexOf("economia.kills = 0;", fonte.indexOf("  function economiaZerar() {")) + 40)), "nova sessão do analisador (troca de personagem/automação) zera a janela");
  void zerar;
  const mundo = extrair("  function mundoLerMensagem(p) {", "  function emCacadaPeloProtocolo");
  assert(!/janelaFreeZerar/.test(mundo), "trocar de instância (sair da hunt, renovar spawn) NÃO zera a janela");
  assert(/startJanelaFreeWatcher\(\);/.test(fonte), "o relógio de amostras é iniciado no boot");
  const resumoFree = extrair("      fonte: \"gold\",", "          vendas: economia.vendas,");
  assert(/xpHora: janela\.xpHora/.test(resumoFree) && /lucroHora: janela\.lucroHora/.test(resumoFree) && /janelaMs: janela\.janelaMs/.test(resumoFree), "o resumo da conta free usa a janela de 15 min");
  const resumoPremium = extrair("      fonte: \"protocolo\",", "      fonte: \"gold\",");
  assert(/xpHora: horas > 0 \? Math\.round\(\(Number\(s\.experience\) \|\| 0\) \/ horas\)/.test(resumoPremium), "conta premium: por hora do analisador do jogo, sem mudança");
  const renderer = readFileSync(path.join(raiz, "renderer", "renderer.js"), "utf8");
  assert(/últimos \$\{janelaMin\} min/.test(renderer) && /medindo…/.test(renderer), "o painel mostra a janela no rótulo e 'medindo…' no começo");
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTudo certo.");
