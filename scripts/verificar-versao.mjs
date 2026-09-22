// TASK-004 — verificação de versionamento visível, pra rodar antes de
// fechar qualquer entrega de release (regra registrada no CLAUDE.md da
// raiz). Confirma três coisas, nessa ordem:
//
//   1. `package.json` tem uma versão SemVer válida (release normal ou
//      prerelease, ex.: "0.13.0" ou "0.13.0-bestiary.1").
//   2. Essa mesma versão aparece no título da PRIMEIRA seção do
//      CHANGELOG.md (ou seja, no topo — a entrada mais recente).
//   3. Os pontos de exibição/plumbing da versão continuam DINÂMICOS (lendo
//      de `app.getVersion()` via IPC), não um número escrito à mão — é
//      assim que "nenhuma versão antiga fica hardcoded" se sustenta: não
//      adianta caçar strings "X.Y.Z" no código inteiro (o projeto tem
//      dezenas delas em comentários de histórico, tipo "v0.13.0 — Auto
//      Bestiary..."), o que importa é que os 3 lugares que REALMENTE
//      exibem a versão (main.js, preload.js, renderer.js) nunca tenham
//      trocado a leitura dinâmica por um literal.
//
// Comando: npm run verify:version  (ou: node scripts/verificar-versao.mjs)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, "..");

let falhas = 0;
function checar(cond, msgOk, msgFalha) {
  if (cond) {
    console.log("ok:", msgOk);
  } else {
    falhas++;
    console.error("FALHOU:", msgFalha);
  }
}

// ---------- 1. package.json ----------

const pkgPath = path.join(raiz, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const versao = pkg.version;

// SemVer 2.0.0 (release ou prerelease), ex.: 0.13.0 / 0.13.0-bestiary.1 / 1.2.3-rc.10
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
checar(
  typeof versao === "string" && SEMVER_RE.test(versao),
  `package.json tem uma versão SemVer válida: "${versao}"`,
  `package.json.version ausente ou não é SemVer válido (encontrado: ${JSON.stringify(versao)})`
);

// ---------- 2. CHANGELOG.md ----------

const changelogPath = path.join(raiz, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
// TASK-004 — "topo do CHANGELOG" = o primeiro título de seção de versão
// (linha "## "), não a primeira linha do arquivo (que é "# Changelog").
const primeiraSecao = changelog.split(/\r?\n/).find((linha) => linha.startsWith("## "));
checar(
  !!primeiraSecao && versao && primeiraSecao.includes(versao),
  `a versão "${versao}" aparece na primeira seção do CHANGELOG.md: "${primeiraSecao}"`,
  `a primeira seção do CHANGELOG.md não menciona a versão atual do package.json (esperado conter "${versao}", encontrado: ${JSON.stringify(primeiraSecao)})`
);

// ---------- 3. plumbing da versão continua dinâmico (não hardcoded) ----------

function lerArquivo(relPath) {
  try {
    return readFileSync(path.join(raiz, relPath), "utf8");
  } catch (err) {
    return null;
  }
}

const pontosDinamicos = [
  { arquivo: "main.js", precisa: "app.getVersion()" },
  { arquivo: "preload.js", precisa: 'ipcRenderer.invoke("app:getVersion")' },
  { arquivo: "renderer/renderer.js", precisa: "window.hunteraFarm.getAppVersion()" },
];

for (const { arquivo, precisa } of pontosDinamicos) {
  const conteudo = lerArquivo(arquivo);
  checar(
    conteudo !== null && conteudo.includes(precisa),
    `${arquivo} ainda lê a versão dinamicamente (${precisa})`,
    conteudo === null
      ? `${arquivo} não encontrado`
      : `${arquivo} não contém mais "${precisa}" — a exibição da versão pode ter virado um literal escrito à mão`
  );
}

// Verificação extra e específica: a versão ANTERIOR conhecida não pode ter
// ficado esquecida bem no ponto que o app mostra (renderer/index.html, onde
// mora o indicador visual `#appVersionTag`). Não varre o repo inteiro de
// propósito — comentários de histórico ("v0.13.0 — feature tal") são
// legítimos e não são bugs de versão hardcoded.
const indexHtml = lerArquivo("renderer/index.html");
const VERSAO_ANTERIOR_CONHECIDA = "0.12.4";
checar(
  indexHtml !== null && !indexHtml.includes(`v${VERSAO_ANTERIOR_CONHECIDA}`) && !indexHtml.includes(VERSAO_ANTERIOR_CONHECIDA),
  `renderer/index.html não tem a versão anterior (${VERSAO_ANTERIOR_CONHECIDA}) hardcoded`,
  `renderer/index.html ainda menciona a versão anterior (${VERSAO_ANTERIOR_CONHECIDA}) — pode ser um número esquecido`
);

// ---------- resultado ----------

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) FALHARAM.`);
  process.exit(1);
}
console.log(`\nVersão "${versao}" OK em package.json, CHANGELOG.md e nos pontos de exibição.`);
