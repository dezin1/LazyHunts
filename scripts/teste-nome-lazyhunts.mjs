// v0.13.5 — troca de nome Swag → LazyHunts sem quebrar quem já usa o app.
//
// O que NÃO pode acontecer numa troca de nome:
//   1. o app abrir com uma pasta de dados nova (vazia) e o usuário "perder"
//      contas, login, estatísticas e Telegram depois de atualizar;
//   2. a atualização automática parar de reconhecer o app (appId);
//   3. o "Iniciar com o sistema" desligar em silêncio porque o exe mudou de nome;
//   4. sobrar "Swag" em texto que o usuário vê.
//
// Comando: node scripts/teste-nome-lazyhunts.mjs

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

const pkg = JSON.parse(ler("package.json"));
const main = ler("main.js");

// ---------- 1) pasta de dados ----------
assert(pkg.name === "huntera-multiconta", "o `name` do package.json continua 'huntera-multiconta' (é dele que a pasta de dados sempre veio)");
const iSetPath = main.indexOf('app.setPath("userData", path.join(app.getPath("appData"), PASTA_DE_DADOS));');
const iPrimeiroUso = main.indexOf('app.getPath("userData")', iSetPath + 1);
const iPrimeiroUsoGeral = main.search(/app\.getPath\("userData"\)(?!` )/);
assert(iSetPath !== -1, "main.js fixa a pasta de dados explicitamente");
assert(/const PASTA_DE_DADOS = "huntera-multiconta";/.test(main), "e a pasta fixada é a MESMA de antes (%APPDATA%\\huntera-multiconta)");
assert(iPrimeiroUso > iSetPath, "a fixação roda antes do primeiro uso de getPath('userData')");
// O único "getPath(\"userData\")" antes do setPath é o que está dentro do comentário explicativo.
const antes = main.slice(0, iSetPath).split("\n").filter((l) => l.includes('getPath("userData")') && !l.trim().startsWith("//"));
assert(antes.length === 0, "nenhum código lê a pasta de dados antes de ela ser fixada");
void iPrimeiroUsoGeral;

// ---------- 2) atualização automática ----------
assert(pkg.build.appId === "br.com.andre.hunteramulticonta", "appId inalterado (é o que liga a instalação antiga à nova e o registro no Windows)");
assert(pkg.build.publish && pkg.build.publish.owner === "dezin1" && pkg.build.publish.repo === "MultiAccount", "o feed de atualização continua o mesmo repositório");

// ---------- 3) nome do produto e instalador ----------
assert(pkg.build.productName === "LazyHunts", "productName = LazyHunts");
assert(pkg.build.nsis.artifactName === "LazyHunts-Setup.exe", "instalador Windows com nome fixo LazyHunts-Setup.exe (o link do site depende de nome fixo)");
assert(/^LazyHunts/.test(pkg.build.mac.artifactName) && /^LazyHunts/.test(pkg.build.dmg.artifactName) && /^LazyHunts/.test(pkg.build.dmg.title), "arquivos do Mac também com o nome novo");

// ---------- 4) migração do "Iniciar com o sistema" (roda a função real) ----------
{
  const ini = main.indexOf("function migrarIniciarComSistema() {");
  const fim = main.indexOf("app.whenReady().then(migrarIniciarComSistema);", ini);
  assert(ini !== -1 && fim > ini, "migração do 'Iniciar com o sistema' existe e é chamada no whenReady");
  const codigo = main.slice(ini, fim);
  function rodar({ plataforma = "win32", empacotado = true, execPath, antigoLigado }) {
    const chamadas = [];
    const app = {
      isPackaged: empacotado,
      getLoginItemSettings: (o) => ({ openAtLogin: !!(o && o.path && o.path.endsWith("Swag.exe") && antigoLigado) }),
      setLoginItemSettings: (o) => chamadas.push(o),
    };
    const ctx = { app, path: path.win32, process: { platform: plataforma, execPath } };
    vm.createContext(ctx);
    vm.runInContext(codigo + "\nmigrarIniciarComSistema();", ctx);
    return chamadas;
  }
  const novo = "C:\\Users\\x\\AppData\\Local\\Programs\\huntera-multiconta\\LazyHunts.exe";
  const c1 = rodar({ execPath: novo, antigoLigado: true });
  assert(c1.length === 1 && c1[0].openAtLogin === true && !c1[0].path, "tinha 'Iniciar com o sistema' no Swag.exe → regrava apontando pro exe atual");
  assert(rodar({ execPath: novo, antigoLigado: false }).length === 0, "não tinha a opção ligada → não liga sozinho");
  assert(rodar({ execPath: novo, antigoLigado: true, empacotado: false }).length === 0, "em desenvolvimento (npm start) não mexe no Registro");
  assert(rodar({ execPath: novo, antigoLigado: true, plataforma: "darwin" }).length === 0, "fora do Windows não faz nada");
}

// ---------- 5) nenhum "Swag" visível sobrou ----------
{
  const html = ler("renderer/index.html").replace(/<!--[\s\S]*?-->/g, "");
  const visivelHtml = html.replace(/<[^>]*>/g, " ");
  assert(!/\bSwag\b/.test(visivelHtml), "index.html: nenhum 'Swag' em texto visível");
  const semComentarios = (src) =>
    src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*)/.test(l))
      .join("\n");
  const strings = (src) => semComentarios(src).match(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g) || [];
  for (const f of ["renderer/renderer.js", "main.js"]) {
    const achados = strings(ler(f)).filter((s) => /\bSwag\b/.test(s) && !/Swag\.exe/.test(s));
    assert(achados.length === 0, `${f}: nenhum 'Swag' em string visível${achados.length ? " — sobrou: " + achados.join(" | ") : ""}`);
  }
  assert(/NOME_DO_APP = "LazyHunts"/.test(main) && /title: NOME_DO_APP,/.test(main), "título da janela = LazyHunts");
}

// ---------- 6) ícone "Lua-arco" ----------
{
  const { existsSync } = await import("node:fs");
  const ico = readFileSync(path.join(raiz, "build", "icon.ico"));
  const n = ico.readUInt16LE(4);
  const camadas = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16;
    const lado = ico[o] || 256;
    const off = ico.readUInt32LE(o + 12);
    const png = ico.slice(off, off + 4).toString("hex") === "89504e47";
    camadas.push({ lado, png });
  }
  const lados = camadas.map((c) => c.lado).join(",");
  assert(lados === "16,24,32,48,64,128,256", `icon.ico com as camadas 16..256 (tem ${lados})`);
  // O Explorer devolveu o ícone GENÉRICO do Windows quando as camadas pequenas
  // eram PNG (medido com app.getFileIcon no exe gerado). BMP até 128, PNG só no 256.
  assert(camadas.every((c) => (c.lado >= 256 ? c.png : !c.png)), "camadas pequenas em BMP e só a de 256 em PNG (senão o Windows mostra o ícone genérico)");
  const icns = readFileSync(path.join(raiz, "build", "icon.icns"));
  const tipos = [];
  for (let o = 8; o < icns.length; o += icns.readUInt32BE(o + 4)) tipos.push(icns.slice(o, o + 4).toString());
  assert(icns.slice(0, 4).toString() === "icns" && ["ic07", "ic08", "ic09", "ic10"].every((t) => tipos.includes(t)), `icon.icns até 1024px (${tipos.join(",")})`);
  const appIcon = readFileSync(path.join(raiz, "renderer", "assets", "app-icon.png"));
  assert(appIcon.readUInt32BE(16) === 256 && appIcon.readUInt32BE(20) === 256, "app-icon.png (janela/barra de tarefas) 256×256");
  assert(!existsSync(path.join(raiz, "renderer", "assets", "lion-mark.png")), "o leão antigo (lion-mark.png) saiu");
  assert(existsSync(path.join(raiz, "build", "icon-fonte", "lazyhunts-icon.svg")), "SVG-fonte guardado em build/icon-fonte/");
  const html = ler("renderer/index.html");
  const ids = [...html.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1]);
  assert(ids.includes("lhMarcaLuaTopo") && ids.includes("lhMarcaLuaLogin") && new Set(ids).size === ids.length, "marcas do topo e do login são a lua-arco, com ids de máscara únicos na página");
  assert(!/stroke-dasharray="140 24"/.test(html), "a marca antiga (anel com ponto) não sobrou");
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTudo certo.");
