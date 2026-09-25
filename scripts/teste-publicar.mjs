// v0.13.5 — distribuição por dl.lazyhunts.com (Cloudflare R2) sem deixar prévia
// chegar aos usuários e sem abandonar quem tem versão antiga.
//
// Roda as funções reais de scripts/publicar.mjs e confere o package.json/main.js.
//
// Comando: node scripts/teste-publicar.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tipoDeRelease, destinosDePublicacao, credenciaisFaltando, URL_DOWNLOADS, R2 } from "./publicar.mjs";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8"));
const main = readFileSync(path.join(raiz, "main.js"), "utf8");

let falhas = 0;
function assert(cond, msg) {
  if (!cond) {
    falhas++;
    console.error("FALHOU:", msg);
  } else {
    console.log("ok:", msg);
  }
}

// ---------- tipo pela versão ----------
assert(tipoDeRelease("0.13.5") === "release" && tipoDeRelease("0.13.5-lazyhunts.2") === "prerelease", "versão limpa = final, com sufixo = prévia");

// ---------- destinos ----------
{
  const final = destinosDePublicacao(pkg.build, "release");
  assert(final[0].provider === "generic" && final[0].url === URL_DOWNLOADS, "final: o feed do app é dl.lazyhunts.com (primeiro da lista = app-update.yml)");
  const s3 = final.find((d) => d.provider === "s3");
  assert(s3 && s3.bucket === R2.bucket && /r2\.cloudflarestorage\.com$/.test(s3.endpoint), "final: sobe pro bucket R2");
  assert(s3 && s3.acl === null, "final: sem ACL (o R2 recusa o public-read padrão do electron-builder)");
  const gh = final.find((d) => d.provider === "github");
  assert(gh && gh.releaseType === "release", "final: também vai pro GitHub como release comum (quem tem versão antiga lê o feed de lá)");

  const previa = destinosDePublicacao(pkg.build, "prerelease");
  assert(!previa.some((d) => d.provider === "s3"), "prévia NUNCA sobe pro R2 (o latest.yml de lá é o que os usuários leem)");
  assert(previa.find((d) => d.provider === "github").releaseType === "prerelease", "prévia vai pro GitHub marcada como prévia");
  assert(previa[0].provider === "generic" && previa[0].url === URL_DOWNLOADS, "prévia instalada também segue o feed de produção (recebe a próxima final)");
}

// ---------- credenciais ----------
assert(credenciaisFaltando("prerelease", { GH_TOKEN: "x" }).length === 0, "prévia só precisa do GH_TOKEN");
assert(credenciaisFaltando("release", { GH_TOKEN: "x" }).join() === "R2_ACCESS_KEY_ID,R2_SECRET_ACCESS_KEY", "final sem as chaves do R2: não publica pela metade");
assert(credenciaisFaltando("release", {}).includes("GH_TOKEN"), "sem GH_TOKEN: não publica");

// ---------- package.json ----------
assert(pkg.build.detectUpdateChannel === false, "detectUpdateChannel desligado: senão uma prévia vira canal 'lazyhunts' e o app instalado procura lazyhunts.yml pra sempre");
assert(pkg.build.publish[0].provider === "generic" && pkg.build.publish[0].url === URL_DOWNLOADS, "build comum também grava o feed do domínio no app");
assert(pkg.build.win.target.includes("nsis-web") && !pkg.build.win.target.includes("nsis"), "Windows: instalador leve (nsis-web) no lugar do completo");
assert(pkg.build.nsis.artifactName === "LazyHunts-Setup.exe" && pkg.build.nsis.oneClick === true && pkg.build.nsis.perMachine === false, "o instalador leve herda nome fixo, 1 clique e instalação por usuário (options do nsis)");

// ---------- main.js ----------
assert(/const SWAG_SIGNUP_URL = "https:\/\/lazyhunts\.com\/cadastrar";/.test(main), "link 'criar conta' do login aponta pro domínio próprio");
assert(/autoUpdater\.allowPrerelease = false;/.test(main), "updater nunca busca prévia, nem pra quem está numa versão com sufixo");

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTudo certo.");
