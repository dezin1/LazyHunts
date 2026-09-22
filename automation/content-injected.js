// automation/content-injected.js
//
// Preload script anexado a cada <webview> (uma por conta) via o atributo
// "preload" — roda em DOCUMENT-START, bem antes de a SPA do Huntera montar,
// então nenhuma leitura de DOM aqui pode assumir que os elementos do jogo já
// existem (por isso `waitFor` é usado pra praticamente tudo, igual na
// extensão Chrome).
//
// v0.4.0: o painel flutuante que ficava DENTRO da tela do jogo foi embora —
// André pediu pra controlar a automação pelo menu lateral do próprio app,
// não misturado com a interface do Huntera. No lugar do painel, esse
// arquivo agora fala com o host (`renderer.js`) por IPC:
//   - reporta o estado (rodando? status, caçada/tier/limiar configurados,
//     log, contas de caçadas/tiers quando pedidas) via
//     `ipcRenderer.sendToHost("hm:state", payload)`;
//   - recebe comandos (ligar, desligar, mudar configuração, atualizar lista
//     de caçadas/tiers) via `ipcRenderer.on("hm:command", handler)` — o
//     host manda esses comandos com `webview.send("hm:command", msg)`.
// A LÓGICA da automação em si (ciclo sair/vender/voltar, monitor de
// capacidade, seleção de caçada/tier) é a mesma de sempre, só a parte de
// "onde mora a interface" mudou. `require("electron")` funciona aqui
// porque o preload de um <webview> roda sem sandbox por padrão (tem acesso
// a Node/Electron mesmo com a página do jogo isolada).
//
// Troca de personagem, expedição da guild e fraqueza elemental (automações
// #2 e #3 da extensão) ainda NÃO estão aqui — ficam pra uma próxima versão.

(function () {
  "use strict";

  // ================= v0.11.10 — ESCUTA DO WEBSOCKET (spawn seco) =================
  //
  // POR QUE ISTO EXISTE: o mundo do jogo é desenhado num <canvas>, então as
  // criaturas não são elementos e NÃO DÁ pra contá-las pelo DOM — foi checado
  // (ver CLAUDE.md, armadilha do `.hud-battle-row`). Mas elas chegam pelo
  // WebSocket, em JSON legível, e é só isso que este bloco lê.
  //
  // ESCOPO DELIBERADAMENTE MÍNIMO: só os tipos 15 (nasceu criatura) e 18
  // (sumiu). O protocolo tem muito mais (posição, vida, preços, expedição),
  // mas cada tipo que a automação passa a depender é mais uma coisa que quebra
  // em silêncio quando o jogo atualizar. Abrimos uma porta por feature.
  //
  // ONDE O TEXTO APARECE: não é no `onmessage` (vem cifrado) nem no
  // `crypto.subtle.decrypt` (o jogo não usa) — é no `TextDecoder.decode`.
  // Descoberto com o probe de diagnóstico do André em 14/09/2026.
  //
  // REGRA DE OURO DESTE BLOCO: ele NUNCA pode quebrar o jogo. Todo o miolo
  // está em try/catch e o resultado nativo é sempre devolvido intacto.
  const spawnWatch = {
    ativo: false,
    vivos: new Map(), // id -> nome da criatura
    ultimoSpawnEm: 0,
    intervalos: [], // entre spawns, pra aprender o ritmo da caçada
    // v0.11.13 — "instalei o gancho" não é o mesmo que "está chegando
    // mensagem". Foi exatamente essa diferença que escondeu a falha da
    // v0.11.10: o gancho instalava com sucesso... no mundo errado.
    mensagens: 0,
    ultimaMensagemEm: 0,
    // v0.11.14 — rastro do PRÓPRIO personagem (tipo 21 filtrado pelo playerId
    // do tipo 103). Serve pra medir "deu a volta completa na caçada", que é o
    // critério que o André pediu: por tempo puro, um personagem de level baixo
    // — que demora mais pra fechar a rotação — dispararia falso.
    meuId: null,
    minhaPosicao: null,
    rastro: [], // {chave, em} das posições por onde passou nesta caçada
    voltaEm: 0, // quando fechou a última volta
    mortesNaVolta: 0,
    mortesNaVoltaAnterior: null, // null = ainda não fechou nenhuma volta
    // v0.11.33 — tiles DISTINTOS andados desde a última morte, e o perfil
    // aprendido da caçada atual. Ver o bloco "PERFIL DE TILES" abaixo.
    tilesDesdeMorte: new Set(),
    // v0.11.42 — candidatos a "meu id" vindos do tipo 30, e a trava que
    // desliga essa fonte assim que aparece mais de um jogador (party).
    idsDoXp: new Map(),
    idsDoXpAmbiguos: false,
    ultimaMorteEm: 0,
    perfilCenario: null, // scenarioId cujo perfil está carregado
    perfilTiles: [], // tiles distintos entre mortes, nesta caçada
    perfilLotes: [], // intervalo entre LOTES de nascimento, nesta caçada
    perfilSujo: false, // tem amostra nova pra gravar
    ultimoLoteEm: 0, // início do último lote de nascimento
    loteArmado: true, // um disparo por lote, não um por mensagem
  };

  // v0.11.18 — FICHA DO PERSONAGEM pelo tipo 77.
  //
  // Cada campo é atualizado só quando vem presente. Isso é precaução, não
  // remendo: nas três capturas, as 483 mensagens do tipo 77 vieram TODAS
  // completas, com as mesmas 39 chaves. (Eu cheguei a achar que existia uma
  // variante curta; era erro meu de leitura, comparando uma contagem do buffer
  // circular com o total da sessão. O teste derrubou a hipótese.) Se um dia
  // aparecer uma variante parcial, esta forma não apaga o que já se sabia.
  //
  // ⚠️⚠️ `capacity` NÃO É A CAPACIDADE RESTANTE. Ficou constante em 588721
  // nas 181 amostras de uma caçada com loot entrando o tempo todo — ou seja,
  // é o MÁXIMO. Trocar o `getCapacityRemaining()` por ele faria o bot achar
  // que nunca enche e nunca mais ir vender. Capacidade continua no DOM.
  const ficha = {
    staminaMs: null,
    staminaDrenando: null,
    level: null,
    vocacao: null,
    capacidadeMaxima: null, // só informativo — ver aviso acima
    em: 0,
  };

  const FICHA_VALIDADE_MS = 60000; // sem tipo 77 há mais que isso, volta pro DOM

  function fichaLerMensagem(p) {
    if (!p || typeof p !== "object") return;
    if (typeof p.staminaMs === "number") ficha.staminaMs = p.staminaMs;
    if (typeof p.staminaDraining === "boolean") ficha.staminaDrenando = p.staminaDraining;
    if (typeof p.level === "number") ficha.level = p.level;
    if (typeof p.vocation === "string") ficha.vocacao = p.vocation;
    if (typeof p.capacity === "number") ficha.capacidadeMaxima = p.capacity;
    ficha.em = Date.now();
    // v0.11.21 — a mesma mensagem que traz a stamina traz a experiência.
    xpLerMensagem(p);
  }

  function fichaFresca() {
    return ficha.em > 0 && Date.now() - ficha.em < FICHA_VALIDADE_MS;
  }

  // v0.11.31 — QUEM É ESTE PERSONAGEM, PELO PROTOCOLO.
  //
  // O tipo 103 (`{playerId}`) chega no login e diz o meu id; o tipo 15 anuncia
  // criaturas e jogadores, inclusive eu — e aí `creature.id === playerId`
  // fecha nome, level e vocação sem depender de o HUD ter montado.
  // Confirmado nas duas capturas de 14/09:
  //   [103,{"playerId":1124085}]
  //   [15,{"creature":{"id":1124085,"kind":"player","name":"Kina Zemsta",
  //        "level":143,"vocation":"knight",...}}]
  //
  // ⚠️ Isto é ZERADO em toda troca de personagem e toda queda de socket. Um
  // nome de personagem velho é pior que nenhum: ele decide atribuição de
  // Telegram, rodízio e quem é líder da party.
  const eu = { id: null, nome: null, vocacao: null, level: null, em: 0, sessao: 0, confirmadoPor103: false };

  function euZerar() {
    // v0.11.42 — outro personagem, outro id: os candidatos do tipo 30 também
    // são do anterior.
    spawnWatch.idsDoXp.clear();
    spawnWatch.idsDoXpAmbiguos = false;
    spawnWatch.meuId = null;
    eu.id = null;
    eu.nome = null;
    eu.vocacao = null;
    eu.level = null;
    eu.em = 0;
    eu.sessao = 0;
    eu.confirmadoPor103 = false;
  }

  // A identidade é confiável somente depois que o socket atual informou o id
  // (103) e um 15 associou esse id a um nome. Não vence por relógio: vence
  // quando a sessão do socket termina ou é substituída.
  function identidadeWsConfirmada() {
    return !!(
      socketJogo.estado === "aberto" &&
      socketJogo.sessao > 0 &&
      eu.confirmadoPor103 &&
      eu.sessao === socketJogo.sessao &&
      eu.id != null &&
      eu.nome
    );
  }

  function motivoFallbackIdentidadeWs() {
    if (socketJogo.estado !== "aberto") return "socket-nao-aberto";
    if (!socketJogo.sessao) return "socket-sem-geracao";
    if (!eu.confirmadoPor103) return "sem-103";
    if (eu.sessao !== socketJogo.sessao) return "geracao-divergente";
    if (eu.id == null) return "sem-playerId";
    if (!eu.nome) return "sem-15-correspondente";
    return null;
  }

  // v0.11.35 — A CAPACIDADE CALCULADA FOI REMOVIDA (decisão do André).
  //
  // A v0.11.31 reconstruía o peso carregado (tipo 74 + tipo 55) pra derivar a
  // capacidade restante, porque o servidor NÃO manda esse número — provado em
  // dois testes: os 43 valores distintos de capacidade da captura não aparecem
  // em nenhuma das 3.830 mensagens, e nenhum campo numérico do protocolo se
  // comporta como capacidade restante. O cálculo entrou em modo de
  // conferência, sem nunca mandar em nada.
  //
  // Na prática ele não convenceu, e o André mandou tirar. Está certo: um
  // número derivado que não converge é ruído no painel, e o número do jogo já
  // funciona. Fica só o que é LEITURA de verdade.
  //
  // Se algum dia isso voltar, o que falta descobrir está documentado no
  // CLAUDE.md: o suspeito é o tipo 62 (container aberto, bag dentro da bag),
  // que ficou de fora por não estar confirmado o que ele é.

  // v0.11.16 — último convite de party visto no protocolo (tipo 71).
  // `{fromId, fromName, members:[{name,level,vocation}]}`. Só a DETECÇÃO vem
  // daqui; aceitar continua sendo clique no DOM.
  const convite = { de: null, membros: [], em: 0 };

  // v0.11.22 — PARTY pelo protocolo (tipo 72). Traz nome, level, vocação e a
  // STAMINA de cada membro, ao vivo — e o `leaderId`, que hoje é um checkbox
  // marcado na mão. ⚠️ A forma muda com o contexto: dentro da caçada cada
  // membro traz `dps`/`damageTotal`/`hps`; na cidade esses campos somem.
  // Código que assumir `dps` presente quebra fora da caçada.
  const party = { lider: null, membros: [], em: 0 };

  // v0.11.17 — CAÇADA EM GRUPO pelo protocolo (tipo 51). O jogo manda a
  // máquina de estados inteira a cada mudança:
  //   {leaderName, huntId, tier, canAnswer, youAccepted,
  //    members:[{name, level, vocation, accepted, arrived, leader}]}
  // `canAnswer && !youAccepted` é literalmente "tem convite esperando você".
  const grupo = {
    lider: null,
    huntId: null,
    tier: null,
    membros: [],
    podeResponder: false,
    euAceitei: false,
    em: 0,
  };

  // v0.11.14 — estado REAL da conexão com o servidor, vindo do próprio socket
  // do jogo (open/close/error) em vez de adivinhado pelo DOM. É o que o André
  // apontou: "o próprio servidor retorna que está online".
  const socketJogo = {
    estado: "desconhecido", // desconhecido | conectando | aberto | fechado
    abertoEm: 0,
    fechadoEm: 0,
    sessao: 0,
  };

  // v0.11.11 — ANALISADOR PRÓPRIO pelo protocolo. O analisador do jogo é
  // premium; estes três tipos dão o mesmo (e mais) em QUALQUER conta:
  //   57 -> tabelas de preço: {npc:[[itemId,preço]]} e {auction:[[itemId,preço]]}
  //   60 -> item que ENTROU: {item:{itemId,count,name,...}}
  //   55 -> gold atual + mudanças de inventário
  // O custo sai dos DÉBITOS de gold: neste jogo suprimento não se compra, o
  // jogo cobra no uso (confirmado ao vivo: -40 = stone shower rune, -56 =
  // mana potion). Então toda variação negativa de gold é um suprimento gasto,
  // e o valor do débito identifica qual foi, cruzando com a tabela de NPC.
  const economia = {
    precoNpc: new Map(), // itemId -> gp
    precoLeilao: new Map(), // itemId -> gp
    nomePorItemId: new Map(),
    ultimoGold: null,
    // acumuladores da sessão (zerados junto com o stats)
    loot: new Map(), // itemId -> { nome, qtd }
    custoTotal: 0,
    custoPorValor: new Map(), // valor do débito -> vezes que aconteceu
    // v0.11.15 — o tipo 41 é o analisador do PRÓPRIO jogo, chegando pronto
    // pelo socket: kills, experience, lootValue, waste e as listas itemizadas
    // de loot e suprimentos, com nome e valor. Quando ele chega, tudo o que
    // está acima vira plano B.
    sessao: null, // último payload do tipo 41
    sessaoEm: 0,

    // v0.11.21 — SESSÃO RECONSTRUÍDA, pra conta free ter o mesmo painel.
    //
    // Validado contra o tipo 41 da conta premium, na mesma janela de tempo:
    //   • MORTES pelo bestiary (tipo 9): 37 × 37 do tipo 41. Exato.
    //     ⚠️ Contar tipo 18 dá 42 — ele também dispara quando a criatura só
    //     SAI DA TELA. Foi medido; não usar.
    //   • XP pelo `experience` do tipo 77: 67.377 × 67.377. Exato.
    //   • CUSTO pelos débitos de gold, que já existia.
    inicio: 0,
    kills: 0,
    bestiario: new Map(), // espécie -> contagem na última mensagem vista
    // v0.13.0 — AUTO BESTIARY POR FASE (Ladder). Maior fase CONFIRMADA via
    // tipo 92 (`"Bestiary stage {stage} reached: {monster}"`) nesta sessão,
    // por criatura (chave = nomeParaChaveBestiario). Só sobe, nunca desce.
    // Não sabe o que já tinha sido cruzado ANTES de o app abrir — é por
    // isso que a UI de configuração mostra os abates atuais da criatura
    // (economia.bestiario) pro André decidir se marca um item como já
    // concluído na hora de montar a lista.
    bestiarioFases: new Map(), // chave da criatura -> maior fase confirmada
    xp: 0,
    ultimoXp: null, // {atual, necessario}
    ultimoLevel: null,
    // v0.11.21 — venda rápida confirmada PELO SERVIDOR (tipo 92).
    vendas: 0,
    itensVendidos: 0,
    goldVendido: 0,
    ultimaVendaEm: 0,

    // v0.11.22 — DESGASTE DE EQUIPAMENTO. O André pediu isso lá atrás ("ring e
    // amuleto também têm preço fixo") e ficou como pendência porque não havia
    // como medir. O tipo 92 avisa na hora: "Your life ring crumbled to dust.
    // You put on another (27 left)." com `params.item` separado do texto.
    //
    // ⚠️ O JOGO NÃO CONTA ISSO NO "GASTO" DELE. A lista `supplies` do tipo 41
    // traz só runas e potions. Então isto é uma linha NOSSA, somada ao custo
    // nos dois caminhos (free e premium) pra que os dois continuem
    // comparáveis entre si — e separada no detalhe, pra ficar claro que o
    // número do Swag e o do analisador do jogo divergem de propósito aqui.
    equipados: new Map(), // slot -> {itemId, nome}
    desgaste: new Map(), // nome -> {qtd, itemId}
    custoDesgaste: 0,
  };

  // v0.11.12 — EXPEDIÇÃO DA GUILD e CATÁLOGO DE CAÇADAS, pelo protocolo.
  //   33 -> {expeditions:{periodKey,endsAtMs,entries:[{objectiveId,familyId,
  //         label,tier,quota,progress,milestonesPaid}]}}  (números exatos)
  //   42 -> {hunts:[{id,name,monsters:[{name,...}],tiers:[{name,...}]}]}
  // O 42 evita abrir o seletor de caçadas só pra descobrir onde mora uma
  // criatura — resolve em memória. Os tiers vêm na ordem do jogo
  // (Cautious → Bold → Reckless), então "mais difícil" é o último.
  const guild = {
    // v0.11.26 — qual objetivo já teve aviso de "não sei as criaturas", pra o
    // alerta sair uma vez por objetivo e não a cada tick de 4s.
    avisoMapaEm: null,
    expedicoes: null, // { periodKey, endsAtMs, entries: [...] }
    cacadas: [], // catálogo do tipo 42
    objetivoEscolhido: null, // objectiveId em que o bot se comprometeu
  };

  // v0.11.16 — ONDE O PERSONAGEM ESTÁ, dito pelo servidor (tipo 54).
  //
  // Descoberto na captura da transição de 14/09/2026 — as duas capturas
  // anteriores, de 5 minutos cada, não tinham respondido isso porque foram
  // inteiras DENTRO da caçada. O valor estava na transição.
  //
  //   caçada → {instanceId:"hero-hunt-675", scenarioId:"hero-hunt",  ambience:"cavern"}
  //   cidade → {instanceId:"city-global",   scenarioId:"main-city",  ambience:"surface"}
  //
  // O `scenarioId` casa com o `id` do catálogo de caçadas (tipo 42), então
  // daqui sai também o NOME da caçada sem abrir menu nenhum. E o `instanceId`
  // é o número da instância: quando ele muda, o spawn é outro.
  const mundo = {
    instanceId: null,
    scenarioId: null,
    ambience: null,
    em: 0,
    trocasDeInstancia: 0,
  };

  function mundoLerMensagem(p) {
    if (!p || typeof p.instanceId !== "string") return;
    const mudou = mundo.instanceId !== null && mundo.instanceId !== p.instanceId;
    mundo.instanceId = p.instanceId;
    mundo.scenarioId = typeof p.scenarioId === "string" ? p.scenarioId : null;
    mundo.ambience = typeof p.ambience === "string" ? p.ambience : null;
    mundo.em = Date.now();
    // v0.11.33 — o perfil de tiles é POR CAÇADA, e o `scenarioId` é a chave
    // certa: `troll-hunt` é o mesmo lugar em troll-hunt-708, -715 e -721.
    // Trocar aqui (e não no zerarDeteccaoDeSpawn) é o que faz o aprendizado
    // sobreviver à renovação de spawn, que é justamente quando ele é preciso.
    usarPerfilDoCenario(mundo.scenarioId);
    // v0.11.22 — o nome da caçada sai daqui de graça (cenário × catálogo do
    // tipo 42). Manter o cache em dia faz o rótulo do painel dizer QUAL
    // caçada, e não só "Caçando".
    try {
      const nome = nomeDaCacadaPeloProtocolo();
      if (nome) currentHuntNameCache = nome;
    } catch (e) {}
    if (mudou) {
      mundo.trocasDeInstancia++;
      // Instância nova = spawn novo. Antes o detector era zerado por
      // dedução ("saí da caçada, então zera"); agora zera no fato.
      zerarDeteccaoDeSpawn();
    }
  }

  // true / false / null — e o `null` é o ponto importante: quer dizer "o tipo
  // 54 ainda não chegou nesta sessão" (app aberto com o socket já de pé, por
  // exemplo). Quem chama cai no DOM nesse caso, em vez de decidir no escuro.
  function emCacadaPeloProtocolo() {
    if (!mundo.instanceId) return null;
    if (/^city/i.test(mundo.instanceId) || /city/i.test(mundo.scenarioId || "")) return false;
    // Só afirma "está caçando" se o cenário for uma caçada que o catálogo
    // conhece. Um cenário novo que eu nunca vi (evento, quest, casa) devolve
    // null e deixa o DOM responder — em vez de eu chutar que é caçada.
    if (Array.isArray(guild.cacadas) && guild.cacadas.length) {
      return guild.cacadas.some((h) => h && h.id === mundo.scenarioId) ? true : null;
    }
    return null;
  }

  function nomeDaCacadaPeloProtocolo() {
    if (!mundo.scenarioId || !Array.isArray(guild.cacadas)) return null;
    const h = guild.cacadas.find((x) => x && x.id === mundo.scenarioId);
    return h && h.name ? h.name : null;
  }

  function guildLerMensagem(tipo, p) {
    if (tipo === "33") {
      if (p.expeditions) guild.expedicoes = p.expeditions;
      return;
    }
    if (tipo === "42") {
      if (Array.isArray(p.hunts)) guild.cacadas = p.hunts;
    }
  }

  // Criaturas-alvo de cada objetivo. O tipo 33 traz label/quota/progress mas
  // NÃO as criaturas — isso só existe no painel, no title dos botões
  // ("Mostrar as caçadas onde Skeleton aparece"). Casa pelo rótulo da linha.
  // v0.11.26 — MAPA "objetivo → criaturas", COM CACHE EM DISCO.
  //
  // Este era o elo fraco da auto expedição, e ele falhava calado: o tipo 33 dá
  // progresso e quota exatos, o tipo 42 dá qual caçada mata cada criatura —
  // mas QUAIS criaturas contam para "Restless Dead" só existe no painel de
  // expedição do jogo, no `title` dos botões. Painel fechado = lista vazia =
  // nenhuma caçada escolhida = a feature não fazia nada e não dizia nada.
  //
  // E não dá pra derivar do protocolo: o `familyId` é "restless-dead", que não
  // é criatura nem id de caçada — é uma CATEGORIA que agrupa Skeleton, Ghoul,
  // Mummy. Conferido contra o catálogo real: "Trolls" e "Amazons & Valkyries"
  // até dariam por semelhança de nome, "Restless Dead" não dá de jeito nenhum.
  // Então o painel continua sendo a fonte — mas basta lê-lo UMA vez.
  const EXPED_MAPA_KEY = "hm_exped_mapa_v1";

  function carregarMapaExpedicao() {
    try {
      return JSON.parse(localStorage.getItem(EXPED_MAPA_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function salvarMapaExpedicao(label, criaturas) {
    if (!label || !criaturas || !criaturas.length) return;
    try {
      const mapa = carregarMapaExpedicao();
      mapa[String(label).trim()] = criaturas;
      localStorage.setItem(EXPED_MAPA_KEY, JSON.stringify(mapa));
    } catch (e) {}
  }

  // v0.11.28 — TERCEIRA FONTE: o `familyId` casado com o `bestiaryId` do
  // catálogo.
  //
  // Medido na expedição real do André: `trolls` → bestiaryId `troll` (Troll,
  // em Troll Hills) e `amazon-camp` → `amazon` (Amazon, em Amazon Camp).
  // `restless-dead` NÃO casa, porque é uma categoria que agrupa várias
  // criaturas — por isso isto é complemento do painel, nunca substituto.
  //
  // Só aceita casamento EXATO com um bestiaryId que existe no catálogo. Sem
  // parecido, sem "começa com": errar aqui manda o personagem caçar a coisa
  // errada por horas.
  //
  // ⚠️ Limite honesto: quando vem daqui, a lista pode estar INCOMPLETA (o
  // painel talvez conte Swamp Troll também). A caçada escolhida continua
  // válida, só pode não ser a melhor. Por isso o painel diz de onde veio.
  function criaturasPorFamilyId(familyId) {
    const f = String(familyId || "").trim();
    if (!f || !Array.isArray(guild.cacadas) || !guild.cacadas.length) return [];
    const base = f.split("-")[0];
    const variantes = new Set([f, f.replace(/-/g, ""), f.replace(/s$/, ""), base, base.replace(/s$/, "")]);
    const nomes = new Set();
    for (const h of guild.cacadas) {
      for (const m of h.monsters || []) {
        if (m && m.bestiaryId && variantes.has(m.bestiaryId) && m.name) nomes.add(m.name);
      }
    }
    return [...nomes];
  }

  // v0.11.38 — QUARTA FONTE: a CLASSE do bestiário (tipo 26).
  //
  // Bug do André: "Ainda não sei quais criaturas contam para Giants e Restless
  // Dead e Woodland Folk". Fui atrás e confirmei, nos tipos 33 E 34, que o
  // protocolo NÃO carrega a lista de criaturas de uma família — só
  // `{objectiveId, familyId, label, tier, quota, progress}`.
  //
  // Mas o tipo 26 traz `monsters[].bestiaryClass`, e existem 14 classes:
  // Humanoid (25 criaturas), Human (16), Reptile (15), Magical (15), Undead
  // (13), Vermin (9), Aquatic (6), Mammal (6), Dragon (6), Demon (5), Giant
  // (4), Plant (4), Lycanthrope (3), Construct (2). Quando o rótulo da
  // expedição É uma classe, a lista sai inteira e exata: "Giants" → Behemoth,
  // Cyclops, Ogre Rowdy, Ogre Sage.
  //
  // ⚠️ O casamento é EXATO com o nome da classe (aceitando só singular/plural).
  // Isso não é preciosismo, é o que mantém a fonte honesta: "Trolls" NÃO casa
  // com classe nenhuma (troll é Humanoid, que tem 25 criaturas) e portanto esta
  // fonte se cala, deixando o caminho do bestiaryId responder. Casar por
  // "parecido" mandaria o personagem caçar 25 espécies erradas por horas.
  //
  // "Restless Dead" e "Woodland Folk" continuam sem resposta por aqui: são
  // nomes de família DO HUNTERA, não classes de bestiário. Pra esses, só o
  // painel de expedição do jogo sabe.
  // nome da criatura -> { classe, xp, vida }. O tipo 26 é a única fonte dos
  // três, e chega uma vez por login.
  const bestiario = new Map();

  function bestiarioClassesLerMensagem(p) {
    if (!p || !Array.isArray(p.monsters)) return;
    for (const m of p.monsters) {
      if (!m || typeof m.name !== "string") continue;
      bestiario.set(m.name, {
        classe: typeof m.bestiaryClass === "string" ? m.bestiaryClass : null,
        xp: Number(m.experience) || 0,
        vida: Number(m.maxHealth) || 0,
      });
    }
  }

  function criaturasPorClasseDoBestiario(label, familyId) {
    if (!bestiario.size) return [];
    const alvos = new Set();
    for (const bruto of [label, familyId]) {
      const t = String(bruto || "").trim().toLowerCase().replace(/[-_]+/g, " ");
      if (!t) continue;
      alvos.add(t);
      alvos.add(t.replace(/s$/, "")); // "giants" -> "giant"
    }
    const nomes = [];
    for (const [nome, ficha] of bestiario) {
      if (!ficha.classe) continue;
      const c = String(ficha.classe).trim().toLowerCase();
      if (alvos.has(c)) nomes.push(nome);
    }
    return nomes;
  }

  // v0.11.39 — QUÃO PESADA É ESTA CAÇADA.
  //
  // André: "ela entrou em uma caçada muito forte, a expedição preferencialmente
  // é para ser feita no bicho mais fraco disponível."
  //
  // A força de uma caçada é a do monstro MAIS FORTE que mora nela — porque lá
  // dentro se enfrenta tudo, não só o bicho do objetivo. É o que separa os três
  // candidatos reais da expedição "Giants": Cyclop Hills tem só Cyclops (xp
  // 150), Behemoth Quarry tem Behemoth (xp 2.500), e Issavi Steppe tem nove
  // moradores até Lamassu e Feral Sphinx (xp 9.000). A regra antiga mandava
  // justamente pra Issavi, porque ela mata DUAS criaturas da família.
  //
  // Devolve null quando o tipo 26 ainda não chegou — e aí a ordenação por força
  // não acontece, em vez de acontecer errado.
  function forcaDaCacada(hunt) {
    if (!bestiario.size || !hunt) return null;
    let pior = null;
    for (const m of hunt.monsters || []) {
      const f = m && m.name ? bestiario.get(m.name) : null;
      if (!f) continue;
      if (pior === null || f.xp > pior) pior = f.xp;
    }
    return pior;
  }

  // v0.11.40 — FAMÍLIAS QUE O ANDRÉ LEU NO PAINEL E ME PASSOU (15/09/2026).
  //
  // Rede pra quando o painel não estiver na tela. Só entra o que ele conferiu
  // olhando o jogo, e cada nome foi validado contra o catálogo do tipo 26 antes
  // de ser escrito aqui — "Elf Scout" é a grafia do jogo. Nada de dedução:
  // esta tabela é testemunho, não inferência.
  // ✅ CONFERIDO CONTRA O JOGO na captura de 15/09 03:40 — o progresso do
  // objetivo subiu junto com as mortes, na proporção certa:
  //   Skeleton: 62 mortes → +64 de progresso, e 17 → +16 (a folga é a guild,
  //             que também soma; o objetivo é compartilhado).
  //   Dwarf:    24 mortes → +24.
  //   Elf + Elf Scout: 19 mortes → +22.
  // ⚠️ Elf Arcanist NÃO entra, mesmo morando na mesma caçada — confirmado pelo
  // André no painel e pela conta acima: com ele seriam 26 mortes minhas pra
  // +22 de progresso, e o progresso nunca pode ser MENOR que as minhas
  // próprias mortes, já que a guild só soma. (Eu cheguei a concluir o
  // contrário lendo o tipo 9 errado — ver o aviso sobre mensagens parciais.)
  const FAMILIAS_CONHECIDAS = {
    "restless-dead": ["Skeleton", "Ghoul"],
    "woodland-folk": ["Elf", "Elf Scout", "Dwarf"],
  };

  function criaturasPorFamiliaConhecida(familyId) {
    const f = String(familyId || "").trim().toLowerCase();
    const nomes = FAMILIAS_CONHECIDAS[f];
    return Array.isArray(nomes) ? nomes.slice() : [];
  }

  function criaturasDoObjetivo(label, familyId) {
    const doDom = criaturasDoObjetivoNoDom(label);
    if (doDom.length) {
      salvarMapaExpedicao(label, doDom);
      return doDom;
    }
    const mapa = carregarMapaExpedicao();
    const guardado = mapa[String(label || "").trim()];
    if (Array.isArray(guardado) && guardado.length) return guardado;
    const conhecida = criaturasPorFamiliaConhecida(familyId);
    if (conhecida.length) return conhecida;
    const porFamilia = criaturasPorFamilyId(familyId);
    if (porFamilia.length) return porFamilia;
    return criaturasPorClasseDoBestiario(label, familyId);
  }

  // De onde veio a lista — só pra o painel poder ser honesto sobre isso.
  function fonteDasCriaturas(label, familyId) {
    if (criaturasDoObjetivoNoDom(label).length) return "painel";
    const mapa = carregarMapaExpedicao();
    const g = mapa[String(label || "").trim()];
    if (Array.isArray(g) && g.length) return "painel (guardado)";
    if (criaturasPorFamiliaConhecida(familyId).length) return "lista conhecida";
    if (criaturasPorFamilyId(familyId).length) return "catálogo";
    if (criaturasPorClasseDoBestiario(label, familyId).length) return "classe do bestiário";
    return null;
  }

  // v0.11.40 — O PAINEL E O PROTOCOLO NÃO CHAMAM O OBJETIVO PELO MESMO NOME.
  //
  // Causa raiz achada no print do André (15/09/2026): o painel do jogo escreve
  // **"Matar Giants"** e o tipo 33 manda **"Giants"**. A comparação aqui era
  // exata (`!==`), então NENHUMA linha casava — nunca. Era esse o motivo real
  // de "Ainda não sei quais criaturas contam para…" mesmo com o painel aberto
  // na tela; as três fontes de fallback (cache, bestiaryId, classe) existem
  // porque a fonte AUTORITATIVA estava quebrada por uma diferença de prefixo.
  //
  // Agora casa quando o texto do painel É o rótulo, ou TERMINA com ele depois
  // de um espaço ("matar giants" → "giants"). Comparar por "contém" seria
  // frouxo demais; exigir o fim garante que "Giants" não case com uma linha
  // "Giants Mortos na Semana", por exemplo.
  function mesmoObjetivo(textoDoPainel, label) {
    const norm = (x) =>
      String(x || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const a = norm(textoDoPainel);
    const b = norm(label);
    if (!a || !b) return false;
    return a === b || a.endsWith(" " + b);
  }

  // v0.11.41 — LER O PAINEL SEM DEPENDER DE CLASSE NEM DE IDIOMA.
  //
  // André: "cada dia é uma expedição diferente, todo dia eu vou ter que te
  // mandar um print?" Não — e pra que a resposta continue sendo não, esta
  // leitura não pode quebrar por um nome de classe CSS que mudou nem por uma
  // frase em português.
  //
  // O que ela tinha de frágil, em três camadas:
  //   1. o container só por `.expedition-tracker`;
  //   2. a linha só por `.expedition-tracker-row` e o rótulo só por
  //      `.expedition-tracker-label`;
  //   3. o nome da criatura só pela frase "Mostrar as caçadas onde X aparece".
  //
  // Agora cada camada tem um plano B, e o plano B do nome da criatura é o que
  // resolve de vez: **o protocolo já me deu os 129 nomes de criatura** (tipo
  // 26). Então qualquer `title`/`alt`/`aria-label` da linha que seja EXATAMENTE
  // um nome do catálogo é uma criatura — sem regex, sem idioma, sem chute. Se
  // o jogo virar inglês ou trocar a frase, continua funcionando.
  function elementoDoTracker() {
    const direto = document.querySelector(SEL.expeditionTracker);
    if (direto) return direto;
    // Plano B: a classe mudou de nome (expedition-tracker-v2, etc.).
    return document.querySelector('[class*="expedition"]') || null;
  }

  function linhasDoTracker(tracker) {
    const porClasse = tracker.querySelectorAll(".expedition-tracker-row");
    if (porClasse.length) return [...porClasse];
    // Plano B: sem a classe conhecida, cada filho direto é uma linha.
    return [...tracker.children];
  }

  function textoDoRotulo(row) {
    const porClasse = row.querySelector(".expedition-tracker-label");
    if (porClasse) return porClasse.textContent;
    // Plano B: o texto da própria linha. `mesmoObjetivo` exige que termine no
    // rótulo, então o progresso ("95/2250") atrapalharia — por isso só a
    // primeira linha de texto entra.
    const bruto = String(row.textContent || "").split("\n").map((x) => x.trim()).filter(Boolean)[0];
    return bruto || "";
  }

  function nomesDeCriaturaNaLinha(row) {
    const nomes = [];
    const vistos = new Set();
    const guardar = (n) => {
      const t = String(n || "").trim();
      if (t && !vistos.has(t)) {
        vistos.add(t);
        nomes.push(t);
      }
    };
    for (const el of row.querySelectorAll("[title], [alt], [aria-label]")) {
      for (const attr of ["title", "alt", "aria-label"]) {
        const v = el.getAttribute(attr);
        if (!v) continue;
        // Caminho rápido e histórico: a frase do jogo em português.
        const m = /Mostrar as caçadas onde (.+) aparece/.exec(v);
        if (m) {
          guardar(m[1]);
          continue;
        }
        // Caminho à prova de idioma: o valor É um nome de criatura do catálogo.
        if (bestiario.has(v.trim())) guardar(v);
      }
    }
    return nomes;
  }

  function criaturasDoObjetivoNoDom(label) {
    const tracker = elementoDoTracker();
    if (!tracker) return [];
    for (const row of linhasDoTracker(tracker)) {
      if (!row || typeof row.querySelectorAll !== "function") continue;
      if (!mesmoObjetivo(textoDoRotulo(row), label)) continue;
      return nomesDeCriaturaNaLinha(row);
    }
    return [];
  }

  // Objetivo pendente mais PERTO DE TERMINAR (decisão do André). No começo do
  // dia todos estão zerados e empatados — aí o desempate é não trocar à toa:
  // se a caçada atual já mata alguma criatura-alvo, fica nela.
  // v0.11.27 — trava entre trocas motivadas por expedição, pra não virar
  // carrossel se dois objetivos empatarem.
  let expedicaoUltimaTrocaEm = 0;
  const EXPEDICAO_TROCA_MIN_MS = 10 * 60000;

  // A caçada `nome` mata alguma criatura de ALGUM objetivo ainda pendente?
  function cacadaServeAlgumObjetivo(nome) {
    const ex = guild.expedicoes;
    if (!ex || !Array.isArray(ex.entries) || !nome) return false;
    const hunt = guild.cacadas.find((h) => h.name === nome);
    if (!hunt) return false;
    const monstros = (hunt.monsters || []).map((m) => m.name);
    return ex.entries.some((e) => {
      if (Number(e.progress) >= Number(e.quota)) return false;
      return criaturasDoObjetivo(e.label, e.familyId).some((c) => monstros.includes(c));
    });
  }

  // Devolve `{alvo, escolha, atual}` quando vale trocar de caçada AGORA, ou
  // null. Null é a resposta na dúvida: sem objetivo pendente, sem mapa de
  // criaturas, caçada atual servindo, ou trava de tempo ativa.
  function avaliarTrocaPorExpedicao(cfg) {
    if (Date.now() - expedicaoUltimaTrocaEm < EXPEDICAO_TROCA_MIN_MS) return null;
    const atual = currentHuntNameCache || cfg.huntName;
    if (!atual) return null;
    if (cacadaServeAlgumObjetivo(atual)) return null; // já serve: fica
    const alvo = escolherObjetivoDaExpedicao(atual);
    if (!alvo || !alvo.criaturas || !alvo.criaturas.length) return null;
    const escolha = cacadaParaCriaturas(alvo.criaturas);
    if (!escolha || escolha.nome === atual) return null;
    return { alvo, escolha, atual };
  }

  function escolherObjetivoDaExpedicao(cacadaAtual) {
    const ex = guild.expedicoes;
    if (!ex || !Array.isArray(ex.entries)) return null;
    const pendentes = ex.entries.filter((e) => Number(e.progress) < Number(e.quota));
    if (!pendentes.length) return null;

    const comCriaturas = pendentes.map((e) => ({ ...e, criaturas: criaturasDoObjetivo(e.label, e.familyId) }));

    // Desempate: a caçada em que já estamos mata alguém da lista?
    if (cacadaAtual) {
      const hunt = guild.cacadas.find((h) => h.name === cacadaAtual);
      const monstros = hunt ? (hunt.monsters || []).map((m) => m.name) : [];
      const fica = comCriaturas.find((e) => e.criaturas.some((c) => monstros.includes(c)));
      if (fica) return fica;
    }
    comCriaturas.sort((a, b) => Number(b.progress) / Number(b.quota) - Number(a.progress) / Number(a.quota));
    return comCriaturas[0];
  }

  // Caçada que mata alguma das criaturas, preferindo a que mata MAIS delas.
  // v0.11.39 — A EXPEDIÇÃO VAI PRO BICHO MAIS FRACO, NÃO PRO QUE RENDE MAIS
  // ACERTOS.
  //
  // Antes isto escolhia a caçada que mata MAIS criaturas do objetivo. Parecia
  // eficiente e era o contrário: na expedição "Giants" do André, mandou o
  // personagem pra Issavi Steppe (Ogre Rowdy + Ogre Sage, dois acertos) em vez
  // de Cyclop Hills (Cyclops, um acerto) — e Issavi tem Lamassu e Feral Sphinx
  // morando junto, xp 9.000 contra os 150 do Cyclops. "Entrou numa caçada muito
  // forte", como ele reportou.
  //
  // A regra dele é a certa e ainda é mais rápida: objetivo de expedição conta
  // MORTE, não dificuldade. Vinte Cyclops morrem no tempo de um Lamassu.
  //
  // Ordem: mais fraca primeiro; empate resolve por quem mata mais criaturas do
  // objetivo. Sem o tipo 26 a força é desconhecida pra todas, e aí a ordenação
  // por força não acontece — a contagem de acertos volta a decidir, como antes.
  //
  // ⚠️ O TIER continua sendo o mais difícil disponível. Não é contradição: a
  // caçada define QUAIS bichos, o tier define QUANTOS vêm por vez. Mais bicho
  // fraco por vez é exatamente o que se quer.
  function cacadaParaCriaturas(nomes) {
    if (!nomes || !nomes.length || !guild.cacadas.length) return null;
    const candidatos = [];
    for (const h of guild.cacadas) {
      const monstros = (h.monsters || []).map((m) => m.name);
      const acertos = nomes.filter((n) => monstros.includes(n)).length;
      if (acertos > 0) candidatos.push({ hunt: h, acertos, forca: forcaDaCacada(h) });
    }
    if (!candidatos.length) return null;
    candidatos.sort((a, b) => {
      // Quem não tem força conhecida vai pro fim: na dúvida, não é a escolhida.
      const fa = a.forca === null ? Infinity : a.forca;
      const fb = b.forca === null ? Infinity : b.forca;
      if (fa !== fb) return fa - fb;
      return b.acertos - a.acertos;
    });
    const melhor = candidatos[0].hunt;
    const tiers = melhor.tiers || [];
    return {
      nome: melhor.name,
      // André: "todas as expedições devem ser executadas no nível mais
      // difícil". Os tiers vêm na ordem do jogo, então é o último.
      tier: tiers.length ? tiers[tiers.length - 1].name : null,
      forca: candidatos[0].forca,
      criaturasAqui: candidatos[0].acertos,
    };
  }

  // v0.11.30 — UMA ÚNICA FONTE DE VERDADE PRA "ONDE ESTE PERSONAGEM DEVE
  // CAÇAR AGORA".
  //
  // Bug reportado pelo André em 14/09: "ele acabou de sair da expedição pq
  // estava sem bicho na tela. não continuou na expedição. acabou voltando
  // para a caçada principal" — e, logo depois, "nem considera mais a
  // expedição depois que saiu".
  //
  // A causa era arquitetural, não um `if` errado: a decisão de expedição
  // morava SÓ no trecho "não está caçando" do monitor. Todos os outros
  // caminhos que reentram numa caçada — renovação por spawn seco, retorno
  // depois de vender — tinham cada um a sua própria regra, e as duas
  // apontavam pra `cfg.huntName` (a caçada configurada no menu). Resultado:
  // qualquer saída durante a expedição jogava o personagem de volta na
  // caçada principal, e de lá ele não voltava mais, porque a troca no meio
  // da caçada (`avaliarTrocaPorExpedicao`) tem trava de 10min e só dispara
  // quando a caçada atual não serve pra NENHUM objetivo.
  //
  // Agora existe um lugar só que responde "qual caçada e qual tier", e os
  // três caminhos perguntam pra ele. Enquanto houver objetivo pendente, a
  // resposta é a caçada da expedição no tier mais difícil; quando todos
  // terminarem, volta a ser a caçada configurada. É exatamente o que o
  // André pediu: "se está fazendo expedição tem que continuar nela, só
  // desconsidera quando finalizar todas".
  // v0.13.0 — Auto Bestiary por fase (Ladder). Devolve `{item, index}` do
  // item ATUAL da lista (o que está "rodando" agora), ou null se a feature
  // estiver desligada, sem itens, ou config ausente. Normaliza o índice pra
  // nunca estourar o tamanho do array (lista editada por fora, item
  // removido etc. — na dúvida, começa do zero em vez de quebrar).
  function bestiaryLadderItemAtual(cfg) {
    const ladder = cfg && cfg.bestiaryLadder;
    if (!ladder || !ladder.enabled || !Array.isArray(ladder.itens) || !ladder.itens.length) return null;
    const n = ladder.itens.length;
    const i = ((Number(ladder.index) || 0) % n + n) % n;
    return { item: ladder.itens[i], index: i };
  }

  // Maior fase já CONFIRMADA (tipo 92) pra criatura do item, nesta sessão.
  function bestiaryLadderFaseAtual(item) {
    const chave = nomeParaChaveBestiario((item && item.criatura) || (item && item.hunt));
    return economia.bestiarioFases.get(chave) || 0;
  }

  // Nome da caçada que o Ladder quer rodar agora — é o que entra no lugar
  // de `cfg.huntName` sempre que a feature está ligada. `null` quando
  // desligada/vazia, pra quem chama poder cair de volta em `cfg.huntName`
  // sem precisar saber que o Ladder existe.
  function nomeDoBestiaryLadder(cfg) {
    const atual = bestiaryLadderItemAtual(cfg);
    return atual && atual.item ? atual.item.hunt || null : null;
  }

  // Acha o próximo item NÃO concluído a partir de `apartirDe` (exclusive),
  // dando a volta na lista uma vez. `null` = todos concluídos.
  function bestiaryLadderProximoIndice(itens, apartirDe) {
    for (let passo = 1; passo <= itens.length; passo++) {
      const i = (apartirDe + passo) % itens.length;
      if (!itens[i].concluido) return i;
    }
    return null;
  }

  // Verifica se o item ATUAL do Ladder já bateu a fase-alvo. Se sim, marca
  // `concluido` nele e devolve `{concluido, proximo, proximoIndex,
  // faseAtingida}` pra quem chama decidir trocar de caçada — sem chamar
  // `ensureHunting`/`leaveHunt` aqui dentro: essa função só DECIDE, quem
  // executa o clique é o `monitorTick`, no mesmo espírito de
  // `avaliarTrocaPorExpedicao`. Muda o estado (`concluido`/`index`) e
  // devolve o `ladder` inteiro pra quem chama persistir com `saveState`.
  function avaliarAvancoDoBestiaryLadder(cfg) {
    const atual = bestiaryLadderItemAtual(cfg);
    if (!atual || atual.item.concluido) return null;
    const faseAtingida = bestiaryLadderFaseAtual(atual.item);
    const faseAlvo = Number(atual.item.faseAlvo) || 0;
    if (faseAtingida < faseAlvo) return null;

    const ladder = cfg.bestiaryLadder;
    const itens = ladder.itens.map((it, i) => (i === atual.index ? { ...it, concluido: true } : it));
    const proximoIndex = bestiaryLadderProximoIndice(itens, atual.index);
    return {
      concluidoItem: atual.item,
      faseAtingida,
      itens,
      // Sem próximo (todos concluídos): fica no mesmo índice, só marcado.
      index: proximoIndex === null ? atual.index : proximoIndex,
      todosConcluidos: proximoIndex === null,
      proximo: proximoIndex === null ? null : itens[proximoIndex],
    };
  }

  // Aplica o avanço (se houver) na config em memória E no disco, loga o
  // resultado e devolve true/false pra quem chama saber se precisa trocar
  // de caçada AGORA. Fica de fora de `avaliarAvancoDoBestiaryLadder` de
  // propósito: aquela função só decide (pura, fácil de testar isolada),
  // esta aqui tem efeito colateral (log, saveState, mutar `cfg`).
  function processarAvancoDoBestiaryLadder(cfg) {
    const avanco = avaliarAvancoDoBestiaryLadder(cfg);
    if (!avanco) return false;
    const novoLadder = { ...cfg.bestiaryLadder, itens: avanco.itens, index: avanco.index };
    cfg.bestiaryLadder = novoLadder;
    saveState({ bestiaryLadder: novoLadder });
    log(
      avanco.todosConcluidos
        ? `Auto Bestiary: "${avanco.concluidoItem.hunt}" bateu a fase ${avanco.faseAtingida} (alvo: ${avanco.concluidoItem.faseAlvo}) — todas as caçadas da lista já foram concluídas.`
        : `Auto Bestiary: "${avanco.concluidoItem.hunt}" bateu a fase ${avanco.faseAtingida} (alvo: ${avanco.concluidoItem.faseAlvo}) — avançando pra "${avanco.proximo.hunt}".`
    );
    return true;
  }

  function alvoDeCacada(cfg, cacadaAtual) {
    const atual = cacadaAtual || currentHuntNameCache || cfg.huntName;
    const ladderNome = nomeDoBestiaryLadder(cfg);
    const padrao = {
      nome: ladderNome || cfg.huntName || atual,
      pullLevel: cfg.pullLevel,
      expedicao: false,
      objetivo: null,
    };
    if (!cfg.expeditionEnabled || cfg.huntMode === "group" || !guild.cacadas.length) return padrao;

    const alvo = escolherObjetivoDaExpedicao(atual);
    if (!alvo || !alvo.criaturas || !alvo.criaturas.length) return padrao;

    // Se a caçada em que já estamos mata alguma criatura do objetivo, ela é
    // a resposta — mesmo que outra do catálogo mate mais. Trocar de mapa a
    // cada renovação de spawn seria carrossel, não expedição.
    const huntAtual = atual ? guild.cacadas.find((h) => h.name === atual) : null;
    const monstrosAtuais = huntAtual ? (huntAtual.monsters || []).map((m) => m.name) : [];
    if (alvo.criaturas.some((c) => monstrosAtuais.includes(c))) {
      return { nome: atual, pullLevel: TIER_MAIS_DIFICIL, expedicao: true, objetivo: alvo };
    }

    const escolha = cacadaParaCriaturas(alvo.criaturas);
    if (!escolha) return padrao;
    return {
      nome: escolha.nome,
      pullLevel: TIER_MAIS_DIFICIL,
      expedicao: true,
      objetivo: alvo,
      tier: escolha.tier,
    };
  }

  // v0.11.18 — confirmado no tipo 41 da captura de 14/09: gold coin tem
  // `value` igual ao `count`, ou seja, 1 gp por moeda.
  const GOLD_COIN_ITEM_ID = 3031;

  function economiaZerar() {
    economia.loot.clear();
    economia.custoTotal = 0;
    economia.custoPorValor.clear();
    economia.ultimoGold = null;
    // A sessão do tipo 41 é do JOGO, não nossa: quem zera ela é o jogo, ao
    // sair da caçada. Limpar aqui só evita mostrar número velho enquanto a
    // próxima mensagem não chega.
    economia.sessao = null;
    economia.sessaoEm = 0;
    // v0.11.21 — a sessão reconstruída zera junto com o resto.
    economia.inicio = Date.now();
    economia.kills = 0;
    economia.bestiario.clear();
    economia.bestiarioFases.clear();
    economia.xp = 0;
    economia.ultimoXp = null;
    economia.ultimoLevel = null;
    economia.vendas = 0;
    economia.itensVendidos = 0;
    economia.goldVendido = 0;
    economia.ultimaVendaEm = 0;
    economia.desgaste.clear();
    economia.custoDesgaste = 0;
    // `equipados` NÃO zera: é o estado atual do personagem, não da sessão.
  }

  // v0.11.21 — mortes pelo bestiary. O tipo 9 traz o contador ACUMULADO por
  // espécie (`{kills:{hero:30014}}`), então morte da sessão é a soma das
  // diferenças. Espécie vista pela primeira vez ancora em vez de contar tudo
  // que o personagem já matou na vida.
  function bestiarioLerMensagem(p) {
    const ks = p && p.kills;
    if (!ks || typeof ks !== "object") return;
    for (const especie of Object.keys(ks)) {
      const atual = Number(ks[especie]);
      if (!Number.isFinite(atual)) continue;
      const antes = economia.bestiario.get(especie);
      if (antes !== undefined && atual > antes) economia.kills += atual - antes;
      economia.bestiario.set(especie, atual);
    }
  }

  // v0.13.0 — mesma transformação que o próprio jogo usa nas chaves do tipo
  // 9 (`kills`/`stages`): tira os espaços e deixa a primeira letra minúscula.
  // Confirmado com o catálogo real: "Adult Goanna" → "adultGoanna", "Ogre
  // Sage" → "ogreSage", "Feral Sphinx" → "feralSphinx", "Manticore" →
  // "manticore". Existe pra poder comparar um NOME DE EXIBIÇÃO (o que vem no
  // tipo 92, `params.monster`, ou o que o André digita na configuração) com
  // as chaves de `economia.bestiario`/`economia.bestiarioFases`, sem precisar
  // de uma tabela de tradução separada.
  function nomeParaChaveBestiario(nome) {
    return String(nome || "")
      .replace(/\s+/g, "")
      .replace(/^./, (c) => c.toLowerCase());
  }

  // v0.13.0 — "Bestiary stage {stage} reached: {monster}" (tipo 92,
  // CONFIRMADO AO VIVO em 22/09/2026). Dispara no exato abate que cruza o
  // limiar da fase, direto do servidor — não depende de o jogador clicar
  // "Desbloquear" na Cyclopedia (isso só ativa a RECOMPENSA, é outro estado,
  // ver `stages` do tipo 9 e o achado no CLAUDE.md). Só sobe: uma mensagem
  // de fase menor que a já vista é ignorada (não deveria acontecer, mas o
  // princípio do projeto é nunca deixar um dado desonesto piorar o estado).
  function bestiaryStageLerMensagem(p) {
    if (!p || typeof p.template !== "string") return;
    if (!/^bestiary stage \{stage\} reached/i.test(p.template)) return;
    const params = p.params || {};
    const monstro = typeof params.monster === "string" ? params.monster : null;
    const fase = Number(params.stage);
    if (!monstro || !Number.isFinite(fase)) return;
    const chave = nomeParaChaveBestiario(monstro);
    const antes = economia.bestiarioFases.get(chave) || 0;
    if (fase > antes) economia.bestiarioFases.set(chave, fase);
  }

  // v0.11.21 — XP pelo tipo 77. O `experience` é DENTRO DO LEVEL, não total da
  // conta (Kina level 143 tem 371.809 de 1.001.200; Dezin level 390 tem
  // 5.240.117 de 7.546.700) — então ele ZERA ao subir de level, e a diferença
  // crua ficaria negativa. Mesmo tratamento que o `acumularXp()` já fazia com
  // a leitura de DOM: na virada, soma o que faltava pro level antigo mais o
  // que já entrou no novo.
  function xpLerMensagem(p) {
    if (!p || typeof p.experience !== "number") return;
    const atual = { atual: p.experience, necessario: Number(p.experienceNeeded) || 0 };
    const level = typeof p.level === "number" ? p.level : null;
    const antes = economia.ultimoXp;
    if (antes) {
      if (level != null && economia.ultimoLevel != null && level > economia.ultimoLevel) {
        economia.xp += Math.max(0, antes.necessario - antes.atual) + Math.max(0, atual.atual);
      } else if (atual.atual >= antes.atual) {
        economia.xp += atual.atual - antes.atual;
      }
      // Caiu sem subir de level = morreu ou o jogo recalculou: re-ancora sem
      // descontar nem inventar.
    }
    economia.ultimoXp = atual;
    if (level != null) economia.ultimoLevel = level;
  }

  // v0.11.21 — o resultado da VENDA RÁPIDA, dito pelo servidor.
  //
  // `{text:"Quick sold 13 items for 980 gold.", template:"Quick sold {count}
  //   items for {amount} gold.", params:{count:13, amount:980}}`
  //
  // Confirmado contra o gold: +980 exatos no mesmo instante. E como vem em
  // `params`, não depende do texto — se o jogo traduzir a mensagem, continua
  // funcionando; casar string quebraria.
  // v0.11.22 — anel/amuleto que se gastou. O nome vem em `params.item`, e o
  // itemId (que dá o preço) vem do que estava EQUIPADO naquele slot, capturado
  // do tipo 55. Sem o itemId não dá pra precificar — nesse caso conta a peça
  // mas não o valor, em vez de chutar um preço.
  function desgasteLerMensagem(p) {
    const nome = p.params && typeof p.params.item === "string" ? p.params.item : null;
    if (!nome) return;
    let itemId = null;
    for (const eq of economia.equipados.values()) {
      if (eq && eq.nome === nome) { itemId = eq.itemId; break; }
    }
    const reg = economia.desgaste.get(nome) || { qtd: 0, itemId };
    reg.qtd++;
    if (itemId != null) reg.itemId = itemId;
    economia.desgaste.set(nome, reg);
    const preco = reg.itemId != null ? economia.precoNpc.get(reg.itemId) : undefined;
    if (typeof preco === "number") economia.custoDesgaste += preco;
  }

  function vendaLerMensagem(p) {
    if (!p || !p.params) return;
    const t = String(p.template || "");
    // "Your {item} {fate}." — equipamento consumido.
    if (/^your \{item\}/i.test(t)) {
      desgasteLerMensagem(p);
      return;
    }
    if (!/quick sold/i.test(t) && !/vend/i.test(t)) return;
    const itens = Number(p.params.count);
    const gold = Number(p.params.amount);
    if (!Number.isFinite(gold)) return;
    economia.vendas++;
    economia.itensVendidos += Number.isFinite(itens) ? itens : 0;
    economia.goldVendido += gold;
    economia.ultimaVendaEm = Date.now();
  }

  function economiaLerMensagem(tipo, p) {
    if (tipo === "9") {
      bestiarioLerMensagem(p);
      return;
    }
    if (tipo === "92") {
      vendaLerMensagem(p);
      bestiaryStageLerMensagem(p);
      return;
    }
    if (tipo === "41") {
      // O analisador do jogo, ao vivo. Confirmado na captura de 14/09/2026:
      // `kills` foi de 1947 a 1984 e `waste` de 35.393 a 35.998 dentro da
      // mesma gravação, ou seja, é acumulador de sessão que sobe sozinho.
      if (p && typeof p.durationMs === "number") {
        economia.sessao = p;
        economia.sessaoEm = Date.now();
      }
      return;
    }
    if (tipo === "57") {
      // Tabelas completas, mandadas no login. Não zeram entre sessões.
      if (Array.isArray(p.npc)) for (const [id, v] of p.npc) economia.precoNpc.set(id, v);
      if (Array.isArray(p.auction)) for (const [id, v] of p.auction) economia.precoLeilao.set(id, v);
      return;
    }
    if (tipo === "60") {
      const it = p && p.item;
      if (!it || it.itemId == null) return;
      if (it.name) economia.nomePorItemId.set(it.itemId, it.name);
      const atual = economia.loot.get(it.itemId) || { nome: it.name, qtd: 0 };
      atual.qtd += Number(it.count) || 1;
      economia.loot.set(it.itemId, atual);
      return;
    }
    if (tipo === "55") {
      // v0.11.22 — o que está equipado em cada slot. Serve só pra precificar o
      // desgaste: quando o tipo 92 diz "your life ring crumbled", é aqui que
      // mora o itemId daquele anel.
      if (Array.isArray(p.changes)) {
        for (const ch of p.changes) {
          if (!ch || ch.container !== "equipment" || !ch.slot) continue;
          if (ch.item && ch.item.itemId != null) {
            economia.equipados.set(ch.slot, { itemId: ch.item.itemId, nome: ch.item.name || null });
          } else {
            economia.equipados.delete(ch.slot);
          }
        }
      }
      if (typeof p.gold !== "number") return;
      if (economia.ultimoGold != null) {
        const delta = p.gold - economia.ultimoGold;
        // Negativo = suprimento consumido. Positivo = gold de loot, que já
        // entra pelo tipo 60 (gold coin) — não contar duas vezes.
        if (delta < 0) {
          const gasto = -delta;
          economia.custoTotal += gasto;
          economia.custoPorValor.set(gasto, (economia.custoPorValor.get(gasto) || 0) + 1);
        }
      }
      economia.ultimoGold = p.gold;
    }
  }

  // Nome provável do suprimento a partir do valor cobrado: procura na tabela
  // de NPC um item com exatamente aquele preço. Se mais de um bater, devolve
  // null — melhor "não sei" do que chutar o item errado no histórico.
  function itemPorPrecoNpc(valor) {
    let achado = null;
    for (const [id, v] of economia.precoNpc) {
      if (v !== valor) continue;
      if (achado) return null; // ambíguo
      achado = id;
    }
    return achado;
  }

  function spawnRegistrarNascimento(nome, id) {
    const agora = Date.now();
    if (spawnWatch.ultimoSpawnEm) {
      const dt = agora - spawnWatch.ultimoSpawnEm;
      // Intervalos absurdos (entrou na caçada agora, ficou parado no menu) não
      // ensinam nada sobre o ritmo — descarta.
      //
      // v0.11.20 — E INTERVALOS CURTOS DEMAIS TAMBÉM NÃO. O servidor nasce
      // criatura em LOTE: nas quatro capturas do André, entre metade e três
      // quartos dos intervalos foram de menos de 1 segundo, e vários de ZERO.
      // A mediana saía 0ms, o "ritmo típico" virava zero e o limiar desabava
      // no piso — ou seja, a calibração automática que a feature promete
      // simplesmente não existia. Medindo só os intervalos de 1s pra cima, as
      // mesmas capturas dão 2,0s / 3,0s / 4,1s / 11,7s, que é ritmo de caçada
      // de verdade.
      if (dt >= 1000 && dt < 5 * 60000) {
        spawnWatch.intervalos.push(dt);
        if (spawnWatch.intervalos.length > 80) spawnWatch.intervalos.shift();
      }
    }
    // v0.11.33 — O RITMO QUE IMPORTA É O DOS LOTES, NÃO O DOS BICHOS.
    //
    // Medido nas capturas: o servidor nasce criatura em LOTE — troll-hunt fez
    // 80 nascimentos em 8 lotes de ~8 bichos, tortoise-hunt 66 em 7 lotes de
    // ~10. Dentro de um lote o intervalo é de milissegundos; entre lotes é de
    // 7s (troll) ou 14s (tortoise). Medir bicho-a-bicho, como era antes, dava
    // duas saídas igualmente inúteis: com o filtro de 1s, poucas amostras (o
    // painel do André ficou em "aprendendo o ritmo 0/8" com a caçada rodando);
    // sem o filtro, mediana zero.
    //
    // Entre LOTES, cada amostra vale, e 4 delas já descrevem a caçada. E é
    // esse o número que separa: no teste em que o André achou que demorou, o
    // buraco entre lotes foi de 75s numa caçada cujo normal é 7s.
    const novoLote = !spawnWatch.ultimoSpawnEm || agora - spawnWatch.ultimoSpawnEm > LOTE_JANELA_MS;
    if (novoLote) {
      if (spawnWatch.ultimoLoteEm && spawnWatch.perfilCenario) {
        const dtLote = agora - spawnWatch.ultimoLoteEm;
        if (dtLote > 0 && dtLote < LOTE_MAX_MS) empilharAmostra(spawnWatch.perfilLotes, dtLote);
      }
      spawnWatch.ultimoLoteEm = agora;
      spawnWatch.loteArmado = true; // nasceu lote novo: o gatilho rearma
    }

    spawnWatch.ultimoSpawnEm = agora;
    spawnWatch.vivos.set(id, nome);
  }

  // v0.11.14 — "deu a volta completa na caçada?" pela POSIÇÃO, não pelo
  // relógio. A caçada é uma rotação fechada: o personagem passa pelos mesmos
  // tiles de novo. Quando ele volta a um tile por onde já passou HÁ UM BOM
  // TEMPO e já andou bastante desde então, a volta fechou.
  //
  // Por que isso é melhor que tempo: uma volta medida no log real levou ~104s
  // num personagem forte, mas um personagem de level baixo demora mais — e o
  // André avisou exatamente disso. Contando voltas, o critério vale pros dois.
  const VOLTA_MIN_TILES = 25; // andou o suficiente pra ser uma volta, não um passo
  const VOLTA_MIN_MS = 30000; // e faz tempo que passou ali
  const RASTRO_MAX = 2000;

  // ---------- v0.11.33 — PERFIL DE TILES POR CAÇADA ----------
  //
  // André: "caçada é um respawn diferente, um lugar diferente, bichos
  // diferentes, tempos diferentes. não poderia ser padrão, isso precisa ser
  // inteligente de alguma forma. todas as caçadas poderiam ser mapeadas para
  // saber onde são os spots."
  //
  // Ele está certo sobre o problema, e a medição corrigiu as DUAS hipóteses
  // que a gente tinha pra solução:
  //
  //  1. LIMIAR FIXO NÃO SERVE. Medido nas capturas, tiles distintos andados
  //     entre mortes: Troll Hills p90 = 9 e 10 (duas capturas), Tortoise Shore
  //     p90 = 2 e 4. A mesma caçada dá o mesmo número com personagens e dias
  //     diferentes; caçadas diferentes dão números 4x distantes. Um "40 tiles"
  //     chapado seria frouxo numa e apertado na outra.
  //
  //  2. MAPEAR O TAMANHO DO MAPA TAMBÉM NÃO SERVE — e é o contrário do que
  //     eu teria chutado. O tipo 88 entrega o terreno com `blocked` por tile,
  //     então dá pra medir a área andável: Troll Hills tem 1.281 tiles
  //     andáveis, Tortoise Shore tem 4.159. Mas é a caçada PEQUENA que tem o
  //     p90 MAIOR (9-10 contra 2-4). Ou seja, a densidade de bicho manda mais
  //     que o tamanho do mapa, e um limiar em "% do mapa" erraria feio. Ainda
  //     por cima o tipo 88 custa ~3 MB por mensagem — 9 MB numa captura de 3
  //     minutos. Não vale parsear pra chegar numa resposta errada.
  //
  // O que funciona é APRENDER, caçada por caçada, do jeito que o ritmo de
  // spawn já é aprendido. A chave é o `scenarioId` do tipo 54 (`troll-hunt`,
  // `tortoise-hunt`) — estável entre instâncias (troll-hunt-708, -715, -721
  // são a mesma caçada), custa 1 KB e já é escutado. É o "mapear as caçadas"
  // que o André pediu, só que medido no jogo dele em vez de escrito à mão.
  //
  // O perfil fica em disco: sair e entrar pra renovar o spawn cria instância
  // nova, e sem persistir o detector recomeçaria do zero justamente depois de
  // cada renovação.
  const SPAWN_PERFIL_KEY = "hm_spawn_perfil_v1";
  const PERFIL_MAX = 200; // janela móvel: a caçada muda de tier, o perfil acompanha

  // Tiles: uma amostra por morte, então dá pra exigir amostra grande.
  const TILES_MIN_AMOSTRAS = 30;
  const TILES_FATOR = 8;
  const TILES_PISO = 25;
  // v0.11.42 — PISO DE TEMPO, porque tile não é segundo.
  //
  // O critério mede ESPAÇO, e num personagem veloz o espaço passa rápido
  // demais: no log do Amoxicilina (speed alto, com haste) ele cobria 40 tiles
  // em SEIS segundos, e a simulação mostrou o detector disparando aos 682s —
  // só que naquele log as criaturas voltaram aos 707s. Sair ali seria trocar
  // uma pausa de 30s por uma transição de ~11s, à toa.
  //
  // Nas capturas em que a saída FOI certa, o disparo veio aos 11s (Dezin) e aos
  // 18s (Kina). Um piso de 15s preserva as duas — a do Dezin sai 4s mais tarde
  // — e mata a de 6s. Continua sendo 6x mais rápido que o piso de 90s.
  const TILES_MIN_SEGUNDOS = 15;

  // Lotes: uma amostra a cada 7-20s, então a exigência é menor — e precisa
  // ser, senão o critério não existe nos primeiros minutos.
  const LOTE_JANELA_MS = 2000; // nascimentos a menos disso são o MESMO lote
  const LOTE_MIN_AMOSTRAS = 4;
  const LOTE_FATOR = 3;
  const LOTE_PISO_MS = 20000;
  const LOTE_MAX_MS = 10 * 60000; // intervalo maior que isso não ensina nada

  function carregarPerfis() {
    try {
      return JSON.parse(localStorage.getItem(SPAWN_PERFIL_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  // v0.11.34 — gravação também por TEMPO, não só por contagem.
  //
  // Antes o perfil só ia pro disco a cada 20 mortes ou ao trocar de caçada.
  // Quem fechasse o app no meio de uma caçada perdia o que estava aprendendo —
  // inclusive as amostras de LOTE, que são poucas e valiosas (4 já calibram).
  // Agora o tick também chama isto, e ele grava no máximo uma vez a cada 30s.
  let perfilGravadoEm = 0;
  const PERFIL_GRAVA_A_CADA_MS = 30000;

  function gravarPerfilSePassouTempo() {
    if (!spawnWatch.perfilSujo) return;
    // `perfilGravadoEm === 0` é "nunca gravou nesta sessão" — e aí grava
    // AGORA. Tratar isso como um timestamp velho fazia a primeira gravação
    // esperar 30s, justamente a janela em que o app acabou de abrir e é mais
    // provável ser fechado.
    if (perfilGravadoEm && Date.now() - perfilGravadoEm < PERFIL_GRAVA_A_CADA_MS) return;
    gravarPerfil();
  }

  function gravarPerfil() {
    if (!spawnWatch.perfilSujo || !spawnWatch.perfilCenario) return;
    perfilGravadoEm = Date.now();
    try {
      const todos = carregarPerfis();
      todos[spawnWatch.perfilCenario] = {
        tiles: spawnWatch.perfilTiles.slice(-PERFIL_MAX),
        lotes: spawnWatch.perfilLotes.slice(-PERFIL_MAX),
        em: Date.now(),
      };
      localStorage.setItem(SPAWN_PERFIL_KEY, JSON.stringify(todos));
      spawnWatch.perfilSujo = false;
    } catch (e) {}
  }

  // Troca o perfil carregado quando a caçada muda. Gravar ANTES de trocar é o
  // que evita perder as amostras da caçada que está saindo.
  function usarPerfilDoCenario(scenarioId) {
    const alvo = scenarioId || null;
    if (spawnWatch.perfilCenario === alvo) return;
    gravarPerfil();
    spawnWatch.perfilCenario = alvo;
    spawnWatch.perfilTiles = [];
    spawnWatch.perfilLotes = [];
    spawnWatch.perfilSujo = false;
    spawnWatch.ultimoLoteEm = 0;
    spawnWatch.loteArmado = true;
    if (!alvo) return;
    const g = carregarPerfis()[alvo];
    if (g) {
      if (Array.isArray(g.tiles)) spawnWatch.perfilTiles = g.tiles.slice(-PERFIL_MAX);
      if (Array.isArray(g.lotes)) spawnWatch.perfilLotes = g.lotes.slice(-PERFIL_MAX);
    }
  }

  function empilharAmostra(lista, valor) {
    lista.push(valor);
    if (lista.length > PERFIL_MAX) lista.shift();
    spawnWatch.perfilSujo = true;
  }

  // Registra "andei N tiles até esta morte" e reinicia a contagem.
  function registrarMorteNoPerfil() {
    if (spawnWatch.perfilCenario) {
      empilharAmostra(spawnWatch.perfilTiles, spawnWatch.tilesDesdeMorte.size);
      // Grava de vez em quando, não a cada morte: em caçada boa isso seria uma
      // escrita em disco a cada dois segundos.
      if (spawnWatch.perfilTiles.length % 20 === 0) gravarPerfil();
    }
    spawnWatch.tilesDesdeMorte.clear();
    spawnWatch.ultimaMorteEm = Date.now();
  }

  // p90, não mediana. A mediana de tiles entre mortes é 0 ou 1 em TODAS as
  // capturas (bicho morre em cima do outro), então ela não descreve "andar
  // procurando"; o p90 descreve.
  function percentil90(xs, minimo) {
    if (!xs || xs.length < minimo) return null;
    const ord = xs.slice().sort((a, b) => a - b);
    return ord[Math.floor(ord.length * 0.9)];
  }

  function tilesTipicos() {
    return percentil90(spawnWatch.perfilTiles, TILES_MIN_AMOSTRAS);
  }

  // v0.11.42 — PERFIL SÓ DE ZEROS NÃO É "CAÇADA APERTADA", É RASTRO MORTO.
  //
  // Sem o id do personagem, `registrarPasso` nunca roda, `tilesDesdeMorte` fica
  // sempre em 0 e o perfil enche de zeros. O p90 então dá 0, o limiar cai no
  // piso (25) e a comparação `0 >= 25` é falsa pra sempre: o critério existe no
  // painel e nunca dispara. Foi exatamente o que aconteceu com o Amoxicilina.
  //
  // Agora isso é reconhecido pelo que é — "não sei medir" — em vez de virar um
  // limiar que nunca será alcançado.
  function rastroMorto() {
    if (spawnWatch.meuId == null) return true;
    if (spawnWatch.perfilTiles.length < TILES_MIN_AMOSTRAS) return false;
    return spawnWatch.perfilTiles.every((x) => x === 0);
  }

  function loteTipicoMs() {
    return percentil90(spawnWatch.perfilLotes, LOTE_MIN_AMOSTRAS);
  }

  // Limiar de tiles pra esta caçada, ou null enquanto não houver amostra.
  function limiarDeTiles() {
    if (rastroMorto()) return null;
    const p90 = tilesTipicos();
    if (p90 === null) return null;
    const fator = Math.max(2, Number(spawnCfg.tilesFactor) || TILES_FATOR);
    const piso = Math.max(10, Number(spawnCfg.tilesFloor) || TILES_PISO);
    return Math.max(piso, p90 * fator);
  }

  // Limiar de silêncio entre lotes, em ms, ou null.
  function limiarDeLote() {
    const p90 = loteTipicoMs();
    if (p90 === null) return null;
    const fator = Math.max(2, Number(spawnCfg.batchFactor) || LOTE_FATOR);
    const piso = Math.max(10000, (Number(spawnCfg.batchFloorSeconds) || 0) * 1000 || LOTE_PISO_MS);
    return Math.max(piso, p90 * fator);
  }

  function registrarPasso(pos) {
    if (!pos || pos.x == null || pos.y == null) return;
    const agora = Date.now();
    const chave = `${pos.x},${pos.y},${pos.z == null ? 0 : pos.z}`;
    if (spawnWatch.minhaPosicao === chave) return; // mesmo tile, não é passo
    spawnWatch.minhaPosicao = chave;

    const antigo = spawnWatch.rastro.find(
      (r) => r.chave === chave && agora - r.em >= VOLTA_MIN_MS
    );
    if (antigo && spawnWatch.rastro.length >= VOLTA_MIN_TILES) {
      spawnWatch.voltaEm = agora;
      spawnWatch.mortesNaVoltaAnterior = spawnWatch.mortesNaVolta;
      spawnWatch.mortesNaVolta = 0;
      spawnWatch.rastro.length = 0;
    }

    spawnWatch.rastro.push({ chave, em: agora });
    if (spawnWatch.rastro.length > RASTRO_MAX) spawnWatch.rastro.shift();
    // v0.11.33 — tiles DISTINTOS desde a última morte. Distintos, não passos:
    // andar pra frente e pra trás no mesmo corredor não é "procurar bicho".
    spawnWatch.tilesDesdeMorte.add(chave);
  }

  // Tipos que a automação escuta. Cada um aqui é uma dependência do
  // protocolo — só entra o que não dá pra ler de outro jeito.
  // v0.11.12 — saíram 26/66: o André disse que não precisa saber QUAL suprimento
  // foi usado, só o custo total — e era só pra isso que o catálogo de nomes
  // servia. Entraram 33 (expedição) e 42 (catálogo de caçadas com monstros e
  // tiers), que substituem abrir menu no jogo pra descobrir onde caçar.
  // v0.11.14 — entraram 21 (movimento) e 103 (id do próprio personagem). Os
  // dois juntos dão a POSIÇÃO do personagem, que é o que o André pediu pra não
  // depender de tempo: "cada caçada é uma rotação diferente e tem personagem
  // level mais baixo que demora mais para dar a volta".
  // v0.11.15 — entrou o 41 (analisador da sessão).
  // v0.11.16 — entraram 54 (onde o personagem está) e 71 (convite de party).
  // v0.11.17 — entrou 51 (caçada em grupo: convite, aceite, chegada, líder).
  // v0.11.18 — entrou 77 (ficha do personagem: stamina, level, vocação).
  // v0.11.21 — entraram 9 (bestiary, pra contar mortes) e 92 (aviso do
  // sistema, que confirma a venda rápida e o desgaste de equipamento).
  // v0.11.22 — entrou 72 (party ao vivo: membros, vocação, stamina, líder).
  // v0.11.42 — entrou o 30 (XP daquela morte). Ele é minúsculo
  // (`{playerId,value}`) e resolve o furo que deixou o detector do Amoxicilina
  // mudo: é a única fonte do id do personagem que chega DEPOIS do login.
  //
  // v0.11.38 — o 26 voltou. Ele saiu na v0.11.35 junto com a capacidade
  // calculada, que era o único uso dele na época. Agora ele é a ÚNICA fonte de
  // `bestiaryClass`, que é o que faz a expedição "Giants" saber quais criaturas
  // contam. Custa um parse de ~224 KB uma vez por login.
  const TIPOS_ESCUTADOS = new Set(["9", "15", "18", "21", "26", "30", "33", "41", "42", "51", "54", "55", "57", "60", "71", "72", "77", "92", "103"]);

  function spawnLerMensagem(texto) {
    // Formato: [tipo, payload]. Filtra ANTES do JSON.parse — isto roda muito
    // (~20 msgs/s por conta), e a maioria das mensagens não interessa.
    if (texto.charCodeAt(0) !== 91 /* [ */) return;
    const virg = texto.indexOf(",");
    if (virg < 2 || virg > 5) return;
    const tipo = texto.slice(1, virg);
    if (!TIPOS_ESCUTADOS.has(tipo)) return;
    const inicioParse = perfDiagnostico.ativo ? perfAgora() : 0;
    const p = JSON.parse(texto)[1];
    if (inicioParse) {
      perfDiagnostico.ws.parse++;
      perfDiagnostico.ws.parseMs += perfAgora() - inicioParse;
    }
    if (!p) return;
    if (tipo === "15") {
      const c = p.creature;
      if (!c) return;
      if (c.kind === "player") {
        perfRegistrarTroca("ws:15", {
          jogador: { id: c.id == null ? null : c.id, nome: typeof c.name === "string" ? c.name : null },
        });
      }
      if (c.kind === "monster") {
        spawnRegistrarNascimento(c.name, c.id);
        return;
      }
      // v0.11.20 — DESCOBRIR O MEU PRÓPRIO ID POR AQUI TAMBÉM.
      //
      // O replay da captura do André mostrou o rastro de posição ZERADO do
      // começo ao fim: o `meuId` vinha só do tipo 103, que chega UMA VEZ, no
      // login. Se o gancho instala depois disso — app aberto com o jogo já
      // rodando, que é o caso comum —, o id nunca chega e o critério da
      // "volta completa" fica morto em silêncio. Exatamente a mesma classe de
      // falha da v0.11.10, achada do mesmo jeito: medindo em vez de supor.
      //
      // O tipo 15 também anuncia JOGADORES (`kind:"player"`), e faz isso a
      // cada mudança de área — inclusive eu mesmo. Casando pelo nome do
      // personagem ativo, o id se reencontra sozinho toda vez que entra numa
      // caçada, sem depender de ter visto o login.
      if (c.kind === "player" && c.id != null && c.name) {
        // v0.11.31 — quando o 103 já disse o meu id, o casamento é por ID e
        // não depende mais do DOM. É daqui que saem nome/vocação/level pelo
        // protocolo (ver o bloco `eu`).
        if (spawnWatch.meuId != null && c.id === spawnWatch.meuId) {
          eu.id = c.id;
          eu.nome = c.name;
          if (typeof c.vocation === "string") eu.vocacao = c.vocation;
          if (typeof c.level === "number") eu.level = c.level;
          eu.em = Date.now();
          return;
        }
        const meuNome = getActiveCharacterName();
        if (meuNome && c.name === meuNome) {
          spawnWatch.meuId = c.id;
          eu.id = c.id;
          eu.nome = c.name;
          if (typeof c.vocation === "string") eu.vocacao = c.vocation;
          if (typeof c.level === "number") eu.level = c.level;
          eu.em = Date.now();
        }
      }
      return;
    }
    if (tipo === "18") {
      if (p.id != null && spawnWatch.vivos.delete(p.id)) {
        spawnWatch.mortesNaVolta++;
        registrarMorteNoPerfil();
      }
      return;
    }
    if (tipo === "30") {
      // v0.11.42 — TERCEIRA FONTE DO MEU ID, e a que não depende do login.
      //
      // No log do Amoxicilina (15/09) o tipo 103 NÃO chegou em 12 minutos — ele
      // só vem no login, e o gancho tinha instalado depois. Sem id, o rastro de
      // posição fica morto, o perfil de tiles enche de ZEROS e o detector de
      // spawn seco vira decoração: teve uma seca de 35s com 211 tiles andados e
      // 0 criaturas vivas, e nada disparou.
      //
      // O tipo 30 (XP daquela morte) traz `playerId` e chega a cada morte —
      // 488 vezes naquela captura. Em party ele traz o id de QUEM matou, então
      // a regra se protege sozinha: só aceita quando um ÚNICO id apareceu (3
      // vezes ou mais). Se um segundo id aparecer, é party, e esta fonte se
      // cala pra sempre nesta sessão em vez de chutar quem sou eu.
      if (spawnWatch.meuId == null && p.playerId != null && !spawnWatch.idsDoXpAmbiguos) {
        const n = (spawnWatch.idsDoXp.get(p.playerId) || 0) + 1;
        spawnWatch.idsDoXp.set(p.playerId, n);
        if (spawnWatch.idsDoXp.size > 1) {
          spawnWatch.idsDoXpAmbiguos = true;
          spawnWatch.idsDoXp.clear();
        } else if (n >= 3) {
          spawnWatch.meuId = p.playerId;
          eu.id = p.playerId;
        }
      }
      return;
    }
    if (tipo === "103") {
      if (p.playerId != null) {
        // Um 103 diferente no mesmo socket não pode herdar o nome anterior.
        // É uma defesa para um futuro fluxo de troca que substitua a sessão
        // sem entregar o close que observamos hoje.
        if (eu.id !== p.playerId || eu.sessao !== socketJogo.sessao) euZerar();
        spawnWatch.meuId = p.playerId;
        eu.id = p.playerId;
        eu.sessao = socketJogo.sessao;
        eu.confirmadoPor103 = true;
      }
      perfRegistrarTroca("ws:103", { playerId: p.playerId == null ? null : p.playerId });
      return;
    }
    if (tipo === "54") {
      mundoLerMensagem(p);
      perfRegistrarTroca("ws:54", {
        instanceId: typeof p.instanceId === "string" ? p.instanceId : null,
        scenarioId: typeof p.scenarioId === "string" ? p.scenarioId : null,
      });
      return;
    }
    if (tipo === "77") {
      fichaLerMensagem(p);
      perfRegistrarTroca("ws:77", {
        level: typeof p.level === "number" ? p.level : null,
        staminaMs: typeof p.staminaMs === "number" ? p.staminaMs : null,
      });
      return;
    }
    if (tipo === "71") {
      convite.de = typeof p.fromName === "string" ? p.fromName : null;
      convite.membros = Array.isArray(p.members) ? p.members : [];
      convite.em = Date.now();
      return;
    }
    if (tipo === "72") {
      party.lider = p.leaderId == null ? null : p.leaderId;
      party.membros = Array.isArray(p.members) ? p.members : [];
      party.em = Date.now();
      return;
    }
    if (tipo === "51") {
      grupo.lider = typeof p.leaderName === "string" ? p.leaderName : null;
      grupo.huntId = typeof p.huntId === "string" ? p.huntId : null;
      grupo.tier = p.tier == null ? null : Number(p.tier);
      grupo.membros = Array.isArray(p.members) ? p.members : [];
      grupo.podeResponder = p.canAnswer === true;
      grupo.euAceitei = p.youAccepted === true;
      grupo.em = Date.now();
      return;
    }
    if (tipo === "21") {
      // O tipo 21 é o movimento de TODO mundo; só interessa o do personagem.
      if (spawnWatch.meuId != null && p.id === spawnWatch.meuId) registrarPasso(p.to);
      return;
    }
    if (tipo === "33" || tipo === "42") {
      guildLerMensagem(tipo, p);
      return;
    }
    if (tipo === "26") {
      // Só a tabela criatura → classe interessa; ataque, loot e o resto do
      // catálogo são descartados.
      bestiarioClassesLerMensagem(p);
      return;
    }
    economiaLerMensagem(tipo, p);
  }

  // ⚠️ POR QUE ISTO É INJETADO NA PÁGINA, E NÃO ENGANCHADO AQUI DIRETO:
  //
  // O preload do <webview> roda em MUNDO ISOLADO. O DOM é compartilhado (por
  // isso `document.querySelector` e os cliques funcionam), mas os objetos de
  // JavaScript NÃO são: o `window.WebSocket` e o `TextDecoder.prototype` daqui
  // são cópias nossas, não os que o jogo usa. A v0.11.10 enganchava aqui e
  // ficava esperando mensagens que nunca chegavam — o detector nunca disparou,
  // em silêncio, e o André reportou "não está funcionando".
  //
  // A saída correta é rodar o gancho no contexto DA PÁGINA e devolver o
  // resultado por CustomEvent no document, que é o terreno comum entre os dois
  // mundos. NÃO desligar `contextIsolation`: isso abriria este preload — que
  // tem ipcRenderer, acesso a arquivo e à licença — pra página do jogo.
  //
  // ⚠️ E POR QUE QUEM EXECUTA É O RENDERER, E NÃO UM <script> INJETADO AQUI:
  //
  // Um <script> inline criado por nós e pendurado no document roda sob a CSP
  // DA PÁGINA — a mesma pegadinha que já está documentada no main.js sobre o
  // fetch() do preload. Se o Huntera servir `script-src` sem 'unsafe-inline',
  // o navegador bloqueia e a gente cai EXATAMENTE no mesmo silêncio da
  // v0.11.10. `webview.executeJavaScript()` não passa pela CSP (é avaliação de
  // nível DevTools) e roda no mundo principal. Então: o preload MANDA o código
  // pro renderer (`hm:proto-hook`), e o renderer executa no webview.
  //
  // O código-fonte do gancho continua morando SÓ aqui — o renderer é cano, não
  // cópia. Duplicar esse trecho lá seria criar duas verdades pra manter.
  const PROTO_EVENTO = "hm:proto";
  const PROTO_EVENTO_WS = "hm:proto-ws"; // ciclo de vida do socket do jogo
  const PROTO_EVENTO_DIAG = "hm:proto-diag"; // v0.11.19 — tudo, no diagnóstico
  const PROTO_MARCA_DIAG = "data-hm-diag"; // interruptor do diagnóstico
  const PROTO_MARCA = "data-hm-proto"; // marca no <html>: o gancho está vivo

  // ================= v0.12.3 — FREIO DO LOOP DE RENDER =================
  //
  // André: "se mudarmos o sistema todo para WebSocket, aba minimizada não
  // renderiza o jogo e fica só troca de mensagens". O objetivo está certo; o
  // caminho não é possível — o protocolo do Huntera é CRIPTOGRAFADO, e a gente
  // só lê texto plano porque o gancho pega o `TextDecoder.decode` DEPOIS que o
  // próprio cliente decifrou, com a chave da sessão dele. Cliente headless
  // precisaria da chave. (Investigação de 04/09/2026 no CLAUDE.md.)
  //
  // Mas o caro nunca foi o socket — é o PHASER. O jogo é Angular + Phaser, e o
  // Phaser desenha o mundo em canvas/WebGL num loop de `requestAnimationFrame`,
  // 60 vezes por segundo, por conta. E esse loop É separável do socket.
  //
  // COMO, E POR QUE ASSIM: o freio NÃO troca `requestAnimationFrame` por
  // `setTimeout`. Essa seria a implementação óbvia e seria um TIRO NO PÉ: um
  // webview escondido (`display:none`) já tem o rAF suspenso pelo Chromium,
  // enquanto os timers continuam correndo (a v0.4.4 desligou o throttling de
  // timer de propósito) — trocar um pelo outro faria a conta escondida sair de
  // 0 fps para 2 fps. Otimização que piora.
  //
  // Em vez disso o rAF continua sendo o ÚNICO motor: o freio só ABSORVE
  // frames, encadeando rAFs vazios e chamando o callback do Phaser de N em N.
  // Se o Chromium já suspendeu o rAF, o freio não faz nada (e não há nada a
  // economizar). Se o rAF está correndo, o Phaser passa a desenhar a 2 fps.
  // Nos dois casos é impossível gastar MAIS do que sem o freio — e é por isso
  // que essa forma foi escolhida, não a outra.
  //
  // O que o freio NÃO toca: WebSocket (orientado a evento), timers (heartbeat),
  // e o HUD do Angular — que é justamente de onde a automação lê capacidade,
  // stamina, botões e tracker de expedição. Frear o Phaser não cega o bot.
  const FREIO_MARCA = "data-hm-freio";
  const FREIO_MARCA_HOOK = "data-hm-freio-hook";
  const FREIO_EVENTO = "hm:render-brake";
  // 30 frames absorvidos ≈ 2 desenhos por segundo a 60Hz.
  const FREIO_PULOS = 30;

  function codigoDoFreioNaPagina(marca, marcaHook, evento) {
    return `(() => {
      try {
        const avisar = (freando) => {
          try { document.dispatchEvent(new CustomEvent(${JSON.stringify(evento)}, { detail: { hookInstalado: true, ligado: !!freando } })); } catch (e) {}
        };
        if (window.__hmFreioInstalado) {
          const ligado = document.documentElement.getAttribute(${JSON.stringify(marca)}) === "1";
          document.documentElement.setAttribute(${JSON.stringify(marcaHook)}, "1");
          avisar(ligado);
          return "ja";
        }
        window.__hmFreioInstalado = true;
        const rafNativo = window.requestAnimationFrame.bind(window);

        // Mesmo interruptor do diagnóstico: atributo no <html>, porque o DOM é
        // o único terreno comum entre o mundo da página e o mundo isolado do
        // preload. Lido por MutationObserver pra não virar leitura de DOM a
        // cada frame.
        let freando = false;
        const lerFlag = () => {
          try {
            freando = document.documentElement.getAttribute(${JSON.stringify(marca)}) === "1";
            avisar(freando);
          } catch (e) {}
        };
        lerFlag();
        document.documentElement.setAttribute(${JSON.stringify(marcaHook)}, "1");
        try {
          new MutationObserver(lerFlag).observe(document.documentElement, {
            attributes: true,
            attributeFilter: [${JSON.stringify(marca)}],
          });
        } catch (e) {}

        window.requestAnimationFrame = function (cb) {
          if (!freando) return rafNativo(cb);
          let restantes = ${FREIO_PULOS};
          const passo = (t) => {
            // Reconfere a cada frame: soltar o freio tem que voltar a 60fps na
            // hora, não no fim da contagem.
            if (freando && restantes-- > 0) return rafNativo(passo);
            cb(t);
          };
          return rafNativo(passo);
        };

        // cancelAnimationFrame continua o nativo de propósito: o id que
        // devolvemos É um id de rAF de verdade (o do primeiro passo), então
        // cancelar funciona sem gambiarra de id.
        return "ok";
      } catch (e) { return "erro:" + (e && e.message); }
    })();`;
  }

  function codigoDoGanchoNaPagina(nomeEvento, tipos, marca, eventoWs, marcaDiag, eventoDiag, marcaPerf, eventoPerf) {
    return `(() => {
      if (window.__hmProtoInstalado) return "ja";
      window.__hmProtoInstalado = true;
      const TIPOS = new Set(${JSON.stringify(tipos)});
      let janela = false;
      const avisarWs = (estado) => {
        try { document.dispatchEvent(new CustomEvent(${JSON.stringify(eventoWs)}, { detail: estado })); } catch (e) {}
      };
      // v0.11.19 — MODO DIAGNÓSTICO. Desligado, não custa nada: a variável
      // \`diag\` é lida por mensagem, e só quando ela é true a mensagem inteira
      // atravessa pro mundo isolado. O interruptor é um atributo no <html>,
      // porque o DOM é o único terreno comum entre os dois mundos — e é
      // observado por MutationObserver pra não virar uma leitura de DOM a
      // cada mensagem (são ~20/s por conta).
      let diag = false;
      let perf = false;
      try {
        const lerFlag = () => {
          try { diag = document.documentElement.getAttribute(${JSON.stringify(marcaDiag)}) === "1"; } catch (e) {}
        };
        lerFlag();
        new MutationObserver(lerFlag).observe(document.documentElement, {
          attributes: true,
          attributeFilter: [${JSON.stringify(marcaDiag)}],
        });
        const lerPerf = () => {
          try { perf = document.documentElement.getAttribute(${JSON.stringify(marcaPerf)}) === "1"; } catch (e) {}
        };
        lerPerf();
        new MutationObserver(lerPerf).observe(document.documentElement, {
          attributes: true,
          attributeFilter: [${JSON.stringify(marcaPerf)}],
        });
      } catch (e) {}
      try {
        const WSNativo = window.WebSocket;
        function WSObservado(url, protocols) {
          const ws = protocols === undefined ? new WSNativo(url) : new WSNativo(url, protocols);
          try {
            // v0.11.14 — o ciclo de vida do socket é o sinal mais honesto de
            // "o servidor está de pé". Não interfere em nada: só observa.
            avisarWs("conectando");
            ws.addEventListener("open", () => avisarWs("aberto"));
            ws.addEventListener("close", () => avisarWs("fechado"));
            ws.addEventListener("error", () => avisarWs("fechado"));
            ws.addEventListener("message", () => {
              janela = true;
              setTimeout(() => { janela = false; }, 0);
            });
          } catch (e) {}
          return ws;
        }
        WSObservado.prototype = WSNativo.prototype;
        for (const k of ["CONNECTING","OPEN","CLOSING","CLOSED"]) WSObservado[k] = WSNativo[k];
        window.WebSocket = WSObservado;

        const decodeNativo = TextDecoder.prototype.decode;
        Object.defineProperty(TextDecoder.prototype, "decode", {
          configurable: true, writable: true,
          value: function (...args) {
            const texto = decodeNativo.apply(this, args);
            try {
              if (janela && typeof texto === "string" && texto.length > 8 && texto.charCodeAt(0) === 91) {
                const v = texto.indexOf(",");
                if (v > 1 && v < 6) {
                  const t = texto.slice(1, v);
                  // Diagnóstico de performance: atravessa apenas opcode e bytes,
                  // nunca o payload. Fica desligado por padrão para não criar
                  // trabalho recorrente durante o uso normal.
                  if (perf) {
                    document.dispatchEvent(new CustomEvent(${JSON.stringify(eventoPerf)}, { detail: t + ":" + texto.length }));
                  }
                  if (TIPOS.has(t)) {
                    document.dispatchEvent(new CustomEvent(${JSON.stringify(nomeEvento)}, { detail: texto }));
                  }
                  // No diagnóstico vai TUDO, inclusive o que a automação não
                  // usa — é justamente o desconhecido que interessa mapear.
                  //
                  // v0.12.1 — COM UM TETO. O tipo 88 (terreno) tem ~3 MB POR
                  // MENSAGEM, e passava inteiro: string de 3 MB clonada pra
                  // atravessar a fronteira de mundos, guardada inteira no anel
                  // de eventos enquanto o tipo ainda fosse "raro", e
                  // descartada logo depois pelo teto de bytes. Era churn de
                  // GC de megabytes por segundo com o log do protocolo ligado
                  // — o suficiente pra travar a máquina de quem ligasse.
                  //
                  // Acima do teto vai só o começo da mensagem: o tipo continua
                  // sendo CONTADO no diagnóstico e dá pra ver o formato dele,
                  // que é tudo que a gente quer do terreno (a decisão de nunca
                  // parsear o 88 é antiga). 512 KB deixa passar inteiros os
                  // catálogos do login, que são o motivo do diagnóstico
                  // existir: o 42 tem 340 KB e o 26 tem 224 KB.
                  if (diag) {
                    const recorte = texto.length > 524288 ? texto.slice(0, 2000) : texto;
                    document.dispatchEvent(new CustomEvent(${JSON.stringify(eventoDiag)}, { detail: recorte }));
                  }
                }
              }
            } catch (e) {}
            return texto;
          },
        });
        // Marca compartilhada: o DOM é o único terreno comum entre o mundo da
        // página e o mundo isolado do preload. Sem isto, "pedi pra instalar"
        // seria de novo indistinguível de "instalou".
        try { document.documentElement.setAttribute(${JSON.stringify(marca)}, "1"); } catch (e) {}
        return "ok";
      } catch (e) { return "erro:" + (e && e.message); }
    })();`;
  }

  // ================= v0.11.19 — LOG DO PROTOCOLO DENTRO DO SWAG =================
  //
  // Até aqui, investigar o protocolo exigia o André abrir o Chrome com o
  // userscript e uma conta sobrando (o jogo só aceita uma sessão por conta).
  // O gancho já está instalado em toda aba do Swag — falta só deixar passar
  // tudo em vez de só os tipos que a automação usa.
  //
  // DESLIGADO POR PADRÃO, e isso não é cerimônia: são ~20 mensagens por
  // segundo por conta. Ligado nas quatro ao mesmo tempo seria ~80/s
  // atravessando a fronteira de mundos sem ninguém pedir.
  //
  // O formato de saída é O MESMO do userscript, de propósito: as ferramentas
  // de análise que já existem continuam valendo sem adaptação.
  const APP_VERSION_DIAG = "0.11.19";
  const DIAG_MAX_BRUTOS = 4000;
  const DIAG_MAX_BYTES = 12 * 1024 * 1024;
  const DIAG_AMOSTRA_INTEIRA = 2 * 1024 * 1024;
  const DIAG_AMOSTRA_CURTA = 2000;

  // v0.11.37 — SEGUNDO ANEL, SÓ PRO QUE É RARO.
  //
  // Achado analisando a captura de 46min do André: o anel de 4.000 mensagens
  // guardou os ÚLTIMOS 40 SEGUNDOS. Tudo que interessava — a caçada em grupo
  // montando (tipo 51, entre 26min e 28min), um "declined the team hunt", um
  // pedido do líder que expirou (139/140 aos 31min) — caiu fora. Uma captura
  // longa virava um retrato do último minuto.
  //
  // A causa é o volume: 21 (movimento), 105 (efeito), 77 (ficha) e 19/20
  // (vida/dano) fazem ~95% das mensagens e empurram o resto pra fora.
  //
  // A saída é um anel separado que guarda só o que é RARO — e "raro" é medido,
  // não listado à mão: uma mensagem entra aqui enquanto o tipo dela não tiver
  // passado de EVENTO_TIPO_MAX ocorrências. Tipo tagarela se auto-exclui
  // depois das primeiras; tipo que acontece 10 vezes numa sessão inteira fica
  // inteiro. Sem lista pra manter desatualizada.
  const DIAG_MAX_EVENTOS = 3000;
  const DIAG_EVENTO_TIPO_MAX = 400; // passou disso, o tipo é tagarela
  const DIAG_EVENTO_MAX_BYTES = 6 * 1024 * 1024;

  const diagnostico = {
    ativo: false,
    inicio: 0,
    total: 0,
    tipos: new Map(), // tipo -> {qtd, primeiro, ultimo, amostras[], bytes}
    brutos: [],
    bytes: 0,
    eventos: [], // o que é raro, preservado da captura inteira
    eventosBytes: 0,
  };

  // Telemetria temporária de baseline. Os contadores só são atualizados quando
  // ligados; fora disso, os caminhos quentes continuam sem relógios, IPC extra
  // ou retenção de payload.
  const PERF_MARCA = "data-hm-perf";
  const PERF_EVENTO = "hm:perf-ws";
  const perfDiagnostico = {
    ativo: false,
    inicio: 0,
    dom: { queries: 0, ms: 0, execucoes: 0, execMs: 0 },
    ws: { mensagens: 0, parse: 0, parseMs: 0, handlerMs: 0, porOpcode: new Map() },
    watchers: new Map(),
    trocaPersonagem: { eventos: [], observer: null, verificarAgendado: false, ultimaTela: null },
  };
  const perfDomPatches = [];

  // Investigação temporária da troca manual: registra somente a ordem dos
  // fatos que podem substituir o TTL da identidade. Não guarda payloads e só
  // observa o DOM enquanto o diagnóstico de baseline está ligado.
  const PERF_TROCA_EVENTOS_MAX = 200;
  function perfResumoIdentidade() {
    return { id: eu.id, nome: eu.nome, em: eu.em || null };
  }
  function perfRegistrarTroca(tipo, dados) {
    if (!perfDiagnostico.ativo) return;
    const eventos = perfDiagnostico.trocaPersonagem.eventos;
    eventos.push({
      t: Date.now() - perfDiagnostico.inicio,
      tipo,
      socket: socketJogo.estado,
      identidade: perfResumoIdentidade(),
      ...(dados || {}),
    });
    if (eventos.length > PERF_TROCA_EVENTOS_MAX) eventos.shift();
  }
  function perfLerTelaDeTroca() {
    const cabecalho = document.querySelector(SEL.characterHeaderName);
    const lista = document.querySelector(SEL.characterListItem);
    const nome = cabecalho && String(cabecalho.textContent || "").trim();
    return { tela: nome ? "jogo" : lista ? "lista-personagens" : "transicao", nome: nome || null };
  }
  function perfVerificarTelaDeTroca() {
    perfDiagnostico.trocaPersonagem.verificarAgendado = false;
    if (!perfDiagnostico.ativo) return;
    const tela = perfLerTelaDeTroca();
    const assinatura = `${tela.tela}:${tela.nome || ""}`;
    if (assinatura === perfDiagnostico.trocaPersonagem.ultimaTela) return;
    perfDiagnostico.trocaPersonagem.ultimaTela = assinatura;
    perfRegistrarTroca("dom:tela", tela);
  }
  function perfIniciarObservacaoDeTroca() {
    perfPararObservacaoDeTroca();
    perfDiagnostico.trocaPersonagem.ultimaTela = null;
    perfVerificarTelaDeTroca();
    try {
      const observer = new MutationObserver(() => {
        if (perfDiagnostico.trocaPersonagem.verificarAgendado) return;
        perfDiagnostico.trocaPersonagem.verificarAgendado = true;
        // Muitas mutações compõem a mesma transição Angular; uma leitura após
        // 150 ms registra o estado assentado sem virar consulta contínua.
        setTimeout(perfVerificarTelaDeTroca, 150);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      perfDiagnostico.trocaPersonagem.observer = observer;
    } catch (err) {}
  }
  function perfPararObservacaoDeTroca() {
    const troca = perfDiagnostico.trocaPersonagem;
    if (troca.observer) {
      try { troca.observer.disconnect(); } catch (err) {}
    }
    troca.observer = null;
    troca.verificarAgendado = false;
  }

  function perfInstalarContagemDom() {
    if (perfDomPatches.length) return;
    const prototipos = [window.Document && window.Document.prototype, window.Element && window.Element.prototype, window.DocumentFragment && window.DocumentFragment.prototype].filter(Boolean);
    for (const proto of prototipos) for (const metodo of ["querySelector", "querySelectorAll", "getElementById", "getElementsByClassName", "getElementsByTagName"]) {
      if (typeof proto[metodo] !== "function") continue;
      const nativo = proto[metodo];
      try {
        proto[metodo] = function (...args) {
          if (!perfDiagnostico.ativo) return nativo.apply(this, args);
          const inicio = perfAgora();
          try { return nativo.apply(this, args); }
          finally { perfDiagnostico.dom.queries++; perfDiagnostico.dom.ms += perfAgora() - inicio; }
        };
        perfDomPatches.push({ proto, metodo, nativo });
      } catch (err) {}
    }
  }
  function perfRemoverContagemDom() {
    while (perfDomPatches.length) {
      const { proto, metodo, nativo } = perfDomPatches.pop();
      try { proto[metodo] = nativo; } catch (err) {}
    }
  }

  function perfAgora() { return performance.now(); }
  function perfFeatureLigada(feature) {
    if (feature === "sempre") return true;
    const cfg = loadState();
    if (feature === "automação") return !!running;
    if (feature === "autoAcceptParty") return !!cfg.autoAcceptParty;
    if (feature === "autoAcceptParty/huntMode") return !!cfg.autoAcceptParty || cfg.huntMode === "group";
    if (feature === "autoInvitePartyEnabled") return !!cfg.autoInvitePartyEnabled;
    if (feature === "minimizeGameAnalyzer") return cfg.minimizeGameAnalyzer !== false;
    if (feature === "autoSellOnCityArrival") return cfg.autoSellOnCityArrival !== false;
    if (feature === "autoRestartAfterOutage") return cfg.autoRestartAfterOutage !== false;
    if (feature === "trainOnStaminaZero/trainOnIdleInCity") return !!cfg.trainOnStaminaZero || !!cfg.trainOnIdleInCity;
    if (feature === "autoResumeSessionEnabled") return !!cfg.autoResumeSessionEnabled;
    if (feature === "syncEkTarget") return !!cfg.syncEkTarget;
    if (feature === "autoKeepCurrentTarget") return !!cfg.autoKeepCurrentTarget;
    return null;
  }
  function perfWatcher(nome, intervaloMs, feature, tarefa) {
    if (!perfDiagnostico.ativo) return tarefa();
    let reg = perfDiagnostico.watchers.get(nome);
    if (!reg) {
      reg = { intervaloMs, feature, execucoes: 0, acoes: 0, domQueries: 0, domMs: 0, domExecucoes: 0, domExecMs: 0, totalMs: 0, activeJsMs: 0, waitingMs: 0, decisionMs: 0 };
      perfDiagnostico.watchers.set(nome, reg);
    }
    reg.execucoes++;
    reg.featureLigada = perfFeatureLigada(feature);
    const q0 = perfDiagnostico.dom.queries, r0 = perfDiagnostico.dom.ms;
    const e0 = perfDiagnostico.dom.execucoes, x0 = perfDiagnostico.dom.execMs;
    const inicio = perfAgora();
    let ativoRegistrado = false;
    let activeMsDaExecucao = 0;
    const registrarTrabalhoAtivo = () => {
      if (ativoRegistrado) return;
      ativoRegistrado = true;
      const total = perfAgora() - inicio;
      activeMsDaExecucao = total;
      const domMs = perfDiagnostico.dom.ms - r0;
      const execMs = perfDiagnostico.dom.execMs - x0;
      reg.activeJsMs += total;
      reg.domQueries += perfDiagnostico.dom.queries - q0;
      reg.domMs += domMs;
      reg.domExecucoes += perfDiagnostico.dom.execucoes - e0;
      reg.domExecMs += execMs;
      reg.decisionMs += Math.max(0, total - domMs - execMs);
      if (perfDiagnostico.dom.execucoes > e0) reg.acoes++;
    };
    const fim = () => {
      registrarTrabalhoAtivo();
      const total = perfAgora() - inicio;
      reg.totalMs += total; // wall-clock: inclui awaits/sleeps deliberadamente
      reg.waitingMs += Math.max(0, total - activeMsDaExecucao);
    };
    try {
      const resultado = tarefa();
      registrarTrabalhoAtivo(); // só JS síncrono; não atribui awaits a CPU
      if (resultado && typeof resultado.then === "function") return resultado.then((v) => { fim(); return v; }, (e) => { fim(); throw e; });
      fim();
      return resultado;
    } catch (err) { fim(); throw err; }
  }

  function perfPacote() {
    const duracaoMs = perfDiagnostico.inicio ? Date.now() - perfDiagnostico.inicio : 0;
    const porMinuto = (n) => duracaoMs ? Math.round((n * 60000 / duracaoMs) * 100) / 100 : 0;
    return {
      gerado: new Date().toISOString(), duracaoMs,
      dom: { ...perfDiagnostico.dom, queriesPorSegundo: duracaoMs ? Math.round((perfDiagnostico.dom.queries * 1000 / duracaoMs) * 100) / 100 : 0, queriesPorMinuto: porMinuto(perfDiagnostico.dom.queries) },
      ws: {
        mensagens: perfDiagnostico.ws.mensagens, parses: perfDiagnostico.ws.parse,
        mensagensPorSegundo: duracaoMs ? Math.round((perfDiagnostico.ws.mensagens * 1000 / duracaoMs) * 100) / 100 : 0,
        parsesPorSegundo: duracaoMs ? Math.round((perfDiagnostico.ws.parse * 1000 / duracaoMs) * 100) / 100 : 0,
        parseMs: perfDiagnostico.ws.parseMs, handlerMs: perfDiagnostico.ws.handlerMs,
        porOpcode: [...perfDiagnostico.ws.porOpcode.entries()].map(([opcode, r]) => ({ opcode, ...r, mensagensPorSegundo: duracaoMs ? Math.round((r.mensagens * 1000 / duracaoMs) * 100) / 100 : 0 })),
      },
      watchers: [...perfDiagnostico.watchers.entries()].map(([watcher, r]) => ({ watcher, ...r, execucoesPorMinuto: porMinuto(r.execucoes), acoesPorMinuto: porMinuto(r.acoes), domReadsPorMinuto: porMinuto(r.domQueries) })),
      timersAtivos: [...perfDiagnostico.watchers.entries()].map(([watcher, r]) => ({ watcher, intervaloMs: r.intervaloMs, feature: r.feature })),
      // Um retrato do interruptor no instante do download. Não é polling nem
      // mede DOM do jogo: são só os atributos de comunicação do próprio Swag.
      renderBrake: {
        ligado: !!(document.documentElement && document.documentElement.getAttribute(FREIO_MARCA) === "1"),
        hookInstalado: !!(document.documentElement && document.documentElement.getAttribute(FREIO_MARCA_HOOK) === "1"),
      },
      trocaPersonagem: { eventos: perfDiagnostico.trocaPersonagem.eventos.slice() },
    };
  }

  function perfLigar(ligado) {
    perfDiagnostico.ativo = !!ligado;
    if (ligado) {
      perfDiagnostico.inicio = Date.now();
      perfDiagnostico.dom = { queries: 0, ms: 0, execucoes: 0, execMs: 0 };
      perfDiagnostico.ws = { mensagens: 0, parse: 0, parseMs: 0, handlerMs: 0, porOpcode: new Map() };
      perfDiagnostico.watchers.clear();
      perfDiagnostico.trocaPersonagem.eventos.length = 0;
      perfInstalarContagemDom();
      perfIniciarObservacaoDeTroca();
      document.documentElement && document.documentElement.setAttribute(PERF_MARCA, "1");
    } else {
      perfRemoverContagemDom();
      perfPararObservacaoDeTroca();
      if (document.documentElement) document.documentElement.removeAttribute(PERF_MARCA);
    }
    sendState({ perfDiagAtivo: perfDiagnostico.ativo, perfDiagInicio: perfDiagnostico.inicio });
  }

  function diagRegistrar(texto) {
    if (!diagnostico.ativo) return;
    const virg = texto.indexOf(",");
    if (virg < 2 || virg > 6) return;
    const tipo = Number(texto.slice(1, virg));
    if (!Number.isFinite(tipo)) return;

    const agora = Date.now();
    diagnostico.total++;

    let reg = diagnostico.tipos.get(tipo);
    if (!reg) {
      reg = { qtd: 0, primeiro: agora, ultimo: agora, amostras: [], bytes: 0 };
      diagnostico.tipos.set(tipo, reg);
    }
    reg.qtd++;
    reg.ultimo = agora;
    reg.bytes += texto.length;
    // A PRIMEIRA amostra de cada tipo vai inteira. Os catálogos do login são
    // enormes (o tipo 42 tem 340 KB) e chegam nos primeiros segundos — cortar
    // a amostra e ainda deixar o buffer circular descartar o original foi
    // exatamente o que estragou a primeira captura do André.
    if (reg.amostras.length === 0) reg.amostras.push(texto.slice(0, DIAG_AMOSTRA_INTEIRA));
    else if (reg.amostras.length < 3) reg.amostras.push(texto.slice(0, DIAG_AMOSTRA_CURTA));

    // Enquanto o tipo for raro, a mensagem também vai pro anel de eventos —
    // que sobrevive à enxurrada de movimento e efeito visual.
    if (reg.qtd <= DIAG_EVENTO_TIPO_MAX) {
      diagnostico.eventos.push({ t: agora - diagnostico.inicio, tipo, texto });
      diagnostico.eventosBytes += texto.length;
      while (diagnostico.eventos.length > DIAG_MAX_EVENTOS || diagnostico.eventosBytes > DIAG_EVENTO_MAX_BYTES) {
        const velho = diagnostico.eventos.shift();
        if (!velho) break;
        diagnostico.eventosBytes -= velho.texto.length;
      }
    }

    diagnostico.brutos.push({ t: agora - diagnostico.inicio, tipo, texto });
    diagnostico.bytes += texto.length;
    while (diagnostico.brutos.length > DIAG_MAX_BRUTOS || diagnostico.bytes > DIAG_MAX_BYTES) {
      const fora = diagnostico.brutos.shift();
      if (!fora) break;
      diagnostico.bytes -= fora.texto.length;
    }
  }

  function diagLigar(ligado) {
    const raiz = document.documentElement;
    if (ligado) {
      diagnostico.ativo = true;
      diagnostico.inicio = Date.now();
      diagnostico.total = 0;
      diagnostico.tipos.clear();
      diagnostico.brutos.length = 0;
      diagnostico.bytes = 0;
      diagnostico.eventos.length = 0;
      diagnostico.eventosBytes = 0;
      if (raiz) raiz.setAttribute(PROTO_MARCA_DIAG, "1");
      saveState({ diagEnabled: true });
      log("Diagnóstico do protocolo LIGADO — gravando tudo que o servidor manda nesta conta.");
    } else {
      diagnostico.ativo = false;
      if (raiz) raiz.removeAttribute(PROTO_MARCA_DIAG);
      saveState({ diagEnabled: false });
      log("Diagnóstico do protocolo desligado.");
    }
    sendState();
  }

  function diagPacote() {
    return {
      gerado: new Date().toISOString(),
      origem: "swag",
      versao: APP_VERSION_DIAG,
      personagem: getActiveCharacterName(),
      duracaoSegundos: diagnostico.inicio ? Math.round((Date.now() - diagnostico.inicio) / 1000) : 0,
      socketEstado: socketJogo.estado,
      totalMensagens: diagnostico.total,
      tipos: [...diagnostico.tipos.entries()]
        .sort((a, b) => b[1].qtd - a[1].qtd)
        .map(([tipo, r]) => ({
          tipo,
          qtd: r.qtd,
          bytes: r.bytes,
          primeiroEm: r.primeiro - diagnostico.inicio,
          ultimoEm: r.ultimo - diagnostico.inicio,
          amostras: r.amostras,
        })),
      brutos: diagnostico.brutos,
      // v0.11.37 — o que é raro, da captura INTEIRA (ver o comentário em
      // `diagnostico`). É aqui que mora a história de uma sessão longa.
      eventos: diagnostico.eventos,
    };
  }

  function ganchoNaPaginaInstalado() {
    try {
      const raiz = document.documentElement;
      return !!(raiz && raiz.hasAttribute(PROTO_MARCA));
    } catch (e) {
      return false;
    }
  }

  function instalarEscutaDeSpawn() {
    if (spawnWatch.ativo) return;
    try {
      // O detalhe do CustomEvent atravessa os mundos como string — objeto
      // exigiria clonagem estruturada e é desnecessário aqui.
      document.addEventListener(PROTO_EVENTO, (ev) => {
        try {
          spawnWatch.mensagens++;
          spawnWatch.ultimaMensagemEm = Date.now();
          const inicio = perfDiagnostico.ativo ? perfAgora() : 0;
          spawnLerMensagem(String(ev.detail));
          if (inicio) perfDiagnostico.ws.handlerMs += perfAgora() - inicio;
        } catch (e) { /* nunca propaga pro jogo */ }
      });

      document.addEventListener(PERF_EVENTO, (ev) => {
        if (!perfDiagnostico.ativo) return;
        try {
          const [opcode, bytes] = String(ev.detail).split(":");
          const reg = perfDiagnostico.ws.porOpcode.get(opcode) || { mensagens: 0, bytes: 0 };
          reg.mensagens++;
          reg.bytes += Number(bytes) || 0;
          perfDiagnostico.ws.porOpcode.set(opcode, reg);
          perfDiagnostico.ws.mensagens++;
        } catch (e) {}
      });

      document.addEventListener(PROTO_EVENTO_WS, (ev) => {
        try {
          const estado = String(ev.detail);
          if (estado === socketJogo.estado) return;
          // A construção de outro WebSocket já delimita uma nova sessão,
          // mesmo se o servidor não entregar o close do anterior.
          if (estado === "conectando") {
            socketJogo.sessao++;
            euZerar();
          }
          socketJogo.estado = estado;
          if (estado === "aberto") socketJogo.abertoEm = Date.now();
          perfRegistrarTroca(`socket:${estado}`);
          if (estado === "fechado") {
            socketJogo.fechadoEm = Date.now();
            // v0.11.31 — socket caiu: a identidade que o protocolo tinha
            // virou foto velha. O 103 chega de novo na reconexão (confirmado
            // nas capturas, ~2s depois de abrir).
            euZerar();
            perfRegistrarTroca("identidade:zerada-por-socket");
          }
        } catch (e) {}
      });

      document.addEventListener(PROTO_EVENTO_DIAG, (ev) => {
        try { diagRegistrar(String(ev.detail)); } catch (e) {}
      });

      // Confirmação orientada a evento: não consulta o DOM em polling. O
      // renderer só chama uma conta "freada" depois de receber este sinal do
      // mundo principal que realmente contém o requestAnimationFrame do jogo.
      document.addEventListener(FREIO_EVENTO, (ev) => {
        try {
          const estado = (ev && ev.detail) || {};
          sendToHost("hm:render-brake", {
            ligado: estado.ligado === true,
            atributoAplicado: document.documentElement.getAttribute(FREIO_MARCA) === "1",
            hookInstalado: estado.hookInstalado === true,
          });
          perfRegistrarTroca("render:freio", {
            ligado: estado.ligado === true,
            hookInstalado: estado.hookInstalado === true,
          });
        } catch (e) {}
      });

      // v0.12.3 — o freio de render vai pela mesma porta: também precisa rodar
      // no MUNDO DA PÁGINA (o `requestAnimationFrame` que o Phaser usa é o da
      // página, não o nosso), e o canal `hm:proto-hook` é só um cano pro
      // `executeJavaScript` do host.
      sendToHost("hm:proto-hook", codigoDoFreioNaPagina(FREIO_MARCA, FREIO_MARCA_HOOK, FREIO_EVENTO));

      const codigo = codigoDoGanchoNaPagina(
        PROTO_EVENTO,
        [...TIPOS_ESCUTADOS],
        PROTO_MARCA,
        PROTO_EVENTO_WS,
        PROTO_MARCA_DIAG,
        PROTO_EVENTO_DIAG,
        PERF_MARCA,
        PERF_EVENTO
      );
      let tentativas = 0;
      const pedir = () => {
        tentativas++;
        sendToHost("hm:proto-hook", codigo);
      };

      // Em document-start o webview pode ainda não ter anexado do lado do
      // renderer, e o <html> pode nem existir. O jogo só abre o WebSocket
      // muitos segundos depois (tela de login → seleção → "Jogar"), então
      // reinsistir aqui não perde mensagem nenhuma. Para quando a marca no
      // <html> aparece — isto é, quando o gancho REALMENTE rodou na página.
      pedir();
      const timer = setInterval(() => {
        if (ganchoNaPaginaInstalado() || tentativas >= 10) {
          clearInterval(timer);
          return;
        }
        pedir();
      }, 2000);

      spawnWatch.ativo = true;
    } catch (err) {
      // Sem escuta o detector não liga; o resto da automação segue normal.
    }
  }
  // ============================================================================

  let ipcRenderer = null;
  try {
    ipcRenderer = require("electron").ipcRenderer;
  } catch (err) {
    // Não deveria acontecer (preload de webview sem sandbox tem acesso ao
    // módulo electron), mas se faltar por algum motivo a automação em si
    // continua rodando — só não reporta estado pro host nem recebe comando.
  }

  function sendToHost(channel, payload) {
    if (!ipcRenderer) return;
    try {
      ipcRenderer.sendToHost(channel, payload);
    } catch (err) {
      // host pode ainda não estar ouvindo (ex: bem no início do boot) —
      // não é motivo pra travar a automação.
    }
  }

  // Depois de `sendToHost` existir de verdade: o pedido do gancho sai por
  // ipcRenderer, então chamar isto antes (como estava até a v0.11.12) mandaria
  // pro vazio com `ipcRenderer` ainda em null.
  instalarEscutaDeSpawn();

  const STORAGE_KEY = "hm_automation_v1";

  const SEL = {
    capacityValue: ".inventory-capacity strong",
    capacityContainer: ".inventory-capacity",
    huntDetailsBtn: 'button[aria-label="Detalhes da caçada"]',
    huntHeadingText: ".hunt-detail-info .hunt-heading h3",
    leaveHuntBtn: 'button[aria-label="Sair da caçada"]',
    huntWindow: ".hunt-window",
    huntSearchInput: 'input[aria-label="Buscar uma caçada ou criatura"]',
    huntEntries: ".hunt-list button.hunt-entry",
    huntEntryName: "strong",
    huntTiers: ".hunt-tiers .hunt-tier",
    quickSellTownBtn: 'button[aria-label^="Venda rápida"]',
    quickSellConfirmBtn: ".quick-sell-confirm",
    quickSellCancelBtn: ".quick-sell-cancel",
    closeModalBtn: 'button[aria-label="Fechar"]',
    // v0.5.0 — mesmo seletor confirmado ao vivo na extensão Chrome
    // (huntera-automacao/content.js): relógio "H:MMh" de stamina restante.
    staminaClock: ".hud-stamina-clock",
    // v0.7.0 — todos os seletores abaixo são idênticos aos já CONFIRMADOS AO
    // VIVO na extensão Chrome (huntera-automacao/CLAUDE.md, seção
    // "Seletores DOM confirmados ao vivo") — o Huntera é o mesmo site nos
    // dois casos, então nada disso precisa de nova investigação.
    characterHeaderName: ".header-character-name",
    // v0.8.0 — auto retomar sessão (tela de seleção de personagem). Mesmos
    // seletores já CONFIRMADOS AO VIVO na extensão Chrome
    // (huntera-automacao/CLAUDE.md) — mesmo site, sem necessidade de nova
    // investigação.
    characterListItem: ".character-list article",
    characterMetaName: ".character-meta strong",
    // Convite de party comum ("Convite para se juntar" / "Convite de
    // party") e convite de caçada em grupo reusam o MESMO container,
    // diferenciados pelo aria-label.
    partyInviteDialog: ".party-invite.invite-card",
    partyInviteMsg: ".party-invite .invite-msg",
    groupHuntInviteDialog: '.party-invite.invite-card[aria-label="Convite de caçada em grupo"]',
    inviteRosterItems: "ul.invite-roster > li",
    inviteRosterRole: ".party-match-role",
    inviteRosterName: ".invite-roster-name",
    followLeaderDialog: '.party-invite.invite-card[aria-label="Seguir o líder da party"]',
    // v0.9.6 — auto convidar pra party via Lista de amigos. Confirmado ao
    // vivo em 08/09/2026 (huntera-automacao/CLAUDE.md tem o detalhe
    // completo da investigação, só-leitura, no Druid do André).
    friendsNavBtn: '#nav-friends[aria-label="Lista de amigos"]',
    friendsWindow: "section.friends-window",
    friendsSearchInput: 'input[aria-label="Buscar ou adicionar um personagem"]',
    friendsEntries: ".friends-groups .friends-entry",
    friendsEntryName: ".friends-name",
    friendsContextMenu: "div.context-menu.friends-context-menu",
    partyMemberNames: ".party-window .party-members .party-name",
    characterVocation: ".header-character-vocation",
    // v0.9.18 — CONFIRMADO AO VIVO em 10/09/2026 (Dezin Zemsta parado na
    // cidade, leitura de DOM sem clicar em "Sair do jogo"). O próprio botão
    // se descreve: "Sair do jogo — Volta para a lista de personagens, sua
    // conta continua conectada", ou seja, NÃO desloga a conta: é o caminho
    // permitido pela regra do projeto (troca de personagem dentro de uma
    // sessão já autenticada, sem nunca tocar em email/senha).
    // v0.9.23 — CONFIRMADO AO VIVO em 10/09/2026 (Dezin Zemsta caçando).
    // `.hud-exp` traz o XP ABSOLUTO no title: "Experiência 1.827.258/6.716.200"
    // (atual/necessário pro próximo level) — é o que permite calcular XP/h de
    // verdade, em vez de estimar pela barra de progresso.
    hudExp: ".hud-exp",
    // Analisador de caçada do jogo (recurso premium). Não tem botão de fechar:
    // só `.analyzer-minimize` (alterna Expandir/Minimizar) e a própria section
    // ganha a classe `minimized`. Também tem `.analyzer-locked-buy`
    // ("Assinar Premium"), que é o CTA mostrado pra conta free.
    huntAnalyzerWindow: "section.hunt-analyzer-window",
    analyzerMinimizeBtn: "button.analyzer-minimize",
    // v0.11.8 — TREINO. Tudo CONFIRMADO AO VIVO em 12/09/2026 (Dezin Zemsta
    // parado na cidade; cliquei "Iniciar treino" de verdade e cancelei
    // depois). Caminho: `#nav-start-hunt` → aba "Treino" → skill → botão do
    // bloco "Treino online".
    startHuntNavBtn: "#nav-start-hunt",
    huntTabButtons: "button.hunt-tab",
    trainSkillButtons: "button.train-skill",
    // ⚠️ ARMADILHA: existem QUATRO `button.train-start` na aba, nesta ordem —
    // "Comprar na store", "Loja da cidade", "Iniciar treino" e "Treinar
    // offline". Pegar pela classe traz o de comprar na store. Sempre casar
    // pelo TEXTO.
    trainStartButtons: "button.train-start",
    // Indicador de "está treinando": toast no topo da tela, que persiste e vai
    // progredindo ("Sword Fighting · 58% · próximo em ~12m"). O botão
    // "Cancelar" dele NÃO tem classe nenhuma — casar por texto dentro do
    // próprio toast. A classe `.pending-toast` é do sistema de toasts, não do
    // treino: não serve de âncora.
    systemToast: ".system-toast",
    trainingSkillLabel: ".training-skill",
    trainingProgressLabel: ".training-progress",
    // v0.11.12 — painel de expedição da guild. Fica `hidden` sem guild. É a
    // ÚNICA fonte das criaturas-alvo de cada objetivo: o tipo 33 do protocolo
    // traz rótulo, quota e progresso, mas não diz quais bichos contam.
    expeditionTracker: ".expedition-tracker",
    optionsNavBtn: 'button.nav-labeled[aria-label="Opções"]',
    optionsMenu: "section.options-menu",
    optionsExitBtn: "button.options-exit",
    optionsCloseBtn: 'button[aria-label="Fechar opções"]',
    targetStrategySelect: 'select.hud-target-strategy[aria-label="Estratégia de alvo"]',
    hotbarSlots: "button.hud-slot[data-action-slot]",
    hotbarSpellIcon: "img.action-spell-icon",
    actionEditor: "div.action-editor",
    actionChoiceButtons: "button.action-choice",
    actionFriendModeSelect: 'select.action-friend-mode[aria-label="Alvo da cura"]',
    actionSaveBtn: "button.action-save",
    actionCloseBtn: "button.action-close",
  };

  // Fica pra referência de quem for montar o <select> de tier no host — os
  // tiers de verdade de cada caçada são lidos ao vivo (peekHuntTiers), isso
  // aqui é só a lista conhecida de nomes possíveis no jogo.
  const PULL_LEVELS = ["Cautious", "Bold", "Reckless", "Suicidal"];
  const DEFAULT_STATE = {
    huntName: "",
    pullLevel: "Reckless",
    capacityThreshold: 100,
    // v0.5.0 — cada personagem tem até 12h (720min) de stamina, que só
    // esgota caçando e recarrega enquanto fora de caçada. O jogo tira o
    // personagem sozinho da caçada quando a stamina zera; sem esse limiar,
    // o monitor tentava re-entrar imediatamente (com 0 de stamina) a cada
    // tick de 4s, entrando e saindo sem sentido. 60min = espera acumular
    // pelo menos 1h de stamina antes de voltar a caçar.
    staminaResumeThreshold: 60,
    // v0.9.32 — "esperar a stamina encher" virou uma AÇÃO que se liga e
    // desliga, igual ao rodízio de personagens (André: "são ações separadas
    // dentro do Rotina"). Antes era comportamento fixo, e a única forma de
    // "desligar" era zerar o limiar — que é justamente o valor que recria o
    // bug de entrar/sair da caçada com 0 de stamina. Ligada por padrão pra
    // não mudar o comportamento de quem já usa.
    staminaWaitEnabled: true,
    // v0.11.8 — TREINO (aba própria no painel). Duas condições independentes,
    // cada uma com o seu liga/desliga, no mesmo espírito da aba Rotina. A
    // skill é FIXA POR PERSONAGEM (decisão do André, 12/09/2026): a mesma
    // conta pode ter EK e ED, e treinar Magic Level num knight seria burrice.
    trainOnStaminaZero: false,
    trainOnIdleInCity: false,
    trainIdleMinutes: 15,
    trainSkillByCharacter: {}, // { "dezin zemsta": "Sword Fighting" }
    // v0.11.12 — expedição da guild. Quando ligada, ela MANDA na escolha da
    // caçada (decisão do André: "a expedição vira uma prioridade e ele
    // executa"), sempre no tier mais difícil e só no modo Solo.
    expeditionEnabled: false,
    // v0.13.0 — Auto Bestiary por fase (Ladder). Lista ORDENADA por
    // prioridade (o André escolhe a ordem ao montar); cada item tem a
    // caçada a rodar, a criatura-alvo dentro dela (default = mesmo nome da
    // caçada) e até qual fase do Bestiary farmar (1, 2, 3...) antes de
    // passar pro próximo item. Ao contrário da expedição, o Ladder só
    // decide a caçada quando NÃO há expedição ativa (`alvoDeCacada`) — são
    // features que ainda não foram reconciliadas, mesma pendência que já
    // existe no huntera-automacao pra Escada/Auto Bestiary.
    bestiaryLadder: {
      enabled: false,
      index: 0,
      // { hunt: "Adult Goanna", criatura: "Adult Goanna", faseAlvo: 2, concluido: false }
      itens: [],
    },
    // v0.11.9 — depois de uma queda (server save), religar a automação sozinha
    // se tiver sido ELA que se desligou por erros. Ligado por padrão: é
    // justamente o furo que o André reportou ("garantir que a caçada retorne
    // depois do server save").
    autoRestartAfterOutage: true,
    // Carimbo de "eu me desliguei sozinha" (0 = foi o usuário que desligou).
    selfStoppedAt: 0,
    // v0.7.0 — Party (portadas do huntera-automacao, confirmadas "funcionando
    // de forma adequada" lá antes do porte, ver CLAUDE.md daquele projeto).
    autoAcceptParty: false,
    autoAcceptPartyAllowlist: [],
    syncEkTarget: false,
    autoKeepCurrentTarget: false,
    // v0.8.0 — auto retomar sessão (ver CLAUDE.md do huntera-automacao pra
    // todo o histórico da revisão da regra "nunca automatizar login" que
    // abriu espaço pra essa exceção estreita: só clica "Jogar" numa sessão
    // JÁ AUTENTICADA na tela de seleção de personagem, nunca em
    // email/senha/"Trocar de conta"/"Sair da conta").
    // v0.11.20 — o log do protocolo agora SOBREVIVE a um reinício. Eu tinha
    // deixado de propósito sem salvar, argumentando que gravar ~20 msg/s não
    // devia continuar por esquecimento. O André apontou o furo do outro lado,
    // que é pior: se o app reinicia no meio de uma investigação (server save,
    // atualização, queda), a gravação para em silêncio e ele só descobre
    // depois. Com a chave salva, ela volta sozinha.
    //
    // O que NÃO sobrevive é o buffer: ele vive na memória da aba. Persistir a
    // chave limita a perda ao tempo parado, não a elimina.
    diagEnabled: false,
    autoResumeSessionEnabled: false,
    autoResumeSessionCharacter: "",
    // v0.9.3 — André: "ao abrir o app, pode logar as contas autenticadas
    // nos personagens de ultimo login". `autoResumeSessionEnabled`/
    // `autoResumeSessionCharacter` passam a ser preenchidos sozinhos pelo
    // `startCharacterNameWatcher()` (ver mais abaixo) assim que um
    // personagem loga de verdade nessa conta — sem precisar abrir o painel
    // e configurar na mão. Esta flag é o "freio de mão": só fica `true`
    // quando o ANDRÉ desliga o toggle manualmente na tela (nunca setada
    // sozinha), e enquanto estiver `true` o preenchimento automático para
    // de ligar o toggle dessa conta de novo — repeita a decisão dele até
    // ele ligar de novo manualmente.
    autoResumeSessionManuallyDisabled: false,
    // v0.9.6 — André: "eu quero uma feature de convidar pt para ir para
    // caçada no multi hunt... o principal da PT poderia ser classificado.
    // inclusive poderiamos ter um auto convite também da Party". Escolhido
    // via AskUserQuestion: gatilho totalmente automático, líder marcado
    // manualmente por conta, dois toggles separados (Party / Caçada em
    // Grupo — este último ainda não implementado, sem como confirmar os
    // seletores de envio com o André em party no momento).
    isPartyLeader: false,
    autoInvitePartyEnabled: false,
    autoInvitePartyTargets: [],
    // v0.9.9 — "Modo de caçada": André, depois de ver a v0.9.8 (toggle
    // avulso "Sincronizar venda de loot em grupo"), pediu pra separar de
    // vez: "ligar automação não pode estar linkado direto com a caçada
    // solo... devemos ter uma funcionalidade caçada solo e caçada em grupo
    // para que as coisas funcionem independentes sem conflitos". Decisão
    // confirmada via AskUserQuestion: um seletor único por conta (nunca os
    // dois modos ao mesmo tempo), e no modo "group" a automação NUNCA
    // inicia uma caçada sozinha — só entra por convite aceito ou entrada
    // manual, e a partir daí cuida do ciclo sair/vender/sincronizar/retomar
    // (ver `monitorTick`/`runSellAndReturnCycle`/`checkGroupHuntTeamReady`
    // em renderer.js). "solo" = comportamento de sempre (auto inicia,
    // monitora, retoma sozinha). Precisa estar em "group" em TODAS as
    // contas do time (líder + membros) pra sincronização funcionar.
    huntMode: "solo", // "solo" | "group"
    // v0.9.15 — André: "ter uma função para ficar detectando que o boneco
    // saiu da hunt e vender... quando está em PT deveria ter um botão tipo:
    // sempre vender quando for para cidade... pq a PT sempre sai da hunt
    // quando acaba a cap de alguém e todos deveriam vender para ficarem mais
    // ou menos próximos". Ligado por padrão de propósito: sem isso, quem cai
    // da caçada por causa da capacidade de OUTRO membro (ou por stamina
    // zerada) nunca vendia — e, no modo grupo, nunca reportava "já vendi",
    // travando a sincronização do time inteiro.
    autoSellOnCityArrival: true,
    // v0.9.18 — André: "trocar de personagem para gastar toda a stamina do
    // outro personagem e seguir na mesma caçada... desloga o personagem A e
    // loga no B e vai até finalizar stamina". "Deslogar" aqui é o "Sair do
    // jogo" do próprio jogo (volta pra lista de personagens, conta segue
    // conectada) — nunca mexe em email/senha, então continua dentro da
    // regra fixa nº 1 do projeto.
    rotateCharactersEnabled: false,
    rotateCharacters: [], // quem participa do rodízio (na ordem da conta)
    // v0.9.20 — André: "o próprio app poderia checar o nome dos personagens
    // que existem na conta e deixar um checkbox de ciclo". Os personagens da
    // conta só existem no DOM na TELA DE SELEÇÃO, então a lista é capturada
    // sempre que essa tela aparece (o que já acontece sozinho: no login, num
    // server save e a cada troca do rodízio) e fica guardada aqui pro painel
    // conseguir montar os checkboxes mesmo com o jogo já aberto.
    knownCharacters: [],
    // v0.9.23 — minimizar o "Analisador de caçada" do jogo assim que ele
    // aparecer. Ligado por padrão a pedido do André ("fechar sempre").
    minimizeGameAnalyzer: true,
    rotateMinStaminaMinutes: 5, // abaixo disso, considera "stamina acabou"
    running: false,
    cycles: 0,
    log: [],
  };

  let running = false;
  let isBusy = false;
  // v0.11.0 — "dias de uso" (Swag). Começa FALSO de propósito (fail-closed):
  // até a primeira resposta de `swag:getStatus` chegar do main.js, nenhuma
  // ação real acontece. `startLicenseWatcher()` (chamado no boot) mantém isso
  // atualizado sem nenhuma chamada de rede daqui — só um `ipcRenderer.invoke`
  // pro main.js, que é quem já fala com o Supabase (mesmo motivo de o
  // Telegram passar por lá: fetch() daqui ficaria sujeito à CSP do jogo).
  let licensed = false;
  let licensePollTimer = null;
  let consecutiveErrors = 0;
  let observer = null;
  let pollTimer = null;
  let currentHuntNameCache = null;
  // v0.9.31 — "estou esperando o jogo terminar de carregar" (ver
  // `isGameUiReady`). Guardado pra logar/atualizar o status UMA vez por
  // espera, em vez de a cada tick de 4s.
  let waitingForGameUi = false;
  // Desde quando o HUD está na tela. O jogo monta o HUD em pedaços, então
  // "achei a barra do personagem" não garante que o botão "Sair da caçada" já
  // foi desenhado — antes de INICIAR uma caçada, espera o HUD assentar.
  let gameUiReadySince = 0;
  let logEntries = [];
  let statusText = "Parado";
  // v0.7.0 — timers dos 3 watchers de Party, independentes do "Ligar
  // automação" (igual na extensão Chrome — fazem sentido mesmo com o bot
  // principal desligado, é conveniência social, não farm). "Último convite
  // ignorado"/"último roster sincronizado" evitam logar/tentar de novo a
  // cada tick enquanto o mesmo diálogo continua na tela.
  let partyInvitePollTimer = null;
  let ekSyncPollTimer = null;
  let followLeaderPollTimer = null;
  let resumeSessionPollTimer = null;
  // v0.11.14 — espera crescente entre tentativas de "Jogar" que não pegaram.
  // Sem teto de tentativas de propósito: um server save pode levar horas (o
  // André avisou), e desistir de vez recriaria o bug que essa feature resolve.
  const RESUME_BACKOFF_MS = [30000, 60000, 3 * 60000, 5 * 60000, 10 * 60000];
  let resumeFalhas = 0;
  let resumeProximaTentativaEm = 0;
  // Os dois watchers da tela de personagem rodam no mesmo intervalo. Sem este
  // cache curtíssimo, ambos faziam a mesma consulta de visibilidade no DOM em
  // cada volta; ele não é uma fonte de estado e expira antes do próximo tick.
  let listaPersonagensVisivelCache = { em: 0, visivel: false };
  const LISTA_PERSONAGENS_CACHE_MS = 1000;
  let characterNamePollTimer = null;
  let autoInvitePartyPollTimer = null;
  let lastReportedCharacterName = null;
  // v0.9.22 — nome + vocação + level juntos: é o que decide se vale reportar.
  let lastReportedCharacterSignature = null;
  let lastSkippedInviteMsg = null;
  let lastSkippedGroupHuntMsg = null;
  let lastSyncedRosterKey = null;
  // v0.9.8/v0.9.9 — sincronizar venda de loot em grupo (ver DEFAULT_STATE.huntMode).
  let isAwaitingGroupHuntSync = false;
  let groupHuntSyncStatus = null; // null | "leaderWaitingTeam" | "memberWaitingInvite"
  let pendingGroupHuntName = null;
  // v0.9.15 — trava da venda automática ao chegar na cidade: garante UMA
  // venda por ida à cidade (zera assim que o personagem volta a caçar).
  let soldSinceArrivingInCity = false;
  // v0.9.15 — watchdog da sincronização em grupo. Sem isso, qualquer coisa
  // que impeça o comando `resumeGroupHunt` de chegar (conta fechada, membro
  // que nunca reportou, app recarregado) deixa a conta parada PRA SEMPRE em
  // "Aguardando o time"/"Aguardando convite", sem log nenhum.
  let awaitingGroupHuntSyncSince = 0;
  const GROUP_SYNC_TIMEOUT_MS = 5 * 60 * 1000;
  // v0.9.31 — folga entre "o HUD apareceu" e "posso decidir iniciar uma
  // caçada" (ver `gameUiReadySince`). Menos que um tick do monitor (4s).
  const GAME_UI_SETTLE_MS = 3000;
  // v0.9.15 — se o comando `resumeGroupHunt` chegar enquanto a conta está
  // ocupada (`isBusy`), antes ele era DESCARTADO em silêncio e o time travava
  // de vez, porque o host só reenvia quando chega estado novo. Agora fica
  // pendente e é executado assim que a trava liberar.
  let pendingResumeGroupHunt = false;
  // v0.9.16 — varredura do catálogo completo de caçadas em andamento.
  let catalogSweepRequested = false;
  let citySellPollTimer = null;
  // v0.11.8 — treino. `cityIdleSince` é o cronômetro da condição "parado na
  // cidade há X minutos": zera em qualquer coisa que não seja estar parado na
  // cidade sem treinar (caçando, treinando, na lista de personagens, jogo
  // carregando).
  let trainingPollTimer = null;
  let cityIdleSince = 0;
  let lastNoTrainSkillLogAt = 0;
  // v0.11.9 — server save / queda do servidor. `selfStoppedAt` marca que foi a
  // AUTOMAÇÃO que se desligou (3 erros seguidos), não o André — é o que
  // permite religar sozinha quando o jogo voltar. `selfRestarts` segura o
  // loop: se ela se desligar e religar sem parar, alguma coisa está quebrada
  // de verdade e insistir só piora.
  let lastOutageLogAt = 0;
  let selfRestarts = [];
  let restartPollTimer = null;
  // "A interface do jogo está de pé desde quando", medido pelo watcher de
  // religamento. Separado do `gameUiReadySince` do monitor de propósito: este
  // precisa zerar a cada queda pra contar a estabilidade DEPOIS dela.
  let uiUpSince = 0;
  // v0.11.14 — quando o socket do jogo caiu. 0 = está de pé (ou não sabemos).
  let servidorCaiuEm = 0;
  // v0.11.10 — detector de spawn seco. `spawnCfg` vem do processo principal
  // (config GLOBAL, spawn.json), atualizada de tempos em tempos igual à
  // licença. `spawnReentradas` só serve pro histórico não repetir mensagem.
  let spawnCfg = { enabled: false, minSeconds: 90, factor: 4 };
  let spawnPollTimer = null;
  let spawnUltimaReentradaEm = 0;
  // v0.9.23 — analyzer próprio do bot. Tudo aqui sai de coisa que a automação
  // já observa (venda, level, XP do HUD) — nada de destravar o analisador
  // premium do jogo, que é recurso pago.
  //
  // `sessionId` muda a cada boot/troca de personagem: é o que deixa o host
  // somar deltas com segurança em vez de somar totais duas vezes.
  let stats = null;
  let analyzerMinimizedOnce = false;
  let analyzerPollTimer = null;

  function novaSessaoStats(motivo) {
    const xp = getExperience();
    stats = {
      sessionId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: Date.now(),
      motivo,
      cycles: 0,
      gold: 0,
      xp: 0,
      levelStart: getActiveCharacterLevel(),
      levelNow: getActiveCharacterLevel(),
      lastXp: xp,
    };
    // v0.11.11 — o acumulado de loot/custo é da SESSÃO, igual ao xp e aos
    // ciclos. As tabelas de preço não zeram: são do jogo, não da sessão.
    economiaZerar();
  }

  // Chamado pelo watcher do personagem (a cada 3s) — acumula o XP ganho.
  // Na virada de level, soma o que faltava pro level antigo mais o que já
  // entrou no novo, senão o delta daria negativo e o ganho se perderia.
  function acumularXp() {
    if (!stats) return;
    const xp = getExperience();
    const level = getActiveCharacterLevel();
    if (!xp) return;
    const antes = stats.lastXp;
    if (antes) {
      if (level != null && stats.levelNow != null && level > stats.levelNow) {
        stats.xp += Math.max(0, antes.necessario - antes.atual) + Math.max(0, xp.atual);
      } else if (xp.atual >= antes.atual) {
        stats.xp += xp.atual - antes.atual;
      }
      // xp.atual < antes.atual sem subir de level = morreu (perdeu XP) ou o
      // jogo recalculou: não desconta nem inventa, só re-ancora.
    }
    stats.lastXp = xp;
    if (level != null) stats.levelNow = level;
    if (stats.levelStart == null) stats.levelStart = level;
  }

  function statsParaEnvio() {
    if (!stats) return null;
    return {
      sessionId: stats.sessionId,
      startedAt: stats.startedAt,
      elapsedMs: Date.now() - stats.startedAt,
      cycles: stats.cycles,
      gold: stats.gold,
      xp: stats.xp,
      levelStart: stats.levelStart,
      levelNow: stats.levelNow,
      levelsGanhos: stats.levelStart != null && stats.levelNow != null ? Math.max(0, stats.levelNow - stats.levelStart) : 0,
      // v0.11.11 — analisador próprio, vindo do protocolo (funciona em conta
      // free, diferente do analisador premium do jogo).
      economia: economiaParaEnvio(),
    };
  }

  // v0.11.15 — reavalia uma lista do tipo 41 a preço de LEILÃO.
  //
  // Isto é o que o analisador do jogo NÃO faz e foi o pedido original do
  // André: o `value` que vem no tipo 41 é preço de NPC (confirmado item a item
  // em 14/09/2026 — protection amulet 100 no NPC × 1.600 no leilão). Com a
  // tabela do tipo 57 dá pra mostrar quanto o mesmo loot valeria vendido no
  // leilão, que é o número que diz o que NÃO vale a pena pôr na venda rápida.
  //
  // Item sem preço de leilão não é "vale zero": é "não tem mercado", então
  // vale o NPC mesmo — usar 0 aqui faria o total de leilão parecer pior que o
  // de NPC sem motivo.
  function revalorarNoLeilao(lista) {
    let total = 0;
    let semPreco = 0;
    for (const it of lista || []) {
      const unit = economia.precoLeilao.get(it.itemId);
      if (typeof unit === "number") total += unit * (Number(it.count) || 0);
      else {
        total += Number(it.value) || 0;
        semPreco++;
      }
    }
    return { total, semPreco };
  }

  function economiaParaEnvio() {
    const temPrecos = economia.precoNpc.size > 0;
    const s = economia.sessao;

    if (s) {
      // ---- FONTE PRINCIPAL: o analisador do próprio jogo, pelo socket ----
      const duracaoMs = Number(s.durationMs) || 0;
      const horas = duracaoMs > 0 ? duracaoMs / 3600000 : 0;
      const lootValue = Number(s.lootValue) || 0;
      const waste = Number(s.waste) || 0;
      const { total: valorLeilao, semPreco } = revalorarNoLeilao(s.loot);

      const itens = (s.loot || [])
        .map((it) => {
          const unitLeilao = economia.precoLeilao.get(it.itemId);
          return {
            itemId: it.itemId,
            nome: it.name || `#${it.itemId}`,
            qtd: Number(it.count) || 0,
            // O painel espera preço UNITÁRIO; o tipo 41 manda o total do
            // acumulado. Dividir aqui evita que o painel tenha que saber disso.
            npc: it.count ? Math.round((Number(it.value) || 0) / it.count) : null,
            leilao: typeof unitLeilao === "number" ? unitLeilao : null,
          };
        })
        .sort((a, b) => (b.npc || 0) * b.qtd - (a.npc || 0) * a.qtd);

      const custos = (s.supplies || [])
        .map((it) => ({
          valorUnitario: it.count ? Math.round((Number(it.value) || 0) / it.count) : Number(it.value) || 0,
          vezes: Number(it.count) || 0,
          total: Number(it.value) || 0,
          nome: it.name || null, // aqui o NOME vem do servidor — nada de inferir pelo preço
        }))
        .sort((a, b) => b.total - a.total);

      return {
        temPrecos,
        escutaAtiva: spawnWatch.ativo && spawnWatch.mensagens > 0,
        // Quem lê o painel precisa saber de onde veio o número.
        fonte: "protocolo",
        resumo: {
          duracaoMs,
          kills: Number(s.kills) || 0,
          xp: Number(s.experience) || 0,
          custo: waste + economia.custoDesgaste,
          lucro: lootValue - waste - economia.custoDesgaste,
          xpHora: horas > 0 ? Math.round((Number(s.experience) || 0) / horas) : null,
          lucroHora: horas > 0 ? Math.round((lootValue - waste - economia.custoDesgaste) / horas) : null,
          vendas: economia.vendas,
          goldVendido: economia.goldVendido,
        },
        sessao: {
          duracaoMs,
          kills: Number(s.kills) || 0,
          experience: Number(s.experience) || 0,
          rawExperience: Number(s.rawExperience) || 0,
          itensSemPrecoLeilao: semPreco,
          porHora: horas > 0 ? {
            exp: Math.round((Number(s.experience) || 0) / horas),
            kills: Math.round((Number(s.kills) || 0) / horas),
            loot: Math.round(lootValue / horas),
            gasto: Math.round(waste / horas),
            saldo: Math.round((lootValue - waste) / horas),
            saldoLeilao: Math.round((valorLeilao - waste) / horas),
          } : null,
        },
        desgaste: [...economia.desgaste.entries()].map(([nome, r]) => ({ nome, qtd: r.qtd })),
        custoDesgaste: economia.custoDesgaste,
        itens: itens.slice(0, 25),
        valorNpc: lootValue,
        valorLeilao,
        custoTotal: waste,
        custos: custos.slice(0, 12),
        saldoNpc: lootValue - waste,
        saldoLeilao: valorLeilao - waste,
      };
    }

    // ---- CONTA FREE: reconstruir por delta de gold (v0.11.11) ----
    //
    // ✅ CONFIRMADO EM 14/09/2026, não é mais hipótese: a conta free NÃO
    // recebe o tipo 41. O André rodou numa conta free, com um ciclo completo
    // de caçada e venda, e o painel seguiu na reconstrução por gold. A trava
    // do analisador premium é no SERVIDOR, não só na interface.
    //
    // Ou seja, este caminho não é provisório — é o analisador oficial de quem
    // joga de graça, e é o único lugar onde essas contas veem custo e saldo.
    // Tratar como código de segunda seria abandonar metade dos usuários.
    let valorNpc = 0;
    let valorLeilao = 0;
    let itensSemPreco = 0;
    const itens = [];
    for (const [itemId, info] of economia.loot) {
      // v0.11.18 — GOLD COIN não está na tabela de venda do NPC (não se vende
      // gold pro NPC), então ele caía fora da conta inteira: no painel do
      // André apareceu "gold coin ×250" valendo "—", somando ZERO. Moeda vale
      // o próprio número — e isso não é chute meu: na captura de 14/09 o tipo
      // 41 traz `{itemId:3031, name:"gold coin", count:38361, value:38361}`,
      // valor idêntico à quantidade.
      const npc = itemId === GOLD_COIN_ITEM_ID ? 1 : economia.precoNpc.get(itemId);
      const leilao = economia.precoLeilao.get(itemId);
      if (typeof npc === "number") valorNpc += npc * info.qtd;
      // Contar item sem preço como zero em SILÊNCIO é o pior dos mundos: o
      // total fica menor e nada avisa. Agora o painel diz quantos ficaram de
      // fora.
      else itensSemPreco++;
      // Item sem preço de leilão não tem mercado: vale o NPC mesmo.
      valorLeilao += (typeof leilao === "number" ? leilao : typeof npc === "number" ? npc : 0) * info.qtd;
      itens.push({ itemId, nome: info.nome || economia.nomePorItemId.get(itemId) || `#${itemId}`, qtd: info.qtd, npc, leilao });
    }
    itens.sort((a, b) => (b.npc || 0) * b.qtd - (a.npc || 0) * a.qtd);

    const custos = [];
    for (const [valor, vezes] of economia.custoPorValor) {
      const id = itemPorPrecoNpc(valor);
      custos.push({
        valorUnitario: valor,
        vezes,
        total: valor * vezes,
        nome: id != null ? economia.nomePorItemId.get(id) || null : null,
      });
    }
    custos.sort((a, b) => b.total - a.total);

    return {
      // `temPrecos` é o sinal de saúde: se as tabelas não chegaram, o painel
      // mostra "sem dados" em vez de fingir que o custo é zero.
      temPrecos,
      escutaAtiva: spawnWatch.ativo && spawnWatch.mensagens > 0,
      fonte: "gold",
      sessao: null,
      // v0.11.21 — a conta free passa a ter o MESMO resumo. Tudo aqui vem de
      // mensagem que ela comprovadamente recebe: mortes do tipo 9, XP do 77,
      // custo dos débitos de gold, loot do 60 com a tabela do 57.
      resumo: (() => {
        const duracaoMs = economia.inicio ? Date.now() - economia.inicio : 0;
        const horas = duracaoMs > 0 ? duracaoMs / 3600000 : 0;
        const lucro = valorNpc - economia.custoTotal - economia.custoDesgaste;
        return {
          duracaoMs,
          kills: economia.kills,
          xp: economia.xp,
          custo: economia.custoTotal + economia.custoDesgaste,
          lucro,
          xpHora: horas > 0 ? Math.round(economia.xp / horas) : null,
          lucroHora: horas > 0 ? Math.round(lucro / horas) : null,
          vendas: economia.vendas,
          goldVendido: economia.goldVendido,
          // v0.11.24 — diagnóstico do próprio analisador. "Tudo zero" tem duas
          // causas possíveis e indistinguíveis na tela: a sessão acabou de
          // começar, ou ela está sendo zerada de novo a cada instante. Estes
          // três números separam uma da outra.
          sessaoIniciadaEm: economia.inicio,
          mensagensDoProtocolo: spawnWatch.mensagens,
          amostrasDeXp: economia.ultimoXp ? 1 : 0,
        };
      })(),
      itensSemPreco,
      desgaste: [...economia.desgaste.entries()].map(([nome, r]) => ({ nome, qtd: r.qtd })),
      custoDesgaste: economia.custoDesgaste,
      itens: itens.slice(0, 25),
      valorNpc,
      valorLeilao,
      custoTotal: economia.custoTotal,
      custos: custos.slice(0, 12),
      saldoNpc: valorNpc - economia.custoTotal,
      saldoLeilao: valorLeilao - economia.custoTotal,
    };
  }
  // v0.9.18 — quantas trocas de personagem aconteceram sem ninguém conseguir
  // caçar de verdade. Sem isso, com TODO MUNDO sem stamina o rodízio viraria
  // um carrossel infinito de sair/entrar. Zera assim que alguém volta a caçar.
  let rotationsWithoutHunt = 0;
  // v0.5.0 — o monitor roda a cada 4s (pollTimer); sem isso, esperar
  // stamina regenerar geraria um log novo a cada 4s até bater o limiar.
  let lastStaminaLogAt = 0;
  const STAMINA_LOG_INTERVAL_MS = 5 * 60 * 1000; // loga de novo no máximo a cada 5min enquanto espera
  // v0.9.14 — mesmo tratamento pro aviso de "líder em modo grupo sem caçada
  // configurada": o monitor roda a cada 4s, sem throttle isso viraria spam.
  let lastNoHuntConfiguredLogAt = 0;

  // ---------- storage: localStorage da própria conta (já isolado) ----------

  // v0.12.1 — CACHE DO ESTADO EM MEMÓRIA.
  //
  // André reportou travada na máquina dele, e outros usuários idem. Medindo o
  // código (não chutando): `loadState()` é chamado em 25 lugares, vários deles
  // dentro de timers de 1,2s / 1,5s / 4s. Cada chamada era
  // `localStorage.getItem` + `JSON.parse` do blob INTEIRO do estado — e esse
  // blob carrega as 120 linhas de log dentro dele. `localStorage` é SÍNCRONO e
  // vai pro disco, e isso rodava na MESMA thread que desenha o jogo, dentro do
  // processo do webview. Ou seja: a automação engasgava o render do jogo.
  //
  // O cache é seguro porque nesta partição existe UM único escritor desta
  // chave: todo `setItem` passa por `saveState()` aqui. Comando vindo do painel
  // do host chega por IPC e também cai aqui. Ainda assim o evento `storage`
  // invalida o cache, caso algum dia apareça outro contexto escrevendo — custa
  // nada e evita um bug silencioso de estado velho.
  //
  // Devolve CÓPIA RASA de propósito: hoje cada chamada devolvia um objeto novo,
  // e passar a devolver a mesma referência mudaria a semântica em silêncio se
  // algum chamador mutasse o resultado. Conferido que ninguém muta hoje, mas a
  // cópia custa um spread de ~20 chaves contra um parse de dezenas de KB — o
  // barato aqui é manter a garantia.
  let estadoCache = null;
  try {
    window.addEventListener("storage", (e) => {
      if (!e || e.key === null || e.key === STORAGE_KEY) estadoCache = null;
    });
  } catch (err) {
    // sem window (teste em sandbox) — o cache segue valendo, só não invalida
  }

  function loadState() {
    if (estadoCache) return { ...estadoCache };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        estadoCache = { ...DEFAULT_STATE };
        return { ...estadoCache };
      }
      const parsed = JSON.parse(raw);
      const merged = { ...DEFAULT_STATE, ...parsed };
      // v0.9.9 — migração do toggle "Sincronizar venda de loot em grupo"
      // (v0.9.8, meio-dia de vida útil) pro "Modo de caçada" novo. André:
      // "ligar automação não pode estar linkado direto com a caçada solo...
      // devemos ter uma funcionalidade caçada solo e caçada em grupo pra
      // funcionar independente sem conflitos" — virou um modo inteiro
      // (`huntMode: "solo"|"group"`) em vez de um toggle avulso.
      if (parsed.syncGroupHuntLoot === true && !parsed.huntMode) {
        merged.huntMode = "group";
      }
      delete merged.syncGroupHuntLoot;
      estadoCache = merged;
      return { ...merged };
    } catch (err) {
      return { ...DEFAULT_STATE };
    }
  }

  // Escreve o cache no disco AGORA. Separado de `saveState` porque a gravação
  // do log é adiada (ver `agendarGravacaoDoLog`) e precisa de um ponto único
  // de descarga — inclusive na saída da página.
  function gravarEstadoAgora() {
    if (!estadoCache) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(estadoCache));
    } catch (err) {
      // storage cheio/bloqueado — não trava a automação por causa disso
    }
  }

  function saveState(partial) {
    const next = { ...loadState(), ...partial };
    // Cache primeiro: mesmo se a escrita falhar (storage cheio), quem ler o
    // estado em seguida tem que ver o valor novo, não o antigo.
    estadoCache = next;
    gravarEstadoAgora();
    return { ...next };
  }

  // v0.12.1 — ESCRITA DO LOG EM LOTE.
  //
  // `log()` fazia `saveState({ log })` por LINHA: read + parse + stringify +
  // `setItem` síncrono do estado inteiro, com as 120 entradas dentro. São 95
  // pontos de log no arquivo. Era a gravação em disco mais frequente do app, e
  // acontecia na thread de render do jogo.
  //
  // Agora a linha nova entra no cache NA HORA (quem ler o estado no meio tempo
  // já vê o log atualizado — nada de leitura suja) e o disco recebe uma
  // gravação só por janela. Uma rajada de 10 logs seguidos vira 1 escrita em
  // vez de 10. O `pagehide` descarrega o que estiver pendente, então fechar o
  // app ou trocar de personagem não perde a última linha.
  const LOG_GRAVA_DEBOUNCE_MS = 1500;
  let logGravaTimer = null;

  function agendarGravacaoDoLog() {
    estadoCache = { ...loadState(), log: logEntries };
    if (logGravaTimer) return;
    logGravaTimer = setTimeout(() => {
      logGravaTimer = null;
      gravarEstadoAgora();
    }, LOG_GRAVA_DEBOUNCE_MS);
  }

  try {
    window.addEventListener("pagehide", () => {
      if (logGravaTimer) {
        clearTimeout(logGravaTimer);
        logGravaTimer = null;
      }
      gravarEstadoAgora();
    });
  } catch (err) {
    // sem window (teste em sandbox) — o lote ainda descarrega pelo timer
  }

  // ---------- cache do catálogo de caçadas (v0.9.0) ----------
  // Mesma ideia do huntera-automacao (chave "huntCatalog" no chrome.storage):
  // nomes de caçada raramente mudam, então ficam em cache "pra sempre" nessa
  // conta (localStorage já é isolado por conta/partição e sobrevive a
  // reiniciar o app) — só re-lê do DOM de verdade se for a primeira vez
  // dessa conta ou se o André pedir refresh manual (botão ↻). Isso evita
  // reabrir a janela de caçada no jogo toda vez que o painel de automação é
  // aberto, só pra popular o dropdown — pedido do André: "tudo tem que
  // funcionar de forma fluida".
  const HUNT_CATALOG_KEY = "hm_hunt_catalog_v1";

  function loadHuntCatalog() {
    try {
      const raw = localStorage.getItem(HUNT_CATALOG_KEY);
      if (!raw) return { names: [], tiersByHunt: {} };
      const parsed = JSON.parse(raw);
      return { names: parsed.names || [], tiersByHunt: parsed.tiersByHunt || {} };
    } catch (err) {
      return { names: [], tiersByHunt: {} };
    }
  }

  function saveHuntCatalogNames(names) {
    const catalog = loadHuntCatalog();
    catalog.names = names;
    catalog.namesFetchedAt = Date.now();
    try {
      localStorage.setItem(HUNT_CATALOG_KEY, JSON.stringify(catalog));
    } catch (err) {
      // storage cheio/bloqueado — não trava a automação por causa disso
    }
  }

  // v0.9.16 — o catálogo de caçadas (nomes + tamanhos de pull) é do JOGO, não
  // da conta: "Dragon Lair" tem os mesmos tiers em qualquer personagem. Antes
  // cada conta mantinha a própria cópia no localStorage da sua partição, o
  // que significava remapear tudo de novo em cada conta (e perder tudo se a
  // partição fosse limpa). Agora o host guarda em disco (userData) e semeia
  // cada conta com essa cópia — aqui é só receber e mesclar.
  function seedCatalogFromHost(payload) {
    if (!payload) return;
    const catalog = loadHuntCatalog();
    const names = Array.isArray(payload.names) && payload.names.length ? payload.names : catalog.names;
    const tiersByHunt = { ...(payload.tiersByHunt || {}), ...catalog.tiersByHunt };
    // O que a conta já leu ao vivo tem prioridade sobre o que veio do disco
    // (é mais recente por definição), mas o disco preenche todos os buracos.
    for (const [hunt, tiers] of Object.entries(payload.tiersByHunt || {})) {
      if (!catalog.tiersByHunt[hunt] || !catalog.tiersByHunt[hunt].length) {
        tiersByHunt[hunt] = tiers;
      }
    }
    try {
      localStorage.setItem(
        HUNT_CATALOG_KEY,
        JSON.stringify({ ...catalog, names, tiersByHunt })
      );
    } catch (err) {
      // storage cheio/bloqueado — segue com o que tinha
    }
    sendState({ huntNames: names });
  }

  function saveHuntCatalogTiers(huntName, tiers) {
    const catalog = loadHuntCatalog();
    catalog.tiersByHunt = { ...catalog.tiersByHunt, [huntName]: tiers };
    try {
      localStorage.setItem(HUNT_CATALOG_KEY, JSON.stringify(catalog));
    } catch (err) {
      // storage cheio/bloqueado — não trava a automação por causa disso
    }
  }

  // ---------- reporta estado pro host (substitui o painel flutuante) ----------

  function sendState(extra) {
    const cfg = loadState();
    sendToHost("hm:state", {
      running,
      status: statusText,
      huntName: cfg.huntName,
      pullLevel: cfg.pullLevel,
      capacityThreshold: cfg.capacityThreshold,
      staminaResumeThreshold: cfg.staminaResumeThreshold,
      staminaWaitEnabled: cfg.staminaWaitEnabled !== false,
      // v0.11.8 — treino.
      autoRestartAfterOutage: cfg.autoRestartAfterOutage !== false,
      expeditionEnabled: !!cfg.expeditionEnabled,
      // v0.13.0 — Auto Bestiary por fase (Ladder). Manda pro painel cada item
      // já com `faseAtual`/`abatesAtuais` calculados (em vez de o painel
      // reimplementar `nomeParaChaveBestiario` do lado de cá) — mesmo
      // espírito do `expedicaoMapa`: o host só desenha o que já vem pronto.
      bestiaryLadder: (() => {
        const ladder = cfg.bestiaryLadder || { enabled: false, index: 0, itens: [] };
        // TASK-003-R2 — a entrada continua pinada numa CRIATURA DE
        // REFERÊNCIA (`it.criatura`, mesmo campo/mesma semântica de sempre —
        // é o que `bestiaryLadderFaseAtual`/`avaliarAvancoDoBestiaryLadder`
        // já usavam pra decidir progresso/conclusão, sem mudança nenhuma
        // aqui). O que muda é só INFORMATIVO: `criaturas` traz o progresso de
        // TODAS as criaturas mapeadas da caçada (não só a de referência),
        // pra a tela mostrar composição sem inventar uma regra de "conclusão
        // agregada" que não existe em lugar nenhum do protocolo/projeto —
        // ver nota extensa no CLAUDE.md sobre essa lacuna.
        const itens = (ladder.itens || []).map((it) => {
          const chave = nomeParaChaveBestiario(it.criatura || it.hunt);
          const huntCatalogo = guild.cacadas.find((h) => h && h.name === it.hunt);
          const nomesCriaturas = huntCatalogo && Array.isArray(huntCatalogo.monsters)
            ? huntCatalogo.monsters.map((m) => (m && m.name ? String(m.name) : "")).filter(Boolean)
            : it.criatura
              ? [it.criatura]
              : [];
          const criaturas = nomesCriaturas.map((nome) => {
            const chaveNome = nomeParaChaveBestiario(nome);
            return {
              nome,
              referencia: nome === (it.criatura || it.hunt),
              faseAtual: economia.bestiarioFases.get(chaveNome) || 0,
              abatesAtuais: economia.bestiario.get(chaveNome) ?? null,
            };
          });
          return {
            ...it,
            faseAtual: economia.bestiarioFases.get(chave) || 0,
            abatesAtuais: economia.bestiario.get(chave) ?? null,
            criaturas,
          };
        });
        const atual = bestiaryLadderItemAtual({ ...cfg, bestiaryLadder: { ...ladder, itens } });
        return {
          enabled: !!ladder.enabled,
          index: Number(ladder.index) || 0,
          itens,
          indiceAtual: atual ? atual.index : null,
        };
      })(),
      // TASK-003 — catálogo guiado (caçada → criaturas/tiers/força), pra a
      // tela de Bestiário parar de pedir nome de caçada/criatura digitado à
      // mão. Fonte: `guild.cacadas` (tipo 42, já chega pronto no login — ZERO
      // custo de DOM, é o mesmo dado que já alimenta `scrapeHuntNames`/
      // `requestTiers` da caçada solo). `forcaDaCacada` também já existe (é o
      // mesmo usado pra ordenar a Expedição pelo bicho mais fraco). `null`
      // só antes do tipo 42 chegar (raro — normalmente é questão de segundos
      // após o login); o painel decide o que mostrar nesse meio-tempo.
      bestiaryCatalogo: (() => {
        const doProtocolo = catalogoDoProtocolo();
        if (!doProtocolo) return null;
        return doProtocolo
          .map((h) => {
            if (!h || !h.name) return null;
            const criaturas = Array.isArray(h.monsters)
              ? h.monsters.map((m) => (m && m.name ? String(m.name) : "")).filter(Boolean)
              : [];
            const tiers = Array.isArray(h.tiers)
              ? h.tiers.map((t) => (t && t.name ? String(t.name) : "")).filter(Boolean)
              : [];
            return { hunt: String(h.name).trim(), criaturas, tiers, forca: forcaDaCacada(h) };
          })
          .filter(Boolean);
      })(),
      // v0.11.26 — o painel precisa poder mostrar QUAIS objetivos já têm o
      // mapa de criaturas. Sem isso, "ligado e parado" é indistinguível de
      // "ligado e funcionando".
      // v0.11.27 — o que o DOM realmente tem. Eu mandei o André "abrir o painel
      // de expedição", mas pelas notas do projeto o `.expedition-tracker` é um
      // elemento do HUD (some só sem guild), não um modal — então ele já devia
      // ter sido lido. Em vez de chutar por que veio vazio, o painel passa a
      // mostrar o que existe: se o elemento está na tela e quais rótulos ele
      // traz. Com isso a diferença entre "não achei o elemento" e "achei mas o
      // rótulo não bate" aparece na primeira olhada.
      expedicaoTracker: (() => {
        try {
          const tracker = document.querySelector(SEL.expeditionTracker);
          if (!tracker) return { presente: false, rotulos: [] };
          const rotulos = [];
          for (const row of tracker.querySelectorAll(".expedition-tracker-row")) {
            const r = row.querySelector(".expedition-tracker-label");
            const criaturas = [];
            for (const b of row.querySelectorAll("button[title]")) {
              const m = /Mostrar as caçadas onde (.+) aparece/.exec(b.getAttribute("title") || "");
              if (m) criaturas.push(m[1].trim());
            }
            rotulos.push({ rotulo: r ? r.textContent.trim() : null, criaturas });
          }
          return { presente: true, rotulos };
        } catch (err) {
          return null;
        }
      })(),
      expedicaoMapa: (() => {
        try {
          const ex = guild.expedicoes;
          if (!ex || !Array.isArray(ex.entries)) return null;
          const mapa = {};
          for (const e of ex.entries) {
            const c = criaturasDoObjetivo(e.label, e.familyId);
            mapa[e.label] = c.length ? { criaturas: c, fonte: fonteDasCriaturas(e.label, e.familyId) } : null;
          }
          return mapa;
        } catch (err) {
          return null;
        }
      })(),
      expedicoes: guild.expedicoes
        ? {
            endsAtMs: guild.expedicoes.endsAtMs,
            entries: (guild.expedicoes.entries || []).map((e) => ({
              label: e.label,
              progress: e.progress,
              quota: e.quota,
              concluido: Number(e.progress) >= Number(e.quota),
            })),
          }
        : null,
      trainOnStaminaZero: !!cfg.trainOnStaminaZero,
      trainOnIdleInCity: !!cfg.trainOnIdleInCity,
      trainIdleMinutes: cfg.trainIdleMinutes,
      trainSkillByCharacter: cfg.trainSkillByCharacter || {},
      training: isTraining(),
      // v0.11.10 — diagnóstico do detector (aparece no painel; também é o
      // jeito de perceber que a escuta do protocolo parou de funcionar).
      spawnEscutaAtiva: spawnWatch.ativo && spawnWatch.mensagens > 0,
      spawnMensagens: spawnWatch.mensagens,
      // v0.11.13 — três estados diferentes, e confundi-los é exatamente o que
      // escondeu a falha da v0.11.10: "pedi o gancho" (ativo), "o gancho rodou
      // na página" (marca no <html>) e "está chegando mensagem" (mensagens>0).
      spawnGanchoNaPagina: ganchoNaPaginaInstalado(),
      // v0.11.14 — estado da conexão direto do socket do jogo, e o resultado
      // da última volta na caçada.
      socketEstado: socketJogo.estado,
      servidorDePe: servidorDePe(),
      mortesNaVoltaAnterior: spawnWatch.mortesNaVoltaAnterior,
      // v0.11.16 — onde o personagem está, segundo o servidor.
      // v0.11.20 — estado vivo do detector de spawn seco, pro painel.
      spawnVivo: spawnWatch.ultimoSpawnEm
        ? {
            vivos: spawnWatch.vivos.size,
            paradoMs: Date.now() - spawnWatch.ultimoSpawnEm,
            tipicoMs: intervaloTipicoDeSpawn(),
            amostras: spawnWatch.intervalos.length,
            tilesNaVolta: spawnWatch.rastro.length,
            // v0.11.33 — os dois perfis aprendidos DESTA caçada.
            cacada: spawnWatch.perfilCenario,
            tilesAndados: spawnWatch.tilesDesdeMorte.size,
            tilesTipicos: tilesTipicos(),
            tilesLimiar: limiarDeTiles(),
            tilesSegundos: spawnWatch.ultimaMorteEm ? Math.round((Date.now() - spawnWatch.ultimaMorteEm) / 1000) : null,
            tilesMinSegundos: TILES_MIN_SEGUNDOS,
            tilesAmostras: spawnWatch.perfilTiles.length,
            tilesMinimo: TILES_MIN_AMOSTRAS,
            loteTipicoMs: loteTipicoMs(),
            loteLimiarMs: limiarDeLote(),
            loteAmostras: spawnWatch.perfilLotes.length,
            loteMinimo: LOTE_MIN_AMOSTRAS,
            mortesNaVoltaAnterior: spawnWatch.mortesNaVoltaAnterior,
            seguindoMeuId: spawnWatch.meuId != null,
          }
        : null,
      diagAtivo: diagnostico.ativo,
      diagMensagens: diagnostico.total,
      diagTipos: diagnostico.tipos.size,
      instanciaAtual: mundo.instanceId,
      cenarioAtual: mundo.scenarioId,
      trocasDeInstancia: mundo.trocasDeInstancia,
      // v0.11.17 — estado da caçada em grupo direto do servidor. O painel
      // deixa de precisar cruzar o que cada conta reporta pra saber se o time
      // está pronto: `arrived` de cada membro já responde isso.
      grupo: grupo.em
        ? {
            lider: grupo.lider,
            huntId: grupo.huntId,
            tier: grupo.tier,
            membros: grupo.membros,
            convitePendente: conviteDeGrupoPendente(),
            todosChegaram: grupo.membros.length > 0 && grupo.membros.every((m) => m && m.arrived === true),
            souLider: grupo.membros.some((m) => m && m.leader === true && m.name === getActiveCharacterName()),
          }
        : null,
      spawnVivos: spawnWatch.vivos.size,
      spawnSegundosSemNascer: spawnWatch.ultimoSpawnEm ? Math.round((Date.now() - spawnWatch.ultimoSpawnEm) / 1000) : null,
      trainingSkill: getTrainingSkill(),
      trainingProgress: getTrainingProgress(),
      staminaLeft: getStaminaRemainingMinutes(),
      cycles: cfg.cycles,
      log: logEntries,
      // v0.7.0 — campos de Party.
      autoAcceptParty: cfg.autoAcceptParty,
      autoAcceptPartyAllowlist: cfg.autoAcceptPartyAllowlist,
      syncEkTarget: cfg.syncEkTarget,
      autoKeepCurrentTarget: cfg.autoKeepCurrentTarget,
      // v0.8.0
      autoResumeSessionEnabled: cfg.autoResumeSessionEnabled,
      autoResumeSessionCharacter: cfg.autoResumeSessionCharacter,
      // v0.9.2 — André: "mostrar o nome do personagem logado e não Conta
      // 1, Conta 2". `null` enquanto estiver na tela de seleção/login (o
      // header só existe dentro do jogo).
      characterName: getActiveCharacterName(),
      // v0.9.24 — André: "os dois personagens estão em PT... se está caçando
      // em PT está caçando e não mostrar que está com automação desligada".
      // O painel só sabia o estado do BOT (`running`/`status`); com a
      // automação desligada, qualquer coisa que o personagem estivesse
      // fazendo virava "Automação desligada". Agora reporta também o que o
      // PERSONAGEM está fazendo, que é independente disso.
      hunting: isHunting(),
      // v0.9.16 — vocação + level pra lista de contas.
      characterVocation: getActiveCharacterVocation(),
      characterLevel: getActiveCharacterLevel(),
      // v0.9.6 — auto convidar pra party.
      isPartyLeader: cfg.isPartyLeader,
      // v0.11.22 — o que VALE na decisão. Separado do checkbox de propósito:
      // o checkbox continua refletindo o que o André marcou, e este campo diz
      // o que o servidor respondeu (ou o checkbox, quando ele está calado).
      souLiderEfetivo: souLider(cfg),
      partyMembros: party.em ? party.membros.map((m) => ({ nome: m.name, vocacao: m.vocation, stamina: m.staminaMinutes })) : null,
      autoInvitePartyEnabled: cfg.autoInvitePartyEnabled,
      autoInvitePartyTargets: cfg.autoInvitePartyTargets,
      // v0.9.9 — Modo de caçada + sincronizar venda de loot em grupo.
      // `groupHuntSyncStatus` é transiente (não fica salvo em localStorage,
      // só na memória desta aba) — null fora do ciclo de sincronização,
      // "leaderWaitingTeam" (líder esperando o time terminar de vender) ou
      // "memberWaitingInvite" (membro esperando o convite novo do líder).
      // O renderer.js usa isso pra decidir quando mandar `resumeGroupHunt`
      // pro líder.
      huntMode: cfg.huntMode,
      groupHuntSyncStatus,
      // v0.9.15 — venda automática ao chegar na cidade.
      autoSellOnCityArrival: cfg.autoSellOnCityArrival !== false,
      // v0.9.18 — rodízio de personagens por stamina.
      rotateCharactersEnabled: !!cfg.rotateCharactersEnabled,
      rotateCharacters: cfg.rotateCharacters,
      knownCharacters: cfg.knownCharacters,
      rotateMinStaminaMinutes: cfg.rotateMinStaminaMinutes,
      // v0.9.25 — estes DOIS campos deviam ter entrado na v0.9.23 e não
      // entraram: a substituição que os adicionaria não casou (o bloco acima
      // estava com indentação diferente) e falhou calada. Sem `stats`, a aba
      // Análise mostrava "Sem dados ainda" mesmo com a conta caçando; sem
      // `minimizeGameAnalyzer`, o toggle da tela não refletia o valor salvo.
      stats: statsParaEnvio(),
      minimizeGameAnalyzer: cfg.minimizeGameAnalyzer !== false,
      ...extra,
    });
  }

  // ---------- utilidades (idênticas à extensão Chrome) ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs = 5000, intervalMs = 250) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = fn();
      if (value) return value;
      await sleep(intervalMs);
    }
    return null;
  }

  function setInputValue(input, value) {
    const inicio = perfDiagnostico.ativo ? perfAgora() : 0;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (inicio) { perfDiagnostico.dom.execucoes++; perfDiagnostico.dom.execMs += perfAgora() - inicio; }
  }

  function setSelectValue(select, value) {
    const inicio = perfDiagnostico.ativo ? perfAgora() : 0;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value"
    ).set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    if (inicio) { perfDiagnostico.dom.execucoes++; perfDiagnostico.dom.execMs += perfAgora() - inicio; }
  }

  // v0.7.0 — mesmo padrão anti-detecção da extensão Chrome (pedido do André,
  // 03/09/2026 lá): atraso randômico 200-1000ms antes de QUALQUER clique de
  // ação real no jogo, pra não sair sempre com o mesmo timing exato (clique
  // instantâneo é o padrão mais óbvio de bot). `humanClick` é o ÚNICO ponto
  // que efetivamente clica em algo pras features novas desta versão — não
  // se aplica a leituras nem a `setInputValue`/`setSelectValue` (não são
  // cliques).
  function randomClickDelayMs() {
    return 200 + Math.floor(Math.random() * 800); // 200–1000ms
  }

  async function humanClick(el) {
    if (!el) return false;
    await sleep(randomClickDelayMs());
    const inicio = perfDiagnostico.ativo ? perfAgora() : 0;
    el.click();
    if (inicio) { perfDiagnostico.dom.execucoes++; perfDiagnostico.dom.execMs += perfAgora() - inicio; }
    return true;
  }

  // v0.9.6 — o menu de "Convidar para a party" na Lista de amigos só abre
  // com clique DIREITO de verdade (confirmado ao vivo, 08/09/2026) — não é
  // um `.click()` normal, é um evento `contextmenu` de verdade. Mesmo
  // atraso anti-detecção do `humanClick`.
  async function humanRightClick(el) {
    if (!el) return false;
    await sleep(randomClickDelayMs());
    const inicio = perfDiagnostico.ativo ? perfAgora() : 0;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("contextmenu", opts));
    if (inicio) { perfDiagnostico.dom.execucoes++; perfDiagnostico.dom.execMs += perfAgora() - inicio; }
    return true;
  }

  function findButtonByExactText(root, text) {
    return (
      Array.from(root.querySelectorAll("button")).find(
        (b) => b.textContent.trim() === text
      ) || null
    );
  }

  // v0.8.0 — mesma função da extensão Chrome (huntera-automacao/content.js).
  function findCharacterArticle(name) {
    const articles = Array.from(document.querySelectorAll(SEL.characterListItem));
    return (
      articles.find((a) => {
        const nameEl = a.querySelector(SEL.characterMetaName);
        return nameEl && nameEl.textContent.trim() === name;
      }) || null
    );
  }

  function parseCapacity(text) {
    if (!text) return null;
    const match = text.replace(",", ".").match(/[\d.]+/);
    return match ? parseFloat(match[0]) : null;
  }

  // v0.5.0 — formato "3:42h" (H:MMh) → minutos restantes de stamina. Mesma
  // lógica confirmada ao vivo na extensão Chrome (huntera-automacao).
  function parseStaminaClock(text) {
    if (!text) return null;
    const match = text.match(/(\d+):(\d{2})h/);
    if (!match) return null;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }

  function formatStaminaMinutes(mins) {
    if (mins === null || mins === undefined) return "?";
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
  }

  // Mesma ressalva documentada na extensão: o Angular do jogo nunca remove
  // do DOM os elementos de barra de ação/modais quando "fecham", só esconde
  // via CSS — toda checagem de ESTADO usa isVisible()/queryVisible().
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === "function") {
      try {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      } catch (e) {
        // cai pro fallback abaixo
      }
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // v0.9.15 — BUG SÉRIO corrigido: isso usava `querySelector` (só o PRIMEIRO
  // match) e depois testava visibilidade. Como o Angular do jogo NUNCA remove
  // modal/painel do DOM (só esconde via CSS — ver comentário acima), bastava
  // existir uma cópia escondida antes da visível pra função devolver `null` e
  // a automação concluir que o elemento "não existe". Isso atingia até o
  // `isHunting()` (a checagem de estado mais importante do arquivo): um falso
  // negativo faz o bot achar que não está caçando e tentar iniciar caçada em
  // loop. Agora procura entre TODOS os matches o primeiro visível.
  function queryVisible(root, selector) {
    const all = (root || document).querySelectorAll(selector);
    for (const el of all) {
      if (isVisible(el)) return el;
    }
    return null;
  }

  // v0.9.30 — eram 30 (e o painel só desenhava 8). Com a aba "Histórico"
  // mostrando tudo e com hora, 30 linhas viram ~10 minutos de automação: pouco
  // pra investigar "o que aconteceu enquanto eu não estava olhando".
  const LOG_HISTORY_MAX = 120;

  // v0.7.0 — `isError` (opcional) manda a notificação pro Telegram: sempre
  // que for erro (independente do toggle "notificar todo evento"), ou
  // qualquer evento se esse toggle estiver ligado. Fire-and-forget de
  // propósito (.catch(()=>{}) — nunca deve travar/atrasar a automação por
  // causa de notificação) via `ipcRenderer.invoke`, que de dentro do
  // preload de um <webview> chega DIRETO no `ipcMain.handle` do processo
  // principal (main.js), sem precisar passar pelo host (renderer.js) —
  // mesmo motivo de ir pro main.js e não pro content-injected.js chamar a
  // API do Telegram direto: fetch() daqui ficaria sujeito à CSP da própria
  // página do jogo.
  function log(message, isError) {
    logEntries = [...logEntries, { message, at: Date.now() }].slice(-LOG_HISTORY_MAX);
    // v0.12.1 — era `saveState({ log: logEntries })`, uma gravação síncrona em
    // disco por linha de log. Ver `agendarGravacaoDoLog`.
    agendarGravacaoDoLog();
    console.log(`[Huntera Multiconta] ${message}`);
    sendState();
    if (ipcRenderer) {
      ipcRenderer
        .invoke("telegram:notify", { message, isError: !!isError, characterName: getActiveCharacterName() })
        .catch(() => {});
    }
  }

  // ---------- leitura de estado do jogo ----------

  function getCapacityRemaining() {
    const el = document.querySelector(SEL.capacityValue);
    return el ? parseCapacity(el.textContent) : null;
  }

  function getStaminaRemainingMinutes() {
    // v0.11.18 — o servidor manda `staminaMs` no tipo 77, e isso resolve o
    // furo mais perigoso desta leitura: o relógio de stamina é DOM, e antes de
    // o HUD montar ele devolvia `null` — que o `hasEnoughStaminaToHunt()` lê
    // como "tem stamina de sobra". Ou seja, a falha de leitura virava um "sim".
    //
    // A validade de 60s existe porque o tipo 77 só chega com o jogo rodando:
    // se o socket cair, o último valor envelhece e a leitura volta pro DOM em
    // vez de ficar afirmando uma stamina congelada.
    if (fichaFresca() && typeof ficha.staminaMs === "number") {
      return Math.floor(ficha.staminaMs / 60000);
    }
    const el = document.querySelector(SEL.staminaClock);
    return el ? parseStaminaClock(el.textContent) : null;
  }

  function isHunting() {
    // v0.11.16 — o servidor responde isso (tipo 54) e responde ANTES de o HUD
    // existir, que é justamente o furo que a v0.9.31 teve que remendar com o
    // `isGameUiReady()`: procurar o botão "Sair da caçada" devolvia false com
    // o personagem caçando, só porque a SPA ainda não tinha desenhado.
    //
    // O portão do `isGameUiReady()` FICA — ele protege as outras leituras de
    // DOM, e aqui o protocolo pode não ter falado ainda (app aberto com o
    // socket já de pé). `null` = não sei, e aí o DOM responde como antes.
    const proto = emCacadaPeloProtocolo();
    if (proto !== null) return proto;
    return !!queryVisible(document, SEL.leaveHuntBtn);
  }

  // v0.9.31 — O HUD do jogo já montou?
  //
  // Bug que isso corrige (reportado pelo André em 10/09/2026): "toda vez que
  // eu abro o bot e está em caçada o bot tenta iniciar uma caçada, e abre o
  // menu de caçadas". A causa é uma inversão perigosa do `isHunting()`: ele
  // procura o botão "Sair da caçada", que só existe DEPOIS de a SPA do jogo
  // desenhar o HUD. Enquanto isso não acontece, "não achei o botão" era lido
  // como "não está caçando" — e o `boot()` chamava `startBot()` assim que o
  // `<body>` existia, muito antes disso. Resultado: o primeiro tick decidia
  // que o personagem estava parado (a stamina também vinha ilegível, e
  // `hasEnoughStaminaToHunt` trata ilegível como "tem stamina"), abria o
  // seletor de caçadas e tentava iniciar uma caçada que já estava rolando.
  //
  // Regra geral que fica: NENHUMA decisão de "está caçando / está na cidade"
  // vale enquanto o HUD não estiver na tela. Três âncoras porque qualquer uma
  // delas já prova que o personagem está dentro do jogo (caçando ou não).
  function isGameUiReady() {
    return !!(
      queryVisible(document, SEL.characterHeaderName) ||
      document.querySelector(SEL.capacityContainer) ||
      document.querySelector(SEL.staminaClock)
    );
  }

  // Tela de seleção de personagem (conta logada, personagem não). Serve pra
  // dar um status honesto em vez de "esperando o jogo carregar".
  function isOnCharacterList() {
    return !!document.querySelector(SEL.characterListItem);
  }

  // Nome do personagem ativo agora (só existe enquanto estiver dentro do
  // jogo — some no seletor de personagens). Usado pra identificar qual das
  // 4 contas mandou cada notificação do Telegram.
  function getActiveCharacterName() {
    // A identidade confirmada pertence à sessão atual do socket; diferente da
    // ficha (77), ela não depende de uma renovação periódica para continuar
    // verdadeira. Sem 103 + 15, em transição ou após queda, o DOM é o fallback.
    if (identidadeWsConfirmada()) return eu.nome;
    const el = queryVisible(document, SEL.characterHeaderName);
    if (el) {
      const texto = el.textContent.trim();
      if (texto) return texto;
    }
    // v0.11.31 — o protocolo sabe disso antes de o HUD montar (tipo 103 dá o
    // id, tipo 15 dá o nome desse id). Só entra quando o DOM está calado, e
    // `eu` é zerado em toda troca de personagem e queda de socket — um nome
    // velho aqui contaminaria atribuição de Telegram, rodízio e liderança de
    // party, que é exatamente o tipo de erro que não aparece no log.
    return null;
  }

  // v0.11.8 — a chave do `trainSkillByCharacter` tem que casar EXATAMENTE com
  // o `normalizeCharacterName()` do renderer — inclusive o `toLowerCase()`. Se
  // só uma das pontas minusculizar, o mapa nunca bate e a skill escolhida some
  // do painel sem erro nenhum.
  function normalizeName(nome) {
    if (typeof nome !== "string") return "";
    return nome
      .normalize("NFC")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // ---------- v0.11.8 — treino online ----------
  //
  // CONFIRMADO AO VIVO em 12/09/2026. Fatos que moldaram este código:
  //  - treinar NÃO é caçar e NÃO tira o personagem da cidade: com o treino
  //    rolando, "Sair da caçada" continua oculto e "Venda rápida" continua
  //    visível. Ou seja, sem tratar isso o `monitorTick` veria "parado na
  //    cidade com stamina" e tentaria caçar por cima do treino;
  //  - "Iniciar treino" não pede confirmação (o "Treinar offline" pede);
  //  - o toast de treino persiste e progride, e o "Cancelar" dele é imediato.

  function findTrainingToast() {
    const toasts = document.querySelectorAll(SEL.systemToast);
    for (const t of toasts) {
      if (t.querySelector(SEL.trainingSkillLabel)) return t;
    }
    return null;
  }

  function isTraining() {
    return !!findTrainingToast();
  }

  function getTrainingSkill() {
    const t = findTrainingToast();
    const el = t && t.querySelector(SEL.trainingSkillLabel);
    return el ? el.textContent.trim() : null;
  }

  function getTrainingProgress() {
    const t = findTrainingToast();
    const el = t && t.querySelector(SEL.trainingProgressLabel);
    return el ? el.textContent.trim() : null;
  }

  // Skill configurada pro personagem logado agora. Sem personagem na tela
  // (carregando, lista de personagens) devolve null de propósito — quem chama
  // não deve treinar às cegas.
  function trainSkillForCurrentCharacter(cfg) {
    const nome = getActiveCharacterName();
    if (!nome) return null;
    return (cfg.trainSkillByCharacter || {})[normalizeName(nome)] || null;
  }

  async function cancelTraining() {
    const toast = findTrainingToast();
    if (!toast) return false;
    const btn = Array.from(toast.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "Cancelar"
    );
    if (!btn) return false;
    await humanClick(btn);
    return !!(await waitFor(() => !isTraining(), 5000));
  }

  async function startOnlineTraining(skill) {
    const nav = document.querySelector(SEL.startHuntNavBtn);
    if (!nav) throw new Error('Não achei o botão "Caçar" pra abrir a aba de treino.');
    await humanClick(nav);

    const abaTreino = await waitFor(() => {
      const win = document.querySelector(SEL.huntWindow);
      if (!win) return null;
      return (
        Array.from(win.querySelectorAll(SEL.huntTabButtons)).find(
          (b) => b.textContent.trim() === "Treino"
        ) || null
      );
    }, 6000);
    if (!abaTreino) throw new Error('Aba "Treino" não apareceu na janela de caçadas.');
    await humanClick(abaTreino);

    // O texto do botão vem com o emoji COLADO ("🗡Sword Fighting"), por isso
    // `includes` e não igualdade.
    const skillBtn = await waitFor(() => {
      const win = document.querySelector(SEL.huntWindow);
      if (!win) return null;
      return (
        Array.from(win.querySelectorAll(SEL.trainSkillButtons)).find((b) =>
          b.textContent.includes(skill)
        ) || null
      );
    }, 6000);
    if (!skillBtn) throw new Error(`Skill "${skill}" não encontrada na aba Treino.`);
    await humanClick(skillBtn);

    const iniciarBtn = await waitFor(() => {
      const win = document.querySelector(SEL.huntWindow);
      if (!win) return null;
      return (
        Array.from(win.querySelectorAll(SEL.trainStartButtons)).find(
          (b) => b.textContent.trim() === "Iniciar treino"
        ) || null
      );
    }, 6000);
    if (!iniciarBtn) throw new Error('Botão "Iniciar treino" (treino online) não encontrado.');
    await humanClick(iniciarBtn);

    // O personagem ANDA até o pátio de treino antes de o treino valer, então a
    // confirmação é o toast aparecer — não a janela fechar.
    const comecou = await waitFor(() => isTraining(), 30000, 500);
    if (!comecou) {
      await closeHuntWindow();
      throw new Error(`Cliquei em "Iniciar treino" (${skill}), mas o treino não começou em 30s.`);
    }
    await closeHuntWindow();
  }

  async function closeNearestModal(fromEl) {
    let node = fromEl;
    let depth = 0;
    while (node && node !== document.body && depth < 8) {
      const btn = node.querySelector(SEL.closeModalBtn);
      if (btn) {
        await humanClick(btn);
        return true;
      }
      node = node.parentElement;
      depth++;
    }
    return false;
  }

  async function getCurrentHuntName() {
    // v0.11.16 — pelo protocolo isto é de graça: o tipo 54 diz o `scenarioId`
    // e o catálogo do tipo 42 traduz pra nome. O caminho de DOM abaixo ABRE UM
    // MODAL, lê o título e fecha — três cliques reais só pra ler um texto, e
    // ainda por cima logo antes de "Sair da caçada" (foi daí que veio o bug da
    // v0.9.15, do modal ficando aberto por cima do botão).
    const pelaRede = nomeDaCacadaPeloProtocolo();
    if (pelaRede) return pelaRede;

    const detailsBtn = queryVisible(document, SEL.huntDetailsBtn);
    if (!detailsBtn) return null;
    await humanClick(detailsBtn);
    const heading = await waitFor(() => queryVisible(document, SEL.huntHeadingText), 3000);
    const name = heading ? heading.textContent.trim() : null;
    // v0.9.15 — o modal precisa fechar SEMPRE, inclusive quando o heading não
    // apareceu a tempo. Antes só fechava no caminho de sucesso: no timeout, o
    // modal de detalhes ficava aberto por cima da tela — e como esta função é
    // chamada logo antes do `leaveHunt()`, o modal bloqueava o clique em
    // "Sair da caçada", dando erro. Os 3 ciclos seguintes falhavam igual e a
    // automação se desligava sozinha.
    if (heading) {
      await closeNearestModal(heading);
    } else {
      const closeBtn = queryVisible(document, SEL.closeModalBtn);
      if (closeBtn) await humanClick(closeBtn);
    }
    return name;
  }

  // ---------- seletor de caçadas ----------

  function getHuntPickerOpenButton() {
    const candidates = Array.from(document.querySelectorAll("button.nav-labeled"));
    return (
      candidates.find((b) => {
        const label = (b.getAttribute("aria-label") || b.title || "").trim();
        return label === "Caçadas" || label === "Iniciar caçada";
      }) || null
    );
  }

  async function ensureHuntWindowOpen() {
    if (queryVisible(document, SEL.huntWindow)) return true;
    // O script roda quase assim que a página começa a carregar — bem antes
    // da SPA em Angular do jogo terminar de montar a barra de navegação (ou
    // até antes do login acontecer, se a conta ainda não estava logada).
    // Por isso espera de verdade o botão aparecer em vez de checar só uma
    // vez — cobre tanto "ainda carregando" quanto "acabou de logar agora".
    const openBtn = await waitFor(() => getHuntPickerOpenButton(), 20000);
    if (!openBtn) return false;
    await humanClick(openBtn);
    return !!(await waitFor(() => queryVisible(document, SEL.huntWindow), 4000));
  }

  function findHuntEntry(win, huntName) {
    const entries = Array.from(win.querySelectorAll(SEL.huntEntries));
    return (
      entries.find((b) => {
        const nameEl = b.querySelector(SEL.huntEntryName);
        const name = nameEl ? nameEl.textContent.trim() : "";
        return name === huntName;
      }) || null
    );
  }

  // v0.9.15 — passou a ser async pra usar `humanClick` (regra do projeto:
  // todo clique real tem delay randômico anti-detecção). ATENÇÃO: NÃO pode
  // ser usada como predicado de `waitFor` — função async devolve Promise,
  // que é sempre truthy, e o waitFor "resolveria" na primeira tentativa. Os
  // chamadores esperam pelo `findHuntEntry` (síncrono) e só então clicam.
  async function clickHuntEntry(win, huntName) {
    const match = findHuntEntry(win, huntName);
    if (!match) return false;
    await humanClick(match);
    return true;
  }

  // v0.11.29 — "O TIER MAIS DIFÍCIL" NÃO PODE SER UM NOME.
  //
  // A expedição entrou no nível mais fácil. O motivo: o tier vinha do tipo 42
  // como NOME ("Reckless") e era casado com o texto do botão. Se aquele tier
  // não está disponível pro personagem naquela caçada, o nome não casa,
  // `selectPullTier` devolve false, e o jogo segue com o botão que já estava
  // marcado — o primeiro, o mais fácil. O aviso saía no log, mas a caçada
  // começava errada do mesmo jeito.
  //
  // O André descreveu a regra certa na própria reclamação: "o nível maior
  // DISPONÍVEL". Então a expedição pede o ÚLTIMO botão de tier que existe e
  // está habilitado — independe de nome, de idioma e do que o personagem
  // consegue ou não acessar.
  const TIER_MAIS_DIFICIL = "__max__";

  // Mesmo cuidado do botão de venda rápida (v0.9.17): "visível" não é
  // "clicável". Um tier bloqueado por level continua no DOM.
  function tierBloqueado(b) {
    if (!b) return true;
    if (b.disabled) return true;
    if (b.getAttribute("aria-disabled") === "true") return true;
    return /(^|\s)(disabled|is-disabled|locked|blocked)(\s|$)/.test(b.className || "");
  }

  function findPullTier(win, pullLevel) {
    const todos = Array.from(win.querySelectorAll(SEL.huntTiers));
    const tiers = todos.filter((b) => !tierBloqueado(b));
    if (!tiers.length) return null;
    if (pullLevel === TIER_MAIS_DIFICIL) return tiers[tiers.length - 1];
    return (
      tiers.find((b) => b.textContent.trim().toLowerCase() === String(pullLevel || "").toLowerCase()) ||
      null
    );
  }

  async function selectPullTier(win, pullLevel) {
    const match = findPullTier(win, pullLevel);
    if (!match) return false;
    await humanClick(match);
    return match.textContent.trim() || true;
  }

  // v0.9.10 — André: "vamos ver como que faz o convite de hunt em grupo".
  // CONFIRMADO AO VIVO em 09/09/2026 (Druid Dezin Zemsta, em party com a
  // Kina): a janela de escolha de caçada tem TRÊS botões de confirmar, não
  // um só — "Iniciar caçada" (solo, o único que a automação conhecia até
  // aqui), "Iniciar com o time" (novo — é isso que de fato manda o convite
  // de caçada em grupo pros outros membros da party) e "Completar o time"
  // (ainda não investigado/usado — provavelmente pra convidar gente de FORA
  // da party até completar o tamanho do pull; não mexe nisso por enquanto).
  // Essa é a causa raiz de "sincronizar loot em grupo"/"modo em grupo" não
  // funcionarem de verdade: `resumeGroupHuntAfterSync()` retomava a caçada
  // clicando em "Iniciar caçada" (solo) — a lógica de espera/sincronização
  // toda rodava certinho, mas nenhum convite de verdade saía pros membros,
  // porque o botão errado era clicado.
  async function clickConfirmButton(win, useTeamButton) {
    const btn = useTeamButton
      ? findButtonByExactText(win, "Iniciar com o time") || findButtonByExactText(win, "Trocar com o time")
      : findButtonByExactText(win, "Iniciar caçada") || findButtonByExactText(win, "Trocar de caçada");
    if (!btn) return false;
    // v0.9.15 — o clique mais crítico do ciclo (o que de fato inicia a
    // caçada) era `.click()` direto, sem o delay anti-detecção exigido pela
    // regra do projeto. Agora passa pelo `humanClick` como todos os outros.
    await humanClick(btn);
    return true;
  }

  // v0.9.11 — "Iniciar com o time" CONFIRMADO AO VIVO COM CLIQUE REAL em
  // 09/09/2026 (Dezin Zemsta Lv357 líder + Kina Zemsta Lv125, hunt "Rat
  // Cellars", os dois elegíveis): abre de verdade o popup nativo do jogo
  // "CONVITE DE CAÇADA EM GRUPO" e, depois de aceito, a caçada sincroniza
  // os dois personagens na mesma instância — confirma que o mecanismo do
  // fix acima está certo.
  //
  // Só que o André também reportou (mesmo dia, Kina líder + Najwizzy
  // Zemsta Lv77 em "Dragon Lair") um SEGUNDO diálogo possível: quando pelo
  // menos um membro da party não é elegível pra caçada escolhida (suspeita
  // mais forte: level mínimo da caçada), o jogo em vez do convite mostra
  // "INICIAR CAÇADA / Líder da party / Quer começar sem o time? / Cancelar
  // / Iniciar sem o time". Sem tratamento, isso trava a automação (nem
  // caça nem cancela) até alguém clicar manualmente — e foi exatamente
  // clicar "Iniciar sem o time" manualmente que fez uma caçada iniciar
  // SOLO mesmo com "Modo de caçada: Em grupo" selecionado.
  //
  // v0.9.13 — a v0.9.11 tentava achar esse diálogo procurando um elemento
  // FOLHA cujo texto batesse EXATAMENTE com a frase "Quer começar sem o
  // time?" — e o André confirmou ao vivo que continuou travando do mesmo
  // jeito (a caçada ficou parada em "Iniciando caçada" com o diálogo aberto
  // sem eu cancelar nada). A frase foi transcrita de um PRINT, não extraída
  // do DOM real — qualquer diferença mínima (espaço, acento, aspas, a frase
  // quebrada em mais de um nó de texto) já é suficiente pra nunca bater
  // igual. Troquei a estratégia: procurar direto o BOTÃO "Iniciar sem o
  // time" (rótulo bem mais curto e específico, praticamente impossível de
  // aparecer em outro lugar do jogo) e, a partir dele, confirmar que é o
  // diálogo certo achando um "Cancelar" num ancestral próximo. Mais
  // resistente a diferença de estrutura/pontuação da frase inteira. Ainda
  // sem inspeção de DOM/classe ao vivo — só texto de botão confirmado pelo
  // André em print.
  function findTeamStartFallbackDialog() {
    const soloBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => isVisible(b) && b.textContent && b.textContent.trim() === "Iniciar sem o time"
    );
    if (!soloBtn) return null;
    let node = soloBtn.parentElement;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      const cancelBtn = findButtonByExactText(node, "Cancelar");
      if (cancelBtn) return { container: node, cancelBtn, soloBtn };
    }
    // Achou "Iniciar sem o time" mas nenhum "Cancelar" perto — ainda assim é
    // o diálogo (o "Cancelar" pode estar fora do ancestral que percorri), então
    // devolve o que dá pra usar em vez de fingir que não viu.
    return { container: soloBtn.parentElement, cancelBtn: null, soloBtn };
  }

  async function pickAndStartHunt(huntName, pullLevel, useTeamButton) {
    const opened = await ensureHuntWindowOpen();
    if (!opened) throw new Error("Não consegui abrir o seletor de caçadas.");
    const win = document.querySelector(SEL.huntWindow);
    const search = win.querySelector(SEL.huntSearchInput);
    if (!search) throw new Error("Campo de busca de caçada não encontrado.");

    setInputValue(search, huntName);
    await sleep(400);

    // v0.9.15 — espera com predicado SÍNCRONO (`findHuntEntry`) e só depois
    // clica com `humanClick`. Passar o `clickHuntEntry` (agora async) direto
    // pro `waitFor` seria um bug silencioso: Promise é sempre truthy.
    const entry = await waitFor(() => findHuntEntry(win, huntName), 4000);
    if (!entry) throw new Error(`Caçada "${huntName}" não encontrada na busca.`);
    await humanClick(entry);

    await waitFor(() => win.querySelector(SEL.huntTiers), 4000);
    const tierFound = await selectPullTier(win, pullLevel);
    // v0.11.29 — dizer QUAL tier entrou, não só que entrou. Foi a falta disso
    // que deixou "entrou no mais fácil" passar despercebido.
    if (tierFound && typeof tierFound === "string") {
      log(`Tier escolhido: ${tierFound}${pullLevel === TIER_MAIS_DIFICIL ? " (o mais difícil disponível)" : ""}.`);
    }
    if (!tierFound) {
      log(
        pullLevel === TIER_MAIS_DIFICIL
          ? `Aviso: não achei nenhum tier disponível em "${huntName}" — a caçada começou no que já estava marcado.`
          : `Aviso: o tier "${pullLevel}" não está disponível em "${huntName}" — a caçada começou no que já estava marcado, que costuma ser o mais fácil.`,
        true
      );
    }
    await sleep(200);

    const confirmed = await clickConfirmButton(win, useTeamButton);
    if (!confirmed) {
      throw new Error(
        useTeamButton
          ? 'Botão "Iniciar com o time"/"Trocar com o time" não encontrado — confirme que a conta está em party.'
          : 'Botão "Iniciar caçada"/"Trocar de caçada" não encontrado.'
      );
    }
  }

  async function ensureHunting(cfg, forcedHuntName, useTeamButton) {
    const targetName = forcedHuntName || cfg.huntName;
    if (!targetName) {
      throw new Error("Nenhuma caçada configurada — escolha uma no menu lateral.");
    }
    if (isHunting()) {
      const current = await getCurrentHuntName();
      if (current && current === targetName) {
        currentHuntNameCache = current;
        return;
      }
      // v0.9.31 — não consegui LER qual caçada é (modal não abriu, heading não
      // veio a tempo). Antes o código caía direto no `pickAndStartHunt`, ou
      // seja: tirava o personagem de uma caçada que estava rolando bem por
      // causa de uma leitura que falhou. Na dúvida, mantém o que está.
      if (!current) {
        log(
          `Já estou caçando, mas não consegui confirmar qual caçada é — mantendo a atual em vez de reiniciar "${targetName}".`
        );
        return;
      }
      log(`Estava caçando "${current}" e a configurada é "${targetName}" — trocando de caçada.`);
    }
    await pickAndStartHunt(targetName, cfg.pullLevel, useTeamButton);

    // v0.9.14 — entendimento CORRIGIDO de quando o diálogo "Quer começar sem
    // o time?" aparece. A hipótese da v0.9.11 (membro não elegível pra
    // caçada, level mínimo) estava ERRADA: o log do André mostrou que quem
    // disparava esse diálogo era o `startBot()` clicando "Iniciar caçada"
    // (SOLO) com a conta sendo LÍDER de uma party montada — é a pergunta
    // natural do jogo ("você é líder e tem gente na party, quer mesmo
    // começar sozinho?"). Ou seja: ele aparece no caminho SOLO, não no
    // caminho do time — exatamente onde a v0.9.11/v0.9.13 não olhavam,
    // porque a checagem estava atrás de `if (useTeamButton)`.
    //
    // Tratamento certo depende da INTENÇÃO:
    //  - queria caçada em grupo (`useTeamButton`) e mesmo assim caiu aqui →
    //    algo saiu errado; cancela e reporta, nunca inicia sozinho.
    //  - queria caçada solo mesmo (modo Solo, mas a conta é líder de uma
    //    party) → "Iniciar sem o time" É a resposta correta: confirma e
    //    segue, em vez de travar esperando uma caçada que nunca começa.
    const fallback = await waitFor(() => findTeamStartFallbackDialog(), 6000);
    if (fallback) {
      if (useTeamButton) {
        if (fallback.cancelBtn) {
          await humanClick(fallback.cancelBtn);
        } else {
          log('Diálogo "Quer começar sem o time?" apareceu mas não achei o botão "Cancelar" — deixei aberto de propósito, em vez de clicar em "Iniciar sem o time".');
        }
        throw new Error(
          `Queria iniciar "${targetName}" COM o time, mas o jogo perguntou "Quer começar sem o time?" — cancelei em vez de iniciar sozinho. Confira se a party está montada e se todo o time é elegível pra essa caçada.`
        );
      }
      log('Modo Solo com party montada — o jogo perguntou "Quer começar sem o time?"; confirmando que é solo mesmo.');
      await humanClick(fallback.soloBtn);
    }

    // v0.9.11 — com convite real de caçada em grupo, a espera não depende só
    // do próprio personagem: precisa dar tempo pro(s) outro(s) aceitar
    // também (CONFIRMADO AO VIVO em 09/09/2026 — o convite ficou "1 de 2
    // aceitaram" por alguns segundos antes de sincronizar de verdade), por
    // isso o timeout é maior que o de uma caçada solo.
    const started = await waitFor(() => isHunting(), useTeamButton ? 60000 : 25000);
    if (!started) {
      throw new Error(
        useTeamButton
          ? `Convite de caçada em grupo pra "${targetName}" enviado, mas ninguém aceitou a tempo (60s).`
          : `Não consegui confirmar que a caçada "${targetName}" iniciou.`
      );
    }
    currentHuntNameCache = targetName;
  }

  async function closeHuntWindow() {
    const win = document.querySelector(SEL.huntWindow);
    if (!win) return;
    const btn = win.querySelector(SEL.closeModalBtn);
    if (btn) await humanClick(btn);
  }

  // ---------- sair da caçada + vender ----------

  async function leaveHunt() {
    const btn = queryVisible(document, SEL.leaveHuntBtn);
    // v0.9.15 — antes era `if (btn) btn.click();` e seguia em frente do mesmo
    // jeito: quando o botão não estava lá, esperava 20s à toa e dava um erro
    // enganoso ("Cliquei em Sair da caçada, mas...") sem ter clicado em nada.
    if (!btn) throw new Error('Botão "Sair da caçada" não encontrado — o personagem ainda está caçando?');
    await humanClick(btn);
    const arrived = await waitFor(() => queryVisible(document, SEL.quickSellTownBtn), 20000);
    if (!arrived) {
      throw new Error(
        'Cliquei em "Sair da caçada", mas não confirmei ter chegado na cidade ("Venda rápida" não apareceu em 20s).'
      );
    }
    await sleep(500);
  }

  // v0.9.17 — o jogo desabilita "Venda rápida" quando não há nada pra vender.
  // O `queryVisible` só olha visibilidade, então o botão desabilitado passava
  // como se estivesse disponível: a automação clicava nele, nada acontecia, e
  // a v0.9.15 (que passou a tratar "confirmação não apareceu" como erro)
  // transformava isso num erro de verdade, repetido a cada tick.
  // Angular costuma marcar de mais de um jeito, então checa os três.
  function isQuickSellDisabled(btn) {
    if (!btn) return true;
    if (btn.disabled) return true;
    if (btn.getAttribute("aria-disabled") === "true") return true;
    return /(^|\s)(disabled|is-disabled)(\s|$)/.test(btn.className || "");
  }

  async function sellInTown() {
    const sellBtn = await waitFor(() => queryVisible(document, SEL.quickSellTownBtn), 10000);
    if (!sellBtn) throw new Error('Botão "Venda rápida" não apareceu na cidade.');
    // Botão desabilitado = bag vazia. Não é erro, não tem o que fazer.
    if (isQuickSellDisabled(sellBtn)) return null;
    await humanClick(sellBtn);

    const confirmBtn = await waitFor(() => queryVisible(document, SEL.quickSellConfirmBtn), 5000);
    if (!confirmBtn) {
      const cancelBtn = queryVisible(document, SEL.quickSellCancelBtn);
      if (cancelBtn) {
        await humanClick(cancelBtn);
        return null; // modal abriu e deu pra cancelar → não havia o que vender
      }
      // v0.9.17 — isso ERA um `throw` (v0.9.15). A intenção era boa (falha de
      // UI não podia passar por "vendi" e liberar a sincronização do time com
      // a bag cheia), mas na prática virou um loop: o erro estourava ANTES de
      // marcar a tentativa como feita, então cada tick tentava tudo de novo.
      // Agora é um aviso — a tentativa já está registrada pelo chamador e o
      // ciclo segue; se realmente sobrou loot, a próxima ida à cidade vende.
      log(
        'Cliquei em "Venda rápida" mas a confirmação não apareceu — sigo sem confirmar a venda desta vez.',
        true
      );
      return null;
    }

    const saleText = confirmBtn.textContent.trim();
    // v0.11.21 — quem confirma a venda agora é o SERVIDOR, não o DOM.
    //
    // O André reportou que "vender loot não tem funcionado muito bem", e o
    // motivo estava aqui: a única evidência de sucesso era um modal sumir da
    // tela. Se ele demorasse, o código seguia sem saber se vendeu, e o aviso
    // "a confirmação não apareceu" saía mesmo quando a venda tinha dado certo.
    //
    // O tipo 92 traz `{template:"Quick sold {count} items for {amount} gold.",
    // params:{count:13, amount:980}}` — conferido contra o gold da mesma
    // captura: +980 exatos no mesmo instante. E como o número vem em `params`,
    // não depende do texto: se o jogo traduzir a mensagem, continua valendo.
    const marca = economia.ultimaVendaEm;
    await humanClick(confirmBtn);
    await waitFor(() => !queryVisible(document, SEL.quickSellConfirmBtn), 5000);

    const confirmadaPeloServidor = await waitFor(() => economia.ultimaVendaEm > marca, 6000, 200);
    if (confirmadaPeloServidor) {
      log(`Venda confirmada pelo servidor: ${economia.itensVendidos} itens no total desta sessão, ${economia.goldVendido} gp.`);
    }
    return saleText;
  }

  // v0.9.15 — pedido do André: "ter uma função para ficar detectando que o
  // boneco saiu da hunt e vender... quando está em PT deveria ter um botão
  // tipo: sempre vender quando for para cidade... pq a PT sempre sai da hunt
  // quando acaba a cap de alguém e todos deveriam vender para ficarem mais
  // ou menos próximos".
  //
  // PROBLEMA REAL que isso corrige: até aqui, VENDER era um passo de dentro
  // do `runSellAndReturnCycle`, que só roda quando é a PRÓPRIA conta que
  // decide sair (capacidade dela no limite). Só que:
  //   - Numa caçada em grupo, quando QUALQUER membro estoura a capacidade, o
  //     jogo tira TODO MUNDO da caçada. Os outros caem na cidade sem nunca
  //     passar por essa função — ou seja, nunca vendiam. E, pior, como quem
  //     marca `memberWaitingInvite` é justamente essa função, eles também
  //     nunca reportavam "já vendi" → o líder ficava esperando o time PRA
  //     SEMPRE (deadlock real da sincronização).
  //   - No modo solo tem o mesmo furo: quando a stamina zera, o jogo tira o
  //     personagem da caçada; ele esperava stamina e voltava a caçar com a
  //     bag do mesmo jeito, sem vender.
  // Agora a venda é uma responsabilidade separada, disparada por ESTADO
  // ("estou na cidade e ainda não vendi nesta ida"), não por quem causou a
  // saída. A trava `soldSinceArrivingInCity` garante que roda UMA vez por
  // ida à cidade — nada de ficar clicando "Venda rápida" a cada 4s.
  function isInCity() {
    // v0.11.23 — o tipo 54 diz o cenário: `city-global` / `main-city`. O
    // caminho de DOM confundia duas coisas diferentes — ele testava se o botão
    // "Venda rápida" está na tela, ou seja "estou num lugar onde dá pra
    // vender", e usava isso como "estou na cidade". Enquanto o HUD não monta,
    // a resposta era `false` mesmo com o personagem parado na cidade.
    if (mundo.instanceId) {
      const naCidade = /^city/i.test(mundo.instanceId) || /city/i.test(mundo.scenarioId || "");
      if (naCidade) return true;
      // Cenário conhecido que NÃO é cidade: responde não, sem consultar o DOM.
      if (emCacadaPeloProtocolo() === true) return false;
    }
    return !isHunting() && !!queryVisible(document, SEL.quickSellTownBtn);
  }

  async function sellLootOnce(cfg, reasonLabel) {
    // v0.9.17 — André: "o botão está desabilitado e está tentando vender na
    // cidade, isso deveria ser uma tentativa só e não ficar tentando várias
    // vezes". A trava era marcada DEPOIS do `sellInTown()`, então qualquer
    // falha no meio (botão desabilitado, confirmação que não aparece) pulava
    // essa linha e o tick seguinte tentava tudo de novo, pra sempre. Agora a
    // trava é marcada ANTES: é uma tentativa por ida à cidade, dê no que der.
    soldSinceArrivingInCity = true;

    const sellBtn = queryVisible(document, SEL.quickSellTownBtn);
    if (isQuickSellDisabled(sellBtn)) {
      // Bag vazia — o jogo desabilita o botão. Não é erro nem tentativa
      // falha: só não há o que vender nesta ida.
      log("Cheguei na cidade, mas não há nada pra vender (Venda rápida indisponível).");
      return null;
    }

    updatePanelStatus("Vendendo loot");
    log(`${reasonLabel} — vendendo loot na cidade (Venda rápida)...`);
    const saleText = await sellInTown();
    if (saleText && stats) {
      // v0.9.23 — o texto do botão de confirmar é o único lugar com o valor
      // da venda. Se o parser não reconhecer o formato, NÃO soma nada — e o
      // texto cru continua no log, que é como dá pra descobrir o formato novo
      // sem ficar chutando.
      const valor = parseGameNumber(saleText);
      if (valor) stats.gold += valor;
    }
    log(saleText ? `Loot vendido: ${saleText}.` : "Nada pra vender nesta ida à cidade.");
    return saleText;
  }

  // Depois de vender, decide o que fazer: no modo grupo entra na espera de
  // sincronização (líder espera o time; membro espera o convite novo); no
  // modo solo volta a caçar. Extraído do `runSellAndReturnCycle` pra poder
  // ser reaproveitado pela venda automática ao chegar na cidade.
  async function afterSellingDecideNext(cfg, huntBeforeLeaving) {
    if (cfg.huntMode === "group") {
      pendingGroupHuntName = huntBeforeLeaving || pendingGroupHuntName || cfg.huntName;
      isAwaitingGroupHuntSync = true;
      awaitingGroupHuntSyncSince = Date.now();
      if (souLider(cfg)) {
        groupHuntSyncStatus = "leaderWaitingTeam";
        updatePanelStatus("Aguardando o time");
        log("Loot vendido — aguardando o time inteiro terminar de vender antes de retomar a caçada em grupo...");
      } else {
        groupHuntSyncStatus = "memberWaitingInvite";
        updatePanelStatus("Aguardando convite");
        log("Loot vendido — aguardando o novo convite de caçada em grupo do líder...");
      }
      sendState();
      return;
    }

    // v0.9.17 — André: "toda vez que sair da caçada faça um check na stamina,
    // hoje ele sai sem stamina, tenta entrar novamente e recebe a mensagem de
    // erro... o sistema precisa ser inteligente para não sair tentando fazer
    // ação que não seria possível".
    //
    // Esse check existia no `monitorTick`, mas NÃO neste caminho (sair por
    // capacidade → vender → voltar), que é justamente o que roda o tempo todo:
    // ao vender com a stamina no fim, a automação tentava reentrar na hora, o
    // jogo recusava e virava erro — três desses e ela se desligava sozinha.
    // Agora, sem stamina, só avisa e volta pro monitor, que reentra quando a
    // stamina bater o limiar configurado.
    if (!hasEnoughStaminaToHunt(cfg)) {
      // v0.9.18 — acabou de vender e não tem stamina: é o momento ideal pra
      // passar a vez (bag já vazia, nada pendente). Se o rodízio estiver
      // ligado e houver próximo na fila, troca aqui.
      if (await tryRotateCharacter(cfg)) return;
      // v0.9.32 — o texto depende da ação de rotina ligada: prometer "volto
      // assim que regenerar" com a espera desligada seria mentira.
      if (cfg.staminaWaitEnabled === false) {
        reportNoStamina(cfg);
        return;
      }
      updatePanelStatus(`Aguardando stamina (${formatStaminaMinutes(getStaminaRemainingMinutes())})`);
      log(
        `Loot vendido, mas a stamina está abaixo do mínimo configurado (${formatStaminaMinutes(getStaminaRemainingMinutes())} de ${formatStaminaMinutes(cfg.staminaResumeThreshold)}) — não vou tentar reentrar agora; volto assim que regenerar.`
      );
      lastStaminaLogAt = Date.now();
      return;
    }

    // v0.9.15 — a caçada alvo passa a ser a CONFIGURADA quando existe. Antes
    // usava só a caçada de antes de sair, então trocar a caçada no menu
    // lateral não tinha efeito nenhum: o ciclo voltava pra antiga pra sempre.
    //
    // v0.11.30 — mas a configurada só ganha quando NÃO há expedição pendente.
    // Este era um dos dois caminhos que jogavam o personagem de volta na
    // caçada principal no meio de uma expedição: vendeu o loot, voltou pra
    // caçada do menu, e a expedição ficava esperando os 10min da trava de
    // troca pra talvez ser lembrada.
    const alvo = alvoDeCacada(cfg, huntBeforeLeaving);
    const targetName = alvo.nome || cfg.huntName || huntBeforeLeaving;
    updatePanelStatus("Iniciando caçada");
    log(
      alvo.expedicao
        ? `Retomando a expedição: ${targetName} (objetivo "${alvo.objetivo.label}", ${alvo.objetivo.progress}/${alvo.objetivo.quota})...`
        : `Retomando caçada: ${targetName}...`
    );
    await ensureHunting({ ...cfg, pullLevel: alvo.pullLevel }, targetName);

    saveState({ cycles: (loadState().cycles || 0) + 1 });
    if (stats) stats.cycles++;
    updatePanelStatus(alvo.expedicao ? "Caçando (expedição)" : "Caçando");
    log(`De volta caçando "${targetName}".`);
  }

  async function runSellAndReturnCycle(cfg) {
    log("Capacidade no limite configurado — saindo da caçada...");
    updatePanelStatus("Saindo da caçada");
    const huntBeforeLeaving = (await getCurrentHuntName()) || currentHuntNameCache || cfg.huntName;

    await leaveHunt();
    await sellLootOnce(cfg, "Saí da caçada por capacidade");
    if (!running) return;
    await afterSellingDecideNext(cfg, huntBeforeLeaving);
  }

  // v0.9.8 — chamado quando o renderer.js confirma (via comando
  // `resumeGroupHunt`) que todo o time configurado já vendeu o loot. Só o
  // líder chega a ficar em `groupHuntSyncStatus === "leaderWaitingTeam"`,
  // então é sempre nele que isso roda de verdade.
  async function resumeGroupHuntAfterSync() {
    // v0.9.15 — não retomar caçada com a automação DESLIGADA. Antes, um
    // `resumeGroupHunt` vindo do host fazia uma conta parada voltar a caçar
    // sozinha, contrariando o "Desligar automação".
    if (!running) return;
    if (!isAwaitingGroupHuntSync || groupHuntSyncStatus !== "leaderWaitingTeam") return;
    // v0.9.15 — antes isso era `if (isBusy) return;`, e o comando era jogado
    // fora em silêncio. Como o host só reenvia quando chega estado NOVO — e
    // durante a espera ninguém manda estado —, bastava o comando cair numa
    // janela ocupada (o auto-convite de party segura a trava por vários
    // segundos) pra caçada em grupo travar de vez. Agora fica pendente e o
    // `monitorTick` executa assim que a trava liberar.
    if (isBusy) {
      pendingResumeGroupHunt = true;
      return;
    }
    isBusy = true;
    try {
      const cfg = loadState();
      const huntName = pendingGroupHuntName || cfg.huntName;
      // v0.9.17 — mesmo check de stamina do ciclo solo: sem stamina, mandar o
      // convite pro time só faz todo mundo tomar erro junto. Mantém o estado
      // de espera (não limpa nada) pro monitor tentar de novo depois.
      if (!hasEnoughStaminaToHunt(cfg)) {
        updatePanelStatus(`Aguardando stamina (${formatStaminaMinutes(getStaminaRemainingMinutes())})`);
        // Deixa pendente pro `monitorTick` tentar de novo a cada tick (é só
        // uma checagem, não clica em nada) — quando a stamina bater o limiar,
        // o convite sai sozinho. O log é throttled pra não encher o histórico
        // enquanto espera.
        pendingResumeGroupHunt = true;
        if (Date.now() - lastStaminaLogAt >= STAMINA_LOG_INTERVAL_MS) {
          lastStaminaLogAt = Date.now();
          log(
            `O time já vendeu, mas minha stamina está abaixo do mínimo (${formatStaminaMinutes(getStaminaRemainingMinutes())} de ${formatStaminaMinutes(cfg.staminaResumeThreshold)}) — só mando o convite quando regenerar.`
          );
        }
        return;
      }
      updatePanelStatus("Iniciando caçada");
      log(`Time inteiro já vendeu o loot — retomando caçada em grupo: ${huntName}...`);
      // v0.9.10 — precisa ser o botão "Iniciar com o time" (useTeamButton=true),
      // senão sai um "Iniciar caçada" solo e nenhum convite real é enviado
      // pro resto do time (ver comentário grande acima de clickConfirmButton).
      await ensureHunting(cfg, huntName, true);
      // v0.9.15 — a limpeza do estado de espera só acontece DEPOIS do
      // sucesso. Antes era limpa logo no começo: se o `ensureHunting`
      // falhasse (ex: ninguém aceitou em 60s), a conta perdia o nome da
      // caçada do time e saía da espera achando que estava tudo certo —
      // voltando a caçar `cfg.huntName`, que pode ser outra caçada.
      isAwaitingGroupHuntSync = false;
      groupHuntSyncStatus = null;
      pendingGroupHuntName = null;
      awaitingGroupHuntSyncSince = 0;
      saveState({ cycles: (loadState().cycles || 0) + 1 });
      if (stats) stats.cycles++;
      updatePanelStatus("Caçando");
      log(`De volta caçando "${huntName}" em grupo.`);
      sendState();
    } catch (err) {
      // Continua em `leaderWaitingTeam` (estado preservado) — o watchdog do
      // `monitorTick` tira daqui se isso não resolver em alguns minutos.
      log(`Erro ao retomar caçada em grupo: ${err.message}`, true);
      updatePanelStatus("Erro");
    } finally {
      isBusy = false;
    }
  }

  // ---------- monitor ----------

  // v0.5.0 — true se já dá pra tentar (re)entrar na caçada: ou não deu pra
  // ler a stamina (elemento pode não existir fora de certas telas — nesse
  // caso não trava por causa disso, segue como antes), ou ela já bateu o
  // limiar configurado. false = ainda precisa esperar regenerar.
  function hasEnoughStaminaToHunt(cfg) {
    const staminaLeft = getStaminaRemainingMinutes();
    if (staminaLeft === null) return true;
    // v0.9.32 — com a ação "Esperar a stamina encher" desligada, o limiar em
    // minutos não segura ninguém. Ainda assim não se tenta caçar com stamina
    // zerada: o jogo recusa e o bot ficaria entrando e saindo a cada 4s (o
    // bug que criou o limiar na v0.5.0). Zerada → cai no `reportNoStamina`.
    if (cfg.staminaWaitEnabled === false) return staminaLeft > 0;
    return staminaLeft >= cfg.staminaResumeThreshold;
  }

  function logStaminaWaitingThrottled(cfg) {
    const now = Date.now();
    if (now - lastStaminaLogAt < STAMINA_LOG_INTERVAL_MS) return;
    lastStaminaLogAt = now;
    const staminaLeft = getStaminaRemainingMinutes();
    log(
      `Sem stamina suficiente pra voltar a caçar (${formatStaminaMinutes(staminaLeft)} de ${formatStaminaMinutes(cfg.staminaResumeThreshold)} mínimo) — aguardando regenerar...`
    );
  }

  // v0.9.32 — ponto ÚNICO de "acabou a stamina e eu não vou caçar agora".
  // Existem duas ações de rotina pra esse momento, cada uma com o seu
  // liga/desliga: esperar a stamina encher e trocar de personagem. Se a
  // espera está desligada, ficar em "Aguardando stamina" seria mentira — o
  // bot para e avisa (decisão do André, 10/09/2026).
  function reportNoStamina(cfg) {
    if (cfg.staminaWaitEnabled === false) {
      updatePanelStatus("Sem stamina");
      const now = Date.now();
      if (now - lastStaminaLogAt >= STAMINA_LOG_INTERVAL_MS) {
        lastStaminaLogAt = now;
        log(
          `Stamina acabou (${formatStaminaMinutes(getStaminaRemainingMinutes())}) e nenhuma ação de rotina disponível — parei por aqui. Ligue "Esperar a stamina encher" ou "Trocar de personagem" na aba Rotina pra eu continuar sozinho.`,
          true
        );
      }
      return;
    }
    updatePanelStatus(`Aguardando stamina (${formatStaminaMinutes(getStaminaRemainingMinutes())})`);
    logStaminaWaitingThrottled(cfg);
  }

  async function monitorTick() {
    if (!running || isBusy || !licensed) return;

    // v0.9.15 — comando `resumeGroupHunt` que chegou com a conta ocupada.
    // Executa agora, antes do resto do tick (a própria função pega a trava).
    if (pendingResumeGroupHunt) {
      pendingResumeGroupHunt = false;
      await resumeGroupHuntAfterSync();
      return;
    }

    // v0.9.31 — PORTÃO: enquanto o HUD do jogo não estiver na tela, nenhuma
    // leitura de "está caçando / está na cidade / quanta stamina" é confiável
    // (ver `isGameUiReady`). Antes daqui o tick decidia com o DOM ainda vazio
    // e abria o seletor de caçadas por cima de uma caçada em andamento.
    // Fica FORA do try/isBusy de propósito: é só uma espera, não um ciclo.
    if (!isGameUiReady()) {
      gameUiReadySince = 0;
      if (!waitingForGameUi) {
        waitingForGameUi = true;
        if (isOnCharacterList()) {
          updatePanelStatus("Aguardando personagem");
          log("Estou na lista de personagens — não vou tentar caçar até entrar no jogo.");
        } else {
          updatePanelStatus("Aguardando o jogo carregar");
          log("Automação ligada, mas o jogo ainda está carregando — esperando a tela do personagem antes de decidir qualquer coisa.");
        }
      }
      return;
    }
    if (!gameUiReadySince) gameUiReadySince = Date.now();
    if (waitingForGameUi) {
      waitingForGameUi = false;
      if (isHunting()) {
        // O caso do bug: reabri o app com o personagem já caçando.
        currentHuntNameCache = null;
        updatePanelStatus("Caçando");
        log("Jogo carregado e o personagem já está caçando — mantendo a caçada atual, sem abrir o seletor.");
      }
    }

    isBusy = true;
    try {
      const cfg = loadState();

      // v0.9.15 — voltou a caçar: libera a trava da venda automática pra
      // próxima ida à cidade. Fica no topo do tick de propósito, pra valer
      // pra QUALQUER caminho que tenha feito o personagem voltar a caçar
      // (convite aceito, retomada solo, entrada manual).
      if (isHunting()) {
        soldSinceArrivingInCity = false;
        // v0.11.9 — caçando de novo = a queda passou. Zera a escada de espera
        // do religamento, senão a queda de amanhã já começaria pelo intervalo
        // longo por causa das tentativas de hoje.
        selfRestarts = [];
        // v0.9.18 — alguém conseguiu caçar: o rodízio "deu certo", então o
        // contador de voltas em vazio zera pra próxima rodada.
        rotationsWithoutHunt = 0;
      }

      // v0.9.8 — enquanto espera a sincronização de venda de loot em grupo
      // (líder esperando o time, ou membro esperando o convite novo), o
      // monitor não tenta reentrar na caçada sozinho — só confirma quando
      // já voltou a caçar de verdade (convite aceito, ou o líder já foi
      // liberado por `resumeGroupHuntAfterSync`) pra encerrar a espera.
      if (isAwaitingGroupHuntSync) {
        if (isHunting()) {
          isAwaitingGroupHuntSync = false;
          groupHuntSyncStatus = null;
          awaitingGroupHuntSyncSince = 0;
          updatePanelStatus("Caçando");
          log("De volta caçando em grupo.");
          sendState();
        } else if (
          awaitingGroupHuntSyncSince &&
          Date.now() - awaitingGroupHuntSyncSince >= GROUP_SYNC_TIMEOUT_MS
        ) {
          // v0.9.15 — watchdog: passou do teto esperando o time/convite.
          // Em vez de ficar parado pra sempre em silêncio, avisa e volta pro
          // fluxo normal (o líder tenta mandar convite de novo; o membro
          // volta a esperar do jeito normal, mas com o estado limpo).
          isAwaitingGroupHuntSync = false;
          groupHuntSyncStatus = null;
          awaitingGroupHuntSyncSince = 0;
          log(
            `Esperei ${Math.round(GROUP_SYNC_TIMEOUT_MS / 60000)}min pela sincronização da caçada em grupo e nada aconteceu — desisti da espera e voltei ao fluxo normal. Confira se todas as contas do time estão abertas, no modo "Em grupo" e com "Auto aceitar convite" ligado.`,
            true
          );
          sendState();
        } else {
          return;
        }
      }

      if (!isHunting()) {
        // v0.11.10 — fora da caçada o detector não tem o que medir: o que
        // aprendeu era daquela instância, e o tempo parado aqui não é seca.
        //
        // v0.11.14 — o `if (spawnWatch.ultimoSpawnEm)` que existia aqui virou
        // um furo quando entrou o rastro de posição: andando pela CIDADE não
        // nasce criatura nenhuma, então `ultimoSpawnEm` fica 0, a limpeza não
        // rodava, e o vaivém na cidade fechava uma "volta sem matar nada" que
        // acusaria spawn seco no primeiro segundo da caçada seguinte. Agora
        // limpa sempre — é barato e não deixa estado velho atravessar.
        zerarDeteccaoDeSpawn();
        // v0.9.15 — VENDA AUTOMÁTICA AO CHEGAR NA CIDADE (pedido do André).
        // Roda ANTES de qualquer decisão de voltar a caçar, e vale pros dois
        // modos: não importa QUEM tirou o personagem da caçada (a própria
        // capacidade, a capacidade de outro membro da party, stamina zerada
        // ou saída manual) — se está na cidade e ainda não vendeu nesta ida,
        // vende uma vez só. É isso que mantém o time "mais ou menos próximo"
        // depois que a party inteira cai da caçada junto.
        if (cfg.autoSellOnCityArrival !== false && !soldSinceArrivingInCity && isInCity()) {
          const huntBefore = currentHuntNameCache || cfg.huntName;
          await sellLootOnce(cfg, "Cheguei na cidade");
          if (!running) return;
          await afterSellingDecideNext(cfg, huntBefore);
          consecutiveErrors = 0;
          return;
        }

        // v0.9.31 — daqui pra baixo o tick pode INICIAR uma caçada, e é a
        // única decisão que não dá pra desfazer barato (abre o seletor por
        // cima do jogo). O HUD monta em pedaços: a barra do personagem pode
        // já estar na tela enquanto o botão "Sair da caçada" ainda não foi
        // desenhado — e aí `isHunting()` mentiria de novo, do mesmo jeito que
        // no bug de reabrir o app caçando. Um tick de folga depois que o HUD
        // apareceu resolve, e não atrasa nada em regime normal (o timestamp
        // fica velho depois dos primeiros segundos).
        if (Date.now() - gameUiReadySince < GAME_UI_SETTLE_MS) return;

        // v0.9.9 (revisado na v0.9.12) — Modo "Em grupo". A decisão original
        // era: automação NUNCA inicia caçada sozinha nesse modo, pra sempre
        // esperar convite/entrada manual — só que isso foi decidido ANTES de
        // saber que "Iniciar com o time" manda um convite de verdade (só
        // confirmado ao vivo em 09/09/2026, ver CLAUDE.md). André: "o que
        // você precisa arrumar e fazer iniciar a caçada em grupo é no botão
        // em grupo" — agora o LÍDER da party pode sim iniciar sozinho,
        // mandando o convite de verdade pro time; quem NÃO é líder continua
        // só esperando (o próprio jogo só deixa o líder iniciar).
        if (cfg.huntMode === "group") {
          if (!souLider(cfg)) {
            updatePanelStatus("Aguardando caçada em grupo");
            return;
          }
          if (!hasEnoughStaminaToHunt(cfg)) {
            // Sem rodízio aqui de propósito: trocar de personagem sendo LÍDER
            // desmontaria a party. No modo Em grupo a única ação de rotina
            // que faz sentido é esperar a stamina.
            reportNoStamina(cfg);
            return;
          }
          if (!cfg.huntName) {
            updatePanelStatus("Aguardando caçada em grupo");
            if (Date.now() - lastNoHuntConfiguredLogAt >= STAMINA_LOG_INTERVAL_MS) {
              lastNoHuntConfiguredLogAt = Date.now();
              log('Modo "Em grupo", líder: nenhuma caçada configurada na aba Caçada — escolha uma pra eu poder mandar o convite.');
            }
            return;
          }
          updatePanelStatus("Iniciando caçada em grupo");
          log(`Líder da party, modo "Em grupo": mandando convite de caçada em grupo pra "${cfg.huntName}"...`);
          await ensureHunting(cfg, cfg.huntName, true);
          updatePanelStatus("Caçando");
          log(`Convite aceito — caçando "${currentHuntNameCache || cfg.huntName}" em grupo.`);
          consecutiveErrors = 0;
          lastStaminaLogAt = 0;
          return;
        }
        // v0.5.0 — o jogo tira o personagem sozinho da caçada quando a
        // stamina zera. Sem essa checagem, o monitor tentava re-entrar a
        // cada tick de 4s com a stamina ainda em 0, entrando e saindo sem
        // sentido (mesma classe de bug já resolvida no Auto Bestiary da
        // extensão Chrome, v0.17.5 — ver huntera-automacao/CLAUDE.md).
        if (!hasEnoughStaminaToHunt(cfg)) {
          // v0.9.18 — antes de simplesmente esperar a stamina regenerar,
          // tenta passar a vez pro próximo personagem da fila (se o rodízio
          // estiver ligado). Trocou = este ciclo acaba aqui; quem assume é o
          // personagem novo, no próximo tick.
          if (await tryRotateCharacter(cfg)) return;
          // v0.11.8 — treinando com a stamina no fim é exatamente o que o
          // treino existe pra fazer: reporta isso em vez de "Aguardando
          // stamina", que daria a impressão de que a conta está à toa.
          if (isTraining()) {
            updatePanelStatus(`Treinando ${getTrainingSkill() || ""}`.trim());
            return;
          }
          reportNoStamina(cfg);
          return;
        }
        // v0.11.12 — EXPEDIÇÃO manda na escolha da caçada. Roda antes da
        // decisão normal: se houver objetivo pendente, a caçada configurada
        // cede a vez. Só no modo Solo (trocar de caçada em grupo desmonta o
        // time) e só quando o catálogo do tipo 42 já chegou.
        if (cfg.expeditionEnabled && cfg.huntMode !== "group" && guild.cacadas.length) {
          const alvo = escolherObjetivoDaExpedicao(currentHuntNameCache || cfg.huntName);
          if (alvo) {
            const escolha = cacadaParaCriaturas(alvo.criaturas);
            // v0.11.26 — SEM O MAPA, A FEATURE NÃO FAZ NADA — E ISSO PRECISA
            // APARECER. Era o pior tipo de falha que tem neste projeto: a
            // expedição ficava ligada, o objetivo era escolhido, e nada
            // acontecia porque a lista de criaturas vinha vazia (painel de
            // expedição fechado). Sem log, sem status, sem pista.
            if (!escolha) {
              if (guild.avisoMapaEm !== alvo.objectiveId) {
                guild.avisoMapaEm = alvo.objectiveId;
                log(
                  alvo.criaturas.length
                    ? `Expedição "${alvo.label}": nenhuma caçada do catálogo mata ${alvo.criaturas.join(" ou ")} — não tenho pra onde mandar o personagem.`
                    : `Expedição "${alvo.label}": ainda não sei quais criaturas contam pra esse objetivo. Abra o painel de expedição do jogo UMA vez com esta conta — eu leio a lista e guardo, e a partir daí funciona sozinho.`,
                  true
                );
              }
            }
            if (escolha) {
              const jaEstou = (currentHuntNameCache || cfg.huntName) === escolha.nome;
              if (guild.objetivoEscolhido !== alvo.objectiveId) {
                guild.objetivoEscolhido = alvo.objectiveId;
                guild.avisoMapaEm = null;
                log(
                  `Expedição: "${alvo.label}" está em ${alvo.progress}/${alvo.quota} — caçando ${escolha.nome}` +
                    (escolha.tier ? ` no ${escolha.tier}` : "") +
                    ` pra matar ${alvo.criaturas.join(" e ")}.`
                );
              }
              if (!jaEstou) {
                updatePanelStatus("Indo pra expedição");
                await ensureHunting({ ...cfg, pullLevel: TIER_MAIS_DIFICIL }, escolha.nome);
                updatePanelStatus("Caçando (expedição)");
                consecutiveErrors = 0;
                lastStaminaLogAt = 0;
                return;
              }
            }
          } else if (guild.objetivoEscolhido) {
            guild.objetivoEscolhido = null;
            log("Expedição: todos os objetivos de hoje estão concluídos — voltando pra caçada configurada.");
          }
        }

        // v0.11.8 — tem stamina e a automação quer caçar, mas o personagem
        // pode estar treinando. Decisão do André (12/09/2026): NÃO cancelar
        // antes — inicia a caçada por cima e deixa o jogo resolver. Como "o
        // jogo cancela sozinho" é suposição e não foi testado ao vivo, a rede
        // de segurança vem logo depois de a caçada começar.
        const estavaTreinando = isTraining();
        updatePanelStatus("Iniciando caçada");
        // v0.13.0 — checa o Auto Bestiary ANTES de decidir o que retomar: se
        // a última caçada bateu a fase-alvo bem no instante em que o
        // personagem caiu (bag cheia, stamina, spawn seco), quem retoma já
        // deve ser a PRÓXIMA da lista, não a que acabou de terminar.
        if (cfg.bestiaryLadder && cfg.bestiaryLadder.enabled && !cfg.expeditionEnabled && cfg.huntMode !== "group") {
          processarAvancoDoBestiaryLadder(cfg);
        }
        log("Personagem não está caçando e já tem stamina suficiente — retomando a caçada configurada...");
        await ensureHunting(cfg, nomeDoBestiaryLadder(cfg));
        if (estavaTreinando && isTraining()) {
          await cancelTraining();
          log("A caçada começou e o treino continuou ativo — cancelei o treino pra não ficar com os dois ao mesmo tempo.");
        }
        updatePanelStatus("Caçando");
        log(`De volta caçando "${currentHuntNameCache || cfg.huntName}". Monitorando capacidade e stamina...`);
        consecutiveErrors = 0;
        lastStaminaLogAt = 0;
        return;
      }

      // v0.11.27 — EXPEDIÇÃO PODE TIRAR O PERSONAGEM DE UMA CAÇADA QUE NÃO
      // SERVE PRA NADA.
      //
      // Antes, a decisão de expedição só rodava no trecho de "não está
      // caçando". Ligar a expedição no meio de uma caçada não tinha efeito
      // nenhum até o personagem sair por conta própria — bag cheia, stamina ou
      // spawn seco. Na conta medida isso deu 2 ciclos em 1h04: meia hora sem
      // reagir, com o painel prometendo que "a expedição manda na escolha da
      // caçada".
      //
      // Decisão do André: sai SÓ se a caçada atual não mata nada de nenhum
      // objetivo pendente. Se serve, fica — trocar à toa perde o loot na bag e
      // o tempo de transição.
      if (cfg.expeditionEnabled && cfg.huntMode !== "group" && guild.cacadas.length) {
        const troca = avaliarTrocaPorExpedicao(cfg);
        if (troca) {
          expedicaoUltimaTrocaEm = Date.now();
          log(
            `Expedição: "${troca.alvo.label}" está em ${troca.alvo.progress}/${troca.alvo.quota} e ${troca.atual} não mata nenhuma criatura dos objetivos pendentes — indo pra ${troca.escolha.nome}` +
              (troca.escolha.tier ? ` no ${troca.escolha.tier}` : "") +
              "."
          );
          updatePanelStatus("Indo pra expedição");
          await leaveHunt();
          zerarDeteccaoDeSpawn();
          await ensureHunting({ ...cfg, pullLevel: TIER_MAIS_DIFICIL }, troca.escolha.nome);
          updatePanelStatus("Caçando (expedição)");
          consecutiveErrors = 0;
          return;
        }
      }

      // v0.13.0 — AUTO BESTIARY (Ladder) NO MEIO DA CAÇADA. Mesma ideia da
      // troca por expedição acima: não espera o spawn secar (podia levar
      // minutos) nem o personagem cair sozinho — assim que o tipo 92 confirma
      // que a fase-alvo foi atingida, troca na hora. Mutuamente exclusivo com
      // expedição por enquanto (pendência igual à do huntera-automacao pra
      // Escada/Auto Bestiary — reconciliar as duas é trabalho futuro, não
      // pedido ainda).
      if (cfg.bestiaryLadder && cfg.bestiaryLadder.enabled && !cfg.expeditionEnabled && cfg.huntMode !== "group") {
        if (processarAvancoDoBestiaryLadder(cfg)) {
          const destino = nomeDoBestiaryLadder(cfg);
          const atualNome = currentHuntNameCache || cfg.huntName;
          if (destino && destino !== atualNome) {
            updatePanelStatus("Indo pra próxima do Auto Bestiary");
            await leaveHunt();
            zerarDeteccaoDeSpawn();
            await ensureHunting(cfg, destino);
            updatePanelStatus("Caçando (Auto Bestiary)");
            log(`Auto Bestiary: caçando "${destino}" agora.`);
            consecutiveErrors = 0;
            return;
          }
        }
      }

      // v0.11.10 — SPAWN SECO. Vale pra caçada normal e pra expedição: o
      // critério não olha QUAL caçada é, só se ela parou de produzir bicho.
      // Só no modo Solo — sair da caçada no modo Em grupo desmontaria a
      // sincronização do time.
      if (spawnCfg.enabled && cfg.huntMode !== "group") {
        gravarPerfilSePassouTempo();
        const seco = avaliarSpawnSeco();
        // Uma reentrada por vez: depois de reentrar, o detector precisa de
        // amostra nova antes de poder concluir qualquer coisa de novo.
        if (seco && Date.now() - spawnUltimaReentradaEm > 60000) {
          spawnUltimaReentradaEm = Date.now();
          const caçadaAtual = currentHuntNameCache || cfg.huntName;
          // v0.11.30 — RENOVAR NÃO PODE SIGNIFICAR ABANDONAR A EXPEDIÇÃO.
          // Antes daqui saía `ensureHunting(cfg, caçadaAtual)`: reentrava com
          // o tier do menu (não o mais difícil) e, quando o cache do nome não
          // estava quente, com `cfg.huntName` — ou seja, a caçada principal.
          // Era o segundo caminho que tirava o personagem da expedição sem
          // ninguém ter pedido.
          const alvo = alvoDeCacada(cfg, caçadaAtual);
          const destino = alvo.nome || caçadaAtual;
          const seg = Math.round(seco.parado / 1000);
          log(
            (seco.motivo === "volta"
              ? "Spawn esgotado: o personagem deu uma volta completa na caçada sem matar nada"
              : seco.motivo === "andou"
                ? `Spawn esgotado: andou ${seco.tiles} tiles sem matar nada e sem nada vivo por perto (o normal nesta caçada é ${seco.tilesTipicos}, o limite é ${seco.limiarTiles})`
                : seco.motivo === "lote"
                  ? `Spawn esgotado: ${seg}s sem nascer um lote novo de criaturas (o normal nesta caçada é um a cada ${Math.round(seco.tipico / 1000)}s, medido em ${seco.lotes} lotes)`
              : `Spawn esgotado: ${seg}s sem nascer nenhuma criatura e nada vivo por perto`) +
              (seco.motivo !== "andou" && seco.motivo !== "lote" && seco.tipico >= 1000
                ? ` (o normal aqui é uma a cada ${Math.round(seco.tipico / 1000)}s)`
                : "") +
              (destino === caçadaAtual
                ? " — saindo e entrando de novo pra renovar a caçada."
                : ` — saindo e indo pra "${destino}".`)
          );
          updatePanelStatus("Renovando a caçada");
          await leaveHunt();
          zerarDeteccaoDeSpawn();
          // Mudou de mapa: conta como troca de expedição, pra não virar
          // carrossel se dois objetivos ficarem empatados.
          if (alvo.expedicao && destino !== caçadaAtual) expedicaoUltimaTrocaEm = Date.now();
          await ensureHunting({ ...cfg, pullLevel: alvo.pullLevel }, destino);
          updatePanelStatus(alvo.expedicao ? "Caçando (expedição)" : "Caçando");
          log(
            alvo.expedicao
              ? `De volta em "${destino}" com o spawn renovado, seguindo na expedição "${alvo.objetivo.label}" (${alvo.objetivo.progress}/${alvo.objetivo.quota}).`
              : `De volta em "${destino}" com o spawn renovado.`
          );
          return;
        }
      }

      // v0.11.22 — O RÓTULO PRECISA REFLETIR O ESTADO ESTÁVEL, NÃO SÓ AS
      // TRANSIÇÕES.
      //
      // Bug reportado pelo André: personagem caçando há minutos e o painel
      // dizendo "Iniciando" nas duas contas. O `startBot()` escrevia
      // "Iniciando" e, se o personagem JÁ estava na caçada, o tick chegava
      // aqui e dava `return` sem nunca escrever outro rótulo. Ou seja, o texto
      // só mudava quando alguma coisa ACONTECIA; caçada correndo bem não é um
      // acontecimento, e ficava congelado no primeiro rótulo pra sempre.
      //
      // Ele achou que era falha de leitura por WebSocket. Não era — o
      // `isHunting()` estava certo o tempo todo; quem mentia era a etiqueta.
      updatePanelStatus(`Caçando${currentHuntNameCache ? ` "${currentHuntNameCache}"` : ""}`);

      const remaining = getCapacityRemaining();
      if (remaining === null || remaining > cfg.capacityThreshold) return;

      await runSellAndReturnCycle(cfg);
      consecutiveErrors = 0;
    } catch (err) {
      // v0.11.9 — SERVER SAVE / QUEDA DO SERVIDOR NÃO É DEFEITO DA AUTOMAÇÃO.
      //
      // Problema reportado pelo André (13/09/2026): todo dia às 12:00 tem
      // server save; o personagem é relogado pelo "Retomar sessão", mas a
      // caçada não volta. A causa está aqui: enquanto o jogo está fora, o
      // tick continua tentando, cada tentativa vira erro, e no TERCEIRO a
      // automação se desliga "por segurança" e grava `running: false`. Depois
      // que o servidor volta não existe mais nada ligado pra retomar a caçada
      // — e como o `running: false` fica salvo, nem recarregar o app resolve.
      //
      // Consertar isso NÃO exige detectar "server save", e é bom que não
      // exija: ele não tem hora nem duração fixa (5 minutos ou horas, depende
      // da atualização). A regra é de estado, não de relógio: se o jogo não
      // está na tela, não houve erro DA AUTOMAÇÃO — houve ausência de jogo.
      // Então não conta erro, não desliga, e espera o tempo que for preciso.
      if (!isGameUiReady() || isOnCharacterList()) {
        updatePanelStatus(isOnCharacterList() ? "Aguardando personagem" : "Aguardando o jogo voltar");
        if (Date.now() - lastOutageLogAt >= STAMINA_LOG_INTERVAL_MS) {
          lastOutageLogAt = Date.now();
          log(
            "O jogo saiu do ar (server save ou queda de conexão) — a automação fica ligada esperando, sem contar isso como erro. Retomo a caçada assim que o personagem voltar."
          );
        }
        return;
      }
      consecutiveErrors++;
      // v0.9.15 — os dois `log()` daqui eram os ÚNICOS de caminho de falha
      // sem o `true` (que dispara a notificação no Telegram). Ou seja: "não
      // achei o menu do amigo" notificava, mas "a automação morreu e se
      // desligou sozinha" não. Invertido.
      log(`Erro: ${err.message}`, true);
      updatePanelStatus("Erro");
      if (consecutiveErrors >= 3) {
        log("3 erros seguidos — desligando a automação por segurança. Vou tentar religar sozinha quando o jogo estiver estável.", true);
        stopBot("erros");
      }
    } finally {
      isBusy = false;
    }
  }

  // v0.12.1 — FREIO NO OBSERVER DA CAPACIDADE.
  //
  // O observer é `subtree: true, characterData: true` no container de
  // capacidade, e disparava `monitorTick()` a cada mutação, SEM debounce. O HUD
  // do jogo mexe nesse subtree o tempo todo (vida, mana, cap mudam a cada
  // tick), então isso virava dezenas de ticks por segundo — e cada tick chama
  // `isGameUiReady()` → `queryVisible()` → `isVisible()`, que usa
  // `getComputedStyle` + `getClientRects()`. Isso é LAYOUT SÍNCRONO FORÇADO
  // dentro do loop de render do jogo: o padrão de livro de frame travado, e o
  // suspeito número um da travada reportada.
  //
  // 400ms colapsa a rajada num tick só e continua imperceptível pro que o
  // observer existe pra fazer (reagir à capacidade cruzar o limiar) — o poll de
  // 4s já era o piso aceito pra essa mesma decisão.
  const OBSERVER_DEBOUNCE_MS = 400;
  let observerDebounceTimer = null;

  function agendarMonitorTickDoObserver() {
    if (observerDebounceTimer) return;
    observerDebounceTimer = setTimeout(() => {
      observerDebounceTimer = null;
      perfWatcher("monitor-capacidade-observer", OBSERVER_DEBOUNCE_MS, "automação", monitorTick);
    }, OBSERVER_DEBOUNCE_MS);
  }

  function tryAttachCapacityObserver() {
    if (observer) return;
    const container = document.querySelector(SEL.capacityContainer);
    if (!container) return;
    observer = new MutationObserver(agendarMonitorTickDoObserver);
    observer.observe(container, { childList: true, characterData: true, subtree: true });
  }

  function startMonitoring() {
    stopMonitoring();
    tryAttachCapacityObserver();
    pollTimer = setInterval(() => {
      perfWatcher("monitor-capacidade", 4000, "automação", () => {
        tryAttachCapacityObserver();
        return monitorTick();
      });
    }, 4000);
    monitorTick();
  }

  function stopMonitoring() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    // v0.12.1 — sem isto, um tick já agendado pelo observer dispararia DEPOIS
    // do monitor ter sido desligado.
    if (observerDebounceTimer) {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // v0.9.14 — CAUSA RAIZ REAL do "modo Em grupo continua iniciando caçada
  // solo", achada pelo log que o André mandou (09/09/2026):
  //
  //   "Erro ao iniciar: Não consegui confirmar que a caçada 'Dragon Lair'
  //    iniciou." + "Automação ligada. Garantindo que a caçada configurada
  //    está ativa..."
  //
  // Essas duas linhas só existem AQUI, no `startBot()` — não no
  // `monitorTick()`. Ou seja: quando você clica "Ligar automação", quem
  // tenta iniciar a caçada é esta função, que tinha uma CÓPIA PRÓPRIA da
  // lógica e chamava `ensureHunting(cfg)` direto — sem olhar `huntMode`,
  // sem olhar `isPartyLeader` e sem passar `useTeamButton`. Resultado: pra
  // uma conta líder em modo "Em grupo", clicava "Iniciar caçada" (SOLO),
  // o jogo respondia com o diálogo "Quer começar sem o time?" (é isso que
  // ele pergunta quando o LÍDER tenta começar sozinho com party montada) e
  // o tratamento desse diálogo (v0.9.11/v0.9.13) nem rodava, porque ele
  // está atrás de `if (useTeamButton)` dentro do `ensureHunting`. Todos os
  // fixes anteriores (v0.9.10/v0.9.12) foram no `monitorTick`, que só roda
  // DEPOIS — por isso "continuava igual" a cada teste.
  //
  // Correção: `startBot()` não duplica mais essa lógica. O próprio
  // `startMonitoring()` já chama `monitorTick()` na hora, e o `monitorTick`
  // tem a lógica correta e única (solo x grupo, líder x membro, stamina,
  // useTeamButton, tratamento do diálogo). Uma fonte de verdade só.
  async function startBot() {
    if (running) return;
    const cfg = loadState();
    // No modo "Em grupo" a caçada configurada só importa pro LÍDER (quem
    // manda o convite) — membro nenhum precisa dela pra ligar a automação,
    // já que ele só espera o convite chegar.
    if (cfg.huntMode !== "group" && !cfg.huntName) {
      log("Configure uma caçada antes de ligar a automação (menu lateral).");
      return;
    }
    running = true;
    consecutiveErrors = 0;
    lastStaminaLogAt = 0;
    lastNoHuntConfiguredLogAt = 0;
    waitingForGameUi = false;
    // v0.11.9 — ligar (pelo botão ou pelo religamento automático) limpa o
    // carimbo de "me desliguei sozinha": o estado atual passa a ser ligado.
    saveState({ running: true, selfStoppedAt: 0 });
    updatePanelRunning(true);
    updatePanelStatus("Iniciando");
    log(
      cfg.huntMode === "group"
        ? `Automação ligada no modo "Em grupo"${souLider(cfg) ? " (líder da party — vou mandar o convite de caçada em grupo)" : " (membro — esperando o convite do líder)"}.`
        : "Automação ligada. Garantindo que a caçada configurada está ativa..."
    );
    startMonitoring();
  }

  // v0.11.9 — `motivo` distingue "o André desligou" de "a automação se
  // desligou sozinha depois de errar". Só o segundo caso pode religar sozinho.
  function stopBot(motivo) {
    running = false;
    stopMonitoring();
    // v0.9.15 — limpar TODO o estado transiente de sincronização em grupo.
    // Antes ficava grudado, com dois efeitos ruins de verdade: (1) desligar a
    // automação de um membro que estava em "memberWaitingInvite" continuava
    // reportando "já vendi, estou pronto" pro líder, que retomava a caçada
    // contando com alguém que nem está mais automatizado; (2) ao religar, o
    // `monitorTick` batia no `isAwaitingGroupHuntSync` e dava `return` em
    // todo tick — a conta nunca mais iniciava caçada nenhuma até um F5.
    isAwaitingGroupHuntSync = false;
    groupHuntSyncStatus = null;
    pendingGroupHuntName = null;
    awaitingGroupHuntSyncSince = 0;
    pendingResumeGroupHunt = false;
    soldSinceArrivingInCity = false;
    waitingForGameUi = false;
    // v0.9.15 — o nome da caçada em cache também: sem isso, trocar a caçada
    // no menu lateral com a automação desligada não tinha efeito ao religar.
    currentHuntNameCache = null;
    // v0.11.34 — o que a caçada ensinou até agora não pode morrer com o
    // desligamento.
    gravarPerfil();
    saveState({ running: false, selfStoppedAt: motivo === "erros" ? Date.now() : 0 });
    updatePanelRunning(false);
    updatePanelStatus("Parado");
    log("Automação desligada.");
    sendState();
  }

  // ---------- auto aceitar party (portado do huntera-automacao, "funcionando
  // de forma adequada" lá — ver CLAUDE.md daquele projeto). Roda
  // INDEPENDENTE do "Ligar automação" acima (é conveniência social, faz
  // sentido mesmo com o bot de caçada desligado), mas ainda respeita a
  // trava `isBusy` compartilhada pra nunca clicar em cima de um ciclo de
  // venda/retorno em andamento. Config lida fresca (`loadState()`) a cada
  // tick — mais simples que reagir a mudança de storage (não tem
  // equivalente ao `chrome.storage.onChanged` da extensão aqui: a config
  // muda só via `applyConfig()`, no mesmo contexto JS, então a próxima
  // leitura já pega o valor novo). ----------

  // A mensagem observada tem pelo menos duas variantes conhecidas
  // ("<Nome> está em outro mundo. Juntar-se?" / "<Nome> convidou você para a
  // party") — ver comentário original na extensão Chrome.
  function parseInviterName(msg) {
    if (!msg) return null;
    const patterns = [
      /^(.+?)\s+está em outro mundo\./i,
      /^(.+?)\s+convidou você para a party/i,
    ];
    for (const pattern of patterns) {
      const match = msg.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  }

  function isInviterAllowed(allowlist, inviterName) {
    if (!allowlist.length) return true; // lista vazia = aceita de qualquer um
    if (!inviterName) return false; // não deu pra identificar quem chamou — não arrisca
    const normalized = inviterName.trim().toLowerCase();
    return allowlist.some((n) => n.toLowerCase() === normalized);
  }

  async function tryAutoAcceptParty() {
    const cfg = loadState();
    if (!cfg.autoAcceptParty || isBusy || !licensed) return;
    const dialog = queryVisible(document, SEL.partyInviteDialog);
    if (!dialog) {
      lastSkippedInviteMsg = null; // convite anterior sumiu — próximo pode logar de novo
      return;
    }
    const enterBtn = findButtonByExactText(dialog, "Entrar");
    if (!enterBtn) return;

    const msgEl = dialog.querySelector(SEL.partyInviteMsg);
    const msg = msgEl ? msgEl.textContent.trim() : "";
    const inviterName = parseInviterName(msg);

    if (!isInviterAllowed(cfg.autoAcceptPartyAllowlist, inviterName)) {
      if (msg !== lastSkippedInviteMsg) {
        lastSkippedInviteMsg = msg;
        log(`Convite de party ignorado — "${inviterName || "remetente desconhecido"}" não está na lista de quem pode aceitar.`);
      }
      return;
    }

    isBusy = true;
    try {
      await humanClick(enterBtn);
      log(`Convite de party aceito automaticamente${msg ? ` — "${msg}"` : ""}.`);
    } catch (err) {
      log(`Erro ao tentar aceitar convite de party: ${err.message}`, true);
    } finally {
      isBusy = false;
    }
  }

  // Extrai quem começou a caçada em grupo, de "<Nome> começou <Caçada>.
  // Encontrar na chama mística?".
  function parseGroupHuntStarterName(msg) {
    if (!msg) return null;
    const match = msg.match(/^(.+?)\s+começou\s+/i);
    return match ? match[1].trim() : null;
  }

  // Reusa o MESMO toggle/Friend List do convite de party comum (pro André é
  // a mesma ideia — "aceitar convite automático de quem eu confio" — só que
  // num diálogo diferente, botão "Aceitar" em vez de "Entrar"). Roda a
  // sincronização do EK PRIMEIRO (dentro da MESMA trava `isBusy`): depois de
  // aceitar, esse diálogo some pra sempre e o roster não dá mais pra ler.
  // v0.11.17 — tem convite de caçada em grupo esperando resposta?
  // true / false / null, e o `null` (tipo 51 ainda não chegou nesta sessão)
  // mantém o comportamento antigo de varrer o DOM.
  function conviteDeGrupoPendente() {
    if (!grupo.em) return null;
    return grupo.podeResponder && !grupo.euAceitei;
  }

  async function tryAutoAcceptGroupHunt() {
    if (isBusy || !licensed) return;
    // O toggle e o modo são a autorização desta feature. Testá-los antes de
    // procurar o diálogo evita uma varredura DOM a cada 1,2s em contas que não
    // usam party, sem alterar o fallback quando a feature está habilitada.
    const cfg = loadState();
    if (!cfg.autoAcceptParty && cfg.huntMode !== "group") return;
    // O servidor já disse que não tem nada pra responder — não precisa
    // procurar diálogo nenhum. Só confia no "não" quando o protocolo falou;
    // no silêncio dele, segue varrendo o DOM como antes.
    if (conviteDeGrupoPendente() === false) {
      lastSkippedGroupHuntMsg = null;
      return;
    }
    const dialog = queryVisible(document, SEL.groupHuntInviteDialog);
    if (!dialog) {
      lastSkippedGroupHuntMsg = null;
      return;
    }

    isBusy = true;
    try {
      await syncEkTargetIfNeeded();

      // v0.9.15 — no modo "Em grupo" o convite de caçada é o ÚNICO jeito da
      // conta voltar a caçar, então não pode depender de um toggle de outra
      // aba. Antes, uma conta em modo grupo com "Auto aceitar convite de
      // party" desligado nunca aceitava nada: ela travava esperando, o líder
      // tomava "ninguém aceitou a tempo (60s)" e, com 3 desses, a automação
      // dele se desligava sozinha — tudo sem nenhuma pista na tela.
      const dialogNow = queryVisible(document, SEL.groupHuntInviteDialog);
      if (!dialogNow) return; // sumiu sozinho enquanto sincronizava (raro)
      const acceptBtn = findButtonByExactText(dialogNow, "Aceitar");
      if (!acceptBtn) return;

      const msgEl = dialogNow.querySelector(SEL.partyInviteMsg);
      const msg = msgEl ? msgEl.textContent.trim() : "";
      const starterName = parseGroupHuntStarterName(msg);

      if (!isInviterAllowed(cfg.autoAcceptPartyAllowlist, starterName)) {
        if (msg !== lastSkippedGroupHuntMsg) {
          lastSkippedGroupHuntMsg = msg;
          log(`Convite de caçada em grupo ignorado — "${starterName || "remetente desconhecido"}" não está na lista de quem pode aceitar.`);
        }
        return;
      }

      await humanClick(acceptBtn);
      log(`Convite de caçada em grupo aceito automaticamente${msg ? ` — "${msg}"` : ""}.`);
    } catch (err) {
      log(`Erro ao tentar aceitar convite de caçada em grupo: ${err.message}`, true);
    } finally {
      isBusy = false;
    }
  }

  function startPartyInviteWatcher() {
    if (partyInvitePollTimer) return;
    partyInvitePollTimer = setInterval(() => {
      perfWatcher("aceitar-party", 1200, "autoAcceptParty", tryAutoAcceptParty);
      perfWatcher("aceitar-cacada-grupo", 1200, "autoAcceptParty/huntMode", tryAutoAcceptGroupHunt);
    }, 1200);
  }

  // ---------- v0.9.6 — auto convidar pra party (via Lista de amigos) ----------
  //
  // André: "eu quero uma feature de convidar pt para ir para caçada no
  // multi hunt... não temos o convite de hunt em grupo. o principal da PT
  // poderia ser classificado. inclusive poderiamos ter um auto convite
  // também da Party". Escolhido via AskUserQuestion: gatilho totalmente
  // automático, líder marcado manualmente por conta (`isPartyLeader`), dois
  // toggles separados (só o de Party implementado aqui — o de Caçada em
  // Grupo fica pra quando der pra confirmar os seletores de ENVIO com o
  // André fora de uma party de verdade). Seletores confirmados ao vivo em
  // 08/09/2026 (ver huntera-automacao/CLAUDE.md, seção "Lista de amigos +
  // ENVIAR convite de party"). Convidar é só por CLIQUE DIREITO na linha do
  // amigo — não tem botão visível.

  function getPartyMemberNames() {
    // v0.11.22 — pelo tipo 72 não depende de a janela de party estar ABERTA,
    // que era a condição silenciosa do seletor `.party-window .party-name`:
    // com a janela fechada a lista vinha vazia, e "vazia" é indistinguível de
    // "não tem party" pra quem chama.
    if (party.em && party.membros.length) {
      return party.membros.map((m) => (m && m.name ? String(m.name).trim() : "")).filter(Boolean);
    }
    return Array.from(document.querySelectorAll(SEL.partyMemberNames))
      .map((el) => el.textContent.trim())
      .filter(Boolean);
  }

  function getFriendsNavButton() {
    return queryVisible(document, SEL.friendsNavBtn);
  }

  async function ensureFriendsWindowOpen() {
    if (queryVisible(document, SEL.friendsWindow)) return true;
    const openBtn = await waitFor(() => getFriendsNavButton(), 10000);
    if (!openBtn) return false;
    await humanClick(openBtn);
    return !!(await waitFor(() => queryVisible(document, SEL.friendsWindow), 4000));
  }

  async function closeFriendsWindow() {
    const win = document.querySelector(SEL.friendsWindow);
    if (!win) return;
    const btn = win.querySelector(SEL.closeModalBtn);
    if (btn) await humanClick(btn);
  }

  function findFriendRow(win, name) {
    const normalized = name.trim().toLowerCase();
    const rows = Array.from(win.querySelectorAll(SEL.friendsEntries));
    return (
      rows.find((row) => {
        const nameEl = row.querySelector(SEL.friendsEntryName);
        return nameEl && nameEl.textContent.trim().toLowerCase() === normalized;
      }) || null
    );
  }

  // v0.9.6 — André: "se o personagem não estiver na lista de amigos,
  // também adicione na lista de amigos". Não testado ao vivo o que
  // acontece depois de clicar "Adicionar" (evitado de propósito durante a
  // investigação, pra não mandar pedido de amizade de verdade) — a
  // automação tenta, loga o que fez, e só confirma "amigo de verdade" no
  // próximo ciclo (quando a linha aparecer em `friendsEntries`).
  async function tryAddFriend(win, name) {
    const input = win.querySelector(SEL.friendsSearchInput);
    const addBtn = findButtonByExactText(win, "Adicionar");
    if (!input || !addBtn) return false;
    setInputValue(input, name);
    await sleep(300);
    await humanClick(addBtn);
    return true;
  }

  async function tryAutoInviteParty() {
    if (isBusy || !licensed) return;
    const cfg = loadState();
    if (!cfg.autoInvitePartyEnabled || !souLider(cfg)) return;
    const targets = (cfg.autoInvitePartyTargets || []).map((s) => s.trim()).filter(Boolean);
    if (!targets.length) return;

    const currentMembers = getPartyMemberNames().map((n) => n.toLowerCase());
    const missing = targets.filter((t) => !currentMembers.includes(t.toLowerCase()));
    if (!missing.length) {
      // v0.9.7 — André: "quando o bot identificar que está na party, deve
      // fechar a janela de amigos". Todo mundo configurado já está na
      // party — a janela não tem mais função aqui. Fecha mesmo que já
      // estivesse aberta antes deste ciclo (não só quando foi a própria
      // automação que abriu agora), porque é exatamente o caso real que
      // deixava a janela aberta pra sempre: ela ficou aberta de um ciclo
      // anterior (ex.: o alvo aceitou o convite rápido demais, antes do
      // `finally` de baixo rodar de novo) e nenhum ciclo seguinte tocava
      // nela de novo.
      if (queryVisible(document, SEL.friendsWindow)) await closeFriendsWindow();
      return;
    }

    // um alvo por ciclo — evita disparar vários cliques em sequência rápida
    const target = missing[0];
    const alreadyOpen = !!queryVisible(document, SEL.friendsWindow);

    isBusy = true;
    try {
      const opened = await ensureFriendsWindowOpen();
      if (!opened) {
        log("Aviso: não consegui abrir a Lista de amigos pra tentar convidar o time.", true);
        return;
      }
      const win = document.querySelector(SEL.friendsWindow);
      const row = findFriendRow(win, target);
      if (!row) {
        const added = await tryAddFriend(win, target);
        if (added) {
          log(`"${target}" ainda não estava na lista de amigos — pedido de amizade enviado. Convite de party é tentado assim que aparecer como amigo.`);
        }
        return;
      }

      await humanRightClick(row);
      const menu = await waitFor(() => document.querySelector(SEL.friendsContextMenu), 2000);
      if (!menu) {
        log(`Não consegui abrir o menu de opções de "${target}" na lista de amigos.`, true);
        return;
      }
      const inviteBtn = findButtonByExactText(menu, "Convidar para a party");
      if (!inviteBtn) {
        document.body.click(); // fecha o menu clicando fora, sem escolher nada
        return;
      }
      await humanClick(inviteBtn);
      log(`Convite de party enviado automaticamente pra "${target}".`);
    } catch (err) {
      log(`Erro ao tentar convidar "${target}" pra party: ${err.message}`, true);
    } finally {
      if (!alreadyOpen) await closeFriendsWindow();
      isBusy = false;
    }
  }

  function startAutoInvitePartyWatcher() {
    if (autoInvitePartyPollTimer) return;
    // 6s — convidar não é urgente feito aceitar; espaço suficiente pra
    // janela de amigos abrir/fechar/menu sem competir com outros watchers.
    autoInvitePartyPollTimer = setInterval(() => {
      perfWatcher("convidar-party", 6000, "autoInvitePartyEnabled", tryAutoInviteParty);
    }, 6000);
  }

  // ---------- v0.8.0 — auto retomar sessão (tela de seleção de personagem)
  // ----------
  //
  // Portado do huntera-automacao (extensão Chrome) v0.18.0, depois do André
  // pedir explicitamente ("faz uma varredura dessa tela para quando você
  // abrir o site ele já auto clicar em jogar") e confirmar em duas rodadas
  // — primeiro com um resumo da regra, depois com o texto exato da regra +
  // o precedente do "Bot Idle" — que essa era uma exceção deliberada e
  // permanente à regra "nunca automatizar login/reconexão", NUNCA uma
  // reversão dela. Escopo continua deliberadamente estreito: só clica
  // "Jogar" pra um personagem que JÁ ESTÁ na lista de seleção (ou seja, já
  // autenticado — essa tela nunca pede email/senha, só decide qual
  // personagem entrar). Nunca mexe em email/senha/"Trocar de conta"/"Sair
  // da conta". Se o personagem configurado não estiver na lista (nome
  // errado, digitado errado, ou é outra conta), NÃO clica em nada — melhor
  // não fazer nada do que clicar errado. Roda sempre, independente do
  // "Ligar automação" (mesmo padrão dos outros watchers sociais acima).
  async function tryAutoResumeSession() {
    if (isBusy || !licensed) return;
    let cfg = loadState();
    // Desligado manualmente significa "não agir"; o fallback de primeiro uso
    // abaixo continua intacto quando ainda não houve uma escolha manual.
    if (!cfg.autoResumeSessionEnabled && cfg.autoResumeSessionManuallyDisabled) return;
    if (!listaDePersonagensEstaVisivel()) return;

    // v0.9.4 — André testou a v0.9.3 e continuou parado na tela de seleção:
    // achei o problema — `autoResumeSessionCharacter`/`autoResumeSessionEnabled`
    // só são preenchidos sozinhos DEPOIS que um personagem já logou pelo
    // menos uma vez sob essa versão (via `startCharacterNameWatcher()`),
    // então na primeira vez que essa tela aparece (conta nunca vista por
    // essa automação ainda, ou app recém-atualizado) não tinha nada salvo
    // pra clicar — problema de "ovo e galinha". Fallback: se ainda não foi
    // ligado nem configurado, e não foi desligado manualmente antes, e a
    // conta só tem UM personagem na lista, não tem ambiguidade nenhuma
    // sobre "qual é o do último login" — adota esse como o alvo (salva
    // habilitado + o nome) sem precisar de nenhum login manual prévio pra
    // "ensinar" a conta. Com 2+ personagens continua sem adivinhar (exige
    // configurar manualmente OU um primeiro "Jogar" manual pra essa versão
    // aprender qual é o de verdade) — igual antes.
    if (!cfg.autoResumeSessionEnabled && !cfg.autoResumeSessionManuallyDisabled && !(cfg.autoResumeSessionCharacter || "").trim()) {
      const articles = Array.from(document.querySelectorAll(SEL.characterListItem));
      if (articles.length === 1) {
        const nameEl = articles[0].querySelector(SEL.characterMetaName);
        const soloName = nameEl ? nameEl.textContent.trim() : "";
        if (soloName) {
          saveState({ autoResumeSessionCharacter: soloName, autoResumeSessionEnabled: true });
          cfg = loadState();
        }
      }
    }

    if (!cfg.autoResumeSessionEnabled) return;
    const name = (cfg.autoResumeSessionCharacter || "").trim();
    if (!name) return;

    // v0.11.14 — ESCADA DE ESPERA DEPOIS DE UMA TENTATIVA QUE NÃO PEGOU.
    //
    // O poll aqui é de 1,5s e a confirmação espera 15s: durante um server save
    // isso vira um "Jogar" de verdade a cada ~16s, por horas, cada um com o
    // aviso "não confirmei o carregamento" — que ainda por cima é notificação
    // no Telegram. Era isso que o André viu como "ele fica tentando logar".
    //
    // Não dá pra usar o `servidorDePe()` aqui: nesta tela o socket do jogo
    // ainda nem existe, então o sinal honesto não está disponível — por isso
    // espera crescente, que é o que sobra quando não se sabe.
    if (Date.now() < resumeProximaTentativaEm) return;

    isBusy = true;
    try {
      const article = findCharacterArticle(name);
      if (!article) return; // personagem configurado não apareceu na lista — não adivinha
      const playBtn = findButtonByExactText(article, "Jogar");
      if (!playBtn) return;

      log(`Tela de seleção de personagem detectada — retomando sessão de "${name}"...`);
      await humanClick(playBtn);

      const loaded = await waitFor(() => queryVisible(document, SEL.characterHeaderName), 15000, 500);
      if (loaded) {
        resumeFalhas = 0;
        resumeProximaTentativaEm = 0;
        log(`Sessão retomada com "${name}".`);
      } else {
        const espera = RESUME_BACKOFF_MS[Math.min(resumeFalhas, RESUME_BACKOFF_MS.length - 1)];
        resumeFalhas++;
        resumeProximaTentativaEm = Date.now() + espera;
        const minutos = Math.round(espera / 60000);
        const quando = espera >= 60000 ? `${minutos}min` : `${Math.round(espera / 1000)}s`;
        // Avisa (com notificação) só na PRIMEIRA falha. Da segunda em diante o
        // silêncio é a informação: já foi dito que o jogo não está voltando.
        log(
          resumeFalhas === 1
            ? `Cliquei em "Jogar" pra retomar "${name}" e o jogo não carregou — provável server save. Vou tentar de novo em ${quando}, sem ficar insistindo.`
            : `"${name}" ainda não entrou (tentativa ${resumeFalhas}). Próxima em ${quando}.`,
          resumeFalhas === 1
        );
      }
    } catch (err) {
      log(`Erro ao tentar retomar sessão automaticamente: ${err.message}`, true);
    } finally {
      isBusy = false;
    }
  }

  // ---------- v0.9.18 — rodízio de personagens por stamina ----------
  // André: "trocar de personagem para gastar toda a stamina do outro
  // personagem e seguir na mesma caçada... desloga o personagem A e loga no
  // B e vai até finalizar stamina".
  //
  // IMPORTANTE — por que isso NÃO fere a regra fixa nº 1 (nunca automatizar
  // login): o "Sair do jogo" do menu de Opções volta pra LISTA DE
  // PERSONAGENS com a conta ainda conectada (o próprio botão diz isso, e foi
  // confirmado ao vivo em 10/09/2026). Daí pra frente é o mesmo caminho já
  // permitido do `autoResumeSession`: clicar "Jogar" num personagem que já
  // está na lista. Em nenhum momento se toca em email, senha, "Trocar de
  // conta" ou "Sair da conta" — se a tela pedir credencial, a automação não
  // faz nada.
  //
  // A caçada configurada NÃO muda: quem entra assume a mesma caçada, que é o
  // "seguir na mesma caçada" do pedido.
  function isStaminaExhausted(cfg) {
    const left = getStaminaRemainingMinutes();
    if (left === null) return false; // não deu pra ler — não arrisca trocar
    const floor = Number(cfg.rotateMinStaminaMinutes);
    return left <= (Number.isNaN(floor) ? 5 : floor);
  }

  // Próximo da fila, começando de quem está logado agora. Lista vazia = usa a
  // ordem que a própria tela de seleção mostrar.
  function nextCharacterInRotation(cfg, currentName, available) {
    const configured = (cfg.rotateCharacters || []).map((n) => n.trim()).filter(Boolean);
    const order = configured.length ? configured : available;
    if (!order.length) return null;
    const pool = order.filter((n) => available.some((a) => a.toLowerCase() === n.toLowerCase()));
    if (!pool.length) return null;
    const i = pool.findIndex((n) => n.toLowerCase() === (currentName || "").toLowerCase());
    // Se o atual não está na fila, começa do primeiro.
    const next = pool[(i + 1) % pool.length];
    return next && next.toLowerCase() !== (currentName || "").toLowerCase() ? next : null;
  }

  async function exitToCharacterList() {
    const navBtn = queryVisible(document, SEL.optionsNavBtn);
    if (!navBtn) throw new Error('Botão "Opções" não encontrado.');
    await humanClick(navBtn);
    const menu = await waitFor(() => queryVisible(document, SEL.optionsMenu), 4000);
    if (!menu) throw new Error("Menu de Opções não abriu.");
    const exitBtn = queryVisible(menu, SEL.optionsExitBtn);
    if (!exitBtn) {
      const closeBtn = queryVisible(menu, SEL.optionsCloseBtn);
      if (closeBtn) await humanClick(closeBtn);
      throw new Error('Botão "Sair do jogo" não encontrado no menu de Opções.');
    }
    await humanClick(exitBtn);
    const atList = await waitFor(() => queryVisible(document, SEL.characterListItem), 15000, 500);
    if (!atList) throw new Error('Cliquei em "Sair do jogo" mas a lista de personagens não apareceu.');
  }

  async function playCharacter(name) {
    const article = await waitFor(() => findCharacterArticle(name), 6000);
    if (!article) throw new Error(`"${name}" não apareceu na lista de personagens.`);
    const playBtn = findButtonByExactText(article, "Jogar");
    if (!playBtn) throw new Error(`Não achei o botão "Jogar" de "${name}".`);
    await humanClick(playBtn);
    const loaded = await waitFor(() => queryVisible(document, SEL.characterHeaderName), 20000, 500);
    if (!loaded) throw new Error(`Cliquei em "Jogar" pra "${name}" mas o jogo não carregou a tempo.`);
  }

  function listCharactersOnScreen() {
    return Array.from(document.querySelectorAll(SEL.characterListItem))
      .map((a) => {
        const el = a.querySelector(SEL.characterMetaName);
        return el ? el.textContent.trim() : null;
      })
      .filter(Boolean);
  }

  // Retorna true se trocou de personagem (o chamador deve encerrar o ciclo
  // atual — quem assume é o personagem novo, no próximo tick).
  async function tryRotateCharacter(cfg) {
    if (!cfg.rotateCharactersEnabled) return false;
    if (!isStaminaExhausted(cfg)) return false;

    const currentName = getActiveCharacterName();

    // Se já demos a volta na fila inteira e ninguém tinha stamina, parar de
    // trocar: acabou pra todo mundo. Fica esperando regenerar do jeito
    // normal, em vez de ficar entrando e saindo do jogo sem parar.
    const poolSize = ((cfg.rotateCharacters || []).filter(Boolean).length) || listCharactersOnScreen().length || 2;
    if (rotationsWithoutHunt >= poolSize) {
      if (Date.now() - lastStaminaLogAt >= STAMINA_LOG_INTERVAL_MS) {
        lastStaminaLogAt = Date.now();
        log(
          cfg.staminaWaitEnabled === false
            ? 'Todos os personagens do rodízio estão sem stamina, e "Esperar a stamina encher" está desligado — parei por aqui.'
            : "Todos os personagens do rodízio estão sem stamina — parei de trocar e vou esperar regenerar."
        );
      }
      return false;
    }

    updatePanelStatus("Trocando de personagem");
    log(
      `Stamina de "${currentName || "personagem atual"}" no fim (${formatStaminaMinutes(getStaminaRemainingMinutes())}) — saindo pra lista de personagens pra passar a vez.`
    );

    // A transição começa aqui. Limpar antes de sair impede que uma confirmação
    // já recebida pelo socket novo seja apagada depois de o HUD aparecer.
    euZerar();
    await exitToCharacterList();

    const available = listCharactersOnScreen();
    const next = nextCharacterInRotation(cfg, currentName, available);
    if (!next) {
      log(
        `Saí pra lista de personagens, mas não achei um próximo na fila do rodízio (disponíveis: ${available.join(", ") || "nenhum"}). Fico na lista — o "Retomar sessão automaticamente" pode reentrar quando você quiser.`,
        true
      );
      updatePanelStatus("Aguardando personagem");
      return true;
    }

    log(`Entrando com "${next}" pra seguir na mesma caçada...`);
    await playCharacter(next);
    // A partir daqui é outro personagem: o cache de caçada e a trava de venda
    // são do personagem anterior e não valem mais.
    currentHuntNameCache = null;
    soldSinceArrivingInCity = false;
    // O `autoResumeSession` guarda "o último personagem que logou" pra
    // retomar sozinho depois de um server save — atualiza pro que entrou
    // agora, senão ele tentaria voltar pro personagem sem stamina.
    saveState({ autoResumeSessionCharacter: next });
    rotationsWithoutHunt++;
    // v0.9.23 — outro personagem, outra sessão de estatística (senão o XP de
    // um entraria na conta do outro).
    novaSessaoStats("troca de personagem");
    log(`Agora jogando com "${next}". Seguindo na caçada configurada.`);
    updatePanelStatus("Iniciando caçada");
    return true;
  }

  // v0.11.4 — troca de personagem sob comando remoto (painel do site). Reusa
  // EXATAMENTE o mesmo caminho do rodízio automático acima (v0.9.18,
  // confirmado ao vivo em 10/09/2026 que "Sair do jogo" volta pra lista de
  // personagens com a conta ainda logada — nunca toca em email/senha/
  // "Trocar de conta"/"Sair da conta"): `exitToCharacterList()` +
  // `playCharacter(nome)`. A diferença é só QUEM decide trocar (o André
  // clicando no painel do celular, não a stamina acabando) — o mecanismo é
  // idêntico e já validado em produção.
  async function switchToCharacterNow(targetName) {
    if (!licensed) return { ok: false, error: "Sem licença ativa." };
    if (isBusy) return { ok: false, error: "Automação ocupada agora — tenta de novo em instantes." };
    const name = (targetName || "").trim();
    if (!name) return { ok: false, error: "Nome do personagem de destino não informado." };
    const current = getActiveCharacterName();
    if (current && current.toLowerCase() === name.toLowerCase()) {
      return { ok: true, alreadyThere: true };
    }
    isBusy = true;
    try {
      updatePanelStatus("Trocando de personagem");
      log(`Comando remoto (painel): trocando para "${name}"...`);
      // Mesma proteção do rodízio: a identidade antiga não atravessa a lista,
      // e não apagamos uma confirmação que chegue antes de `playCharacter`.
      euZerar();
      await exitToCharacterList();
      await playCharacter(name);
      // Mesma limpeza de estado que a troca automática já faz — cache de
      // caçada, trava de venda e tudo que o protocolo sabia do anterior.
      currentHuntNameCache = null;
      soldSinceArrivingInCity = false;
      saveState({ autoResumeSessionCharacter: name });
      novaSessaoStats("troca de personagem (comando remoto)");
      log(`Agora jogando com "${name}" (comando remoto).`);
      sendState();
      return { ok: true };
    } catch (err) {
      log(`Erro ao trocar pra "${name}" via comando remoto: ${err.message}`, true);
      return { ok: false, error: err.message || "Falha ao trocar de personagem." };
    } finally {
      isBusy = false;
    }
  }

  // v0.11.4 — "ir para cidade" sob comando remoto (painel do site). Reusa
  // `leaveHunt()` (v0.9.15/v0.9.17, mesmo botão "Sair da caçada" que o ciclo
  // normal do bot já clica sozinho quando a mochila enche) — aqui é só o
  // André decidindo manualmente do painel, em vez da automação decidir por
  // conta própria. Não vende nada sozinho (fica só "sair da caçada" — quem
  // decide vender é o André, pelo app, ou a automação no próximo ciclo).
  async function goToCityNow() {
    if (!licensed) return { ok: false, error: "Sem licença ativa." };
    if (isBusy) return { ok: false, error: "Automação ocupada agora — tenta de novo em instantes." };
    if (!isHunting()) return { ok: true, alreadyInCity: true };
    isBusy = true;
    try {
      updatePanelStatus("Indo para a cidade");
      log("Comando remoto (painel): indo para a cidade...");
      await leaveHunt();
      sendState();
      return { ok: true };
    } catch (err) {
      log(`Erro ao ir pra cidade via comando remoto: ${err.message}`, true);
      return { ok: false, error: err.message || "Falha ao ir para a cidade." };
    } finally {
      isBusy = false;
    }
  }

  // v0.9.20 — captura oportunista dos personagens da conta. Só leitura, sem
  // clicar em nada, e roda mesmo com `isBusy` (não disputa a trava). A tela
  // de seleção é o ÚNICO lugar onde esses nomes existem no DOM — por isso a
  // lista é guardada em vez de lida sob demanda.
  function harvestCharacterList() {
    if (!listaDePersonagensEstaVisivel()) return;
    const names = listCharactersOnScreen();
    if (!names.length) return;
    const known = loadState().knownCharacters || [];
    const igual = known.length === names.length && known.every((n, i) => n === names[i]);
    if (igual) return;
    saveState({ knownCharacters: names });
    log(`Personagens desta conta: ${names.join(", ")}.`);
    sendState();
  }

  function listaDePersonagensEstaVisivel() {
    const agora = Date.now();
    if (agora - listaPersonagensVisivelCache.em < LISTA_PERSONAGENS_CACHE_MS) {
      return listaPersonagensVisivelCache.visivel;
    }
    const visivel = !!queryVisible(document, SEL.characterListItem);
    listaPersonagensVisivelCache = { em: agora, visivel };
    return visivel;
  }

  // v0.9.20 — André: "o venda na cidade só funciona quando o ligar automação
  // está habilitado?". Funcionava, sim — a venda morava dentro do
  // `monitorTick`, que começa com `if (!running) return`. Mas ela é uma
  // conveniência que faz sentido sozinha (mesmo raciocínio dos watchers de
  // party, que já rodam independentes desde a v0.7.0): se o toggle está
  // ligado e o personagem chegou na cidade, vender o loot não depende de
  // estar caçando automaticamente.
  //
  // Com a automação LIGADA, quem cuida disso continua sendo o `monitorTick`
  // (que além de vender decide o que fazer depois: retomar, ou entrar na
  // sincronização do time). Aqui é só o caso de automação desligada: vende e
  // para por aí, sem tentar retomar caçada nenhuma.
  async function tryCitySellWhileIdle() {
    if (running || isBusy || !licensed) return;
    const cfg = loadState();
    if (cfg.autoSellOnCityArrival === false) return;
    if (isHunting()) {
      soldSinceArrivingInCity = false;
      return;
    }
    if (soldSinceArrivingInCity) return;
    if (!isInCity()) return;

    isBusy = true;
    try {
      await sellLootOnce(cfg, "Cheguei na cidade");
    } catch (err) {
      log(`Erro ao vender na cidade: ${err.message}`, true);
    } finally {
      isBusy = false;
    }
  }

  // v0.9.23 — André: "o analisador de caçada é só para premium... forçar um
  // close dele?". O painel do jogo NÃO tem botão de fechar — só
  // `.analyzer-minimize`, que alterna Expandir/Minimizar, e a própria section
  // ganha a classe `minimized` (confirmado ao vivo em 10/09/2026). Então
  // "fechar" aqui é deixar minimizado, que já devolve o canto da tela.
  //
  // Age UMA vez por aparição: se o André expandir de propósito depois, fica
  // expandido — um watcher que reminimiza a cada 4s seria briga, não ajuda.
  //
  // Nada aqui destrava o analisador pra conta free: isso é recurso pago do
  // jogo e continua pago. O que substitui ele é o analyzer próprio do bot,
  // montado com o que a automação já observa.
  // v0.9.28 — QUARTA tentativa, e desta vez sem esperteza nenhuma.
  //
  // Histórico das falhas, porque cada uma ensinou uma coisa:
  //   v0.9.23/25/26 — eu desconfiava do SELETOR do painel;
  //   v0.9.27 — descobri ao vivo que o `isVisible()` do projeto reprova esse
  //             painel (checkVisibility false, tamanho 0x0), então o código
  //             nem o encontrava. Corrigido, mas continuou não sumindo;
  //   v0.9.28 — no mesmo dump ao vivo a classe era
  //             "hunt-analyzer-window ui-scaled MINIMIZED wide" com o painel
  //             ABERTO na tela. Ou seja, a classe `minimized` não significa o
  //             que eu assumi, e o meu `if (classList.contains("minimized"))
  //             return;` fazia a função sair sem fazer nada, sempre.
  //
  // Conclusão: qualquer condição que eu derive do DOM desse painel tem chance
  // de estar errada, porque eu não consigo inspecionar a versão da conta free.
  // Então o caminho passa a ser o determinístico: se o toggle está ligado e o
  // painel está no DOM, ESCONDE. Sem checar classe, sem checar visibilidade,
  // sem depender de botão existir. É o que o André pediu ("fechar sempre") e
  // é a única coisa que não pode falhar em silêncio.
  //
  // Continua sendo só preferência de tela, reversível pelo toggle — não
  // destrava nada do recurso pago do jogo.
  function findGameAnalyzerWindow() {
    const porClasse = document.querySelector(SEL.huntAnalyzerWindow);
    if (porClasse) return porClasse;
    // Reserva: pelo título, que é igual nas duas versões do painel.
    const titulo = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,div,span,strong,p")).find(
      (el) => el.children.length === 0 && /^analisador de ca/i.test((el.textContent || "").trim())
    );
    if (!titulo) return null;
    let node = titulo.parentElement;
    for (let i = 0; i < 6 && node && node !== document.body; i++, node = node.parentElement) {
      if (node.tagName === "SECTION" || /(window|analyzer|panel)/i.test(String(node.className || ""))) return node;
    }
    return titulo.parentElement;
  }

  async function tryMinimizeGameAnalyzer() {
    if (!licensed) return;
    const cfg = loadState();
    // Se não fomos nós que escondemos nada, o toggle desligado não tem trabalho
    // pendente. Assim não procura o painel a cada 4s só para concluir "nada".
    if (cfg.minimizeGameAnalyzer === false && !analyzerMinimizedOnce) return;
    const win = findGameAnalyzerWindow();
    if (!win) {
      analyzerMinimizedOnce = false;
      return;
    }

    // Toggle desligado: devolve o painel se fomos nós que escondemos.
    if (cfg.minimizeGameAnalyzer === false) {
      if (win.dataset.hmHidden === "1") {
        win.style.removeProperty("display");
        delete win.dataset.hmHidden;
        log("Analisador de caçada do jogo devolvido (toggle desligado).");
      }
      analyzerMinimizedOnce = false;
      return;
    }

    // Já escondido por nós e continua escondido: nada a fazer.
    if (win.dataset.hmHidden === "1" && win.style.display === "none") return;

    // `!important` porque o CSS do jogo usa `!important` no próprio controle
    // de exibição desse painel (confirmado ao vivo: forçar display inline
    // simples não teve efeito).
    win.style.setProperty("display", "none", "important");
    win.dataset.hmHidden = "1";

    if (!analyzerMinimizedOnce) {
      analyzerMinimizedOnce = true;
      log(`Analisador de caçada do jogo escondido (painel: ${String(win.className || "(sem classe)")}).`);
    }
  }

  function startAnalyzerWatcher() {
    if (analyzerPollTimer) return;
    analyzerPollTimer = setInterval(() => perfWatcher("minimizar-analisador", 4000, "minimizeGameAnalyzer", tryMinimizeGameAnalyzer), 4000);
  }

  // ---------- v0.11.0 — "dias de uso" (Swag) ----------
  //
  // Só ATUALIZA a variável `licensed` — quem trava de verdade é cada função
  // de ação (`if (... || !licensed) return;`), igual o padrão já usado pra
  // `isBusy`. Sem chamada de rede aqui: `ipcRenderer.invoke` chega direto no
  // `ipcMain.handle("swag:getStatus")` do main.js, que já mantém o estado
  // atualizado sozinho (login/refresh/checagem periódica moram lá).
  async function refreshLicenseFlag() {
    if (!ipcRenderer) return;
    try {
      const status = await ipcRenderer.invoke("swag:getStatus");
      licensed = !!(status && status.licensed);
    } catch (err) {
      // Sem resposta (ex: main.js ainda subindo) — mantém o último valor
      // conhecido em vez de assumir liberado.
    }
  }

  function startLicenseWatcher() {
    if (licensePollTimer) return;
    refreshLicenseFlag();
    licensePollTimer = setInterval(() => perfWatcher("licenca", 30000, "sempre", refreshLicenseFlag), 30000);
  }

  // v0.11.10 — config global do detector de spawn seco. Mesmo padrão do
  // `refreshLicenseFlag`: só atualiza a variável, quem decide é quem age.
  async function refreshSpawnConfig() {
    if (!ipcRenderer) return;
    try {
      const cfg = await ipcRenderer.invoke("spawn:load");
      if (cfg) spawnCfg = cfg;
    } catch (err) {
      // Mantém o último valor conhecido em vez de assumir ligado.
    }
  }

  function startSpawnConfigWatcher() {
    if (spawnPollTimer) return;
    refreshSpawnConfig();
    spawnPollTimer = setInterval(() => perfWatcher("config-spawn", 30000, "sempre", refreshSpawnConfig), 30000);
  }

  // Intervalo TÍPICO entre nascimentos de criatura nesta caçada. Mediana, não
  // média: um intervalo gigante (entrou agora, ficou no menu) não deve
  // arrastar o limiar pra cima.
  function intervaloTipicoDeSpawn() {
    const xs = spawnWatch.intervalos.slice().sort((a, b) => a - b);
    if (xs.length < 8) return null; // amostra pequena demais pra concluir
    return xs[Math.floor(xs.length / 2)];
  }

  // "A caçada secou?" — nenhuma criatura viva E faz muito mais tempo que o
  // normal desde o último nascimento. O limiar é aprendido: num personagem que
  // mata a cada 4s, 90s já é gritante; num que leva 40s por bicho, não é.
  function avaliarSpawnSeco() {
    if (!spawnWatch.ativo || !spawnWatch.ultimoSpawnEm) return null;
    if (spawnWatch.vivos.size > 0) return null;

    // v0.11.14 — CRITÉRIO FORTE, e o que o André pediu de verdade: o
    // personagem deu uma volta inteira na rotação e não matou NADA. Não
    // depende de calibrar tempo nenhum — se a volta fechou sem morte, o spot
    // está seco, seja o personagem rápido ou lento.
    if (spawnWatch.mortesNaVoltaAnterior === 0 && spawnWatch.voltaEm) {
      return {
        motivo: "volta",
        parado: Date.now() - spawnWatch.ultimoSpawnEm,
        limiar: 0,
        tipico: intervaloTipicoDeSpawn(),
      };
    }

    // v0.11.33 — ANDOU MUITO SEM MATAR NADA.
    //
    // Este é o critério que responde à queixa do André ("o boneco anda
    // bastante tempo sem bicho na tela", "ainda acho que demora demaaais"), e
    // ele existe porque o critério de TEMPO quase nunca calibra: o ritmo de
    // spawn só é aprendido a partir de 8 intervalos, e nas caçadas em que o
    // bicho nasce em LOTE a maioria dos intervalos é de milissegundos e é
    // descartada — o painel dele mostrava "aprendendo o ritmo (0/8)" com a
    // caçada rodando. Sem ritmo aprendido, o limiar cai no piso de 90s SEMPRE.
    //
    // Tiles não têm esse problema: toda morte gera uma amostra, sempre.
    // Simulado contra as capturas reais (229 mortes, quatro trechos de caçada
    // saudável e dois trechos secos): dispara nos dois secos, nenhuma vez nos
    // saudáveis, e ~18s depois da última morte em vez dos 90s do piso.
    const limiarTiles = limiarDeTiles();
    const desdeUltimaMorte = spawnWatch.ultimaMorteEm ? Date.now() - spawnWatch.ultimaMorteEm : Infinity;
    const pisoSegundos = Math.max(5, Number(spawnCfg.tilesMinSeconds) || TILES_MIN_SEGUNDOS);
    if (
      limiarTiles !== null &&
      spawnWatch.tilesDesdeMorte.size >= limiarTiles &&
      desdeUltimaMorte >= pisoSegundos * 1000
    ) {
      return {
        motivo: "andou",
        parado: Date.now() - spawnWatch.ultimoSpawnEm,
        limiar: 0,
        tipico: intervaloTipicoDeSpawn(),
        tiles: spawnWatch.tilesDesdeMorte.size,
        limiarTiles,
        tilesTipicos: tilesTipicos(),
      };
    }

    // v0.11.33 — O MUNDO PAROU DE PRODUZIR.
    //
    // Complementa o critério de tiles em vez de substituí-lo, porque os dois
    // falham em situações diferentes: se o personagem estiver preso num canto
    // (andando pouco), os tiles não acumulam e este aqui responde; se a caçada
    // nascer bicho longe e ele varrer o mapa sem achar, os tiles respondem
    // antes. Vale o que disparar primeiro.
    const limiarLote = limiarDeLote();
    if (limiarLote !== null && spawnWatch.loteArmado && spawnWatch.ultimoSpawnEm) {
      const calado = Date.now() - spawnWatch.ultimoSpawnEm;
      if (calado >= limiarLote) {
        spawnWatch.loteArmado = false;
        return {
          motivo: "lote",
          parado: calado,
          limiar: limiarLote,
          tipico: loteTipicoMs(),
          lotes: spawnWatch.perfilLotes.length,
        };
      }
    }

    const tipico = intervaloTipicoDeSpawn();
    const piso = Math.max(30, Number(spawnCfg.minSeconds) || 90) * 1000;
    const fator = Math.max(2, Number(spawnCfg.factor) || 4);
    const limiar = tipico ? Math.max(piso, tipico * fator) : piso;
    const parado = Date.now() - spawnWatch.ultimoSpawnEm;
    if (parado < limiar) return null;
    return { motivo: "tempo", parado, limiar, tipico };
  }

  function zerarDeteccaoDeSpawn() {
    spawnWatch.vivos.clear();
    spawnWatch.ultimoSpawnEm = 0;
    spawnWatch.intervalos.length = 0;
    // O rastro é POR CAÇADA: levar tiles da caçada anterior pra próxima faria
    // uma "volta" fechar em cima de coordenada que não é mais daqui.
    spawnWatch.rastro.length = 0;
    spawnWatch.minhaPosicao = null;
    spawnWatch.voltaEm = 0;
    spawnWatch.mortesNaVolta = 0;
    spawnWatch.mortesNaVoltaAnterior = null;
    // v0.11.33 — a CONTAGEM zera; o PERFIL APRENDIDO não. Zerar o aprendizado
    // aqui mataria a feature: `zerarDeteccaoDeSpawn()` roda a cada troca de
    // instância, ou seja, toda vez que a automação sai e entra pra renovar o
    // spawn — o detector recomeçaria do zero exatamente depois de agir.
    spawnWatch.tilesDesdeMorte.clear();
    spawnWatch.ultimaMorteEm = 0;
    spawnWatch.ultimoLoteEm = 0;
    spawnWatch.loteArmado = true;
    gravarPerfil();
  }

  function startCitySellWatcher() {
    if (citySellPollTimer) return;
    citySellPollTimer = setInterval(() => perfWatcher("venda-na-cidade", 4000, "autoSellOnCityArrival", tryCitySellWhileIdle), 4000);
  }

  // ---------- v0.11.9 — religar depois de uma queda ----------
  //
  // Só age quando foi a PRÓPRIA automação que se desligou (`selfStoppedAt`),
  // nunca quando o André desligou no botão. Espera o jogo estar de pé e
  // ESTÁVEL antes de religar — senão religaria no meio do server save e se
  // desligaria de novo três erros depois.
  const RESTART_STABLE_MS = 45000; // jogo de pé por esse tempo antes de religar
  // Espera entre tentativas de religar, crescendo. O teste headless matou a
  // primeira versão disso, que era "no máximo 3 tentativas por hora": num
  // server save longo (o André avisou que pode levar HORAS) as 3 tentativas
  // se gastariam nos primeiros minutos e a automação ficaria desligada
  // justamente no resto da queda — ou seja, o bug original de volta. Com
  // escada de espera não existe mais teto: ela tenta pra sempre, cada vez mais
  // espaçado, e a tentativa que pegar o servidor de pé simplesmente cola.
  const RESTART_BACKOFF_MS = [45000, 2 * 60000, 5 * 60000, 10 * 60000, 15 * 60000];

  // v0.11.14 — "O SERVIDOR ESTÁ DE PÉ?" PERGUNTADO AO SERVIDOR.
  //
  // Até aqui a resposta era inferida do DOM ("o HUD está na tela?") e temperada
  // com uma escada de espera, porque o DOM mente durante o server save: a tela
  // continua desenhada com o servidor fora. O André apontou o caminho certo —
  // "o próprio servidor retorna que está online". O socket do jogo sabe disso
  // de primeira mão: `close` quando cai, `open` quando volta, e mensagem
  // chegando enquanto está de verdade conversando.
  //
  // Devolve `true`, `false` ou `null`. O `null` é importante e não é
  // preguiça: quer dizer "não tenho essa informação" (gancho não instalado,
  // conta ainda na tela de personagem, jogo recém-aberto). Nesse caso o
  // religamento cai no comportamento antigo, em vez de travar pra sempre
  // esperando um sinal que não vai chegar.
  const SOCKET_SILENCIO_MS = 20000; // socket aberto e mudo por mais que isso = não conta

  function servidorDePe() {
    if (!spawnWatch.ativo || !spawnWatch.mensagens) return null; // nunca ouvimos nada
    if (socketJogo.estado === "fechado") return false;
    if (socketJogo.estado !== "aberto") return null; // conectando/desconhecido
    if (!spawnWatch.ultimaMensagemEm) return null;
    return Date.now() - spawnWatch.ultimaMensagemEm < SOCKET_SILENCIO_MS;
  }

  function startRestartWatcher() {
    if (restartPollTimer) return;
    restartPollTimer = setInterval(() => perfWatcher("religar-apos-queda", 10000, "autoRestartAfterOutage", restartTick), 10000);
  }

  async function restartTick() {
    if (running || isBusy || !licensed) return;
    const cfg = loadState();
    if (cfg.autoRestartAfterOutage === false) return;
    if (!cfg.selfStoppedAt) return; // desligado pelo André — não mexe

    // v0.11.14 — a pergunta certa, feita ao servidor. Enquanto o socket está
    // caído, NÃO adianta tentar nada: era isso que fazia o bot ficar batendo
    // na porta durante o server save inteiro. E enquanto não tenta, também não
    // gasta degrau da escada de espera — quando o servidor voltar, a primeira
    // tentativa sai na hora, não daqui a 15 minutos.
    const dePe = servidorDePe();
    if (dePe === false) {
      if (!servidorCaiuEm) {
        servidorCaiuEm = Date.now();
        log("O servidor caiu (o jogo fechou a conexão). Esperando ele voltar — não vou ficar tentando reconectar à toa.");
      }
      uiUpSince = 0;
      return;
    }
    if (dePe === true && servidorCaiuEm) {
      // Voltou. A escada de espera existia pra não martelar um servidor que a
      // gente não sabia se estava de pé; agora sabemos, então ela zera.
      const fora = Math.round((Date.now() - servidorCaiuEm) / 60000);
      servidorCaiuEm = 0;
      selfRestarts.length = 0;
      log(`O servidor voltou depois de ~${fora}min fora. Retomando a caçada.`);
    }

    // Jogo de pé? Sem isso, religaria durante a queda e se desligaria de novo.
    if (!isGameUiReady() || isOnCharacterList()) {
      uiUpSince = 0;
      return;
    }
    if (!uiUpSince) uiUpSince = Date.now();

    // Com o socket confirmado de pé e respondendo, esperar 45s de "interface
    // estável" é herança da época em que a gente só tinha o DOM pra olhar.
    const esperaEstavel = dePe === true ? 5000 : RESTART_STABLE_MS;

    // DUAS esperas, e as duas importam — o teste headless mostrou por quê.
    // A primeira versão media só "faz quanto tempo que a interface está de
    // pé", reusando o contador do `monitorTick`. Só que no caso do servidor
    // meio fora (HUD na tela, nada respondendo) a interface NUNCA sumiu:
    // esse contador já estava velho na hora do desligamento, e a automação
    // religava no tick seguinte, ainda no meio da queda. Então:
    //  (1) tempo desde que a INTERFACE voltou — pega o server save clássico,
    //      em que a tela do jogo some e volta;
    //  (2) escada de espera desde a ÚLTIMA tentativa — pega o caso em que a
    //      tela ficou lá o tempo todo e só o servidor estava ruim.
    if (Date.now() - uiUpSince < esperaEstavel) return;
    const espera = RESTART_BACKOFF_MS[Math.min(selfRestarts.length, RESTART_BACKOFF_MS.length - 1)];
    const desdeUltima = Date.now() - (selfRestarts[selfRestarts.length - 1] || Number(cfg.selfStoppedAt) || 0);
    if (desdeUltima < espera) return;

    selfRestarts.push(Date.now());
    saveState({ selfStoppedAt: 0 });
    log(
      selfRestarts.length === 1
        ? "O jogo voltou e está estável — religando a automação sozinha pra retomar a caçada."
        : `Tentativa ${selfRestarts.length} de religar a automação (próxima em ${Math.round(RESTART_BACKOFF_MS[Math.min(selfRestarts.length, RESTART_BACKOFF_MS.length - 1)] / 60000)}min se falhar de novo).`
    );
    await startBot();
  }

  // ---------- v0.11.8 — watcher do treino ----------
  //
  // Roda independente do "Ligar automação", como a venda na cidade e os
  // watchers de party: cada condição tem o seu checkbox e só age se ele
  // estiver ligado. Isso é proposital — a condição "parado na cidade há X
  // minutos" praticamente só acontece com a automação DESLIGADA (ou esperando
  // convite de grupo); se dependesse do botão de caçar, nunca dispararia.
  // Como toda ação real do app, é gateado por `licensed`.
  function startTrainingWatcher() {
    if (trainingPollTimer) return;
    trainingPollTimer = setInterval(() => perfWatcher("treino", 5000, "trainOnStaminaZero/trainOnIdleInCity", trainingTick), 5000);
  }

  async function trainingTick() {
    if (isBusy || !licensed) return;
    const cfg = loadState();
    const querStamina = !!cfg.trainOnStaminaZero;
    const querOcioso = !!cfg.trainOnIdleInCity;
    if (!querStamina && !querOcioso) {
      cityIdleSince = 0;
      return;
    }
    if (!isGameUiReady()) {
      cityIdleSince = 0;
      return;
    }
    // Caçando: o treino não se mete. E o cronômetro zera, senão uma caçada de
    // 3h contaria como 3h parado na cidade.
    if (isHunting()) {
      cityIdleSince = 0;
      return;
    }
    // Já treinando: cronômetro zerado pra que, ao acabar o treino, os X
    // minutos comecem a contar de novo do zero.
    if (isTraining()) {
      cityIdleSince = 0;
      return;
    }
    if (!isInCity()) {
      cityIdleSince = 0;
      return;
    }

    if (!cityIdleSince) cityIdleSince = Date.now();

    const semStamina = querStamina && isStaminaExhausted(cfg);
    const minutos = Number(cfg.trainIdleMinutes);
    const limite = (Number.isNaN(minutos) ? 15 : minutos) * 60000;
    const paradoHa = Date.now() - cityIdleSince;
    const ocioso = querOcioso && paradoHa >= limite;
    if (!semStamina && !ocioso) return;

    const skill = trainSkillForCurrentCharacter(cfg);
    if (!skill) {
      if (Date.now() - lastNoTrainSkillLogAt >= STAMINA_LOG_INTERVAL_MS) {
        lastNoTrainSkillLogAt = Date.now();
        const nome = getActiveCharacterName();
        log(
          `Era hora de treinar, mas "${nome || "este personagem"}" não tem skill escolhida na aba Treino — escolha uma pra eu poder treinar.`
        );
      }
      return;
    }

    isBusy = true;
    try {
      log(
        semStamina
          ? `Stamina no fim e sem caçada — indo treinar ${skill}.`
          : `Parado na cidade há ${Math.max(1, Math.round(paradoHa / 60000))}min — indo treinar ${skill}.`
      );
      await startOnlineTraining(skill);
      updatePanelStatus(`Treinando ${skill}`);
      log(`Treinando ${skill}.`);
      sendState();
    } catch (err) {
      log(`Erro ao iniciar o treino: ${err.message}`, true);
      // Não tenta de novo no tick seguinte: reinicia o cronômetro.
      cityIdleSince = Date.now();
    } finally {
      isBusy = false;
    }
  }

  function startResumeSessionWatcher() {
    if (resumeSessionPollTimer) return;
    // v0.9.5 — André: "está demorando cerca de 30 segundos, não da para
    // ser mais rápido?". Dois ajustes: (1) checa uma vez IMEDIATAMENTE ao
    // iniciar o watcher, em vez de esperar o primeiro tick do
    // `setInterval` (que só dispara depois do intervalo inteiro passar);
    // (2) intervalo caiu de 5s pra 1.5s — a checagem em si é barata (só
    // ler se a lista de personagens está visível), não tem custo real em
    // checar mais rápido, e isso também reduz o impacto de uma checagem
    // perdida por causa do `isBusy` estar ocupado com outro watcher no
    // momento exato do tick. Parte da demora reportada pode continuar
    // sendo o próprio carregamento do jogo depois do clique em "Jogar"
    // (fora do nosso controle) — o log já avisa quando isso acontece
    // ("cliquei... mas não confirmei o carregamento").
    harvestCharacterList();
    tryAutoResumeSession();
    resumeSessionPollTimer = setInterval(() => {
      // v0.9.20 — captura a lista de personagens da conta antes de tentar
      // retomar: é a mesma tela, e assim o painel monta os checkboxes do
      // rodízio sozinho.
      perfWatcher("capturar-lista-personagens", 1500, "sempre", harvestCharacterList);
      perfWatcher("retomar-sessao", 1500, "autoResumeSessionEnabled", tryAutoResumeSession);
    }, 1500);
  }

  // v0.9.2 — André: "mostrar o nome do personagem logado e não Conta 1,
  // Conta 2 por exemplo". `sendState()` já manda `characterName` sempre,
  // mas só é CHAMADA em eventos pontuais (log novo, config mudou, boot) —
  // sem isso, o nome ficaria parado até o próximo desses eventos acontecer
  // por acaso. Poll leve (3s, só leitura de um seletor já visível) que
  // manda o estado de novo SÓ quando o nome muda de verdade (entrou no
  // jogo, trocou de personagem, voltou pra seleção) — não gera tráfego
  // extra o resto do tempo.
  // v0.9.22 — André: "a vocação e level no menu lateral não é atualizado
  // junto do jogo" (print com KNIGHT LV 10 no jogo e "K 8" na barra lateral).
  // Causa: este watcher só reportava quando o NOME mudava — vocação e level
  // iam de carona em qualquer `sendState()` que acontecesse por outro motivo.
  // E, caçando normalmente, o `monitorTick` sai sem reportar nada quando a
  // capacidade ainda está longe do limite: ou seja, ficava horas sem enviar
  // estado, e o level congelava no valor do login. Agora o watcher observa os
  // três (nome, vocação e level) e envia quando qualquer um muda.
  function startCharacterNameWatcher() {
    if (characterNamePollTimer) return;
    characterNamePollTimer = setInterval(() => {
      perfWatcher("identidade-personagem", 3000, "sempre", () => {
      const domQueriesBefore = perfDiagnostico.dom.queries;
      const wsIdentityValid = identidadeWsConfirmada();
      const motivoFallback = wsIdentityValid ? null : motivoFallbackIdentidadeWs();
      const name = getActiveCharacterName();
      const domQueriesDepoisNome = perfDiagnostico.dom.queries;
      const vocation = getActiveCharacterVocation();
      const level = getActiveCharacterLevel();
      // v0.9.23 — acumula XP a cada tick (antes da checagem de mudança, senão
      // só somaria quando algo mais mudasse).
      acumularXp();
      const assinatura = `${name || ""}|${vocation || ""}|${level == null ? "" : level}|${isHunting() ? 1 : 0}`;
      if (assinatura === lastReportedCharacterSignature) return;
      const nomeMudou = name !== lastReportedCharacterName;
      lastReportedCharacterSignature = assinatura;
      lastReportedCharacterName = name;
      // O bloco abaixo (alvo do "retomar sessão") só faz sentido quando é o
      // PERSONAGEM que mudou — subir de level não pode reescrever config.
      if (name && nomeMudou) {
        // v0.9.3 — André: "ao abrir o app, pode logar as contas
        // autenticadas nos personagens de ultimo login... precisamos
        // salvar as configurações de ultima sessão". Sempre que um
        // personagem loga de verdade nessa conta, guarda o nome dele como
        // alvo do "retomar sessão" e liga o toggle sozinho — SALVO se o
        // André tiver desligado manualmente antes (`autoResumeSessionManuallyDisabled`,
        // ver DEFAULTS/applyConfig() acima). Escopo continua o mesmo de
        // sempre: só afeta QUAL personagem/SE liga o clique automático em
        // "Jogar" na tela de seleção — nunca mexe em email/senha, nunca
        // cria uma sessão nova.
        const cfg = loadState();
        const patch = {};
        if (cfg.autoResumeSessionCharacter !== name) patch.autoResumeSessionCharacter = name;
        if (!cfg.autoResumeSessionManuallyDisabled && !cfg.autoResumeSessionEnabled) {
          patch.autoResumeSessionEnabled = true;
        }
        if (Object.keys(patch).length) saveState(patch);
      }
      // Temporário: separa a leitura do nome das demais responsabilidades
      // deste watcher (vocação, level e XP) sem alterar sua execução.
      if (perfDiagnostico.ativo) {
        const reg = perfDiagnostico.watchers.get("identidade-personagem");
        if (reg) {
          const amostras = reg.amostrasIdentidade || (reg.amostrasIdentidade = []);
          amostras.push({
            wsIdentityValid,
            socketGeneration: socketJogo.sessao,
            identityGeneration: eu.sessao,
            socketState: socketJogo.estado,
            playerId: eu.id,
            nome: eu.nome,
            domQueriesBefore,
            domQueriesAfterName: domQueriesDepoisNome,
            domQueriesAfter: perfDiagnostico.dom.queries,
            motivoFallback,
          });
          if (amostras.length > 30) amostras.shift();
        }
      }
      sendState();
      });
    }, 3000);
  }

  // ---------- sincronizar Sio (Heal Friend) + ALVO com o EK (Tank) da party
  // ---------- também portado — o EK só é identificado pelo PAPEL (Tank) no
  // roster do convite de caçada em grupo, nunca pela liderança (o líder da
  // party pode ser qualquer vocação).

  function getGroupHuntInviteRoster() {
    const dialog = queryVisible(document, SEL.groupHuntInviteDialog);
    if (!dialog) return null;
    const items = Array.from(dialog.querySelectorAll(SEL.inviteRosterItems));
    return items
      .map((li) => {
        const roleEl = li.querySelector(SEL.inviteRosterRole);
        const nameEl = li.querySelector(SEL.inviteRosterName);
        if (!nameEl) return null;
        // Quando o membro é o líder, o nome vem com um
        // <em class="invite-roster-leader">líder</em> ANINHADO dentro do
        // mesmo span — clona e remove antes de ler, senão gruda "líder" no
        // nome (bug real batido na extensão Chrome em 02/09/2026).
        const nameClone = nameEl.cloneNode(true);
        nameClone.querySelectorAll(".invite-roster-leader").forEach((el) => el.remove());
        const name = nameClone.textContent.trim();
        if (!name) return null;
        const roleClass = roleEl ? roleEl.className : "";
        const roleMatch = roleClass.match(/role-(\w+)/);
        return { name, role: roleMatch ? roleMatch[1] : "none" };
      })
      .filter(Boolean);
  }

  // v0.11.22 — o roster do grupo, preferindo o protocolo.
  //
  // O caminho de DOM só existe ENQUANTO O DIÁLOGO DE CONVITE ESTÁ ABERTO — uma
  // janela de poucos segundos. O tipo 51 mantém o roster o tempo todo, então
  // o sync do EK deixa de depender de pegar aquele instante.
  //
  // ⚠️ UMA DIFERENÇA DE SIGNIFICADO QUE NÃO DÁ PRA VARRER PRA BAIXO DO TAPETE:
  // o DOM traz o PAPEL atribuído na caçada (`role-tank`); o protocolo traz a
  // VOCAÇÃO (`knight`). Na prática o tank é o knight, mas não é a mesma
  // afirmação. Por isso o papel do DOM continua tendo precedência quando
  // existe, e a vocação só responde quando o DOM não tem o que dizer.
  function rosterDoGrupo() {
    const doDom = getGroupHuntInviteRoster();
    if (doDom && doDom.length) return { fonte: "dom", membros: doDom };
    if (grupo.em && grupo.membros.length) {
      return {
        fonte: "protocolo",
        membros: grupo.membros.map((m) => ({
          name: m.name,
          role: m.vocation === "knight" ? "tank" : "none",
          vocation: m.vocation || null,
          leader: m.leader === true,
          arrived: m.arrived === true,
        })),
      };
    }
    return null;
  }

  // v0.11.22 — "sou o líder?" com o servidor tendo a palavra, e o checkbox
  // como último recurso. O checkbox continua existindo e continua sendo o que
  // vale quando o protocolo está calado (fora de party, jogo recém-aberto).
  function souLider(cfg) {
    const pelaRede = souLiderPeloProtocolo();
    if (pelaRede !== null) return pelaRede;
    return !!(cfg && cfg.isPartyLeader);
  }

  function findEkInRoster(roster) {
    const tank = roster.find((m) => m.role === "tank");
    return tank ? tank.name : null;
  }

  // v0.11.22 — sou o líder da party? true / false / null.
  //
  // Hoje isso é um checkbox que o André marca conta por conta. O servidor sabe
  // — tipo 51 (`leader` por membro) e tipo 72 (`leaderId`). Continua sendo
  // `null` quando o protocolo não falou, e aí o checkbox decide, como antes.
  function souLiderPeloProtocolo() {
    const meuNome = getActiveCharacterName();
    if (!meuNome) return null;
    if (grupo.em && grupo.membros.length) {
      const eu = grupo.membros.find((m) => m && m.name === meuNome);
      if (eu) return eu.leader === true;
    }
    if (party.em && party.lider != null && party.membros.length) {
      const eu = party.membros.find((m) => m && m.name === meuNome);
      if (eu && eu.id != null) return eu.id === party.lider;
    }
    return null;
  }

  // Vocação do PRÓPRIO personagem ativo — essa automação só faz sentido
  // jogando de suporte.
  //
  // v0.11.31 — ESTA É A ÚNICA LEITURA QUE FICA NO DOM DE PROPÓSITO. O
  // protocolo manda a vocação BASE ("knight", "druid" — tipo 77 e tipo 15),
  // e o jogo mostra a PROMOVIDA ("EK", "ED"). Um Druid não promovido e um
  // Elder Druid são "druid" no protocolo e coisas diferentes na tela. Como o
  // sync de EK compara justamente com "Elder Druid", trocar a fonte aqui
  // ligaria a automação pra quem não deveria. A vocação base fica exposta no
  // painel (`vocacaoProtocolo`), mas quem decide continua sendo o DOM.
  function getActiveCharacterVocation() {
    const el = queryVisible(document, SEL.characterVocation);
    if (!el) return null;
    const span = el.querySelector("span");
    return (span || el).textContent.trim();
  }

  // v0.9.16 — André: "seria legal é nessa parte ter qual a vocação do
  // personagem". O elemento `.header-character-vocation` já era lido pro sync
  // do EK; agora o level do `<em>` dele também vai pro painel, pra lista de
  // contas mostrar "ED 357" em vez de repetir o domínio do jogo.
  function getActiveCharacterLevel() {
    // v0.11.18 — o tipo 77 traz `level` como número, sem depender do `<em>`
    // dentro do cabeçalho existir ainda.
    //
    // A VOCAÇÃO continua saindo do DOM de propósito: o protocolo manda
    // "druid", e a interface do jogo mostra a abreviação promovida ("ED").
    // Traduzir uma na outra depende da promoção do personagem — seria chute, e
    // o preço de errar aqui é o rótulo da conta ficar errado na barra lateral.
    if (fichaFresca() && typeof ficha.level === "number") return ficha.level;

    const el = queryVisible(document, SEL.characterVocation);
    if (!el) return null;
    const em = el.querySelector("em");
    if (!em) return null;
    const match = em.textContent.match(/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  // v0.9.23 — lê o XP absoluto do title do `.hud-exp`. Formato confirmado ao
  // vivo: "Experiência 1.827.258/6.716.200" (ponto como separador de milhar).
  // Devolve { atual, necessario } ou null se não deu pra ler — nunca chuta.
  function getExperience() {
    // v0.11.23 — o tipo 77 traz `experience` e `experienceNeeded` como números,
    // e chega ~2x por segundo. A leitura de DOM abaixo depende do atributo
    // `title` do `.hud-exp` ("Experiência 1.827.258/6.716.200"), que só existe
    // depois de o HUD montar e quebraria se o jogo mudasse a formatação.
    if (fichaFresca() && economia.ultimoXp && economia.ultimoXp.necessario) {
      return { atual: economia.ultimoXp.atual, necessario: economia.ultimoXp.necessario };
    }
    const el = queryVisible(document, SEL.hudExp);
    const title = el && el.getAttribute("title");
    if (!title) return null;
    const nums = title.match(/[\d.]+/g);
    if (!nums || nums.length < 2) return null;
    const atual = Number(nums[0].replace(/\./g, ""));
    const necessario = Number(nums[1].replace(/\./g, ""));
    if (!Number.isFinite(atual) || !Number.isFinite(necessario)) return null;
    return { atual, necessario };
  }

  // v0.9.23 — CONFIRMADO AO VIVO em 10/09/2026: o botão de confirmar a venda
  // rápida diz "Vender por 432 gp" — número simples com "gp" no fim (e ponto
  // como separador de milhar nos valores maiores). O analisador do jogo, por
  // outro lado, abrevia ("1,6kk", "484,2k"). Este parser cobre os dois
  // formatos e devolve null quando não reconhece, pra nunca inventar valor —
  // nesse caso o texto cru continua no log, que é como um formato novo
  // aparece sem virar número errado silenciosamente.
  function parseGameNumber(text) {
    if (!text) return null;
    const m = String(text).match(/([\d.,]+)\s*(kk|kkk|k|m|b)?/i);
    if (!m) return null;
    const bruto = m[1];
    const sufixo = (m[2] || "").toLowerCase();
    // Com sufixo, a vírgula é decimal ("1,6kk"). Sem sufixo, ponto e vírgula
    // são separadores de milhar ("1.234.567").
    const n = sufixo
      ? Number(bruto.replace(/\./g, "").replace(",", "."))
      : Number(bruto.replace(/[.,]/g, ""));
    if (!Number.isFinite(n)) return null;
    const mult = { k: 1e3, kk: 1e6, kkk: 1e9, m: 1e6, b: 1e9 }[sufixo] || 1;
    return Math.round(n * mult);
  }

  const EK_SYNC_VOCATION = "Elder Druid";

  function findHotbarSlotByIcon(iconFragment) {
    const slots = Array.from(document.querySelectorAll(SEL.hotbarSlots));
    return (
      slots.find((slot) => {
        const img = slot.querySelector(SEL.hotbarSpellIcon);
        return img && (img.getAttribute("src") || "").includes(iconFragment);
      }) || null
    );
  }

  async function closeActionEditor() {
    const editor = document.querySelector(SEL.actionEditor);
    const btn = editor && editor.querySelector(SEL.actionCloseBtn);
    if (btn) await humanClick(btn);
  }

  // Abre o modal "Configurar ação" já mostrando a magia certa (por
  // data-action-id, se já estiver aberto numa magia diferente).
  async function openActionEditorFor(actionId, iconFragment) {
    let editor = queryVisible(document, SEL.actionEditor);
    if (!editor) {
      const slot = findHotbarSlotByIcon(iconFragment);
      if (!slot) throw new Error(`Não achei a magia (ícone "${iconFragment}") na barra de ação.`);
      await humanClick(slot);
      editor = await waitFor(() => queryVisible(document, SEL.actionEditor), 4000);
      if (!editor) throw new Error('Modal "Configurar ação" não abriu.');
    }
    const choice = Array.from(editor.querySelectorAll(SEL.actionChoiceButtons)).find(
      (b) => b.getAttribute("data-action-id") === actionId
    );
    if (choice && choice.getAttribute("aria-selected") !== "true") {
      await humanClick(choice);
      await sleep(300);
    }
    return editor;
  }

  // Configura "Alvo da cura" da Sio (Heal Friend) pro EK, via
  // select.action-friend-mode (option value "member:<Nome>"), e salva.
  async function setHealTargetToEK(ekName) {
    const editor = await openActionEditorFor("heal-friend", "heal-friend");
    const select = editor.querySelector(SEL.actionFriendModeSelect);
    if (!select) throw new Error('Dropdown "Alvo da cura" não encontrado no modal da Sio (Heal Friend).');
    const targetValue = `member:${ekName}`;
    const hasOption = Array.from(select.options).some((o) => o.value === targetValue);
    if (!hasOption) {
      throw new Error(`Opção "Membro da party: ${ekName}" não existe no dropdown da Sio — o EK está mesmo na party?`);
    }
    setSelectValue(select, targetValue);
    const saveBtn = editor.querySelector(SEL.actionSaveBtn);
    if (!saveBtn) throw new Error('Botão "Salvar" não encontrado no modal da Sio.');
    await humanClick(saveBtn);
    await sleep(300);
  }

  // Configura o ALVO (estratégia de alvo) pra "Seguir <EK>".
  function setFollowTargetToEK(ekName) {
    const select = document.querySelector(SEL.targetStrategySelect);
    if (!select) throw new Error('Dropdown "ALVO" (estratégia de alvo) não encontrado.');
    const wantedText = `Seguir ${ekName}`;
    const option = Array.from(select.options).find((o) => o.textContent.trim() === wantedText);
    if (!option) throw new Error(`Opção "${wantedText}" não existe no ALVO — o EK está mesmo na party?`);
    setSelectValue(select, option.value);
  }

  async function syncHealAndTargetToEK(ekName) {
    try {
      await setHealTargetToEK(ekName);
    } finally {
      await closeActionEditor();
    }
    setFollowTargetToEK(ekName);
    log(`Sio (Heal Friend) e ALVO configurados pra seguir "${ekName}" (EK da party).`);
  }

  // Núcleo da sincronização, SEM a trava `isBusy` própria — quem chama já
  // garante isso (o watcher próprio abaixo, OU `tryAutoAcceptGroupHunt`, que
  // precisa rodar isso ENQUANTO já está dentro da própria seção crítica
  // dele, pra garantir que o EK é lido antes de aceitar e o diálogo sumir).
  async function syncEkTargetIfNeeded() {
    const cfg = loadState();
    if (!cfg.syncEkTarget) return;
    if (getActiveCharacterVocation() !== EK_SYNC_VOCATION) return; // só faz sentido jogando de suporte

    // v0.11.22 — antes isto exigia o DIÁLOGO DE CONVITE aberto, uma janela de
    // poucos segundos: perdeu o instante, não sincronizou. O tipo 51 mantém o
    // roster o tempo todo. O DOM continua valendo quando o protocolo está
    // calado (`rosterDoGrupo` decide), e sem nenhum dos dois o estado zera
    // como antes.
    const fonte = rosterDoGrupo();
    if (!fonte) {
      lastSyncedRosterKey = null;
      return;
    }
    const roster = fonte.membros;
    if (!roster.length) return; // roster ainda não carregou
    const ekName = findEkInRoster(roster);
    if (!ekName) return; // ninguém com papel "Tank" nessa party (ainda)

    const rosterKey = roster.map((m) => `${m.name}:${m.role}`).join("|");
    if (rosterKey === lastSyncedRosterKey) return; // já sincronizado pra esse mesmo roster

    try {
      await syncHealAndTargetToEK(ekName);
    } catch (err) {
      // Marca como "já tentado" mesmo em erro — sem isso, uma falha
      // persistente ficaria tentando de novo a cada 1.5s pra sempre.
      log(`Erro ao sincronizar Sio/ALVO com o EK: ${err.message}`, true);
    } finally {
      lastSyncedRosterKey = rosterKey;
    }
  }

  async function tryAutoSyncEkTarget() {
    if (isBusy || !licensed) return;
    // v0.12.1 — a flag é conferida ANTES de pegar a trava. Como estava, este
    // timer de 1,5s marcava a conta como ocupada a cada disparo mesmo com a
    // sincronia desligada, e só descobria lá dentro que não tinha nada a fazer
    // — atravessando o caminho do `monitorTick` de graça.
    if (!loadState().syncEkTarget) return;
    isBusy = true;
    try {
      await syncEkTargetIfNeeded();
    } finally {
      isBusy = false;
    }
  }

  function startEkSyncWatcher() {
    if (ekSyncPollTimer) return;
    ekSyncPollTimer = setInterval(() => perfWatcher("sincronizar-ek", 1500, "syncEkTarget", tryAutoSyncEkTarget), 1500);
  }

  // Diálogo "Seguir o líder da party" — responde sempre "Manter a atual" (o
  // ALVO já está certo por outro caminho, seguir o líder sobrescreveria sem
  // necessidade). Não depende de vocação nem do bot principal.
  async function tryAutoKeepCurrentTarget() {
    // v0.12.1 — ordem invertida de propósito: `isBusy`/`licensed` são duas
    // comparações, `loadState()` hoje é cache mas já foi leitura de disco, e
    // `queryVisible` força layout. Do mais barato pro mais caro, sempre — este
    // timer roda a cada 1,2s por conta.
    if (isBusy || !licensed) return;
    if (!loadState().autoKeepCurrentTarget) return;
    const dialog = queryVisible(document, SEL.followLeaderDialog);
    if (!dialog) return;
    const keepBtn = findButtonByExactText(dialog, "Manter a atual");
    if (!keepBtn) return;

    isBusy = true;
    try {
      await humanClick(keepBtn);
      log('Diálogo "Seguir o líder da party" respondido automaticamente com "Manter a atual".');
    } catch (err) {
      log(`Erro ao responder o diálogo "Seguir o líder da party": ${err.message}`, true);
    } finally {
      isBusy = false;
    }
  }

  function startFollowLeaderWatcher() {
    if (followLeaderPollTimer) return;
    followLeaderPollTimer = setInterval(() => perfWatcher("manter-alvo-atual", 1200, "autoKeepCurrentTarget", tryAutoKeepCurrentTarget), 1200);
  }

  // ---------- leitura de caçadas/tiers (pra alimentar os selects no host) ----------

  // v0.11.23 — o catálogo de caçadas vem PRONTO no tipo 42, no login: 60
  // caçadas com id, nome, monstros e tiers (`Cautious/Bold/Reckless`) já com
  // o `monsterCount`, que é o tamanho do pull.
  //
  // O caminho de DOM abaixo abria o seletor de caçadas, limpava o campo de
  // busca, esperava, lia os botões e fechava a janela — uma sequência de
  // cliques reais só pra montar uma lista. E era frágil de um jeito
  // específico: quando os botões de tier não apareciam nos 4s de espera, o
  // resultado vazio ia pro cache e travava aquela caçada com o dropdown vazio
  // (o bug da v0.9.5). Lendo do protocolo, nada disso existe.
  function catalogoDoProtocolo() {
    if (!Array.isArray(guild.cacadas) || !guild.cacadas.length) return null;
    return guild.cacadas;
  }

  async function scrapeHuntNames(forceRefresh) {
    const doProtocolo = catalogoDoProtocolo();
    if (doProtocolo) {
      const names = doProtocolo.map((h) => (h && h.name ? String(h.name).trim() : "")).filter(Boolean);
      if (names.length) {
        saveHuntCatalogNames(names);
        return names;
      }
    }
    if (!forceRefresh) {
      const cached = loadHuntCatalog();
      if (cached.names && cached.names.length) return cached.names;
    }
    const alreadyOpen = !!queryVisible(document, SEL.huntWindow);
    const opened = await ensureHuntWindowOpen();
    if (!opened) throw new Error("Não consegui abrir o seletor de caçadas.");
    const win = document.querySelector(SEL.huntWindow);
    const search = win.querySelector(SEL.huntSearchInput);
    if (search) setInputValue(search, "");
    await sleep(250);
    const entries = Array.from(win.querySelectorAll(SEL.huntEntries));
    const names = entries
      .map((b) => {
        const nameEl = b.querySelector(SEL.huntEntryName);
        return nameEl ? nameEl.textContent.trim() : null;
      })
      .filter(Boolean);
    if (!alreadyOpen) await closeHuntWindow();
    saveHuntCatalogNames(names);
    return names;
  }

  async function peekHuntTiers(huntName, forceRefresh) {
    // v0.9.5 — André: "o tamanho do pull não aparece... deveria já ficar
    // fixo por hunt já, isso já deveria ser mapeado e salvo para não ficar
    // falhando". Achado o bug: quando o scrape falhava em achar os botões
    // de tier a tempo (`SEL.huntTiers` não apareceu dentro dos 4s de
    // `waitFor`), `tiers` ficava `[]` e isso era salvo no cache do mesmo
    // jeito — e um array vazio é "truthy" em JS, então o check de cache
    // (`if (cached.tiersByHunt[huntName])`) tratava esse `[]` como "já
    // sei, não precisa buscar de novo", travando aquela caçada com o
    // dropdown vazio PRA SEMPRE (só um "Atualizar" com forceRefresh
    // resolvia, e mesmo assim só até falhar de novo). Fix: só considerar
    // "já mapeado" um resultado com pelo menos 1 tier de verdade — cache
    // vazio/ausente sempre tenta buscar ao vivo de novo, e só GRAVA no
    // cache quando o scrape realmente trouxe alguma coisa.
    // v0.11.23 — pelo tipo 42 os tiers vêm na ordem do jogo e com o tamanho
    // do pull junto, sem abrir janela nenhuma.
    const doProtocolo = catalogoDoProtocolo();
    if (doProtocolo) {
      const h = doProtocolo.find((x) => x && String(x.name).trim() === String(huntName).trim());
      const tiers = h && Array.isArray(h.tiers) ? h.tiers.map((t) => (t && t.name ? String(t.name) : "")).filter(Boolean) : [];
      if (tiers.length) {
        saveHuntCatalogTiers(huntName, tiers);
        return tiers;
      }
    }
    if (!forceRefresh) {
      const cached = loadHuntCatalog();
      if (cached.tiersByHunt && cached.tiersByHunt[huntName] && cached.tiersByHunt[huntName].length) {
        return cached.tiersByHunt[huntName];
      }
    }
    const alreadyOpen = !!queryVisible(document, SEL.huntWindow);
    const opened = await ensureHuntWindowOpen();
    if (!opened) throw new Error("Não consegui abrir o seletor de caçadas.");
    const win = document.querySelector(SEL.huntWindow);
    const search = win.querySelector(SEL.huntSearchInput);
    if (search) setInputValue(search, huntName);
    await sleep(400);
    // v0.9.16 — BUG INTRODUZIDO NA v0.9.15, corrigido aqui: este `waitFor`
    // recebia o `clickHuntEntry`, que na v0.9.15 virou `async` (pra usar o
    // `humanClick`). Predicado async devolve Promise, que é SEMPRE truthy —
    // então o `waitFor` "resolvia" na primeira tentativa, sem esperar a
    // caçada aparecer na busca e sem garantir o clique. Resultado: os tiers
    // nunca renderizavam e o "Tamanho do pull" ficava vazio. Eu corrigi esse
    // mesmo padrão no `pickAndStartHunt` e passei batido AQUI. Agora espera
    // com predicado síncrono (`findHuntEntry`) e clica depois.
    const entry = await waitFor(() => findHuntEntry(win, huntName), 4000);
    if (!entry) {
      if (!alreadyOpen) await closeHuntWindow();
      throw new Error(`Caçada "${huntName}" não encontrada.`);
    }
    await humanClick(entry);
    // v0.9.5 — 4s → 6s: margem extra pro caso do render dos tiers atrasar
    // um pouco (era um dos jeitos de cair na falha que poluía o cache).
    const tiersReady = await waitFor(() => win.querySelector(SEL.huntTiers), 6000);
    const tiers = Array.from(win.querySelectorAll(SEL.huntTiers)).map((b) => b.textContent.trim());
    if (!alreadyOpen) await closeHuntWindow();
    if (tiers.length) {
      saveHuntCatalogTiers(huntName, tiers);
    } else {
      // Não grava nada — deixa o cache como "ainda não sei" pra tentar de
      // novo na próxima, em vez de travar num resultado vazio.
      log(
        `Aviso: não consegui ler o tamanho do pull de "${huntName}" a tempo${
          tiersReady ? "" : " (elementos não apareceram)"
        } — tento de novo na próxima vez que essa caçada for selecionada.`
      );
    }
    return tiers;
  }

  // v0.9.16 — André: "uma coisa que me incomoda muito e que deveríamos ter
  // funcionando é a lista de caçadas completas já salva na máquina do
  // usuário. toda vez que eu abro o tamanho do pull vem vazio e deveria vir
  // já a lista completinha."
  //
  // O modelo antigo era PREGUIÇOSO: os tiers de uma caçada só eram lidos
  // quando aquela caçada específica era selecionada no dropdown. Ou seja,
  // caçada nunca aberta = "Tamanho do pull" vazio, sempre — e qualquer falha
  // de leitura (jogo lento, conta não logada) devolvia vazio de novo.
  //
  // Agora dá pra varrer o catálogo INTEIRO de uma vez: abre a janela de
  // caçadas UMA vez, passa por todas as caçadas lendo os tiers de cada uma e
  // salva tudo. O host guarda o resultado em disco (userData), compartilhado
  // por todas as contas — tiers são do JOGO, não da conta, então basta uma
  // conta mapear pra todas terem a lista pronta.
  //
  // Clicar numa caçada na lista só PRÉ-VISUALIZA (mostra detalhes e tiers) —
  // quem inicia de verdade é o botão "Iniciar caçada"/"Iniciar com o time",
  // que não é tocado aqui. Por isso a varredura é segura mesmo com a conta
  // logada e parada na cidade.
  async function scrapeFullCatalog() {
    const alreadyOpen = !!queryVisible(document, SEL.huntWindow);
    const opened = await ensureHuntWindowOpen();
    if (!opened) throw new Error("Não consegui abrir o seletor de caçadas.");
    const win = document.querySelector(SEL.huntWindow);
    const search = win.querySelector(SEL.huntSearchInput);
    if (search) setInputValue(search, "");
    await sleep(300);

    const names = Array.from(win.querySelectorAll(SEL.huntEntries))
      .map((b) => {
        const nameEl = b.querySelector(SEL.huntEntryName);
        return nameEl ? nameEl.textContent.trim() : null;
      })
      .filter(Boolean);

    if (!names.length) {
      if (!alreadyOpen) await closeHuntWindow();
      throw new Error("A lista de caçadas veio vazia — a conta está logada?");
    }
    saveHuntCatalogNames(names);

    const tiersByHunt = {};
    let done = 0;
    let failed = 0;
    for (const name of names) {
      // A lista inteira já está renderizada (busca vazia), então é só achar a
      // entrada e clicar — sem re-buscar/refiltrar a cada caçada.
      const entry = findHuntEntry(win, name);
      if (!entry) {
        failed++;
        continue;
      }
      await humanClick(entry);
      const ready = await waitFor(() => win.querySelector(SEL.huntTiers), 4000);
      const tiers = ready
        ? Array.from(win.querySelectorAll(SEL.huntTiers)).map((b) => b.textContent.trim()).filter(Boolean)
        : [];
      if (tiers.length) {
        tiersByHunt[name] = tiers;
        saveHuntCatalogTiers(name, tiers);
      } else {
        failed++;
      }
      done++;
      // Progresso pro painel — a varredura leva ~1-2min (são dezenas de
      // caçadas, cada clique com o delay anti-detecção do `humanClick`).
      sendState({ catalogProgress: { done, total: names.length, failed } });
      if (!running && !catalogSweepRequested) break; // cancelado
    }

    if (!alreadyOpen) await closeHuntWindow();
    return { names, tiersByHunt, failed };
  }

  async function runFullCatalogSweep() {
    if (isBusy) {
      log("Mapeamento do catálogo adiado — a conta está ocupada agora. Tente de novo em alguns segundos.");
      return;
    }
    isBusy = true;
    catalogSweepRequested = true;
    try {
      log("Mapeando o catálogo completo de caçadas (nomes + tamanhos de pull)... isso leva um ou dois minutos.");
      sendState({ catalogSweeping: true });
      const { names, tiersByHunt, failed } = await scrapeFullCatalog();
      const mapped = Object.keys(tiersByHunt).length;
      log(
        `Catálogo mapeado: ${names.length} caçadas, ${mapped} com o tamanho do pull lido${
          failed ? ` (${failed} não deram — dá pra remapear depois)` : ""
        }. Salvo na máquina e compartilhado com as outras contas.`
      );
      // O host persiste isso em disco (userData) e distribui pras outras
      // contas — ver `huntCatalog:save` no main.js.
      sendState({
        catalogSweeping: false,
        catalogProgress: null,
        huntNames: names,
        fullCatalog: { names, tiersByHunt },
      });
    } catch (err) {
      log(`Não consegui mapear o catálogo: ${err.message}`, true);
      sendState({ catalogSweeping: false, catalogProgress: null });
    } finally {
      catalogSweepRequested = false;
      isBusy = false;
    }
  }

  async function refreshHuntsAndSend(forceRefresh) {
    // Se já tem cache, manda na hora (sem "carregando" piscando à toa) e só
    // then reconsulta o jogo se for forceRefresh ou não tiver nada salvo.
    const cached = loadHuntCatalog();
    if (!forceRefresh && cached.names && cached.names.length) {
      sendState({ huntNames: cached.names, huntsLoading: false });
      return;
    }
    sendState({ huntsLoading: true });
    try {
      const names = await scrapeHuntNames(forceRefresh);
      sendState({ huntNames: names, huntsLoading: false });
    } catch (err) {
      // Causa mais comum: pedido antes de a conta estar logada (ou a SPA do
      // jogo ainda não tinha montado a barra de navegação a tempo). O host
      // deixa tentar de novo manualmente (botão ↻), sem precisar recarregar
      // a conta inteira.
      log(`Aviso: não consegui ler a lista de caçadas ainda (${err.message}). Se a conta já está logada, tente de novo.`);
      sendState({ huntNames: [], huntsLoading: false, huntsError: true });
    }
  }

  async function requestTiersAndSend(huntName, forceRefresh) {
    if (!huntName) return;
    // v0.9.5 — mesmo fix do `peekHuntTiers()`: só considera "já mapeado" um
    // cache com pelo menos 1 tier de verdade, nunca um `[]` vazio (senão
    // fica preso mostrando o dropdown vazio pra sempre).
    const cached = loadHuntCatalog();
    if (!forceRefresh && cached.tiersByHunt && cached.tiersByHunt[huntName] && cached.tiersByHunt[huntName].length) {
      sendState({ tiers: cached.tiersByHunt[huntName], tiersLoading: false });
      return;
    }
    sendState({ tiersLoading: true });
    try {
      const tiers = await peekHuntTiers(huntName, forceRefresh);
      sendState({ tiers, tiersLoading: false });
    } catch (err) {
      log(`Aviso: não consegui ler os tiers de "${huntName}" (${err.message}).`);
      sendState({ tiers: [], tiersLoading: false });
    }
  }

  // ---------- reporte de status/estado (substitui as funções que antes
  // mexiam direto no DOM do painel flutuante) ----------

  function updatePanelStatus(text) {
    // v0.11.22 — sem o "mudou?", isto vira `sendState()` a cada 4s repetindo o
    // mesmo texto; e o rótulo agora é escrito em TODO tick de caçada saudável
    // (ver `monitorTick`), o que multiplicaria esse tráfego por conta.
    if (statusText === text) return;
    statusText = text;
    sendState();
  }

  function updatePanelRunning(isRunning) {
    running = isRunning;
    statusText = isRunning ? "Caçando" : "Parado";
    sendState();
  }

  // ---------- comandos vindos do host (menu lateral) ----------

  function applyConfig(partial) {
    const next = {};
    if (typeof partial.huntName === "string") next.huntName = partial.huntName;
    if (typeof partial.pullLevel === "string") next.pullLevel = partial.pullLevel;
    if (partial.capacityThreshold !== undefined) {
      const n = Number(partial.capacityThreshold);
      if (!Number.isNaN(n)) next.capacityThreshold = n;
    }
    if (partial.staminaResumeThreshold !== undefined) {
      const n = Number(partial.staminaResumeThreshold);
      if (!Number.isNaN(n)) next.staminaResumeThreshold = n;
    }
    if (typeof partial.staminaWaitEnabled === "boolean") {
      next.staminaWaitEnabled = partial.staminaWaitEnabled;
    }
    if (typeof partial.autoRestartAfterOutage === "boolean") {
      next.autoRestartAfterOutage = partial.autoRestartAfterOutage;
    }
    if (typeof partial.expeditionEnabled === "boolean") {
      next.expeditionEnabled = partial.expeditionEnabled;
    }
    // v0.11.8 — treino.
    if (typeof partial.trainOnStaminaZero === "boolean") {
      next.trainOnStaminaZero = partial.trainOnStaminaZero;
    }
    if (typeof partial.trainOnIdleInCity === "boolean") {
      next.trainOnIdleInCity = partial.trainOnIdleInCity;
    }
    if (partial.trainIdleMinutes !== undefined) {
      const n = Number(partial.trainIdleMinutes);
      // Menos de 1min viraria "treina assim que chega na cidade", o que
      // atropelaria a venda automática e a retomada da caçada.
      if (!Number.isNaN(n) && n >= 1) next.trainIdleMinutes = n;
    }
    // Chega como { character, skill } — skill vazia REMOVE a escolha daquele
    // personagem, em vez de gravar string vazia no mapa.
    if (partial.trainSkill && typeof partial.trainSkill.character === "string") {
      const mapaTreino = Object.assign({}, next.trainSkillByCharacter);
      const chave = normalizeName(partial.trainSkill.character);
      if (chave) {
        if (partial.trainSkill.skill) mapaTreino[chave] = String(partial.trainSkill.skill);
        else delete mapaTreino[chave];
        next.trainSkillByCharacter = mapaTreino;
      }
    }
    // v0.7.0 — campos de Party.
    if (typeof partial.autoAcceptParty === "boolean") next.autoAcceptParty = partial.autoAcceptParty;
    if (Array.isArray(partial.autoAcceptPartyAllowlist)) {
      next.autoAcceptPartyAllowlist = partial.autoAcceptPartyAllowlist.filter((s) => typeof s === "string" && s);
    }
    if (typeof partial.syncEkTarget === "boolean") next.syncEkTarget = partial.syncEkTarget;
    if (typeof partial.autoKeepCurrentTarget === "boolean") next.autoKeepCurrentTarget = partial.autoKeepCurrentTarget;
    // v0.8.0 — auto retomar sessão.
    if (typeof partial.autoResumeSessionEnabled === "boolean") {
      next.autoResumeSessionEnabled = partial.autoResumeSessionEnabled;
      // v0.9.3 — só o toggle da TELA (ação manual do André) mexe nesta
      // flag: desligou na mão = passa a respeitar (freio de mão ligado);
      // ligou na mão de novo = libera o preenchimento automático de novo.
      next.autoResumeSessionManuallyDisabled = !partial.autoResumeSessionEnabled;
    }
    if (typeof partial.autoResumeSessionCharacter === "string") {
      next.autoResumeSessionCharacter = partial.autoResumeSessionCharacter;
    }
    // v0.9.6 — auto convidar pra party.
    if (typeof partial.isPartyLeader === "boolean") next.isPartyLeader = partial.isPartyLeader;
    if (typeof partial.autoInvitePartyEnabled === "boolean") next.autoInvitePartyEnabled = partial.autoInvitePartyEnabled;
    if (Array.isArray(partial.autoInvitePartyTargets)) {
      next.autoInvitePartyTargets = partial.autoInvitePartyTargets.filter((s) => typeof s === "string" && s);
    }
    if (partial.huntMode === "solo" || partial.huntMode === "group") next.huntMode = partial.huntMode;
    // v0.9.15 — vender automaticamente ao chegar na cidade.
    if (typeof partial.autoSellOnCityArrival === "boolean") {
      next.autoSellOnCityArrival = partial.autoSellOnCityArrival;
    }
    // v0.9.18 — rodízio de personagens por stamina.
    if (typeof partial.minimizeGameAnalyzer === "boolean") {
      next.minimizeGameAnalyzer = partial.minimizeGameAnalyzer;
    }
    if (typeof partial.rotateCharactersEnabled === "boolean") {
      next.rotateCharactersEnabled = partial.rotateCharactersEnabled;
    }
    if (Array.isArray(partial.rotateCharacters)) {
      next.rotateCharacters = partial.rotateCharacters.filter((s2) => typeof s2 === "string" && s2);
    }
    if (partial.rotateMinStaminaMinutes !== undefined) {
      const n = Number(partial.rotateMinStaminaMinutes);
      if (!Number.isNaN(n)) next.rotateMinStaminaMinutes = n;
    }
    // v0.13.0 — Auto Bestiary (Ladder). O painel manda o objeto inteiro
    // (lista editada por completo, igual `rotateCharacters`) — nunca confia
    // cegamente no que vem do host: item sem `hunt` ou com `faseAlvo`
    // inválido é descartado em vez de gravado quebrado.
    // TASK-003-R2 — modelo por CAÇADA: a CRIAÇÃO nova (`adicionarCacadaNaEscada`
    // no renderer) nunca duplica uma `hunt` já presente.
    // TASK-003-R2.1 — REVERTIDO: esta validação chegou a deduplicar por
    // `hunt` também aqui, mantendo só a primeira ocorrência. Isso é
    // DESTRUTIVO pra configuração legada: como QUALQUER `setConfig` de
    // Bestiary (iniciar, pausar, mexer no stepper de um item, marcar
    // concluída) passa por aqui, uma duplicata legada válida (duas entradas
    // da mesma hunt com criaturas de referência diferentes, de antes desta
    // mudança de modelo) era apagada na PRÓXIMA ação trivial qualquer, sem o
    // usuário sequer tocar nela. Esta validação agora só filtra itens
    // estruturalmente inválidos (`hunt` vazio, `faseAlvo` não numérico ou <
    // 1) — nunca remove uma entrada por ela compartilhar `hunt` com outra.
    // Consolidar duplicatas, se um dia for feito, precisa ser uma ação
    // explícita do usuário — não uma leitura silenciosa como esta.
    if (partial.bestiaryLadder && typeof partial.bestiaryLadder === "object") {
      const raw = partial.bestiaryLadder;
      const itens = Array.isArray(raw.itens)
        ? raw.itens
            .map((it) => {
              if (!it || typeof it.hunt !== "string" || !it.hunt.trim()) return null;
              const hunt = it.hunt.trim();
              const faseAlvo = Number(it.faseAlvo);
              if (!Number.isFinite(faseAlvo) || faseAlvo < 1) return null;
              return {
                hunt,
                // `criatura` é a CRIATURA DE REFERÊNCIA da entrada — mesmo
                // campo/semântica de sempre, usada por
                // `bestiaryLadderFaseAtual`/`avaliarAvancoDoBestiaryLadder`
                // pra decidir progresso e conclusão. Não é uma "criatura
                // inventada": vem do catálogo real (renderer só manda nomes
                // de `bestiaryCatalogo`) ou de configuração legada já válida.
                criatura: typeof it.criatura === "string" && it.criatura.trim() ? it.criatura.trim() : hunt,
                faseAlvo: Math.round(faseAlvo),
                concluido: !!it.concluido,
              };
            })
            .filter(Boolean)
        : [];
      const ladderAtual = loadState().bestiaryLadder;
      const indexAtual = ladderAtual ? ladderAtual.index : 0;
      next.bestiaryLadder = {
        enabled: !!raw.enabled,
        // Índice recalculado só quando a lista muda de tamanho (edição na
        // tela) — preserva o "onde eu estava" quando é só liga/desliga.
        index: raw.index !== undefined ? Math.max(0, Math.round(Number(raw.index)) || 0) : indexAtual || 0,
        itens,
      };
    }
    saveState(next);
    sendState();
  }

  async function handleCommand(msg) {
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "start":
        startBot();
        break;
      case "stop":
        stopBot();
        break;
      case "diagStart":
        diagLigar(true);
        break;
      case "diagStop":
        diagLigar(false);
        break;
      case "diagDump":
        // O pacote pode ter megabytes — vai por sendToHost, que é o mesmo
        // canal do estado, mas SÓ quando pedido.
        sendToHost("hm:diag", diagPacote());
        break;
      case "perfStart":
        perfLigar(true);
        break;
      case "perfStop":
        perfLigar(false);
        break;
      case "perfSnapshot":
        sendToHost("hm:perf", perfPacote());
        break;
      case "setConfig":
        applyConfig(msg.payload || {});
        break;
      case "refreshHunts":
        await refreshHuntsAndSend(!!(msg.payload && msg.payload.forceRefresh));
        break;
      case "requestTiers":
        await requestTiersAndSend(
          msg.payload && msg.payload.huntName,
          !!(msg.payload && msg.payload.forceRefresh)
        );
        break;
      case "buildFullCatalog":
        await runFullCatalogSweep();
        break;
      case "seedCatalog":
        // v0.9.16 — o host manda o catálogo salvo em disco pra esta conta,
        // pra ela não precisar remapear nada (tiers são do jogo, iguais em
        // todas as contas).
        seedCatalogFromHost(msg.payload);
        break;
      case "resumeGroupHunt":
        await resumeGroupHuntAfterSync();
        break;
      // v0.12.3 — freio do loop de render. O host é quem sabe qual conta está
      // na tela e se a janela do app está minimizada; aqui só se mexe o
      // interruptor, que é um atributo no <html> (o DOM é compartilhado com o
      // mundo da página, ver `codigoDoFreioNaPagina`).
      case "setRenderBrake":
        try {
          const raiz = document.documentElement;
          if (!raiz) break;
          const ligado = !!(msg.payload && msg.payload.on);
          if (ligado) raiz.setAttribute(FREIO_MARCA, "1");
          else raiz.removeAttribute(FREIO_MARCA);
          // Confirma a chegada do comando imediatamente. A confirmação do
          // gancho no mundo da página vem separada pelo evento acima.
          sendToHost("hm:render-brake", {
            ligado,
            atributoAplicado: raiz.getAttribute(FREIO_MARCA) === "1",
            hookInstalado: raiz.getAttribute(FREIO_MARCA_HOOK) === "1",
          });
          perfRegistrarTroca("render:freio-comando", { ligado });
        } catch (err) {
          // sem <html> ainda — o host reenvia na próxima troca de conta
        }
        break;
      case "goToCity": {
        const result = await goToCityNow();
        sendToHost("hm:commandResult", { commandId: msg.commandId, ...result });
        break;
      }
      case "switchCharacter": {
        // v0.11.4 — único comando remoto que demora e pode falhar de verdade
        // (os outros são configuração local instantânea) — por isso responde
        // com um resultado explícito pro host esperar, em vez de ser
        // fire-and-forget como start/stop/setConfig.
        const result = await switchToCharacterNow(msg.payload && msg.payload.targetCharacterName);
        sendToHost("hm:commandResult", { commandId: msg.commandId, ...result });
        break;
      }
      default:
        break;
    }
  }

  // ---------- boot ----------

  function boot() {
    if (window.__hunteraMulticontaAutomationLoaded) return;
    window.__hunteraMulticontaAutomationLoaded = true;

    if (ipcRenderer) {
      ipcRenderer.on("hm:command", (_event, msg) => {
        handleCommand(msg);
      });
    }

    // v0.11.0 — checa "dias de uso" ANTES de ligar qualquer watcher — os
    // outros já nascem gateados por `licensed` (ver cada `tryX`), mas
    // iniciar esse primeiro deixa o valor pronto o mais rápido possível.
    startLicenseWatcher();

    // v0.7.0 — os 3 watchers de Party rodam SEMPRE, independente do "Ligar
    // automação" acima (mesmo padrão da extensão Chrome — auto aceitar
    // convite / sync EK / "Manter a atual" são conveniência social, fazem
    // sentido mesmo com o bot de caçada desligado). Cada função interna já
    // checa o próprio toggle salvo (`loadState()`) antes de agir, então
    // ligar os timers aqui não faz nada sozinho enquanto os toggles da tela
    // de Configurações/Party estiverem desligados. Desde a v0.11.0, todas
    // também checam `licensed` — sem dias de uso válidos, nenhuma delas age.
    startPartyInviteWatcher();
    startEkSyncWatcher();
    startFollowLeaderWatcher();
    startResumeSessionWatcher();
    startCharacterNameWatcher();
    startAutoInvitePartyWatcher();
    // v0.9.20 — venda na cidade também roda independente do "Ligar
    // automação" (o próprio toggle dela manda; com a automação ligada, quem
    // cuida é o monitorTick).
    startCitySellWatcher();
    // v0.11.8 — treino: também independe do "Ligar automação" (cada condição
    // tem o seu checkbox). Ver o comentário em `startTrainingWatcher`.
    startTrainingWatcher();
    // v0.11.10 — config global do detector de spawn seco.
    startSpawnConfigWatcher();
    // v0.11.20 — retoma a gravação do protocolo se ela estava ligada antes do
    // reinício. Sem isto, a chave salva não serviria pra nada.
    if (loadState().diagEnabled) diagLigar(true);
    // v0.11.9 — religar sozinha depois de server save/queda.
    startRestartWatcher();
    // v0.9.23 — analyzer próprio + minimizar o analisador do jogo.
    novaSessaoStats("boot");
    startAnalyzerWatcher();

    // O preload roda em document-start, bem antes de a SPA do jogo montar —
    // espera existir pelo menos um <body> antes de reportar/começar a
    // religar sozinha se estava ligada.
    waitFor(() => document.body, 15000).then((body) => {
      const cfg = loadState();
      logEntries = cfg.log || [];
      statusText = cfg.running ? "Caçando" : "Parado";
      sendState();
      if (!body) return;
      // Se a automação estava ligada quando a página recarregou de verdade
      // (não troca de rota interna — isso não recarrega a página, só um F5
      // ou reabrir o app), religa sozinha em vez de deixar parada.
      if (cfg.running) startBot();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
