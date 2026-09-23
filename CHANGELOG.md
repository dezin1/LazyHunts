# Changelog

## 0.13.0-bestiary.10 — 2026-09-22 (prévia de teste)

> ⚠️ **Versão de teste, não é release final.** Mesmo ciclo do Bestiário.

### Nova ferramenta de investigação: logs direto na pasta do projeto

André sugeriu: em vez de baixar cada log/print e anexar na conversa toda vez, salvar direto numa pasta que já pode ser lida sem esse vai-e-vem. Só funciona em desenvolvimento (`npm start`, nunca num build instalado):

- **Log do protocolo** e **Baseline de performance** (já existiam) agora também salvam em `logs/` na raiz do projeto, além do download de sempre.
- **Nova: "Capturar tela do jogo"** (Configurações → Caçada) — tira uma foto do HTML da janela aberta na conta selecionada (prioriza o seletor de caçadas, se estiver aberto) e salva do mesmo jeito. É a ferramenta que teria resolvido mais rápido as investigações desta sessão (tela "Como você quer caçar?", seletor de tier) sem precisar de print/descrição.

`logs/` entrou no `.gitignore` — é captura de investigação, não código.

## 0.13.0-bestiary.9 — 2026-09-22 (prévia de teste)

> ⚠️ **Versão de teste, não é release final.** Mesmo ciclo do Bestiário.

### Correção: "Como você quer caçar?" continuava travado depois da `.6`

André confirmou com print: a busca do botão "Organizar caçada"/"Explorar caçadas" só olhava dentro de `button`/`a`/`[role="button"]`, e o card provavelmente é um `<div>` comum com clique do Angular, sem nenhuma dessas marcações. Agora a busca é por TEXTO em qualquer elemento folha da tela, e clica nele — o clique sobe (bubbling) até quem estiver de fato escutando, então não depende de adivinhar a tag certa.

## 0.13.0-bestiary.8 — 2026-09-22 (prévia de teste)

> ⚠️ **Versão de teste, não é release final.** Mesmo ciclo do Bestiário.

### Correção: a tela ainda mostrava "Fase 0" depois da correção da `.7`

André confirmou com print ao vivo: mesmo na `.7`, "Tortoise Shore" (85,3k abates) continuava mostrando "Fase 0 → alvo 1". Causa: o piso de 2.500 abates só tinha sido aplicado em `bestiaryLadderFaseAtual()` (usada pela decisão de avanço da escada) — o `sendState()` que alimenta a tela calculava a fase de novo, direto, duplicado, sem passar pela correção.

Consolidado num único lugar (`faseAtualPorChave()`), usado tanto pela decisão de avanço quanto pelo estado enviado à tela — agora os dois concordam.

## 0.13.0-bestiary.7 — 2026-09-22 (prévia de teste)

> ⚠️ **Versão de teste, não é release final.** Mesmo ciclo do Bestiário.

### Correção: "Fase 0" mostrado mesmo com dezenas de milhares de abates

Causa raiz documentada hoje (achado em `huntera-automacao/CLAUDE.md`, print real da Cyclopedia do André): o tipo 92 só dispara no EXATO abate que cruza o limiar de uma fase, nesta sessão — uma criatura que já passou da Fase 1 em sessões anteriores nunca gera esse evento de novo, e a escada ficava mostrando "Fase 0" pra sempre.

Confirmado em 4 classes de criatura diferentes: a Fase 1 do Bestiary custa sempre **2.500 abates cumulativos**. Quando não há evento de fase nesta sessão, mas os abates já bateram 2.500, a Fase 1 agora é considerada alcançada. Fases 2/3 **não** são inferidas — os limiares delas ainda não têm confirmação pra criatura genérica.

## 0.13.0-bestiary.6 — 2026-09-22 (prévia de teste)

> ⚠️ **Versão de teste, não é release final.** Mesmo ciclo do Bestiário.

### Causa raiz encontrada: tela nova "Como você quer caçar?" antes da lista

André mandou print: o jogo passou a mostrar uma tela intermediária (cards "Organizar caçada" / "Encontrar time") antes da lista de caçadas de sempre, dentro do MESMO modal `.hunt-window` — por isso tudo que vínhamos corrigindo nesta investigação (lista perdendo entrada no meio, tier não lido) tinha essa causa em comum: o código achava o modal aberto e já tentava usar a busca, que só existe depois de escolher "Organizar caçada". Corrigido no ponto único (`ensureHuntWindowOpen`) usado por TODOS os fluxos que abrem esse seletor — mapeamento, tier avulso, e iniciar uma caçada normal.

### Simplificação: usar o protocolo em vez de clicar em cada caçada

André perguntou o óbvio: o catálogo inteiro (nomes + tiers) já vem pronto pelo protocolo do jogo (tipo 42) — não precisava abrir o seletor e clicar em dezenas de caçadas uma por uma. O "Mapear catálogo completo" agora usa esses dados diretamente quando já chegaram nesta sessão (instantâneo, sem abrir nada), e só cai pro clique manual (agora corrigido) como fallback, pro caso raro de o tipo 42 ainda não ter chegado.

## 0.13.0-bestiary.5 — 2026-09-22 (prévia de teste)

> ⚠️ **Versão de teste, não é release final.** Mesmo ciclo do Bestiário.

### Correção: "Mapear" travava dentro da caçada, só avançava com voltar manual

André confirmou ao vivo: depois do fix da `.4`, o mapeamento entrava numa caçada pra ler o tier e **não voltava sozinho** pra próxima — só avançava se ele clicasse em voltar na tela, na mão. Causa: clicar numa entrada da lista passou a **navegar pra uma tela de detalhes** que troca a lista/busca de lugar, em vez de só mostrar os tiers por cima dela (era assim que o código antigo, e o comentário original, assumiam).

Em vez de caçar um botão "voltar" novo (arriscado — já foram 2 seletores que quebraram nesta mesma investigação), a varredura agora **fecha e reabre a janela inteira do seletor antes de cada caçada** (menos a primeira, já aberta) — o mesmo fluxo comprovado que já inicia caçadas de verdade (`pickAndStartHunt`).

## 0.13.0-bestiary.4 — 2026-09-22 (prévia de teste)

> ⚠️ **Versão de teste, não é release final.** Mesmo ciclo do Bestiário.

### Correção: "Mapear" catálogo perdia caçadas no meio da varredura

Causa raiz confirmada ao vivo pelo `[MAPEAR-DIAG]` da `.3`: "Tortoise Shore" (e outra caçada) não eram mais encontradas pelo `findHuntEntry` no meio do mapeamento, mesmo tendo aparecido certinho na varredura inicial de nomes. O código confiava que a lista inteira (aberta com busca vazia) continuava toda renderizada do início ao fim — em listas maiores isso não se sustenta depois de já ter clicado em outra caçada.

Agora cada caçada é buscada pelo nome antes de clicar nela, igual ao fluxo que já inicia caçadas de verdade (`pickAndStartHunt`) e nunca teve esse problema. `[MAPEAR-DIAG]` continua registrado como rede de segurança, caso alguma caçada ainda falhe por outro motivo.

## 0.13.0-bestiary.3 — 2026-09-22 (prévia de teste)

> ⚠️ **Versão de teste, não é release final.** Mesmo ciclo do Bestiário.

### Diagnóstico: cobrir a falha ANTES da leitura de tier

Na `.2`, o `[MAPEAR-DIAG]` só disparava se a caçada abrisse mas o seletor de tier não aparecesse. André testou com a `.2` rodando (confirmado pelo rodapé) e nenhum `[MAPEAR-DIAG]` saiu, mesmo com 2 de 3 caçadas falhando — ou seja, a falha real é ANTES disso: `findHuntEntry()` não está achando o botão da caçada na lista (estrutura da lista pode ter mudado, ou o nome não bate mais exatamente com o que veio da varredura inicial). Agora esse caminho também loga `[MAPEAR-DIAG]`, uma vez por varredura.

## 0.13.0-bestiary.2 — 2026-09-22 (prévia de teste)

> ⚠️ **Versão de teste, não é release final.** Mesmo ciclo do Bestiário, número novo só porque o conjunto abaixo já foi testado manualmente e precisa ficar identificável.

### Correção: jogo travava em "Carregando o jogo…" sem um jeito de resolver

Trazido também pra cá do fix já publicado em produção (`main`, 0.12.5): reload comum (`webview.reload()`) não resolve quando o Chromium continua servindo um bundle JS velho do cache HTTP (ou de um Service Worker). Novo botão **"Recarregar sem cache"** (popover da lupa, ao lado do reload comum): limpa cache HTTP + service workers/Cache Storage só da partição daquela conta — não desloga (cookies/localStorage preservados).

### Diagnóstico: mapeamento de "Tamanho do pull" travando em "clique em ↻ Mapear"

André reportou o "Mapear catálogo" (aba Caçada) deixando o dropdown de tier vazio mesmo depois de clicar em atualizar, possivelmente ligado a uma atualização do jogo no mesmo dia. Sem acesso a DevTools no ambiente dele, não dá pra inspecionar o DOM na mão — este ciclo só ADICIONA instrumentação (`[MAPEAR-DIAG]` no log da conta, aba Histórico): quando o seletor `.hunt-tiers .hunt-tier` não acha nada pra uma caçada, loga os elementos com "tier" na classe e os botões visíveis na janela, uma vez por varredura. Nenhuma correção funcional ainda — precisa do log real pra saber se é seletor mudado, timing, ou caçada sem opção de tier.

## 0.13.0-bestiary.1 — 2026-09-22 (prévia de teste)

> ⚠️ **Versão de teste, não é release final.** Existe pra dar ao André um número concreto pra apontar quando testar o Bestiário novo ("estou na 0.13.0-bestiary.1"), não uma promessa de que o 0.13.0 definitivo vai sair exatamente assim. Feedback deste ciclo pode ainda mudar comportamento antes do release de verdade.

### Auto Bestiary organizado por CAÇADA (não mais por criatura)

- A escada agora tem **uma entrada por caçada**, nunca uma prioridade separada por criatura da mesma hunt — auditoria confirmou que não existe (nem no protocolo, nem no projeto) uma regra de "conclusão agregada" pra várias criaturas da mesma caçada, então a automação continua decidindo progresso por uma **criatura de referência** só (mesma leitura de `economia.bestiarioFases` de sempre); as demais criaturas mapeadas da caçada aparecem como informação, e dá pra trocar qual delas é a referência.
- **Nível-alvo virou stepper** (−/+) em "Minha escada", sem teto inventado — não existe um máximo confirmado no protocolo pra qualquer criatura além das 3 primeiras fases já vistas ao vivo.
- **Iniciar/Pausar Bestiário explícito**: um botão único (mesmo padrão visual do "Ligar automação") liga/desliga a escada inteira sem mexer em ordem, níveis ou "concluídas" — substitui o checkbox discreto de antes.
- **Configuração legada preservada**: escadas salvas antes desta mudança (inclusive com duas entradas da mesma caçada, de um defeito já corrigido) continuam carregando integralmente — nada é descartado ou consolidado sozinho.
- **Catálogo de caçadas virou modal** ("+ Adicionar caçadas"), com busca e grid de cards compactos — antes ficava sempre montado na lateral estreita, comprimindo "Minha escada". Fechado, o catálogo não ocupa DOM nenhum.

### Versionamento

- `package.json` e o indicador de versão no rodapé do app (novo, discreto — "Swag vX.Y.Z") passam a ser atualizados junto com toda entrega de teste, a partir de agora — ver regra permanente no `CLAUDE.md` da raiz.

## 0.12.4 — 2026-09-17

### Correção: o painel de desempenho ficava "Medindo…" para sempre

Defeito meu na v0.12.2, e dos bobos. Pus uma condição pra só medir com a seção aberta (`offsetParent !== null`), e ela ficava **antes** da primeira escrita de texto. Na sua máquina a condição nunca passou, então nada nunca foi escrito e o painel ficou parado no texto inicial por minutos. A condição economizava uma chamada de IPC a cada 4 segundos — ou seja, nada — e tinha exatamente um modo de falha, que foi o que aconteceu. Removida.

**Três coisas mudaram:**

1. **Mede na hora.** Antes a primeira medição só vinha depois de 4 segundos; agora sai assim que o app abre, e de novo toda vez que você abre as Configurações.
2. **O painel nunca fica mudo.** Cada motivo de falha agora tem frase própria: preload antigo ("feche e abra o Swag de novo"), handler não registrado, erro do `getAppMetrics`, resposta vazia. Se a montagem do painel estourar, o erro aparece no lugar do número em vez de sumir.
3. **Teste pra isso**, que é a parte que importa: `teste-perf.js` ganhou 8 casos que rodam `renderPerfLive` com preload velho, `hunteraFarm` inexistente, handler que rejeita, handler que estoura sem promessa, `getAppMetrics` indisponível, resposta vazia, resposta nula e o caminho feliz — **e conferem que em todos o painel escreveu alguma coisa**. Bateria total: **406 checagens**.

A lição registrada no CLAUDE.md é essa: painel de diagnóstico que não diagnostica a si mesmo é o mesmo defeito que o detector de spawn seco teve por meses — ficar em silêncio quando quebra é pior do que não existir.

## 0.12.3 — 2026-09-17

### Não desenhar as contas que ninguém está vendo

Sua ideia: "aba minimizada não renderiza o jogo e fica só troca de mensagens". O objetivo estava certo, o caminho não era possível — e a diferença importa.

**Por que não dá pra trocar o cliente por um WebSocket direto.** O protocolo do Huntera é **criptografado** (investigado em 04/09/2026, está no CLAUDE.md: 48 frames reais, bytes indistinguíveis de ruído nos dois sentidos). O Swag lê texto plano porque o gancho está em `TextDecoder.decode` — a gente lê **depois que o próprio cliente do jogo decifrou**, com a chave da sessão dele. Nunca decifrámos nada, e nunca mandámos uma mensagem: tudo que muda estado é clique no DOM. Um cliente próprio precisaria da chave de sessão, o que é um projeto de engenharia reversa à parte — e um cliente próprio falando o protocolo é um risco de banimento categoricamente maior que automatizar o cliente oficial.

**Mas o caro nunca foi o socket — é o Phaser.** O jogo é Angular + Phaser, e o Phaser desenha o mundo em canvas/WebGL num loop de `requestAnimationFrame`, 60 vezes por segundo, em cada conta, mesmo nas que estão fora da tela. E esse loop **é separável do socket**.

**O freio** (toggle em Configurações → Log do protocolo → Desempenho, desligado por padrão). Reduz o desenho a ~2 fps nas contas que ninguém está vendo, e em **todas** quando a janela está minimizada. Volta a 60 fps no instante em que você seleciona a conta.

Não toca em: WebSocket (orientado a evento), timers (heartbeat), nem o HUD do Angular — que é de onde a automação lê capacidade, stamina, botões e tracker de expedição. **Frear o Phaser não cega o bot.**

**Uma decisão de implementação que vale registrar.** O freio **não** troca `requestAnimationFrame` por `setTimeout`. Seria a forma óbvia e seria um tiro no pé: numa conta escondida o Chromium já suspendeu o rAF, enquanto os timers continuam correndo (a v0.4.4 desligou o throttling de timer de propósito) — trocar um pelo outro levaria a conta escondida de 0 fps para 2 fps. Otimização que piora. Em vez disso o rAF continua sendo o único motor, e o freio só **absorve** frames. Assim é impossível gastar mais do que sem o freio, e o teste mede exatamente isso.

**Teste novo: `teste-freio.js`, 18 checagens** — inclusive a garantia estrutural de que o código gerado não contém `setTimeout`, e um sandbox que nem define `setTimeout`, de modo que um motor próprio quebraria o teste em vez de passar despercebido. Bateria total: **398 checagens**.

### O que esperar

Ganho em **CPU e GPU**. Em **RAM não**: textura e buffer de WebGL continuam alocados mesmo sem desenhar — pra memória o que temos é o purge da v0.12.2.

⚠️ Se a imagem engasgar ao voltar pra uma conta (o Phaser pode reagir mal a um delta de frame grande), desligue o toggle e me avise. Não afeta o servidor — o servidor é autoritativo —, mas pode ficar feio na volta.

## 0.12.2 — 2026-09-17

### Desempenho, parte 2: medir em vez de chutar

Você mandou o Gerenciador de Tarefas — 3 contas, "Electron (8)", **2.840 MB e 32% de CPU** — e disse que não sentiu diferença. Justo, e a v0.12.1 não ia mudar esse número mesmo: ela atacou **travada** (gravação síncrona em disco e layout forçado na thread de render), que é outro problema. Confundi os dois na hora de te responder.

**Painel de desempenho** (Configurações → Log do protocolo → Desempenho). O Windows soma o app inteiro num número só, e com um número só não dá pra decidir nada. Agora aparece **memória e CPU por processo, com o nome da conta em cada um** — e a nossa própria interface rotulada separada, que é o que distingue "o app é pesado" de "o jogo é pesado". Usa `app.getAppMetrics()`; é leitura pura, não muda comportamento.

**Liberar memória das contas em segundo plano** (toggle, desligado por padrão). O Chromium devolve memória ao sistema sozinho quando uma aba fica parada — mas a v0.4.4 desligou o backgrounding de renderer no app inteiro pra o jogo não desconectar, e **desligar o backgrounding desliga esse purge junto**. Ou seja: a proteção anti-desconexão cobra em RAM, o tempo todo, de todas as contas. Ligado, o Swag pede o purge na mão a cada 2 minutos, só pras contas que **não estão na tela** — via `Memory.forciblyPurgeJavaScriptMemory`, a mesma operação que o Chromium faria sozinho. Não mexe em prioridade de processo, timer nem socket: nada que o jogo enxergue. O botão **"Liberar agora"** roda em todas e mostra quanto liberou.

Conta visível nunca é purgada automaticamente (forçar coleta no meio do render de quem você está olhando seria trocar um problema por outro), e no modo grade — onde todas estão visíveis — o automático não roda.

**Teste novo: `teste-perf.js`, 25 checagens** — pid vira o nome da conta certa, renderer nenhum fica sem rótulo, conta na tela nunca entra no purge, debugger anexado por outra coisa não é solto por engano. Bateria total: **378 checagens**.

### O que eu ainda não sei, e como descobrir

Auditei nossas estruturas em memória: tudo tem teto (log 120 linhas, rastro, intervalos, anéis do diagnóstico). **Não é o nosso script que come 2,8 GB** — são ~950 MB por conta, e isso é o cliente do jogo mais o Chromium em volta. O painel novo é o que vai dizer quanto disso é o processo de vídeo, quanto é cada conta e quanto somos nós.

Uma ressalva honesta sobre a comparação com o idle-labs: eles anunciam economia rodando **idle games**, que são páginas em sua maioria estáticas. O Huntera é um cliente de MMO em canvas que recebe **3 MB de terreno por mensagem**. O custo por conta é dominado pela página, não pelo container — o número deles com 6 abas de idle game não é comparável ao nosso com 3 clientes de Huntera.

## 0.12.1 — 2026-09-17

### Desempenho — a travada era nossa, não do jogo

Você reportou lag na sua máquina e outros usuários também. Fui medir o código em vez de chutar, e o que estava caro **rodava dentro do processo do jogo, na mesma thread que desenha a tela**. Por isso aparecia como frame travado, e não como "o app está lento".

**1. Cada linha de log gravava o estado inteiro no disco.** `log()` chamava `saveState({log})`, que fazia `getItem` + `JSON.parse` do blob inteiro (com as 120 linhas de log dentro), `JSON.stringify` e `setItem`. `localStorage` é **síncrono e vai pro disco**. São 95 pontos de log no arquivo — era a gravação mais frequente do app. Agora a linha entra no estado na hora e o disco recebe **uma gravação por janela de 1,5 s**: uma rajada de 10 logs vira 1 escrita em vez de 10. `pagehide` descarrega o que estiver pendente, então fechar o app não perde a última linha.

**2. Cache do estado em memória.** `loadState()` é chamado em 25 lugares, vários dentro de timers de 1,2 s / 1,5 s / 4 s, e cada chamada era leitura de disco + parse. Agora o disco é lido uma vez e o cache serve o resto. É seguro porque nesta partição existe **um único escritor** desta chave (todo `setItem` passa por `saveState`) — e mesmo assim o evento `storage` invalida o cache se algum dia aparecer outro. Continua devolvendo **cópia** a cada chamada, pra semântica não mudar em silêncio.

**3. O `MutationObserver` da capacidade estava sem freio.** Ele observa o subtree do container de capacidade com `characterData: true` e disparava `monitorTick()` **a cada mutação**. O HUD do jogo mexe nesse subtree o tempo todo (vida, mana, cap mudam a cada tick), então virava dezenas de ticks por segundo — e cada tick chama `isGameUiReady()` → `queryVisible()` → `isVisible()`, que usa `getComputedStyle` + `getClientRects()`. Isso é **layout síncrono forçado dentro do loop de render do jogo**: o padrão de livro de frame travado, e o suspeito número um. Agora a rajada colapsa num tick só, com 400 ms de freio — imperceptível pro que o observer existe pra fazer, já que o piso dessa mesma decisão sempre foi o poll de 4 s.

**4. Dois timers curtos trabalhando à toa.** O de 1,5 s (sincronizar ALVO com o EK) marcava a conta como **ocupada** a cada disparo mesmo com a sincronia desligada, atravessando o caminho do `monitorTick` de graça. O de 1,2 s (diálogo "seguir o líder") lia o estado antes de checar as travas baratas. Os dois agora conferem do mais barato pro mais caro, e saem antes de encostar no DOM quando a feature está desligada.

**5. Teto de tamanho no log do protocolo.** O tipo 88 (terreno) tem **~3 MB por mensagem** e passava inteiro pro diagnóstico: string de 3 MB clonada pra atravessar a fronteira de mundos, guardada inteira no anel de eventos e descartada logo em seguida pelo teto de bytes. Era churn de GC de megabytes por segundo pra quem ligasse o log — travava a máquina. Agora mensagem acima de 512 KB atravessa só o começo (2000 chars): o tipo continua sendo contado e dá pra ver o formato, que é tudo que a gente quer do terreno. Os catálogos do login, que são o motivo do diagnóstico existir, passam inteiros (42 tem 340 KB, 26 tem 224 KB).

**Nada disso encosta na proteção anti-desconexão** (v0.4.2/v0.4.4). Aquilo continua exatamente como está.

**Teste novo: `teste-desempenho.js`, 29 checagens.** Não testa valor de retorno — testa **contagem**: quantas vezes o disco é tocado, quantos ticks uma rajada de 60 mutações produz, quantos chars atravessam por mensagem. Todo fix desta leva é uma contagem, então o teste é uma contagem. Total da bateria: **353 checagens**.

### O que ficou de fora, de propósito

O modo de economia que deixa conta escondida parar de pintar (afrouxar os switches globais `--disable-renderer-backgrounding` / `--disable-backgrounding-occluded-windows`) **não entrou**. É onde está o maior ganho com o app minimizado, mas é exatamente a área que causou a desconexão que a v0.4.2/v0.4.4 consertou. Fica pra uma versão própria, como toggle desligado por padrão, depois de medir o ganho destes fixes primeiro.

Também não entrou o painel de CPU/RAM por conta.

## 0.12.0 — 2026-09-16

### macOS

A partir daqui **toda entrega sai para os dois sistemas**.

**O conserto que o mac exigia.** O `Menu.setApplicationMenu(null)` da v0.7.2 (você pediu pra sumir com File/Edit/View) no Windows tira só um enfeite. No macOS ele tira junto os **atalhos do sistema**: sem um menu com o papel de edição, **Cmd+C, Cmd+V, Cmd+X e Cmd+A param de funcionar**, e sem o papel de aplicativo não existe Cmd+Q. O app tem campo de texto em vários lugares — token do Telegram, chat id, nome de caçada — onde colar é obrigatório. Agora, só no mac, vai o menor menu que preserva o comportamento nativo: aplicativo e edição. Nada de File/View. Nos outros sistemas continua sem barra nenhuma.

**O resto já estava pronto e eu não esperava.** Nenhum módulo nativo (só `electron` e `electron-updater`, os dois JavaScript puro), nada de registro do Windows, nada de `.exe`, caminhos todos via `path.join`. E o ciclo de vida do mac já estava tratado: `window-all-closed` já checava `darwin` e o handler de `activate` já existia.

**Build.** Entrou o bloco `mac` (dmg + zip, Apple Silicon e Intel), o `icon.icns` gerado a partir do mesmo leão, e os scripts `dist:mac`, `dist:win` e `dist:all`.

**Nome de artefato sem versão** — `Swag-mac-arm64.dmg` em vez de `Swag-0.12.0-arm64.dmg`. Parece detalhe e não é: é o que permite um link de download permanente no site, que nunca mais precisa ser trocado a cada versão.

⚠️ **Sem assinatura da Apple**, o macOS põe o app em quarentena. Na primeira vez: botão direito → Abrir, ou `xattr -cr /Applications/Swag.app`. E a atualização automática do `electron-updater` **não funciona no mac sem app assinado** — no Windows continua igual.

⚠️ **O `.dmg` só pode ser gerado no próprio macOS**: o `dmg-license` é `Valid os: darwin`. Daqui eu produzo o `.app` empacotado em zip (fiz, e ele está íntegro), mas o instalador de verdade sai de um Mac ou de um runner macOS no CI.

## 0.11.42 — 2026-09-15

### Por que o detector ficou mudo na conta do Amoxicilina

O log dele prova que a seca existiu: às 676s ele matou o último bicho e às 687s já estava com **0 criaturas vivas e 67 tiles andados**, num limiar de 56. Foram 181 momentos seguidos com as duas condições satisfeitas, e nada aconteceu.

Duas causas, e as duas silenciosas.

**1. Sem o id do personagem, o critério de tiles é decoração.** O contador de posição só roda quando o app sabe o id, e esse id vem do tipo 103 — que chega **só no login**. Se o gancho instala depois (app aberto com o jogo já rodando), ele nunca chega: na captura dele, 12 minutos, zero mensagens do tipo 103. Sem id, o perfil enche de zeros, o p90 dá zero, o limiar cai no piso de 25 e a comparação `0 >= 25` é falsa pra sempre.

Agora existe uma **terceira fonte do id: o tipo 30** (o XP daquela morte), que traz o `playerId` e chega a cada morte — 488 vezes naquela captura. Em party ele traz o id de quem matou, então a regra se protege: só aceita quando um único id apareceu três vezes ou mais, e se um segundo aparecer ela se desliga em vez de chutar.

E "perfil só de zeros" passou a ser reconhecido pelo que é — **rastro morto** — em vez de virar um limiar inalcançável. O painel diz isso com todas as letras.

**2. Tile não é segundo.** Com o id recuperado, a simulação mostrou o detector disparando **6 segundos** depois da última morte — porque o Amoxicilina é rápido e cobre 40 tiles nesse tempo. E no log real as criaturas voltaram 25s depois. Sair ali seria trocar uma pausa por uma transição, à toa.

Entrou um **piso de 15 segundos**. Nas capturas em que a saída foi certa, os disparos vinham aos 11s (Dezin) e 18s (Kina); o piso preserva as duas — a do Dezin sai 4s mais tarde — e mata a de 6s. Continua sendo 6x mais rápido que os 90s de antes.

⚠️ **Conferir também**: o log dele diz **versão 0.11.36**, e o pacote não tem o campo `eventos` — que só existe a partir da 0.11.37. Ou seja, a instalação dele não subiu junto. O detector é igual nas duas versões, então isso não explica o silêncio, mas vale alinhar.

12 checagens novas rodando contra a captura real dele; 324 no conjunto.

## 0.11.41 — 2026-09-15

### Você não vai me mandar print todo dia

A resposta pra sua pergunta é não, e esta versão existe pra que ela continue sendo não.

A v0.11.40 consertou o motivo real de o painel nunca ser lido (o "Matar " na frente do rótulo). Só que a leitura ainda dependia de três coisas que podem mudar sem aviso: o nome da classe do container, o nome da classe da linha e do rótulo, e uma **frase em português** ("Mostrar as caçadas onde X aparece"). Qualquer uma delas mudando, você voltaria pro print diário.

Agora cada camada tem um plano B — e o plano B do nome da criatura resolve de vez: **o protocolo já me deu os 129 nomes de criatura** (tipo 26). Então qualquer `title`, `alt` ou `aria-label` da linha que seja **exatamente** um nome do catálogo é uma criatura. Sem regex, sem idioma, sem chute. Se o jogo virar inglês ou trocar a frase, continua funcionando.

E continua sem inventar: texto que não é nome de criatura do catálogo é ignorado, e sem catálogo **e** sem a frase ele devolve vazio em vez de adivinhar.

Então o fluxo do seu dia a dia é: a expedição nova aparece, o painel está na tela, o Swag lê e guarda. Sem print, sem mim no meio. A tabela que escrevi ontem (Restless Dead, Woodland Folk) é só rede pra quando o painel não estiver visível.

13 checagens novas quebrando uma dependência de cada vez — classe do container, classe da linha, classe do rótulo, idioma — e conferindo que a leitura sobrevive a todas; 312 no conjunto.

## 0.11.40 — 2026-09-15

### O painel dizia "Matar Giants"; o protocolo dizia "Giants"

Seu print entregou a causa raiz, e ela é muito melhor que as duas famílias que faltavam: **o painel do jogo escreve "Matar Giants" e o tipo 33 manda "Giants"**. A comparação era exata, então nenhuma linha do painel casava com nenhum objetivo — **nunca**.

Isso explica tudo de uma vez. A fonte autoritativa, a que sabe de verdade quais criaturas contam, estava quebrada por uma diferença de prefixo desde o começo. As três fontes de reserva que fui construindo (cache em disco, `familyId`↔`bestiaryId`, classe do bestiário) existem porque a boa estava morta em silêncio — e nenhum teste pegou, porque todos passavam o rótulo já no formato do protocolo.

Agora casa quando o texto do painel **é** o rótulo ou **termina** com ele depois de um espaço. Comparar por "contém" seria frouxo; exigir o fim garante que "Giants" não case com uma linha "Giants Mortos na Semana".

Com isso, qualquer expedição se resolve sozinha assim que o painel estiver na tela — inclusive as que ainda nem existem.

### E as duas que você leu pra mim

**Restless Dead** = Skeleton e Ghoul. **Woodland Folk** = Elf, Elf Scout e Dwarf. Ficaram gravadas como rede pra quando o painel não estiver visível. Conferi cada nome contra o catálogo do jogo antes de escrever — a grafia do jogo é "Elf Scout".

Com a regra do mais fraco da v0.11.39, elas mandam o personagem para:

- **Restless Dead** → Bone Crypt (Skeleton, xp 35), não Ghoul Graveyard
- **Woodland Folk** → Dwarf Mines (Dwarf, xp 45), não Yalahar Elf Quarter (que tem 2 da família, mas força 175)
- **Giants** → Cyclop Hills (Cyclops, xp 150), não Issavi Steppe

18 checagens novas, incluindo a prova do prefixo e a validação de cada criatura contra o catálogo real; 300 no conjunto.

## 0.11.39 — 2026-09-15

### A expedição vai pro bicho mais fraco

*"Ela entrou em uma caçada muito forte. A expedição preferencialmente é para ser feita no bicho mais fraco disponível."*

A regra antiga escolhia a caçada que mata **mais** criaturas do objetivo. Parecia eficiente e era o contrário. Na sua expedição "Giants":

| caçada | criaturas da família | monstro mais forte que mora lá |
|---|---|---|
| Cyclop Hills | Cyclops | xp 150, vida 400 |
| Behemoth Quarry | Behemoth | xp 2.500, vida 4.000 |
| **Issavi Steppe** | Ogre Rowdy **e** Ogre Sage | **xp 9.000, vida 9.800** |

Issavi ganhava por dois acertos contra um — e leva junto Lamassu, Feral Sphinx, Manticore e mais cinco. Era pra lá que o personagem ia.

Agora a ordem é: **mais fraca primeiro**, empate resolvido por quem mata mais criaturas do objetivo. Sua regra também é a mais rápida, não só a mais segura: objetivo de expedição conta **morte**, e vinte Cyclops morrem no tempo de um Lamassu.

A força de uma caçada é a do monstro **mais forte** que mora nela, não a média — lá dentro se enfrenta tudo, não só o bicho do objetivo. Isso vem do tipo 26, que já tinha voltado na v0.11.38.

**O tier continua sendo o mais difícil disponível**, e não é contradição: a caçada decide *quais* bichos, o tier decide *quantos vêm por vez*. Mais bicho fraco por vez é exatamente o que se quer.

Se o tipo 26 ainda não chegou, a força é desconhecida para todas e a contagem de acertos volta a decidir — o comportamento antigo, em vez de um ranking errado.

9 checagens novas contra o catálogo real, incluindo a prova de que a regra antiga escolheria Issavi; 280 no conjunto.

## 0.11.38 — 2026-09-15

### "Ainda não sei quais criaturas contam para Giants"

Fui atrás e a primeira resposta é ruim: **o protocolo não carrega a lista de criaturas de uma família de expedição.** Conferi nos dois lugares onde ela aparece — tipo 33 e tipo 34 — e os dois trazem só `{objectiveId, familyId, label, tier, quota, progress}`. A lista de bichos existe só no painel de expedição do jogo.

Mas achei uma fonte nova que resolve boa parte: o tipo **26** traz `bestiaryClass` por monstro, e o jogo tem 14 classes — Humanoid (25 criaturas), Human (16), Reptile (15), Magical (15), Undead (13), Vermin (9), Aquatic (6), Mammal (6), Dragon (6), Demon (5), **Giant (4)**, Plant (4), Lycanthrope (3), Construct (2).

Quando o rótulo da expedição **é** uma classe, a lista sai inteira e exata. **"Giants" → Behemoth, Cyclops, Ogre Rowdy, Ogre Sage.** E de graça vêm Undead, Dragons, Demons, Vermin, Plants e todas as outras que aparecerem.

O casamento é **exato** com o nome da classe, aceitando só singular/plural. Isso não é preciosismo: "Trolls" não casa com classe nenhuma (troll é Humanoid, que tem 25 criaturas), então a fonte se cala e deixa o caminho antigo responder. Casar por "parecido" mandaria o personagem caçar 25 espécies erradas por horas.

**"Restless Dead" e "Woodland Folk" continuam sem resposta** — são nomes de família do próprio Huntera, não classes de bestiário. Pra esses, só o painel do jogo sabe, e eu preciso ver o painel uma vez pra destravar.

A ordem das fontes ficou: painel do jogo → o que já foi guardado → `familyId` casado com `bestiaryId` → classe do bestiário. O painel sempre ganha.

Com isso o tipo 26 voltou pra escuta (tinha saído na v0.11.35 junto com a capacidade calculada). Custa um parse de ~224 KB uma vez por login, e agora é a única fonte de uma informação que nada mais tem.

17 checagens novas rodando contra o catálogo real de 129 monstros da sua captura; 271 no conjunto.

## 0.11.37 — 2026-09-14

### O log longo agora guarda o que interessa

Sua captura de 46 minutos tinha 171 mil mensagens. O buffer de 4.000 guardou **os últimos 40 segundos**. Tudo que valia — a caçada em grupo se montando, um *"Dezin Zemsta declined the team hunt. The hunt was cancelled."*, um pedido do Amoxicilina que expirou sem resposta — caiu fora antes de eu ver.

A culpa é do volume: movimento, efeito visual e ficha do personagem fazem ~95% das mensagens e empurram o resto pra fora. Numa sessão longa, a captura virava um retrato do último minuto.

Agora existe um **segundo anel, só pro que é raro** — e "raro" é medido, não listado à mão: uma mensagem entra nele enquanto o tipo dela não tiver passado de 400 ocorrências. Tipo tagarela se auto-exclui depois das primeiras (e essas primeiras ficam, que é o que mostra o formato); tipo que acontece dez vezes numa sessão inteira fica inteiro. Sem lista pra manter desatualizada.

Simulado com a proporção real da sua captura: o anel comum cobre 6% do tempo, o de eventos cobre 100% — e guarda 122 das 122 mensagens raras contra 8 de antes.

11 checagens novas; 254 no conjunto.

## 0.11.36 — 2026-09-14

### O painel não conta como o serviço é feito

Você disse: *"nada que diga como que a gente faz as coisas deveria estar visível. no layout para o usuário precisa ser bem clean"*. Aplicado.

- **Saiu a linha "WebSocket: personagem ... · druid 393".** Não dizia nada que você precise saber pra jogar.
- **O detector de spawn seco saiu da aba de caçada** e foi pra Configurações → Log do protocolo, junto do resto do diagnóstico. Ritmo de lote, tiles e contadores de amostra são ferramenta de quem desenvolve. Não sumiu — quem abre aquela seção está investigando, e foi um daqueles contadores que denunciou o defeito do ritmo.
- **A expedição parou de despejar diagnóstico de DOM** ("o painel está na tela com 3 linhas... me manda este print"). Ficou só a instrução que resolve: abrir o painel do jogo uma vez.

A aba de caçada agora tem o toggle e nada mais.

## 0.11.35 — 2026-09-14

### A capacidade calculada saiu

Você disse que ela não estava convincente, e está certo. Sai.

Vale registrar o que ela era, porque a descoberta continua valendo mesmo sem o código: **o servidor não manda a capacidade restante**. Isso foi provado de duas formas — os 43 valores distintos de capacidade da sua captura não aparecem em nenhuma das 3.830 mensagens, e nenhum campo numérico do protocolo se comporta como capacidade restante. O que existia era uma **reconstrução** (peso de cada item do tipo 74 mais as mudanças do 55), e ela nunca mandou em nada: o número do jogo sempre foi quem decidiu sair pra vender. Mas um número derivado que não converge é ruído no painel, e não é isso que você pediu.

Com ele saem também o tipo 74 e o tipo 26 da escuta — os dois só existiam pra esse cálculo. São **~300 KB a menos de JSON pra parsear por login, por conta**.

Fica o que é leitura de verdade: **nome, level e vocação base** pelo tipo 103 + tipo 15, que continuam respondendo antes de o HUD montar e continuam sendo zerados a cada troca de personagem.

Se um dia isso voltar, o que falta descobrir está no CLAUDE.md: o suspeito é o tipo 62, o container aberto (bag dentro da bag), que ficou de fora por não estar confirmado o que ele é.

241 checagens no conjunto.

## 0.11.34 — 2026-09-14

### O que a caçada ensinou não pode morrer quando o app fecha

Furo achado ao explicar o funcionamento da v0.11.33: o perfil só ia pro disco a cada 20 mortes ou ao trocar de caçada. Fechar o Swag no meio de uma caçada jogava fora o que estava sendo aprendido — inclusive as amostras de **lote**, que são poucas e caras (4 já calibram, e cada uma leva 7 a 20 segundos pra aparecer).

Agora a gravação também acontece por tempo, no máximo uma vez a cada 30 segundos, e ao desligar a automação.

O teste dessa gravação pegou um defeito meu na hora: com o marcador de "última gravação" em zero, a **primeira** gravação ficava bloqueada pelos 30 segundos iniciais — justamente a janela em que o app acabou de abrir e é mais provável ser fechado. Zero agora significa "nunca gravou, grava agora".

6 checagens novas; 274 no conjunto todo.

## 0.11.33 — 2026-09-14

### Sair da caçada seca, calibrado por caçada

Você disse duas coisas: *"ainda acho que demora demaaais"* e *"caçada é um respawn diferente, um lugar diferente, bichos diferentes, tempos diferentes... não poderia ser padrão"*. As duas estavam certas — e a medição derrubou as duas soluções que a gente tinha imaginado.

**Primeiro, por que demorava.** O critério de tempo mede o intervalo entre *criaturas*. Só que o servidor nasce bicho em **lote**: Troll Hills fez 80 nascimentos em 8 lotes de ~8; Tortoise Shore, 66 em 7 lotes de ~10. Dentro de um lote o intervalo é de milissegundos. Rodando a função real contra suas capturas, o resultado é que ela **nunca calibra**: numa caçada de 3,5 minutos com 80 nascimentos ela junta `0/8` amostras — que é exatamente o que seu print mostrava. E quando junta, a mediana dá 4s, o limiar cai abaixo do piso, e o piso de 90s vence de novo. Na prática o detector **sempre esperou 90 segundos**, em qualquer caçada.

**Segundo, o que não funcionaria.** Mapear o tamanho dos mapas parecia a saída — e o tipo 88 entrega o terreno com `blocked` por tile, então dá pra medir: Troll Hills tem 1.281 tiles andáveis, Tortoise Shore tem 4.159. Mas é a caçada **pequena** que tem o p90 **maior** (9–10 tiles entre mortes contra 2–4). A densidade de bicho manda mais que o tamanho do mapa, e um limiar em "% do mapa" erraria feio — além de o tipo 88 custar ~3 MB por mensagem.

**O que funciona é aprender, caçada por caçada.** Agora existem dois critérios novos, cada um com o número **dessa** caçada, aprendido no seu jogo e guardado em disco:

- **"o mundo parou de produzir"** — silêncio entre lotes maior que 3× o normal dali. Troll Hills aprende 11s e sai com 33s; Tortoise Shore aprende 22s e sai com 66s. No seu teste, o buraco real foi de **75s numa caçada cujo normal é 7s**.
- **"já varri o lugar"** — andou mais de 8× o normal de tiles distintos sem matar nada. Troll Hills aprende 9 e sai com 72 tiles; e 72 tiles são **18 segundos**, não 90.

Os dois valem em paralelo porque falham em situações diferentes: preso num canto, os tiles não acumulam e o critério de lote responde; varrendo o mapa atrás de bicho, os tiles respondem antes. Tudo continua atrás da trava que já existia — **nada vivo na tela**.

A chave é o `scenarioId` do tipo 54 (`troll-hunt`, `tortoise-hunt`), estável entre instâncias e que já era escutado. É o "mapear as caçadas" que você pediu, só que medido no seu jogo em vez de escrito à mão — e **o aprendizado sobrevive à renovação**, senão o detector recomeçaria do zero logo depois de cada vez que age.

O painel passou a mostrar os dois perfis e o que falta pra cada um calibrar. Aquele `0/8` não era ruído: era o defeito aparecendo, e por isso o texto novo continua mostrando o contador em vez de escondê-lo.

Replay das capturas reais pelas funções entregues: dispara no trecho seco **18s depois da última morte** (contra 90s), zero disparos nos trechos saudáveis, e as duas caçadas aprendem ritmos diferentes (11s e 22s) na mesma sessão. 18 checagens novas; 268 no conjunto todo.

## 0.11.32 — 2026-09-14

### A rede de segurança do cálculo de peso

O peso vem dentro de cada item, na própria mensagem — medido: dos 4.087 itens que passam pelo protocolo nas suas capturas, 4.085 trazem `weight`, e nos caminhos que alimentam a capacidade (74, 55, 60, 62) a cobertura é **806 de 806**. Então o catálogo não é necessário pro caso normal. Ele entrou pro caso anormal.

Agora o peso de um slot tem três fontes, nessa ordem: o que veio na mensagem, o **catálogo do tipo 26** (835 itens com peso, chega uma vez por login), e "não sei".

O "não sei" continua virando zero no somatório — inventar um peso seria pior. O que mudou é que ele deixou de ser silêncio: o item fica registrado pelo nome e aparece **no aviso de divergência e no painel**. Isso transforma um número que não bate em diagnóstico:

- *"diferença de 3.20 — passaram pela bag 1 item sem peso conhecido: experience scroll"* → achei o culpado;
- *"diferença de 1.00 — nenhum item passou sem peso, então a diferença vem de outro lugar"* → o próximo suspeito é o tipo 62 (container aberto), que ficou de fora justamente por eu não ter certeza do que ele é.

E se a conferência bater **mesmo com um item desconhecido na bag**, então zero era o peso certo e o caso se resolve sozinho.

Detalhe de custo: escuto só o tipo **26**, não o 66. Medido, o 66 é subconjunto estrito do 26 (775 itens contra 836, zero exclusivos) — ouvir os dois seria parsear 109 KB a mais por login sem ganhar um item.

11 checagens novas, incluindo o resgate de peso pelo catálogo contra o catálogo real da sua captura. 250 no conjunto todo.

## 0.11.31 — 2026-09-14

### As leituras que ainda estavam no DOM

Fui atrás das três que faltavam. Duas migraram, uma não — e explico a que não.

**Nome, vocação base e level do personagem** agora saem do protocolo. O tipo 103 diz o meu id no login, e o tipo 15 anuncia o jogador desse id com nome, level e vocação. Antes isso dependia do `.header-character-name` estar desenhado; agora o DOM continua na frente (é ele que mostra a vocação **promovida**), mas quando ele está calado o protocolo responde. Esse estado é **zerado em toda troca de personagem e em toda queda de socket** — um nome de personagem velho decide atribuição de Telegram, rodízio e liderança de party, e seria o tipo de erro que não aparece em log nenhum.

**Capacidade restante** é a migração de verdade, e ela vem com uma ressalva que faço questão de deixar por escrito: **o servidor não manda a capacidade restante.** O `capacity` do tipo 77 é o *máximo* — constante em 976 amostras de três capturas suas, com o personagem caçando e enchendo a bag o tempo todo. O que dá pra fazer é **reconstruir o peso carregado**: o tipo 74 entrega o inventário inteiro no login (bag, satchel, equipamento) com o peso de cada item, e o tipo 55 entrega o estado novo de cada slot que muda. Restante = máximo − soma.

Como isso é **derivado e não lido**, ele entra em modo de **conferência**: enquanto o HUD estiver legível, quem manda continua sendo o número do jogo, e o modelo só passa a valer sozinho depois de bater com ele **três vezes seguidas**. Se divergir, se marca como não-confiável e avisa **uma vez** no log, com os dois números. Não dava pra validar isso offline — nas capturas não existe o valor do HUD pra comparar —, então a validação acontece na sua máquina, à vista, e até ela passar nada muda de comportamento.

O buraco que isso fecha é real: antes de o HUD montar, a capacidade era `null`, e `null` ali significa "não sei" — o ciclo de venda simplesmente não acontecia até a interface aparecer.

**O que NÃO migrou, e por quê:**

- **Treino** — não existe em nenhuma das sete capturas (o personagem nunca estava treinando durante uma). Chutar um tipo aqui foi o que custou três versões na v0.11.10–13. Continua no DOM até uma captura com treino ligado.
- **Vocação que aparece no painel** — o protocolo manda a vocação **base** (`"druid"`), o jogo mostra a **promovida** ("ED"). Um Druid e um Elder Druid são a mesma palavra no protocolo e coisas diferentes na tela, e o sync de EK compara justamente com "Elder Druid". Trocar a fonte aqui ligaria a automação pra quem não deveria. A vocação base fica visível no painel, mas quem decide continua sendo o DOM.

Uma linha nova no painel de caçada mostra o que a leitura por WebSocket está enxergando — personagem, vocação e o estado da conferência da capacidade. É pelo mesmo motivo da linha do spawn: sem ver, "migrei pro WebSocket" é promessa.

37 checagens novas rodando as funções reais contra as suas capturas, incluindo o replay das 113 mudanças de inventário do Kina (272.26 → 202.36 de capacidade) conferido contra uma reconstrução manual item a item. 239 no conjunto todo.

## 0.11.30 — 2026-09-14

### Sair da caçada não podia significar abandonar a expedição

Você viu os dois sintomas em sequência: o personagem saiu da expedição por estar sem bicho na tela e **voltou pra caçada principal**; depois disso, **não considerou mais a expedição**.

A causa não foi um `if` errado, foi arquitetura. A decisão de expedição morava num lugar só: o trecho do monitor que trata "não está caçando". Todos os outros caminhos que reentram numa caçada — renovar por spawn seco, voltar depois de vender o loot — tinham cada um a sua própria regra, e as duas apontavam pra `cfg.huntName`, a caçada do menu. Qualquer saída no meio da expedição caía na caçada principal.

E de lá ele não voltava porque a troca no meio da caçada tem trava de 10 minutos e só dispara quando a caçada atual não serve pra **nenhum** objetivo pendente. Se a principal já matasse algo de algum objetivo, ficava lá pra sempre.

Agora existe **uma função só** que responde "qual caçada e qual tier agora", e os três caminhos perguntam pra ela. Enquanto houver objetivo pendente a resposta é a caçada da expedição no tier mais difícil disponível; quando todos terminarem, volta a ser a configurada — que é a regra que você deu: *"se está fazendo expedição tem que continuar nela, só desconsidera quando finalizar todas"*.

Dois detalhes que vieram junto:

- a renovação por spawn seco reentrava com o **tier do menu**, não com o mais difícil — o conserto da v0.11.29 não alcançava esse caminho;
- se a caçada em que você já está serve o objetivo, ela é a resposta mesmo que outra do catálogo mate mais criaturas da lista. Sem isso, cada renovação de spawn poderia trocar de mapa — carrossel, não expedição.

18 checagens novas reproduzindo o caso exato, inclusive com o cache do nome da caçada frio (que era o jeito mais rápido de cair na principal).

## 0.11.29 — 2026-09-14

### A expedição entrava no nível mais fácil

O tier vinha do catálogo como **nome** ("Reckless") e era casado com o texto do botão. Quando esse tier não está disponível pro personagem naquela caçada, o nome não casa, a seleção falha — e o jogo começa com o botão que já estava marcado, que é o primeiro: o mais fácil.

Sua reclamação já trazia a regra certa: **o nível maior _disponível_**. Então a expedição deixou de pedir um nome e passou a pedir o **último botão de tier que existe e está habilitado**.

Isso conserta três coisas de uma vez:

- **tier bloqueado por level** deixa de derrubar a escolha (botão desabilitado é ignorado — `disabled`, `aria-disabled` e classe `locked`);
- **independe de idioma** — se o jogo traduzir para "Cauteloso / Ousado / Imprudente", continua funcionando, enquanto casar por nome quebraria;
- **o log diz qual tier entrou**, não só que entrou. Foi a falta disso que deixou "começou no mais fácil" passar despercebido.

A escolha por nome continua valendo para a caçada normal, que é onde você configura o tier à mão.

12 checagens novas, incluindo a reprodução do caso real: catálogo anuncia três tiers, o personagem só tem dois liberados.


## 0.11.28 — 2026-09-14

### A expedição não depende mais do painel do jogo (na maioria dos casos)

Seu log mostrou o personagem saindo de Tortoise Shore pra cidade e **voltando pra Tortoise Shore** — a expedição não agia porque não sabia quais criaturas contam para "Trolls".

Achei uma terceira fonte, medida na sua expedição real: o `familyId` do tipo 33 casa com o `bestiaryId` dos monstros do catálogo (tipo 42).

```
trolls        → bestiaryId "troll"   → Troll,  em Troll Hills
amazon-camp   → bestiaryId "amazon"  → Amazon, em Amazon Camp
restless-dead → não casa (é uma categoria, agrupa várias criaturas)
```

Dois dos três objetivos de hoje resolvem sozinhos — inclusive o **Trolls**, que é o único pendente. Só aceita casamento exato com um `bestiaryId` que existe no catálogo: sem "parecido", sem "começa com". Errar aqui manda o personagem caçar a coisa errada por horas.

**Ordem das fontes:** painel do jogo (explícito e completo) → o que já foi guardado em disco → dedução pelo catálogo. E o painel diz de qual veio: quando é dedução, avisa que **a lista pode estar incompleta** — "Trolls" talvez conte Swamp Troll também, e só o painel do jogo sabe disso. A caçada escolhida continua válida, só pode não ser a melhor.

Objetivo que nenhuma das três fontes resolve continua sem ação **e dizendo isso** — não tira o personagem da caçada às cegas.

### A versão no log estava mentindo

Seu log veio marcado como "0.11.19" rodando outra coisa. Era uma constante chumbada no preload que eu esqueci de atualizar, e ela atrapalhou justamente o diagnóstico que eu tinha pedido. Agora quem carimba é o renderer, que sabe a versão real do app.


## 0.11.27 — 2026-09-14

### A expedição agora tira o personagem de uma caçada que não serve pra nada

Ligar a expedição no meio de uma caçada não tinha efeito nenhum: a decisão só rodava no trecho de "não está caçando", então ela esperava o personagem sair por conta própria — bag cheia, stamina ou spawn seco. Na conta medida isso deu 2 ciclos em 1h04. Meia hora sem reagir, com o painel prometendo que "a expedição passa a mandar na escolha da caçada".

Agora ela avalia durante a caçada também, com a regra que você escolheu: **sai só se a caçada atual não mata nenhuma criatura de nenhum objetivo pendente.** Se serve, fica — trocar à toa perde o loot na bag e o tempo de transição. Trava de 10 minutos entre trocas pra não virar carrossel quando dois objetivos empatam, e sem o mapa de criaturas ela não tira o personagem de lugar nenhum.

### "Abra o painel de expedição" pode ser instrução errada minha

Pelas notas do projeto, `.expedition-tracker` é um elemento do **HUD** — some só pra quem não tem guild —, não um modal que se abre. Foi mapeado ao vivo com o personagem caçando. Ou seja, ele já devia ter sido lido sozinho, e eu te mandei fazer uma coisa que talvez nem resolva.

Em vez de insistir no chute, a aba Guild passa a mostrar **o que existe de verdade**: se o elemento está na tela e quais rótulos ele traz, com a contagem de criaturas de cada um. Isso separa "não achei o elemento" de "achei, mas o rótulo não bate com o objetivo" — que são problemas diferentes e têm correções diferentes.


## 0.11.26 — 2026-09-14

### A auto expedição estava ligada e parada, sem dizer nada

Fui verificar a feature e achei o furo. Ela precisa de três coisas, e só duas estavam garantidas:

| o quê | de onde | estado |
|---|---|---|
| progresso e quota de cada objetivo | tipo 33 | ✅ exato e ao vivo |
| qual caçada mata cada criatura | tipo 42 | ✅ catálogo completo |
| **quais criaturas contam para o objetivo** | painel de expedição do jogo | ❌ só com o painel **aberto** |

Com o painel fechado, a lista de criaturas vinha vazia, nenhuma caçada era escolhida, e **nada acontecia — sem log, sem status, sem pista**. A feature parecia ligada e não fazia nada.

**Por que isso não sai do protocolo:** o `familyId` do tipo 33 é `"restless-dead"`, que não é criatura nem id de caçada — é uma categoria que agrupa Skeleton, Ghoul, Mummy. Testei contra o catálogo real: `"Trolls"` e `"Amazons & Valkyries"` até dariam por semelhança de nome, `"Restless Dead"` não dá de jeito nenhum. O painel continua sendo a fonte.

**A correção:** o mapa é lido do painel e **guardado em disco**. Basta abrir o painel de expedição uma vez por conta; depois disso funciona sozinho, com o painel fechado, entre reinícios.

**E a falha deixou de ser silenciosa.** Enquanto o mapa não existir, o log diz exatamente o que fazer, e a aba Guild lista quais objetivos ainda faltam mapear. "Ligado e parado" não pode mais ser confundido com "ligado e funcionando" — foi esse padrão que escondeu o detector de spawn por três versões e o analisador por uma.

### Preço de leilão: removido de vez

Você deu duas saídas — deixar o jogador escolher item a item, ou tirar. Tirei, e não por trabalho: mesmo com você escolhendo os itens, o número continuaria sendo **o que alguém pede**, não o que você recebe. O seletor entregaria um valor igualmente não-realizável, só que com a sua assinatura embaixo.

Fica a lista **"vale olhar antes de vender"**, item a item, que já existe e responde à pergunta original — o que não mandar na venda rápida.


## 0.11.25 — 2026-09-14

### O total de leilão estava mentindo, e saiu

No seu print de 1h04, o painel dizia: *"leiloando em vez de vender rápido, esta sessão renderia **6,4kk** a mais"*. Esse número não corresponde a dinheiro nenhum que você conseguiria.

A tabela `auction` do tipo 57 é o **preço pedido por jogadores**, não valor de mercado. A tabela real do jogo tem:

```
banana skin    npc 1     leilão 6.000.000
tortoise egg   npc 10    leilão   300.000
grapes         npc 3     leilão   100.000
cucumber       npc 2     leilão   100.000
```

São **32 itens** com preço pedido mais de mil vezes o valor de NPC. Você estava em **Tortoise Shore**: 21 ovos de tartaruga a 300k já dão 6,3kk — é exatamente o seu número.

**O erro foi meu, e de método.** Eu validei essa conta com o protection amulet (100 no NPC → 1.600 no leilão), que parecia razoável, e não testei contra o caso absurdo. Quando a fonte é preço pedido por gente, a validação tem que incluir o outlier — não só a amostra que confirma a hipótese.

**O que saiu:** o total "Loot (preço de leilão)", o "Saldo leiloando" e a promessa de ganho. Saíram também do caminho legado do painel, que hoje nem roda — código morto que mente continua sendo passivo.

**O que ficou**, porque continua acionável: a lista **"Vale olhar antes de vender"**, item a item, com o preço unitário pedido e um aviso de que é oferta, não recebimento. Serve pra você notar o que não mandar na venda rápida — que era o pedido original —, sem fingir que dá pra somar.

O preço de leilão nunca mais é multiplicado por quantidade em lugar nenhum, nem como critério de ordenação. Tem teste travando isso, construído em cima da tabela real que revelou o problema.


## 0.11.24 — 2026-09-14

### Diagnóstico do analisador zerado

Você reportou o analisador todo em zero. Antes de mexer em qualquer coisa, passei a sua captura inteira pelo motor de verdade: ele produz **112 mortes, 8.708 XP, custo 616, lucro 1.450, 189k XP/h**. Ou seja, a leitura está certa — o defeito não está em ler o protocolo.

Sobram duas explicações, e elas dão **exatamente a mesma tela**: ou a sessão acabou de começar (app reiniciado), ou ela está sendo zerada repetidamente. Olhando só o código eu não consigo separar as duas, e chutar aqui é como eu perdi três versões no detector de spawn.

Então o painel passou a responder isso sozinho. Dentro de "Detalhe do loot e do gasto":

- **Sessão começou há** — se esse número não passar de alguns segundos enquanto você caça, é reinício em loop, e é isso que zera tudo.
- **Mensagens do protocolo** — se estiver em zero, o gancho não está recebendo.
- **Ficha do personagem lida** — se for "não", o tipo 77 não está chegando e o XP não teria de onde sair.

Abra esse bloco com o personagem caçando e me diga os três números. Com eles eu sei onde mexer em vez de adivinhar.


## 0.11.23 — 2026-09-14

### O catálogo de caçadas não precisa mais abrir menu nenhum

O tipo 42 traz o catálogo inteiro no login: **60 caçadas**, cada uma com id, nome, monstros e os tiers `Cautious/Bold/Reckless` já com o `monsterCount` — que é o **tamanho do pull**, o número que te deu dor de cabeça na v0.9.5.

O caminho antigo abria o seletor de caçadas, limpava o campo de busca, esperava, lia os botões e fechava a janela — cliques reais só pra montar uma lista. E era frágil de um jeito específico: quando os botões de tier não apareciam nos 4 segundos de espera, o resultado vazio ia pro cache e travava aquela caçada com o dropdown vazio pra sempre. Esse modo de falha deixa de existir.

### Experiência e "estou na cidade" pelo protocolo

**XP** sai do `experience` do tipo 77, que chega ~2× por segundo, em vez do atributo `title` do `.hud-exp` ("Experiência 1.827.258/6.716.200") — que só existe depois do HUD montar e quebraria se o jogo mudasse a formatação do número.

**"Estou na cidade"** sai do tipo 54. O teste antigo confundia duas coisas: ele olhava se o botão "Venda rápida" está na tela — ou seja, "estou num lugar onde dá pra vender" — e usava isso como "estou na cidade". Antes do HUD montar, a resposta era `false` com o personagem parado na cidade.

### O peixe de 5.221 não era bug meu

Ficou marcado como suspeito na v0.11.21: `fish ×2` valendo 10,4k no leilão contra 2 gp no NPC. Com a tabela de preços completa — que só veio agora, porque o log de dentro do Swag passou a salvar a primeira amostra de cada tipo inteira — dá pra confirmar: `fish`, itemId 3578, NPC **2**, leilão **5.221**. O preço é real; é mercado de jogador.

De quebra, a tabela tem **784 itens com preço de NPC e 524 com preço de leilão**, e confirma por que o gold coin precisou de tratamento próprio: ele não está em nenhuma das duas.

### Onde a migração para o WebSocket para

Isto fecha tudo que está mapeado. O que **continua no DOM, e por quê**:

- **capacidade restante** — o tipo 77 tem `capacity`, mas é o **máximo** (constante em 588721 durante uma caçada inteira com loot entrando). Trocar faria o bot achar que nunca enche.
- **nome e vocação do personagem** — o protocolo dá a vocação em inglês (`druid`) e a interface mostra a abreviação promovida (`ED`); traduzir depende da promoção.
- **está treinando** — nenhum tipo mapeado; o treino só aparece como toast.
- **tela de seleção de personagem** — ali o socket do jogo ainda nem existe.
- **todas as ações** — clicar, vender, entrar em caçada, treinar. Foi o combinado desde o começo.


## 0.11.22 — 2026-09-14

### O painel dizia "Iniciando" com o personagem caçando

Você achou que era falha de leitura por WebSocket. Não era — o `isHunting()` estava certo o tempo todo; quem mentia era a etiqueta.

O `startBot()` escrevia "Iniciando", e se o personagem **já estava** na caçada o tick chegava no fim e voltava sem nunca escrever outro rótulo. O texto só mudava quando alguma coisa **acontecia**, e caçada correndo bem não é um acontecimento — então ficava congelado no primeiro rótulo pra sempre.

Agora o rótulo é escrito no estado estável, com o nome da caçada junto (`Caçando "Hero Fortress"`), que sai de graça do tipo 54 cruzado com o catálogo. E o `updatePanelStatus` passou a ignorar repetição, senão escrever a cada tick viraria tráfego de estado a cada 4 segundos por conta.

### Party e caçada em grupo pelo protocolo

| antes (DOM) | agora |
|---|---|
| lista de membros (exigia a janela de party **aberta**) | tipo 72 |
| "sou o líder?" (checkbox marcado à mão) | tipo 72 `leaderId` / tipo 51 `leader` |
| roster do grupo (só com o diálogo de convite **aberto**) | tipo 51, contínuo |
| convite de caçada em grupo | tipo 51 `canAnswer && !youAccepted` |

As duas condições em negrito eram falhas silenciosas: com a janela fechada, a lista de membros vinha vazia — e "vazia" é indistinguível de "não tem party" pra quem chama. O sync do EK dependia de pegar os poucos segundos em que o diálogo estava na tela.

**O checkbox de líder continua existindo** e continua valendo quando o protocolo está calado (fora de party, jogo recém-aberto). O painel passa a mandar os dois: o que você marcou e o que o servidor respondeu.

**Uma diferença de significado que não varri pra baixo do tapete:** o DOM traz o *papel atribuído* na caçada (`role-tank`), o protocolo traz a *vocação* (`knight`). Na prática o tank é o knight, mas não é a mesma afirmação — então o papel do DOM tem precedência quando existe, e a vocação só responde quando o DOM não tem o que dizer. Tem teste pros dois casos, inclusive o de um tank que não é knight.

**O que eu NÃO migrei:** o "time pronto?" do líder. O tipo 51 tem `arrived`, mas isso é "todo mundo já entrou na caçada" — a pergunta ali é "todo mundo está pronto pra *receber* o convite", que é o momento anterior. Trocar uma pela outra seria um bug sutil.

### Desgaste de anel e amuleto entra no custo

Pendência aberta desde que você perguntou se dava pra contabilizar. Dá: o tipo 92 avisa na hora (`params.item = "life ring"`), e o preço vem do que estava equipado naquele slot, capturado do tipo 55.

⚠️ **O jogo não conta isso no "Gasto" dele** — a lista `supplies` do tipo 41 traz só runas e potions. Então esta é uma linha nossa, somada ao custo nos dois caminhos pra que free e premium continuem comparáveis entre si, e separada no detalhe pra ficar claro onde o número do Swag diverge do analisador do jogo, de propósito.

Item sem preço conhecido conta a peça e **não** inventa valor.


## 0.11.21 — 2026-09-14

### Analisador simples, e igual para conta free e premium

Seis números e mais nada: **tempo, mortes, XP, XP/h, custo, lucro e lucro/h**. O lucro conta durante a caçada, conforme o loot entra — não espera a venda.

Loot a preço de NPC, loot a preço de leilão e a lista item a item saíram da vista. Não foram apagados: foram pro bloco "Detalhe do loot e do gasto", fechado. A comparação com o leilão continua útil pra decidir o que **não** mandar na venda rápida, e a lista item a item é o que permite conferir um número estranho — foi assim que apareceu o "fish valendo 5.200 no leilão", que segue sem explicação.

**A conta free agora tem exatamente o mesmo painel**, sem receber o tipo 41. Cada número foi validado contra o analisador do próprio jogo, na mesma janela de tempo da captura premium:

| número | de onde | Swag | jogo |
|---|---|---|---|
| mortes | bestiary (tipo 9) | 37 | 37 |
| XP | `experience` (tipo 77) | 67.377 | 67.377 |

Contar mortes pelo tipo 18 pareceria mais óbvio e daria **42** em vez de 37 — ele também dispara quando a criatura sai da tela. Isso foi medido, não suposto, e tem teste travando a escolha.

Detalhe que o XP exigiu: o `experience` é **dentro do level**, não total da conta (Kina, level 143: 371.809 de 1.001.200). Ele zera ao subir de level, então a diferença crua ficaria negativa — mesmo tratamento que a leitura de DOM já fazia.

### A venda rápida agora é confirmada pelo servidor

Você disse que "vender loot não tem funcionado muito bem", e o motivo estava na verificação: a única evidência de sucesso era um modal sumir da tela. Se ele demorasse, o código seguia sem saber se vendeu — e o aviso "a confirmação não apareceu" saía mesmo quando a venda tinha dado certo.

O tipo 92 traz o resultado direto do servidor: `{template:"Quick sold {count} items for {amount} gold.", params:{count:13, amount:980}}`. Conferido contra o gold da mesma captura: **+980 exatos no mesmo instante**. E como o número vem em `params`, não depende do texto — se o jogo traduzir a mensagem, continua funcionando.

### O detector de spawn: a correção da v0.11.20 funciona

Replay da sua captura de teste com o código novo: o detector dispara em t=182s **pelo critério da volta** ("deu uma volta inteira sem matar nada"), antes do piso de 90 segundos. É a primeira vez que o critério inteligente decide em vez do relógio.

Uma observação dessa mesma captura: naquela caçada, o ritmo típico nunca chegou a ser aprendido — os nascimentos vêm em lotes tão apertados que nenhum intervalo passou de 1 segundo. Ou seja, para essa caçada o piso continua sendo o único critério de tempo, e é o critério da volta que carrega a feature.


## 0.11.20 — 2026-09-14

### O detector de spawn seco tinha dois defeitos sérios, e os dois eram invisíveis

Em vez de mexer no detector no escuro, montei um **replay**: as mensagens reais das capturas, na ordem e no tempo em que chegaram, passando pelo código que está rodando. O que apareceu:

**1. O critério da "volta completa" nunca funcionou.** O rastro de posição ficou zerado do começo ao fim. O motivo: o id do próprio personagem vinha só do tipo 103, que chega **uma vez, no login**. Se o gancho instala depois disso — app aberto com o jogo já rodando, que é o caso comum — o id nunca chega e o critério fica morto, em silêncio. Mesma classe de falha da v0.11.10, achada do mesmo jeito: medindo em vez de supor.

Corrigido: o tipo 15 também anuncia jogadores (`kind:"player"`) a cada mudança de área, inclusive o próprio personagem. Casando pelo nome, o id se reencontra sozinho toda vez que entra numa caçada.

**2. O "ritmo típico" era sempre zero.** O servidor nasce criatura em lote: nas quatro capturas, entre metade e três quartos dos intervalos foram de menos de um segundo, vários de zero. A mediana dava 0ms, o ritmo aprendido virava zero, e o limiar desabava no piso configurado — ou seja, **a calibração automática que a feature promete simplesmente não existia**.

Corrigido: só entram no aprendizado intervalos de 1s pra cima. Nas mesmas capturas, o ritmo real passa a ser 2,0s / 3,0s / 4,1s / 11,7s.

**Consequência prática, e você tinha sentido isso:** com o ritmo sempre zero, quem decidia tudo era o piso de 90 segundos. Agora que o ritmo é real (~4s numa caçada sua), vale reconsiderar esse número — 90s é 22× o ritmo normal. Deixei a configuração como está, porque é sua; mas agora o painel mostra o ritmo aprendido, então dá pra escolher com informação em vez de chute.

### O detector passou a mostrar o que está vendo

Abaixo do botão de ligar, na aba Caçada: `Spawn: 3 criaturas vivas · sem nascer há 12s · ritmo normal ~4s · 72 mortes na última volta`. Se o id do personagem não tiver sido descoberto, aparece "posição do personagem indisponível" — o critério da volta desligado deixa de ser silencioso.

Era a falta dessa linha que deixou os dois defeitos acima passarem despercebidos.

### A chave do log agora é salva

Você pediu, e meu argumento contra era fraco. Se o app reinicia no meio de uma investigação, a gravação parava em silêncio. Agora a chave sobrevive ao reinício e a gravação volta sozinha. **O buffer não sobrevive** — ele vive na memória da aba; persistir a chave limita a perda ao tempo parado, não a elimina.

### A aba "Telegram" tinha sumido

Quatro abas com ícone não cabem numa linha, a barra é flex sem quebra e o painel tem `overflow-x: hidden` — então a quarta aba não ficava cortada, ficava invisível. É o mesmo problema que a barra da automação já tinha resolvido na v0.11.8 e que eu não apliquei aqui: quebra em duas linhas, borda de baixo vira box-shadow.


## 0.11.19 — 2026-09-14

### Log do protocolo dentro do Swag

Até agora, investigar o jogo exigia abrir o Chrome com o userscript e uma conta sobrando, porque o Huntera só aceita uma sessão por conta. Não fazia sentido: o gancho já está instalado em toda aba do Swag — faltava só deixar passar tudo em vez de só os tipos que a automação usa.

Em **Configurações → Caçada**, no fim: um interruptor "Gravar o que o servidor manda" e um botão "Baixar o log". Grava a **conta selecionada no painel**, e o arquivo sai no mesmo formato JSON do userscript de propósito — as ferramentas de análise que já existem continuam valendo sem adaptação. O nome do arquivo carrega o personagem e o carimbo de tempo, porque esses logs sempre acabam sendo comparados entre si.

**Desligado por padrão, e não é cerimônia:** são ~20 mensagens por segundo por conta. O interruptor também não é salvo em disco — gravar não é estado que deva sobreviver a um reinício por esquecimento. Liga, investiga, baixa, desliga.

Uma coisa que veio de graça do jeito que foi feito: a primeira amostra de cada tipo vai inteira. Os catálogos do login são enormes (o tipo 42 tem 340 KB) e chegam nos primeiros segundos — cortar a amostra e ainda deixar o buffer circular descartar o original foi exatamente o que estragou a primeira captura e escondeu a tabela de preços de leilão.

### Confirmado: conta free não recebe o tipo 41

Não é mais hipótese. Rodando a v0.11.18 numa conta free, com um ciclo completo de caçada e venda, o painel seguiu na reconstrução por gold. Como o `economiaZerar()` só roda ao iniciar sessão nova do bot — nunca ao sair da caçada — se o tipo 41 tivesse chegado uma vez o painel teria trocado de fonte. Não trocou. **A trava do analisador premium é no servidor, não só na interface.**

Consequência: o cálculo por diferença de gold deixa de ser plano B provisório. É o analisador oficial da conta free e o único lugar onde essas contas veem custo e saldo — está marcado assim no código, pra ninguém tratar como código de segunda.


## 0.11.18 — 2026-09-14

### Stamina pelo protocolo

`getStaminaRemainingMinutes()` passa a ler o `staminaMs` do tipo 77. Isso corrige o furo mais perigoso dessa leitura: o relógio de stamina é DOM, e antes de o HUD montar ele devolvia `null` — que o `hasEnoughStaminaToHunt()` interpreta como "tem stamina de sobra". Uma falha de leitura virava um "sim".

Os minutos calculados batem exatamente com o `staminaMinutes` que o tipo 72 informa do mesmo personagem — duas mensagens independentes do servidor concordando, o que é a melhor confirmação disponível sem testar no jogo.

O level também sai do tipo 77. **A vocação não**: o protocolo manda `"druid"` e a interface mostra a abreviação promovida (`ED`). Traduzir uma na outra depende da promoção do personagem, e errar aí deixa o rótulo da conta errado na barra lateral — continua saindo do DOM.

Toda leitura tem validade de 60s: o tipo 77 só chega com o jogo rodando, então se o socket cair o último valor envelhece e a leitura volta pro DOM, em vez de afirmar uma stamina congelada.

### A capacidade NÃO migrou, e é de propósito

O tipo 77 tem um campo `capacity`, e era tentador usar. Ele ficou **constante em 588721 nas 181 amostras** de uma caçada com loot entrando o tempo todo — ou seja, é a capacidade **máxima**, não a restante.

Trocar o `getCapacityRemaining()` por ele faria o bot achar que nunca enche, nunca sair pra vender e caçar até travar. O teste registra isso: verifica que o valor é constante no log e que a função continua lendo o DOM.

### Correção de uma afirmação minha

Eu tinha escrito no código que o tipo 77 tinha duas variantes, uma completa e uma curta. Não tem: nas três capturas, as 483 mensagens vieram todas com as mesmas 39 chaves. A conclusão errada veio de comparar uma contagem do buffer circular com o total da sessão — denominadores diferentes. O comentário foi corrigido e o teste agora segura a hipótese: se um dia aparecer uma mensagem parcial, ele acusa.

### Dois defeitos que o print do André revelou

**Gold coin valia zero.** No painel apareceu `gold coin ×250` com valor "—", somando nada. Gold não está na tabela de venda do NPC (não se vende moeda pro NPC), então ele caía fora da conta inteira no caminho de reconstrução por gold. Corrigido: moeda vale o próprio número — e isso não é chute, o tipo 41 da captura traz `{itemId:3031, count:38361, value:38361}`, valor idêntico à quantidade.

**Item sem preço sumia em silêncio.** Era o pior dos mundos: o total ficava menor e nada avisava. Agora o painel diz quantos itens ficaram de fora da soma.

**E o painel passou a dizer de onde vem o número.** Quando o analisador do jogo não chega, aparece "Calculado por diferença de gold". A pergunta "será que não vem o tipo 41 na conta free?" deixa de depender de eu olhar o código.

### Testes

12 checagens novas. Total de 95 no projeto, todas rodando em cima dos arquivos entregues e das suas capturas reais.


## 0.11.17 — 2026-09-14

### Caçada em grupo: o servidor manda a máquina de estados inteira

O take dirigido (convite de party → convite de grupo → aceite → entrada) revelou o **tipo 51**:

```
{leaderName:"Amoxicilina", huntId:"hero-hunt", tier:2,
 members:[{name, level, vocation, accepted, arrived, leader}],
 canAnswer:true, youAccepted:false}
```

Chega a cada mudança de estado, e resolve quatro coisas que hoje são remendo:

- **`canAnswer && !youAccepted` é literalmente "tem convite esperando você"** — não precisa mais varrer o DOM a cada 1,2s procurando o diálogo.
- **`arrived` por membro é o "time pronto?"** sem cada conta precisar reportar o próprio estado pro painel.
- **`leader` e `leaderName` substituem o `isPartyLeader`**, que hoje você marca na mão, conta por conta.
- **`vocation` por membro identifica o EK** sem depender do roster do DOM na hora do convite.

Nesta versão o que mudou de comportamento foi só o mais seguro: quando o servidor diz que **não** há convite pendente, o bot para de procurar o diálogo. Aceitar continua sendo clique no DOM, e quando o protocolo ainda não falou nesta sessão o comportamento antigo vale integralmente. O resto (líder, time pronto, EK) já vai pro painel como dado — trocar as decisões que hoje dependem deles é o passo seguinte, e prefiro fazer isso separado pra não mexer em quatro fluxos de uma vez.

Mapeado junto o **tipo 47** (`{hunt:{huntId,tier}, arenaId}`), a seleção atual de caçada em grupo.

### Confirmado: o analisador zera por caçada

No instante em que o grupo entrou, o tipo 41 veio `{durationMs:0, kills:0, lootValue:0, waste:0, supplies:[], loot:[]}`. Ou seja, é acumulador **por sessão de caçada**, não total da conta — que é exatamente o que o analisador precisa, sem ter que zerar nada por conta própria.

### Testes

13 checagens novas percorrendo as quatro mensagens reais do seu take, na ordem: convite pendente → aceitei → um chegou → todos chegaram. O teste passa pelo `spawnLerMensagem` de verdade, incluindo o filtro de tipos, e não por um atalho.


## 0.11.16 — 2026-09-14

### O jogo passou a dizer onde o personagem está

A captura que atravessa a saída da caçada revelou o **tipo 54**, que chega a cada mudança de lugar:

```
caçada → {instanceId:"hero-hunt-675", scenarioId:"hero-hunt", ambience:"cavern"}
cidade → {instanceId:"city-global",   scenarioId:"main-city", ambience:"surface"}
```

Três coisas saem daí de uma vez.

**`isHunting()` deixa de depender do HUD.** Ele procurava o botão "Sair da caçada", que só existe depois que a interface do jogo desenha — e até lá "não achei" era lido como "não está caçando". Foi esse furo que fez o bot abrir o seletor de caçadas por cima de uma caçada em andamento (o bug que você reportou em 10/09 e que a v0.9.31 remendou com o `isGameUiReady()`). O servidor responde antes de existir HUD. O portão do `isGameUiReady()` continua onde está, protegendo as outras leituras de DOM.

**O nome da caçada fica de graça.** O `scenarioId` casa com o `id` do catálogo do tipo 42. Antes, ler o nome abria um modal, lia o título e fechava — três cliques reais só pra ler um texto, e logo antes de "Sair da caçada" (foi dali que veio o bug da v0.9.15, do modal ficando por cima do botão). Agora é consulta em memória.

**O detector de spawn zera no fato, não na dedução.** O `instanceId` traz o número da instância, então sair e reentrar aparece como troca de instância. Antes eu zerava o detector por inferência ("saí da caçada, então deve ter renovado"); agora zera quando o servidor confirma que a instância é outra.

**Onde eu não deixei o protocolo mandar.** Se o cenário não estiver no catálogo de caçadas — um evento, uma quest, uma área que eu nunca vi — a resposta é "não sei" e o DOM decide, como antes. Afirmar "está caçando" só porque não parece cidade seria o mesmo tipo de chute que me custou três versões no detector.

### Convite de party pelo socket

Mapeado o **tipo 71** — `{fromId, fromName, members:[{name, level, vocation}]}`, com o roster de quem convidou. Por enquanto só a detecção está ligada; aceitar continua sendo clique no DOM, como combinado ("as ações podem ser via DOM"). Ainda não sabemos se o convite de **caçada em grupo** é esse mesmo tipo ou outro — as duas ocorrências capturadas eram party.

### Testes

12 checagens novas, rodando com as mensagens reais da sua captura — incluindo os casos que importam mais: cenário desconhecido devolve "não sei" em vez de chutar, reentrar na mesma instância não zera nada, e payload malformado não derruba a automação. Total de 60 checagens no projeto.


## 0.11.15 — 2026-09-14

### O analisador agora é o analisador do jogo

A captura de 292s revelou o **tipo 41**: o servidor manda o analisador da sessão pronto, ao vivo, para o cliente — `kills`, `experience`, `rawExperience`, `lootValue`, `waste` (o "Gasto") e as listas itemizadas de **loot** e **suprimentos usados**, cada uma com nome e valor. Os números sobem sozinhos durante a caçada (na captura, kills foi de 1947 a 1984).

Isso aposenta o cálculo de custo por delta de gold da v0.11.11. Aquilo era uma reconstrução: eu somava débitos de gold e tentava adivinhar qual suprimento tinha sido usado cruzando o valor com a tabela de NPC — e quando dois suprimentos custavam o mesmo, ficava sem saber. Agora o nome vem do próprio servidor.

Ganhos diretos no painel: tempo de sessão, mortes, experiência e as taxas por hora (xp/h e gp/h), que antes não existiam.

**O cálculo antigo continua no código**, e não é preguiça: ainda não está confirmado que uma conta FREE recebe o tipo 41. A trava do analisador premium provavelmente é só de interface, mas enquanto isso for hipótese, apagar o caminho antigo seria apagar o analisador inteiro de quem joga de graça. O painel diz qual das duas fontes está valendo.

### Preço de leilão, que o jogo não faz

O `value` do tipo 41 é preço de NPC — confirmado item a item em 14/09 (protection amulet: 100 no NPC contra 1.600 no leilão). Com a tabela do tipo 57, o Swag revaloriza o mesmo loot a preço de leilão e mostra os dois lados. É o número que diz o que **não** vale a pena mandar na venda rápida.

Regra importante: item sem preço de leilão vale o NPC, nunca zero — tratar como zero faria o total de leilão parecer pior que o de NPC sem motivo nenhum. Tem teste pra isso.

### Testes

15 checagens rodando em cima da **mensagem real** capturada pelo André, não de um payload inventado — o teste lê o log e alimenta as funções recortadas do arquivo entregue.

Foi esse teste que descobriu uma falha na ferramenta de captura: os catálogos que o jogo manda no login são enormes (tipo 42 = 340 KB, 26 = 211 KB, 66 = 111 KB, 57 = 21 KB) e o script cortava a amostra em 4.000 caracteres, além de descartar os originais no buffer circular. A tabela de preços de leilão chegava pela metade. Corrigido no `huntera-proto.user.js` **v1.2.0**: a primeira amostra de cada tipo vai inteira.


## 0.11.14 — 2026-09-14

### Script novo: "Huntera — Leitor de Protocolo"

`huntera-automacao/probes/huntera-proto.user.js`. Userscript único que substitui os probes antigos. Ele lê o protocolo em texto claro, cataloga os tipos de mensagem e **marca em vermelho todo tipo que a gente ainda não conhece**.

O recurso que importa é a **busca por valor**: você digita um número que está vendo na tela — a stamina, o level, a capacidade — e ele diz qual mensagem carrega aquilo e em que caminho dentro do JSON (ex.: `[77] stamina.remainingMinutes`). Aceita o número formatado da tela (`12.032.555`) e texto também. É com isso que a gente fecha o que ainda falta mapear, sem ficar lendo 4 mil pacotes na mão.

Painel flutuante arrastável, botão de download do log, e `window.hproto` no console pra quem preferir sem interface. Só observa: nunca envia, bloqueia ou altera mensagem, e o `TextDecoder` sempre devolve o valor nativo.

### Leitura via WebSocket: o que entrou agora

Entraram os tipos **21 (movimento)** e **103 (id do personagem)**. Juntos eles dão a **posição do personagem**, e com ela o detector de spawn seco ganhou o critério que você pediu desde o começo:

> "cada caçada é uma rotação diferente e tem personagem level mais baixo que demora mais para dar a volta"

Agora o bot conta **voltas**, não segundos. Quando o personagem fecha uma volta inteira na rotação e não matou **nada**, o spot está seco — vale igual pro personagem forte e pro fraco, sem calibrar tempo nenhum. O critério por tempo continua existindo pro caso do personagem que fica parado.

**O que ainda NÃO migrou, e por quê.** Stamina, capacidade, nome/level/vocação do personagem e nome da caçada continuam saindo do DOM: eu não tenho o tipo de mensagem que carrega cada um desses, e migrar no chute é como eu quebrei o detector nas três últimas versões. É exatamente pra isso que serve a busca por valor do script novo — rode em caçada por uns minutos, procure a sua stamina, e eu fecho o resto.

### Server save: parar de bater na porta

Dois problemas diferentes, duas correções.

**1. O bot ficava clicando "Jogar".** O poll da tela de personagens é de 1,5s e a confirmação espera 15s — ou seja, durante um server save isso virava um "Jogar" de verdade a cada ~16 segundos, por horas, cada um com aviso no Telegram. Agora tem espera crescente (30s → 1min → 3min → 5min → 10min), sem teto de tentativas, e o aviso sai **só na primeira falha**. Da segunda em diante o silêncio é a informação.

**2. "O servidor está online?" agora é perguntado ao servidor.** Você tinha razão — o próprio socket do jogo sabe disso: `close` quando cai, `open` quando volta. Antes eu inferia do DOM, que mente durante o save (a tela continua desenhada com o servidor fora), e compensava com uma escada de espera. Agora, enquanto a conexão está caída o bot simplesmente **não tenta**, e quando volta a primeira tentativa sai **na hora** — não daqui a 15 minutos, como acontecia quando a escada já tinha subido.

O sinal tem três valores, não dois: sim, não, e **"não sei"**. No "não sei" (gancho não instalado, tela de personagem, jogo recém-aberto) o comportamento antigo continua valendo — o sinal novo só aperta o portão quando é confiável, nunca trava esperando algo que não vai chegar.

### Testes

40 checagens headless, todas em cima do arquivo entregue (o teste recorta as funções do fonte real, não de uma cópia): gancho sob CSP, catálogo e busca do script, detecção de volta, spawn seco por volta e por tempo, e os cinco estados do `servidorDePe()`.

Um furo achado no meio do caminho e corrigido: andando pela **cidade** não nasce criatura, então a limpeza do detector não rodava, e o vaivém na cidade fechava uma "volta sem matar nada" que teria acusado spawn seco no primeiro segundo da caçada seguinte.


## 0.11.13 — 2026-09-14

### Correção: "sair da caçada sem spawn" nunca disparava

O André reportou que o detector de spawn seco não funcionava. Não era configuração dele — era erro de arquitetura meu.

**O que estava errado.** O preload de um `<webview>` do Electron roda em **mundo isolado**. O DOM é compartilhado (por isso todo o resto da automação, que é clique e `querySelector`, sempre funcionou), mas os objetos de JavaScript **não são**: o `window.WebSocket` e o `TextDecoder.prototype` de lá são cópias nossas. A v0.11.10 enganchou nessas cópias e ficou esperando mensagens que nunca iam chegar. Em silêncio, sem erro nenhum — e como o painel dizia "escuta ativa" só porque o gancho tinha sido instalado, nada denunciava a falha.

**Por que a primeira tentativa de correção também teria falhado.** A saída óbvia era injetar um `<script>` inline na página. Um teste headless servindo a página com `Content-Security-Policy: script-src 'self'` mostrou que o navegador bloqueia esse script — ou seja, daria exatamente o mesmo silêncio. (O `main.js` já documentava a mesma pegadinha para o `fetch()` do preload; eu não liguei os pontos na hora.)

**Como ficou.** O gancho é executado no mundo principal da página via `webview.executeJavaScript()`, que não passa pela CSP. O código do gancho continua morando só no `content-injected.js`: o preload manda a string pro renderer pelo canal `hm:proto-hook` e o renderer só executa — assim não existem duas cópias do mesmo gancho pra manter em dia. O resultado volta pelo `document` em `CustomEvent`, que é o terreno comum entre os dois mundos.

**Contexto isolado continua ligado.** Desligá-lo resolveria o problema numa linha e abriria o preload — que tem `ipcRenderer`, acesso a arquivo e à licença — pra página do jogo. Não é uma troca que vale.

### Diagnóstico honesto

Agora são três estados distintos, e não um só:

- `spawnWatch.ativo` — pedi o gancho;
- `spawnGanchoNaPagina` — o gancho **rodou** na página (marca `data-hm-proto` no `<html>`, visível dos dois mundos);
- `spawnMensagens > 0` — está **chegando** mensagem.

Foi exatamente confundir o primeiro com o terceiro que escondeu a falha por três versões. O preload reinsiste em pedir o gancho a cada 2s (até 10 tentativas) enquanto a marca não aparece — cobre o caso do webview ainda estar anexando no `document-start`.

> Depois de instalar: **feche e reabra o Swag**. O gancho entra no carregamento da página do jogo; recarregar a aba sozinha não basta se o app já estava aberto.


## 0.9.33 — 2026-09-12

### Nova aba: Treino

Mapeado AO VIVO em 12/09/2026 (Dezin Zemsta parado na cidade — cliquei "Iniciar treino" de verdade e cancelei depois).

**O caminho:** `#nav-start-hunt` → `button.hunt-tab` com texto `Treino` → `button.train-skill` → `button.train-start` com texto **`Iniciar treino`**.

Três coisas que só se descobre olhando a tela de verdade:

- **Existem QUATRO `button.train-start`** na aba, nesta ordem: "Comprar na store", "Loja da cidade", "Iniciar treino", "Treinar offline". Casar pela classe pegaria o botão de comprar na store — tem que ser por texto.
- **O treino online não pede confirmação.** Clicou, a janela fecha, o personagem anda até o pátio e começa. (O offline pede, `.text-prompt-dialog` — por isso a confirmação de sucesso aqui é o toast aparecer, não a janela fechar; a caminhada leva alguns segundos.)
- **"Está treinando" é um toast**: `.system-toast` contendo `.training-skill`, `.training-bar` e `.training-progress` ("Sword Fighting · 58% · próximo em ~12m"), com um `<button>Cancelar</button>` **sem classe nenhuma**. Persiste e progride; cancelar é imediato e também não pede confirmação.

E o fato que mais mexeu no código: **treinar não é caçar e não tira o personagem da cidade** — com o treino rolando, "Sair da caçada" segue oculto e "Venda rápida" segue visível. Sem tratar isso, o monitor veria "parado na cidade com stamina" e tentaria caçar por cima do treino.

**Duas condições, cada uma com o seu interruptor** (rodam com a automação desligada, como a venda na cidade):

- **Quando a stamina acabar** — entra depois do rodízio de personagens: se ainda houver alguém com stamina na fila, trocar continua ganhando.
- **Quando ficar parado na cidade** por X minutos (padrão 15). O cronômetro só corre com o personagem parado na cidade, sem caçar e sem treinar; caçada, treino ou lista de personagens zeram a contagem. É a condição que aproveita o tempo de quem está esperando convite de grupo ou com a automação desligada.

**A skill é fixa por personagem**, não por conta (decisão do André): a mesma conta costuma ter vocações diferentes, e treinar Magic Level num knight seria desperdício. A lista de personagens é a mesma já capturada na tela de seleção. Personagem sem skill escolhida não treina — a automação avisa no histórico em vez de chutar uma.

**Quando a caçada volta a valer**, a automação inicia a caçada por cima do treino e deixa o jogo resolver (escolha do André). Como "o jogo cancela sozinho" é suposição e não foi testado ao vivo, tem uma rede: se a caçada começou e o toast de treino continuar na tela, aí sim o bot cancela e registra.

Validado num DOM que reproduz a estrutura real da aba (inclusive os quatro `train-start` na ordem certa), em seis cenários: stamina zerada com e sem a condição ligada, sem skill configurada, ociosidade antes e depois do prazo, e ociosidade com o personagem caçando.

### Sumiram as barras de rolagem do menu lateral

André: "essa barra está totalmente desconexa no layout atual... não pode ter barra de rolagem nessa parte". Eram duas — a vertical, chumbada do Windows, e uma **horizontal** no rodapé do painel.

A horizontal tinha causa: a barra de abas ficou mais larga que o painel e empurrava a largura do bloco inteiro (dava pra ver o "Histórico" cortado na ponta). Com a sexta aba não havia mais fonte pra encolher, e rolar na horizontal esconderia uma aba inteira — então **a barra de abas agora quebra em duas linhas**, com as seis visíveis e legíveis. A borda de baixo virou `box-shadow` pra não cortar a primeira linha.

As duas barras de rolagem foram desligadas no painel de automação, no de configurações e na lista de contas. O conteúdo continua rolando normalmente na roda e no trackpad — só não desenha mais a barra.

## 0.9.32 — 2026-09-10

### "Quando a stamina acaba" virou duas ações independentes

André: "voltar a caçar com x minutos de stamina é para quem tem um personagem só, e trocar de personagem é para quem tem dois — deveria ser uma configuração separada... são ações separadas dentro do Rotina".

Era isso mesmo: o rodízio sempre teve liga/desliga, mas a espera de stamina era comportamento fixo, e a única forma de "desligar" era zerar o limiar — justamente o valor que recria o bug de entrar e sair da caçada com 0 de stamina (o motivo do limiar existir, v0.5.0).

Agora a seção tem duas ações irmãs, cada uma com o seu interruptor e os seus campos (que somem quando a ação está desligada):

- **Esperar a stamina encher** → o campo "Voltar a caçar com stamina ≥ (min)".
- **Trocar de personagem** → a lista de personagens no rodízio.

Combinações e o que cada uma faz:

| Esperar | Trocar | Comportamento |
|---|---|---|
| ligada | ligada | Tenta trocar de personagem primeiro; espera só quando a fila acaba (comportamento de hoje) |
| ligada | desligada | Fica parado até bater o limiar e volta sozinho |
| desligada | ligada | Troca de personagem; quando todos zerarem, para e avisa |
| desligada | desligada | Para, mostra "Sem stamina" no painel e manda a notificação |

Detalhes que fazem diferença:

- **Com a espera desligada, o limiar em minutos deixa de segurar**, mas o bot ainda não tenta caçar com stamina **zerada** — o jogo recusa e ele ficaria entrando e saindo a cada 4s. Zerada cai no "parei por aqui".
- **Config antiga continua igual**: quem já usa o app não tem o campo salvo, e `undefined` conta como ligado (mesmo padrão do "sempre vender ao chegar na cidade").
- **Nenhuma mensagem mente mais**: os textos de "aguardando regenerar" só aparecem quando a espera está ligada de verdade — inclusive o do fim de ciclo ("loot vendido, mas a stamina está abaixo do mínimo") e o do rodízio esgotado.
- No modo **Em grupo** o rodízio segue fora de questão de propósito: trocar de personagem sendo líder desmontaria a party.

Validado num DOM simulado nos cinco cenários (as duas ligadas, cada uma sozinha, nenhuma, e config antiga), conferindo o log e que nenhum clique real é disparado.

## 0.9.31 — 2026-09-10

### Reabrir o app com o personagem caçando não tira ele da caçada

Bug reportado pelo André: "toda vez que eu abro o bot e está em caçada o bot tenta iniciar uma caçada, e abre o menu de caçadas".

**Causa (confirmada reproduzindo, não por hipótese)**: `isHunting()` procura o botão "Sair da caçada", que só existe depois que a SPA do jogo desenha o HUD. O `boot()` religava a automação assim que o `<body>` existia — muito antes disso. Nesse instante o DOM está praticamente vazio, então:

- "não achei o botão Sair da caçada" era lido como **não está caçando**;
- a stamina também vinha ilegível, e `hasEnoughStaminaToHunt()` trata ilegível como **tem stamina**;
- resultado: o primeiro tick concluía "personagem parado com stamina" e abria o seletor de caçadas por cima de uma caçada que já estava rolando.

Reproduzido num DOM simulado: com o código da v0.9.30, o cenário "app abre → HUD sobe já caçando" loga `Personagem não está caçando e já tem stamina suficiente — retomando a caçada configurada...` — exatamente a linha que aparecia no Histórico do André.

**Correção**: nenhuma decisão de "está caçando / está na cidade / quanta stamina" vale enquanto o HUD não estiver na tela.

- Portão novo no topo do `monitorTick()`: sem HUD, o tick não decide nada, só reporta "Aguardando o jogo carregar" (ou "Aguardando personagem", se estiver na tela de seleção). Loga uma vez por espera, não a cada 4s.
- Quando o HUD aparece e o personagem **já está caçando**, o log diz isso e o bot mantém a caçada atual, sem abrir seletor nenhum.
- O HUD monta em pedaços, então antes de INICIAR uma caçada o tick espera 3s de HUD estável — senão a barra do personagem já visível com o botão "Sair da caçada" ainda pendente reproduziria a mesma mentira. Não atrasa nada em regime normal.
- Bônus do mesmo portão: parado na tela de seleção de personagem o bot também não tenta mais caçar.

### `ensureHunting` não abandona mais uma caçada por causa de uma leitura que falhou

Se o personagem estava caçando e o bot não conseguia **ler** qual caçada era (o modal de detalhes não abriu, o título não veio a tempo), o código caía direto no "escolher e iniciar" — ou seja, tirava o personagem de uma caçada boa por causa de uma falha de leitura. Agora, na dúvida, mantém a atual e registra o motivo. Só troca de caçada quando lê positivamente um nome **diferente** do configurado (e agora loga a troca).

## 0.9.30 — 2026-09-10

### O botão agora mora dentro da aba Caçada (e não empurra mais a barra de abas)

A v0.9.29 escondia o "Ligar automação" nas outras abas, mas ele continuava **fora** do painel — então sumir/aparecer mudava a altura do bloco e a barra de abas dançava a cada troca de aba. O André pegou na hora: "ele fica alterando o menu de cima".

Agora o botão é filho do painel da aba **Caçada**, como primeiro elemento dela: aparece e some junto com a aba, sem nenhum JS extra, e a barra de abas fica cravada no mesmo lugar (validado: `top` da barra idêntico em Caçada e Rotina). No topo da aba, e não no fim, pra não ficar abaixo da dobra em janela baixa.

### Histórico: com hora e usando a aba inteira

- **Cada linha mostra a hora** (`HH:MM:SS`) numa coluna própria, com separador de dia ("Hoje · 10/09", "Ontem · 09/09"). O dado sempre existiu — o guest grava `at: Date.now()` em toda entrada desde o começo —, o painel é que jogava fora.
- **Mostra o histórico inteiro**, não as 8 últimas. A aba estava 80% vazia.
- **O guest guarda 120 entradas** em vez de 30. Com 30, o histórico cobria uns 10 minutos de automação — pouco pra responder "o que aconteceu enquanto eu não estava olhando".
- Linhas separadas por divisória fina, hora em `tabular-nums` pra coluna alinhada, e o bloco perdeu a borda/afastamento que fazia sentido quando o log dividia espaço com outras seções.
- Só redesenha quando o log muda de verdade — senão a lista piscaria e perderia a rolagem a cada `hm:state` (que chega o tempo todo).

## 0.9.29 — 2026-09-10

### "Ligar automação" agora só aparece na aba Caçada

O André perguntou o que exatamente esse botão liga, e a resposta expôs um problema de layout: ele ficava **acima da barra de abas**, sempre visível, sugerindo que gateava o painel inteiro. Não gateia. Ele controla só o ciclo de caçada:

- entrar/retomar a caçada configurada (solo ou "Iniciar com o time" na conta líder);
- vigiar a capacidade e fazer sair → vender → voltar quando a bag enche;
- esperar a stamina encher;
- trocar de personagem no rodízio quando a stamina zera.

Todo o resto roda por conta própria, cada um no seu checkbox, **com a automação desligada**: aceitar convite de party/caçada, vender ao chegar na cidade (v0.9.20), retomar a sessão, seguir o líder, sincronizar EK, convidar a party, reportar nome/vocação/level/caçando e esconder o analisador do jogo.

Agora o botão vive junto do que ele liga: aparece na aba **Caçada** e some nas outras. Detalhe de implementação que já mordeu antes neste projeto: `.autoToggleBtn` é `display: flex`, que ganha do `[hidden]` do HTML — precisou de `.autoToggleBtn[hidden] { display: none }` explícito.

## 0.9.28 — 2026-09-10

### Minimizar o analisador: quarta tentativa, agora sem esperteza

As três anteriores falharam cada uma por um motivo diferente, e a v0.9.27 tinha achado um deles de verdade — mas ainda sobrava outro. No mesmo dump ao vivo, a classe do painel era `hunt-analyzer-window ui-scaled **minimized** wide` **com o painel aberto na tela**. Ou seja, a classe `minimized` não significa o que eu assumi, e o meu `if (classList.contains("minimized")) return;` fazia a função sair sem fazer nada — de novo em silêncio.

O histórico completo das causas, porque cada uma foi uma lição diferente:

1. **v0.9.23/25/26** — eu desconfiava do seletor do painel. Não era isso.
2. **v0.9.27** — era o `isVisible()` do projeto, que reprova esse painel (`checkVisibility` false, tamanho 0×0), então o código nem o encontrava. Real, corrigido, mas não era o único.
3. **v0.9.28** — a classe `minimized` estava presente mesmo com o painel aberto, e a guarda que eu criei em cima dela abortava tudo.

O padrão comum: **eu construí condições em cima de suposições sobre um DOM que não consigo inspecionar** (a versão da conta free). Então a v0.9.28 remove todas elas. A regra virou: se o toggle está ligado e o painel existe no DOM, **esconde** — sem checar classe, sem checar visibilidade, sem depender de o botão de minimizar existir. É o que foi pedido ("fechar sempre") e é a única coisa que não pode falhar em silêncio.

- Usa `display: none !important`, porque o CSS do jogo usa `!important` no controle de exibição desse painel (confirmado ao vivo: forçar display inline simples não tinha efeito).
- **Re-aplica sozinho**: o jogo reescreve o `style` inline desse painel o tempo todo (posição, `max-height`, `z-index`), então se ele apagar o nosso, o próximo tick esconde de novo.
- Desligar o toggle devolve o painel, removendo só a nossa propriedade e deixando os estilos do jogo intactos — testado com ida e volta no painel real.

Continua sendo preferência de tela e nada mais: não destrava nenhum número do recurso pago. Quem calcula os seus é a aba Análise.

## 0.9.27 — 2026-09-10

### Causa raiz do "minimizar o analisador não funciona" — não era o seletor, era o filtro de visibilidade

Três tentativas minhas falharam no mesmo ponto (v0.9.23, v0.9.25, v0.9.26) porque eu fiquei desconfiando do **seletor** do painel. Testando ao vivo na aba do André, o problema é outro e vale como lição geral do projeto:

**`section.hunt-analyzer-window` existe, está na tela durante a caçada, e mesmo assim reprova no `isVisible()`** — `checkVisibility({checkOpacity:true, checkVisibilityCSS:true})` devolve `false` e `offsetWidth/offsetHeight` vêm `0`. Como todo o resto do arquivo usa `queryVisible`, o painel era literalmente invisível pro código: as três versões saíam sem fazer nada e sem nem chegar no log de diagnóstico que eu tinha colocado. (Confirmado por comparação direta: rodando o `isVisible` antigo contra o painel real, o resultado é "não".)

- A busca do painel **não usa mais o filtro de visibilidade padrão**. A regra agora é só: existe no DOM e nenhum ancestral tem `display:none` — o suficiente pra distinguir "o jogo escondeu porque não há caçada" (confirmado: ele esconde por regra de CSS) de "está na tela".
- O **botão de minimizar também é procurado sem filtro de visibilidade**, de propósito: `.click()` dispara o handler do Angular mesmo num elemento que o CSS esconde. Então, se na conta free o botão existir mas não aparecer no cabeçalho, clicar nele funciona do mesmo jeito.
- **Verificação depois do clique**: se o botão existir mas não minimizar de fato, cai no plano B (esconder da vista) em vez de dar por resolvido. Antes eu confiava que o clique tinha funcionado.
- O log diz exatamente o que aconteceu — minimizou, ou escondeu porque não havia botão, ou escondeu porque o botão não teve efeito — sempre com a classe do painel e a lista de botões.

Anotado no `CLAUDE.md` como armadilha do projeto: **quando um fix "não faz nada e não loga nada", desconfiar do filtro de visibilidade antes do seletor.**

## 0.9.26 — 2026-09-10

### "Minimizar o analisador" agora acha o painel por texto, não por classe

Segunda tentativa falhando no mesmo lugar, e o motivo é o mesmo dos dois casos anteriores: **eu confirmei o painel numa conta PREMIUM e assumi que valia pra free**. O `section.hunt-analyzer-window` que eu vi ao vivo é da versão desbloqueada; a versão da conta free (a que mostra "Assinar Premium") é provavelmente outro elemento, então o código nem encontrava o painel — e por não encontrar, saía em silêncio, sem nem o log de diagnóstico que eu tinha colocado.

- Agora a busca não depende mais da classe: acha pelo **título "Analisador de caçada"**, que é idêntico nas duas versões (dá pra ver no print do André), e sobe até o container do painel. A classe confirmada continua sendo tentada primeiro, quando existe.
- O log agora registra **qual painel foi encontrado e quais botões ele tem**, tanto no caminho de minimizar quanto no de esconder. Se ainda assim não resolver, é o Histórico que vai dizer o porquê — em vez de eu chutar uma terceira vez.
- 5 testes fora do jogo cobrindo os dois formatos de painel (com e sem a classe conhecida), o caso de subir até um container sem `section`, o de não confundir com outro texto parecido, e o de painel ausente.

## 0.9.25 — 2026-09-10

### Fix: a aba Análise mostrava "Sem dados ainda" com a conta caçando

Erro meu de execução, não de lógica: na v0.9.23 eu adicionei os campos `stats` e `minimizeGameAnalyzer` ao `sendState()` com uma substituição automática que **não casou** — o bloco vizinho estava com indentação diferente — e ela **falhou em silêncio**. Eu validei o script inteiro em vez de cada substituição, então passou. Resultado: o bot calculava tudo direito, mas nunca enviava pro painel.

- `stats` agora é enviado de verdade: a aba Análise passa a mostrar os números da sessão em vez de "Sem dados ainda".
- `minimizeGameAnalyzer` também: o toggle da tela passa a refletir o valor salvo.
- Aproveitei e corrigi a indentação do bloco da v0.9.18, que foi o que fez a substituição errar o alvo.
- **Auditei as outras 15 peças da v0.9.23 uma a uma** (coleta de XP, gold, ciclos, sessão nova na troca de personagem, agregação, histórico, IPC) — todas tinham entrado corretamente; era só esta.

### Fix: "Minimizar o analisador do jogo" não fazia nada na conta free

O print do André é de conta **free**, e o analisador dela é a versão bloqueada (a que mostra "Assinar Premium"). O que eu confirmei ao vivo na v0.9.23 foi a versão **premium**, que tem `button.analyzer-minimize` — a versão bloqueada, pelo visto, não tem controle de minimizar nenhum, então o código procurava um botão que não existia e saía sem fazer nada.

Agora tenta três caminhos, nessa ordem:

1. `button.analyzer-minimize` (premium, confirmado ao vivo);
2. qualquer botão do painel cujo rótulo contenha "minimizar" — cobre a classe mudar sem o botão sumir;
3. sem botão nenhum: **esconde o painel da vista** (`display: none`), que é o único jeito de devolver o canto da tela quando o jogo não oferece o controle. É preferência de tela, reversível pelo próprio toggle, e não destrava nada do recurso pago — os números do jogo continuam sendo do jogo; quem calcula os nossos é a aba Análise.

No caminho 3 o log registra **quais botões o painel realmente tem**. Se um dia essa versão ganhar um minimizar de verdade, isso aparece no histórico e dá pra usar o botão em vez de esconder — em vez de eu ficar adivinhando de novo.

## 0.9.24 — 2026-09-10

### Fix: a lista dizia "Automação desligada" para quem estava caçando

André, com Kinazinho e Naj caçando juntos em party mas o Naj aparecendo como "Automação desligada": *"os dois personagens estão em PT, deveria funcionar de alguma forma a informação do que o bot está fazendo... se está caçando em PT está caçando e não mostrar que está com automação desligada"*.

- **Causa**: a linha reportava o estado do **bot**, não o do **personagem**. Com a automação desligada, tanto fazia o que estivesse acontecendo no jogo — entrou por convite, entrou na mão, estava matando Ghoul há meia hora: aparecia sempre "Automação desligada". O estado real do personagem nem chegava ao painel; ninguém reportava se ele estava caçando.
- **Fix**: o content script passou a reportar `hunting` (que já era conhecido internamente pelo `isHunting()`, só nunca era enviado), e a linha agora mostra o personagem primeiro:
  - caçando sem o bot → **"Caçando (sem bot)"**, em verde, porque a conta está produzindo;
  - parado, com o bot desligado → **"Parado na cidade"**;
  - na tela de seleção → **"Fora do jogo"**;
  - com o bot ligado, o status da automação continua mandando ("Caçando", "Aguardando o time", "Aguardando stamina"...).
- Que a automação está desligada continua visível no **ícone de raio** da linha, que é exatamente pra isso — o texto ficou livre pra dizer o que importa.
- O mesmo vale no painel da conta: o status grande e o pontinho verde agora acompanham o personagem, não só o bot.
- `hunting` entrou na assinatura do watcher que reporta o personagem, senão o estado ficaria velho — foi o mesmo problema do level congelado, corrigido na v0.9.22.

### Validação

- `node --check` + 6 testes fora do jogo: o caso exato reportado (caçando em party sem bot), parado na cidade, fora do jogo, com bot ligado em vários status, prioridade do erro e conta ainda carregando.

## 0.9.23 — 2026-09-10

### Analyzer próprio do bot (nova aba "Análise")

André perguntou se dava pra fazer o analisador de caçada funcionar na conta free, ter um do próprio bot, ou forçar o fechamento dele. Das três: **destravar o analisador premium pra conta free está fora** — é recurso pago do jogo, e contornar isso não é coisa que eu vá fazer. As outras duas foram feitas, e o analyzer próprio ficou melhor pro caso dele de qualquer jeito, porque o do jogo é por personagem e o nosso soma as contas.

Tudo é calculado com o que a automação **já observa**, e independe de ser conta premium:

- **Esta conta, nesta sessão**: tempo, ciclos, gold vendido (total e por hora), XP (total e por hora), level atual e quantos subiu.
- **Todas as contas abertas**: soma de gold, XP e ciclos, mais qual conta está rendendo mais gold/hora agora.
- **Por dia**: os últimos 7 dias na tela (30 guardados em disco, em `userData/stats.json`, mesmo padrão do catálogo de caçadas). É aqui que dá pra comparar se uma caçada rende mais que outra.

Detalhes que importam pra confiar nos números:

- **Gold é receita bruta da venda, não lucro** — descontar o custo da caçada exigiria ler o "Ratear custos da hunt", que é outra história. O rótulo diz "gold vendido" de propósito.
- **XP é somado por delta**, com tratamento de virada de level (`(faltava pro level antigo) + (já entrou no novo)`). Perder XP sem subir de level (morte) não desconta nem inventa: só re-ancora.
- **Cada conta reporta o total da sessão; o app soma o DELTA** desde a última leitura, com um id de sessão que muda a cada boot e a cada troca de personagem do rodízio. Sem isso, o mesmo gold seria contado várias vezes (o estado chega repetido a cada evento) e o XP de um personagem entraria na conta do outro.
- **Se o parser não reconhecer um formato de número, não soma nada** e o texto cru continua no log — é assim que um formato novo aparece sem virar número errado em silêncio.

### Minimizar o analisador do jogo

Novo toggle (ligado por padrão, a pedido). O painel do jogo **não tem botão de fechar**, só minimizar — então é isso que a automação faz, e **uma vez por aparição**: se você expandir de propósito depois, ela não fica reminimizando por cima.

### Painel do bot e personagem agora andam juntos

André: *"quando eu estou com o bot aberto, e eu clico lá no personagem em cima, ele não altera a janela do bot"*. Eram duas seleções independentes — dava pra ficar vendo um personagem e mexendo na configuração de outro, que é um jeito ótimo de configurar a conta errada sem perceber. Agora acompanham nos dois sentidos: escolher o personagem leva o painel junto, e abrir o painel de uma conta traz o personagem dela pra tela.

### Confirmado ao vivo (10/09/2026)

Investigação no Dezin Zemsta, com uma caçada curta em Amazon Camp que o André autorizou pra eu medir valores reais:

- **XP absoluto**: `.hud-exp` tem `title="Experiência 1.827.258/6.716.200"`. Medido em 25s de caçada real: 1.828.209 → 1.830.428 = **2.219 de XP**, que é exatamente o que a conta de delta prevê.
- **Texto da venda**: `.quick-sell-confirm` diz **"Vender por 432 gp"** — número simples com " gp", sem abreviação (o analisador do jogo abrevia, o botão de venda não). Era o único formato que eu não conhecia. Li e **cancelei**, sem vender o loot dele.
- **Venda rápida desabilitada** usa a propriedade **nativa `disabled`** — confirma que o fix da v0.9.17 checa a coisa certa contra o DOM real.
- **O diálogo "Quer começar sem o time?" é do LÍDER**: com o Dezin em party mas como membro, "Iniciar caçada" iniciou direto, sem diálogo. Não é "estar em party + clicar solo" que dispara — é ser líder e tentar começar sozinho, o que bate com o subtítulo do próprio diálogo e confirma a causa raiz da v0.9.14.

### Validação

- `node --check` nos quatro `.js`, JSON do manifest válido e checagem de ids órfãos (zero).
- 10 testes fora do jogo: parse do texto real "Vender por 432 gp", valores com separador de milhar, formato abreviado do jogo, texto sem número (vira `null`, não zero), o delta de XP medido ao vivo, virada de level, morte, primeira leitura, e os deltas por sessão (não contar em dobro, recomeçar na troca de personagem).
- Aba nova renderizada em Chromium headless a 250px.

## 0.9.22 — 2026-09-10

### Fix: vocação e level congelavam na barra lateral

André mandou print com "KNIGHT LV 10" no jogo e "K 8" na barra lateral: *"a vocação e level no menu lateral não é atualizado junto do jogo"*.

- **Causa**: o watcher que reporta o personagem só enviava estado quando o **nome** mudava (`if (name === lastReportedCharacterName) return`). Vocação e level iam de carona em qualquer `sendState()` que acontecesse por outro motivo — e, caçando normalmente, o `monitorTick` sai sem reportar nada enquanto a capacidade está longe do limite. Ou seja: podia passar horas sem enviar estado, e o level ficava parado no valor de quando o personagem logou.
- **Fix**: o watcher agora observa os três juntos (nome, vocação e level) e envia assim que qualquer um muda. O bloco que atualiza o alvo do "retomar sessão" continua rodando só quando é o **personagem** que mudou — subir de level não pode reescrever configuração.

### A barra de URL saiu

André: *"essa barra de url aqui em cima só ocupa espaço, pode tirar ela e arruma outro lugar para alocar o zoom do sistema"*. Tinha razão: a barra existia pra exibir e permitir digitar uma URL que nunca muda — o app só carrega `huntera.com.br/game`, e o processo principal já bloqueia navegação pra fora desse domínio de qualquer jeito. Junto dela saíram os botões de voltar/avançar, que também não têm uso num app de uma página só.

O que valia a pena manter foi pro **popover da trilha** (o ícone de lupa): **zoom da conta ativa** (−, valor, +, com clique no valor pra voltar ao padrão) e **Recarregar esta conta**. Fica ancorado na trilha, que está sempre visível mesmo com o menu recolhido, e não custa nenhuma altura do jogo. Fecha clicando fora ou no Esc.

A pastilha de status (que mostra "N/4 contas" e o resultado da checagem de atualização) desceu pro rodapé do menu — o contador de contas já aparecia no cabeçalho do grupo de qualquer forma.

### Validação

- `node --check` + checagem automática de que nenhum `getElementById` do renderer aponta pra um id removido junto com a barra (zero).
- App renderizado em Chromium headless com o menu recolhido e o popover aberto.

## 0.9.21 — 2026-09-10

### Reorganização das abas: uma pergunta por aba

André: *"a opção de retomar sessão automaticamente não deveria estar em party... monte uma proposta de reorganização. as categorias precisam fazer sentido."* Levantando tudo que existia, o "Retomar sessão" em Party não estava sozinho — eram seis desencontros, e todos saíam do mesmo critério: **cada aba responde uma pergunta só; se um ajuste não responde a pergunta da aba, está na aba errada.**

- **Caçada** — *o que eu quero caçar, e até quando?* Fica com Modo de caçada, Caçada, Tamanho do pull e Sair quando capacidade.
- **Rotina** (nova) — *o que fazer pra continuar caçando sem mim?* Recebe o que estava espalhado entre duas abas, em três seções: **Ao encher a bag** (vender na cidade), **Quando a stamina acaba** (voltar a caçar com stamina, trocar de personagem + rodízio) e **Ao cair a sessão** (retomar sessão + personagem a retomar).
- **Party** — *com quem eu jogo?* Ganhou títulos nas três seções: **Meu time**, **Convites que recebo** e **Em combate** — essa última existia sem título nenhum, com quatro opções soltas misturando "quem pode me convidar" com comportamento de combate.
- **Histórico** — *o que aconteceu enquanto eu não estava olhando?*

O que motivou juntar "Retomar sessão" com o rodízio: as duas fazem a mesma coisa — decidem qual personagem está logado, e as duas passam pela tela de seleção. Estavam em abas diferentes.

### Dois acertos aproveitados junto

- **"Personagem a retomar" virou lista.** Era um campo de texto com o mesmo dado que o rodízio já escolhe por checkbox, e um typo aqui falha calado justo no pior momento: quando a sessão cai e ninguém está olhando. Usa a lista de personagens da conta capturada na v0.9.20. Se ainda não vimos a conta, o nome salvo continua aparecendo (a configuração não some da tela) e um aviso explica de onde a lista vem.
- **"Lista de amigos" virou "Aceitar convite de".** O campo não tem relação com a lista de amigos do jogo: é a allowlist de quem pode te convidar automaticamente. O nome antigo sugeria a coisa errada, ainda mais a dois campos de "Personagens do time", que é uma lista de verdade.

Nada de comportamento mudou — só onde cada ajuste aparece, mais os dois renomes. As configurações salvas continuam valendo (todos os IDs dos campos foram preservados, então a leitura/escrita é a mesma).

### Dois bugs de layout achados no preview

- **Quatro abas não cabiam**: com ícone + rótulo, "Histórico" era cortado em 250px. Na barra da automação o rótulo tem prioridade — os ícones saem e o texto encolhe um pouco. A barra das Configurações tem três abas e mantém os ícones.
- **Checkboxes do rodízio grudados no nome**, sem o espaçamento nem a etiqueta "agora" alinhada à direita: a mesma armadilha de especificidade corrigida na v0.9.20 pro `.switchRow`, agora no `.rotateItem` — `.automationSection label` (`display: block`) vencia o `display: flex`.

### Validação

- `node --check` + checagem automática de que nenhum `getElementById` do renderer aponta pra um id que sumiu do HTML na reorganização (zero).
- As três abas renderizadas em Chromium headless a 250px, que foi o que pegou os dois bugs acima.

## 0.9.20 — 2026-09-10

### Rodízio por checkbox, não por nome digitado

André: *"hoje a rotação de personagens é por nome. o próprio app poderia checar o nome dos personagens que existem na conta e deixar um checkbox de ciclo, quais são os personagens que fazem parte da rotação"*. Tinha razão — digitar nome à mão era frágil: um typo não dava erro nenhum, só fazia o personagem ser ignorado em silêncio.

- **O app agora descobre os personagens da conta sozinho.** Eles só existem no DOM na tela de seleção de personagens, então a lista é capturada sempre que essa tela aparece — o que já acontece naturalmente: no login, num server save e a cada troca do rodízio. Fica guardada por conta, pro painel montar os checkboxes mesmo com o jogo já aberto.
- **O campo de texto virou uma lista de checkboxes**, com uma etiqueta "agora" no personagem que está logado no momento. A ordem do rodízio passou a ser a ordem da própria conta; marcar/desmarcar só decide quem entra.
- A lógica de rodízio em si não mudou — ela continua recebendo exatamente o mesmo array `rotateCharacters`, agora preenchido por clique em vez de digitação.
- Enquanto a lista ainda não foi vista, o painel explica de onde ela vem em vez de mostrar um espaço vazio.

### A venda na cidade deixou de depender do "Ligar automação"

André perguntou: *"o venda na cidade só funciona quando o ligar automação está habilitado?"*. Funcionava — a venda morava dentro do `monitorTick`, que começa com `if (!running) return`. Mas ela é uma conveniência que faz sentido sozinha, mesmo raciocínio dos watchers de party, que rodam independentes desde a v0.7.0.

Agora tem watcher próprio: com a automação **desligada**, se o toggle estiver ligado e o personagem chegar na cidade, o loot é vendido do mesmo jeito (uma vez por ida, como antes) — e para por aí, sem tentar retomar caçada nenhuma. Com a automação **ligada**, quem cuida continua sendo o monitor, que além de vender decide o que fazer depois (retomar, ou entrar na sincronização do time).

### Fix de layout: interruptores empilhados

Achado no preview renderizado: em toda seção da automação, o rótulo e o interruptor apareciam **um embaixo do outro** em vez de lado a lado. `.switchRow` (0,1,0) perdia em especificidade pra `.automationSection label` (0,1,1), que é `display: block` — então todo switch dentro de uma seção virava bloco. Já era assim antes desta versão (a aba Party inteira estava com isso); os toggles novos só deixaram óbvio.

## 0.9.19 — 2026-09-10

### Fix: a lista mostrava o nome de personagens que não estavam logados

André, com "Kinazinho Zemsta" e "Naj Zemsta" logados mas a barra lateral mostrando "Kina Zemsta" e "Najwizzy Zemsta": *"eu não estou logado nos personagens que está no canto esquerdo. aqui deveria estar o nome dos personagens online no momento"*.

- **Causa**: a regra de preencher o nome da conta era `/^Conta \d+$/.test(tab.label)` — ou seja, o rótulo só era atualizado **enquanto ainda fosse o padrão gerado**. Assim que virava um nome de personagem, congelava pra sempre; entrar com outro personagem naquela conta não mexia mais em nada. (Dava pra ver no print que o resto do estado chegava normal: vocação e level já eram dos personagens novos, só o nome estava preso.)
- **Fix**: o rótulo acompanha o personagem logado sempre, com um "freio de mão" no mesmo padrão já usado no `autoResumeSessionManuallyDisabled` — renomear a conta na mão marca `labelManual` e o nome escolhido nunca mais é sobrescrito. Apagar o texto e sair do campo devolve o controle pro automático.
- **Nota de migração**: contas que você já tinha renomeado na mão antes desta versão não têm essa marca salva, então vão ser corrigidas pro nome do personagem logado uma vez. Basta renomear de novo — daí em diante fica fixo.
- **Bônus do mesmo print**: personagem novo aparece como "Sem vocação", e a abreviação genérica virava "**SEM 6**", que não quer dizer nada. Agora, sem vocação definida, o badge mostra só o level (`Lv 6`).

### Validação

- `node --check` + 8 testes da regra do rótulo e do badge fora do jogo, incluindo o caso exato reportado, o "renomeado na mão nunca é sobrescrito" e a tela de seleção (sem personagem logado, mantém o último nome em vez de esvaziar).

## 0.9.18 — 2026-09-10

### Nova feature: rodízio de personagens quando a stamina acaba

André: *"trocar de personagem para gastar toda a stamina do outro personagem e seguir na mesma caçada... desloga o personagem A e loga no B e vai até finalizar stamina"*.

**Por que isso não fere a regra fixa nº 1 (nunca automatizar login)** — confirmado ao vivo em 10/09/2026, com o Dezin parado na cidade, lendo o DOM sem clicar: o "Sair do jogo" do menu de Opções se descreve sozinho como *"Volta para a lista de personagens — sua conta continua conectada"*. Ou seja, não desloga a conta: volta pra mesma tela de seleção que o `autoResumeSession` (v0.8.0) já usa desde sempre, onde o único clique é "Jogar" num personagem já autenticado. Em nenhum momento se toca em e-mail, senha, "Trocar de conta" ou "Sair da conta" — o escopo continua exatamente o da exceção estreita aberta em 04/09/2026, sem alargá-la.

- **Novo toggle "Trocar de personagem quando a stamina acabar"** + campo de **ordem do rodízio** (nomes separados por vírgula; vazio usa a ordem da própria tela de seleção), na aba Caçada.
- **Como funciona**: quando a stamina do personagem atual chega no piso, em vez de ficar parado esperando regenerar, a automação sai pra lista de personagens, entra no próximo da fila e **segue na mesma caçada configurada**. Dispara nos dois momentos em que a falta de stamina aparece: no monitor (personagem fora da caçada sem stamina) e logo depois de vender o loot — esse segundo é o momento ideal, com a bag já vazia e nada pendente.
- **Trava contra carrossel infinito**: se o rodízio der a volta na fila inteira sem ninguém conseguir caçar (todos sem stamina), ele para de trocar e passa a esperar regenerar normalmente — senão o app ficaria entrando e saindo do jogo sem parar. O contador zera assim que algum personagem volta a caçar de verdade.
- **Cuidados**: se a stamina não puder ser lida, nunca troca (não arrisca no escuro); se o personagem configurado não estiver na lista, é ignorado em vez de chutar outro; e o "personagem a retomar" do `autoResumeSession` é atualizado pro que entrou, senão depois de um server save ele tentaria voltar justamente pro personagem sem stamina.

**Seletores confirmados ao vivo (10/09/2026)**: `button.nav-labeled[aria-label="Opções"]` abre `section.options-menu`; dentro, `.options-entries` lista as entradas e `button.options-exit` é o "Sair do jogo"; fechar é `button[aria-label="Fechar opções"]`.

### Validação

- `node --check` nos `.js` tocados + JSON do manifest válido.
- 10 testes da lógica de rodízio rodados fora do jogo, todos passando: ordem configurada, volta no fim da fila, lista vazia caindo na ordem da tela, nome inexistente ignorado, fila de um só (não troca à toa), personagem atual fora da fila, nenhum disponível, diferenças de caixa/espaço, piso de stamina e o caso crítico de stamina ilegível (nunca troca).

## 0.9.17 — 2026-09-10

### Fix: venda ficava tentando pra sempre com o botão desabilitado

André mandou o log: `Cheguei na cidade — vendendo loot... / Erro: Cliquei em "Venda rápida" mas a confirmação não apareceu` repetido, e diagnosticou junto: *"o botão está desabilitado e está tentando vender na cidade, isso deveria ser uma tentativa só e não ficar tentando várias vezes"*. Eram dois erros meus, encadeados:

- O jogo **desabilita** o "Venda rápida" quando não há nada pra vender. O `queryVisible` só olha visibilidade, então o botão desabilitado passava como disponível — a automação clicava, nada acontecia, e a v0.9.15 (que passou a tratar "confirmação não apareceu" como erro) transformava isso num erro de verdade. Agora `isQuickSellDisabled()` checa `disabled`, `aria-disabled` e classe, e trata como "bag vazia" — que não é erro nenhum.
- **A trava de "uma venda por ida à cidade" era marcada DEPOIS da venda.** Qualquer falha no meio pulava essa linha, e o tick seguinte tentava tudo de novo, pra sempre. Agora a trava é marcada **antes** da tentativa: é uma tentativa por ida à cidade, dê no que der — exatamente o que ele pediu. E "confirmação não apareceu" virou aviso em vez de erro, já que a trava sozinha impede o loop.

### Fix: tentava reentrar na caçada sem stamina

André: *"toda vez que sair da caçada faça um check na stamina, hoje ele sai sem stamina, tenta entrar novamente e recebe a mensagem de erro... o sistema precisa ser inteligente para não sair tentando fazer ação que não seria possível"*. O check existia no `monitorTick`, mas não no caminho sair-por-capacidade → vender → voltar, que é o que roda o tempo todo. Ao vender com a stamina no fim, a automação tentava reentrar na hora, o jogo recusava, virava erro — e três desses desligavam a automação sozinha. Agora, sem stamina, ela avisa e devolve pro monitor, que reentra quando o limiar for atingido. Mesma proteção na retomada em grupo (com o log throttled, pra não encher o histórico enquanto espera).

### Layout: "trilha que expande" (opção B da proposta, aprovada)

O hambúrguer saiu. A trilha de 52px **é** o estado recolhido: passar o mouse abre a barra, tirar recolhe, com 180ms de atraso pra não abrir sem querer ao cruzar. O antigo ☰ virou o **⚲ fixar aberto**, pra quando é pra mexer em várias coisas seguidas — e a escolha fica salva.

E o que fazia o ☰ incomodar de verdade foi resolvido: **as contas agora moram também na trilha**, com o pontinho de status (verde caçando, vermelho travada). Recolhido, você continua vendo as quatro — antes, recolher significava perder a lista de vista por completo. Clicar num avatar da trilha troca de conta.

Cuidado tomado: a barra não recolhe por baixo de quem está digitando (renomear conta, campos da automação) — o campo ficaria com foco num painel invisível.

### Layout: painel do bot destacável (opção C, também aprovada)

Novo botão **Destacar** no topo do painel: ele sai da barra lateral e vira um card flutuante sobre o jogo, arrastável pela barrinha, com a posição salva. Com ele destacado, a barra lateral volta a mostrar a lista de contas — contas encaixadas de um lado, bot flutuando do outro. O ⇤ encaixa de volta.

Implementado **movendo** o `#automationPanel` entre a barra e o card (`appendChild`), nunca duplicando: todos os campos, listeners e o `syncAutomationPanel()` que já existiam seguem valendo sem nenhuma alteração. O arrasto usa `setPointerCapture`, que é o que faz ele continuar funcionando quando o cursor passa por cima do `<webview>` do jogo (sem isso o guest engole os eventos e o card gruda no meio do caminho).

### Outros

- **Tab troca de personagem** (pedido do André). Tab avança, Shift+Tab volta, dando a volta no fim da lista. Só no modo tela cheia — no modo grade as quatro já estão à vista. Não sequestra o Tab de quem está digitando num campo.
- **Status da conta sem os ciclos.** Com o badge de vocação do lado, o "· 812 ciclos" empurrava o texto e cortava o estado no meio ("Caçando · 812 c…", "Aguardando o t…"). Agora a linha mostra só o estado, inteiro; os ciclos continuam no painel da conta, que tem largura pra eles.

### Validação

- `node --check` nos quatro `.js` + JSON do manifest válido.
- App renderizado em Chromium headless nos três estados (trilha recolhida, barra expandida, painel destacado). O preview pegou dois bugs que a checagem de sintaxe não pegaria: o card flutuante posicionado no espaço de coordenadas errado (eu limitava a posição pelo container das contas, mas o CSS resolvia contra outro ancestral, jogando o card por cima da barra de ferramentas) e o `display:flex` do card vencendo o `[hidden]`, o que o deixava visível mesmo escondido.

## 0.9.16 — 2026-09-10

### Catálogo de caçadas salvo na máquina (o "Tamanho do pull" vazio)

André: *"uma coisa que me incomoda muito... a lista de caçadas completas já salva na máquina do usuário. toda vez que eu abro o tamanho do pull vem vazio e deveria vir já a lista completinha."*

- **Bug que eu mesmo introduzi na v0.9.15, corrigido**: ao converter os cliques pra `humanClick`, o `clickHuntEntry` virou `async` — e ele era usado como predicado de `waitFor` em DOIS lugares. Corrigi um (`pickAndStartHunt`) e passei batido no outro (`peekHuntTiers`). Predicado async devolve Promise, que é sempre truthy, então o `waitFor` "resolvia" na primeira tentativa, sem esperar a caçada aparecer nem garantir o clique: os tiers nunca renderizavam e o dropdown ficava vazio. (A revisão da v0.9.15 tinha avisado exatamente sobre esse risco, com os dois números de linha. Anotado no `CLAUDE.md` como armadilha recorrente.)
- **O modelo era preguiçoso por natureza**: os tiers de uma caçada só eram lidos quando aquela caçada específica era selecionada. Caçada nunca aberta = dropdown vazio, sempre. E cada conta mantinha a própria cópia no `localStorage` da sua partição — ou seja, remapear tudo de novo em cada conta, e perder tudo se a partição fosse limpa.
- **Agora**: o botão ↻ faz uma **varredura completa** — abre a janela de caçadas uma vez, passa por todas as caçadas lendo o tamanho do pull de cada uma, com progresso na tela ("Mapeando 12/55…"). O resultado é salvo **em disco** (`userData/hunt-catalog.json`, no processo principal) e **compartilhado pelas 4 contas**: tiers são do jogo, não da conta, então uma varredura só serve pra todas. Contas novas são semeadas com esse catálogo assim que abrem, e os dois dropdowns já nascem preenchidos, antes de qualquer conta responder.
- O catálogo também se completa sozinho com o uso normal: tudo que qualquer conta descobre (nomes, tiers de uma caçada) é gravado no arquivo compartilhado.
- Clicar numa caçada na lista só pré-visualiza (mostra detalhes e tiers) — quem inicia de verdade é o "Iniciar caçada"/"Iniciar com o time", que a varredura não toca. Por isso ela é segura com a conta logada e parada.

### Layout

- **A lista de contas mostra o estado real de cada conta.** A sub-linha exibia `huntera.com.br` — idêntico nas 4 contas, sempre — e o tempo de sessão. O app existe pra ficar rodando enquanto você faz outra coisa, mas não dizia nada de relance: saber se uma conta travou exigia entrar conta por conta. Agora mostra "Caçando · 812 ciclos", "Aguardando o time", "Erro" (em vermelho), "Automação desligada".
- **Vocação e level na lista** (pedido do André). Abreviado no padrão do jogo — `ED 357`, `EK 125`, `RP 77` — que é como todo mundo escreve no chat, e cabe na barra estreita.
- **Linha inteira clicável e arrastável** (pedido do André: *"se o usuário só clicar ele já executa o switch de personagem, se clicar e segurar libera o arrastar"*). Antes só a alcinha de pontinhos arrastava — um alvo de ~10px que só aparecia no hover. O `draggable` é ligado no `mousedown` em vez de ficar fixo no HTML, senão o nome da conta (que é `contenteditable`) perderia a seleção de texto ao renomear.
- **O status ganhou peso no painel da conta.** Era 11.5px cinza fraco: a informação mais olhada era a de menor peso visual. Agora é a âncora do painel, com cor por estado, e ciclos/stamina viraram uma legenda discreta na linha de baixo — isso também corrigiu uma quebra feia em três linhas que só apareceu no preview renderizado.
- **Textos de ajuda enxugados.** Eram parágrafos de 5-8 linhas que ocupavam mais altura que todos os controles da aba somados (o pior deles escrito por mim na v0.9.15). Agora é um resumo de uma linha, com o detalhe atrás de um "?" que abre.
- **Checkbox virou toggle de verdade.** O CSS forçava `30x16` num checkbox nativo, então o controle quadrado esticava e virava um retângulo achatado, com cara de bug.
- **Acabamento**: o botão ligar/desligar usava `#3fda8b`/`#ff6b70` fixos, ignorando o tema — agora deriva de `--success`/`--danger`; e removida uma linha inválida e morta do CSS (`background: var(--bg-rail)80;`).

### Validação

- `node --check` nos quatro `.js` + JSON do manifest válido.
- Barra lateral renderizada de verdade em Chromium headless (Playwright), com dados de exemplo nos quatro estados de conta, tema escuro, em 250px — zero erro de página. Foi esse preview que pegou a quebra da linha de status, que a checagem de sintaxe não pegaria.

## 0.9.15 — 2026-09-09

Revisão geral do código pedida pelo André ("consegue fazer uma análise no código e corrigir o que não está muito bem escrito? coisas que não fazem sentido/lógica nas funcionalidades?"), com duas revisões independentes rodando em paralelo. Foram achados vários travamentos permanentes reais na caçada em grupo — a maioria explicando sintomas que já tínhamos visto sem entender.

### Nova feature (pedido direto do André)

- **"Sempre vender ao chegar na cidade"** (novo toggle na aba Caçada, **ligado por padrão**). André: *"ter uma função para ficar detectando que o boneco saiu da hunt e vender... quando está em PT deveria ter um botão tipo: sempre vender quando for para cidade... pq a PT sempre sai da hunt quando acaba a cap de alguém e todos deveriam vender para ficarem mais ou menos próximos"*.
  - **O furo que isso tapa**: até aqui, VENDER era um passo interno do ciclo que só roda quando é a **própria conta** que decide sair (capacidade dela no limite). Só que numa caçada em grupo, quando **qualquer** membro estoura a capacidade, o jogo tira **todo mundo** — e os outros caíam na cidade sem nunca passar por esse ciclo. Resultado: não vendiam, voltavam a caçar com a bag cheia e — pior — como é justamente esse ciclo que marca "já vendi", **nunca reportavam isso pro líder, que ficava esperando o time pra sempre**. No modo solo havia o mesmo furo quando a stamina zerava.
  - Agora a venda é disparada por **estado** ("estou na cidade e ainda não vendi nesta ida"), não por quem causou a saída. Trava `soldSinceArrivingInCity` garante **uma venda por ida à cidade** (nada de clicar "Venda rápida" a cada 4s), liberada assim que o personagem volta a caçar.

### Travamentos permanentes corrigidos (caçada em grupo)

- **Comando `resumeGroupHunt` era descartado em silêncio** se chegasse com a conta ocupada (`isBusy`) — e o host só reenvia quando chega estado novo, o que não acontece durante a espera. Bastava o comando cair numa janela ocupada (o auto-convite de party segura a trava por vários segundos) pra caçada em grupo travar de vez. Agora fica pendente e executa assim que a trava libera.
- **Líder com "Personagens do time" vazio esperava pra sempre.** A lista mora na aba Party, mas o Modo de caçada mora na aba Caçada — nada obriga a preencher uma pra usar o outro. Lista vazia agora significa "não tem ninguém pra esperar" e retoma na hora.
- **Watchdog de 5 min na sincronização**: qualquer coisa que impeça o ciclo de fechar (conta fechada, membro que nunca reportou, app recarregado) deixava a conta parada pra sempre, **sem nenhum log**. Agora avisa (e notifica no Telegram) e volta ao fluxo normal.
- **`Desligar automação` não limpava o estado de sincronização.** Dois efeitos reais: (1) um membro desligado continuava reportando "estou pronto" pro líder, que retomava contando com alguém que nem estava mais automatizado; (2) ao religar, a conta batia na espera velha e dava `return` em todo tick — **nunca mais iniciava caçada até um F5**.
- **`resumeGroupHunt` rodava com a automação desligada**, fazendo uma conta parada voltar a caçar sozinha.
- **Estado da espera era limpo ANTES de tentar retomar**: se a retomada falhasse (ex: ninguém aceitou em 60s), a conta perdia o nome da caçada do time e saía da espera achando que estava tudo certo — voltando pra outra caçada. Agora só limpa depois do sucesso; no erro, mantém o estado e deixa o watchdog resolver.
- **Membro em modo grupo com "Auto aceitar convite de party" desligado nunca aceitava o convite** — travando o time inteiro, sem pista nenhuma na tela (o líder ainda tomava "ninguém aceitou a tempo" 3 vezes e se desligava sozinho). No modo "Em grupo" o convite de caçada agora é aceito independente desse toggle de outra aba.
- **Comparação de nomes de personagem** entre a lista do time e o estado reportado passou a normalizar acento em forma Unicode diferente (NFD x NFC), espaço duplo e espaço não-quebrável. Antes, uma diferença invisível fazia o líder concluir que o membro "não faz parte da sincronização" e **retomar cedo**, mandando o convite enquanto o membro ainda estava vendendo.

### Bugs de robustez

- **`queryVisible()` só testava o PRIMEIRO match** e então checava visibilidade. Como o Angular do jogo nunca remove modal do DOM (só esconde via CSS), bastava existir uma cópia escondida antes da visível pra função devolver "não existe". Isso atingia até o **`isHunting()`** — a checagem de estado mais importante do arquivo; um falso negativo faz o bot achar que não está caçando e tentar iniciar caçada em loop. Agora procura o primeiro **visível** entre todos os matches.
- **"Nada pra vender" x "o modal não abriu" eram indistinguíveis**: uma falha de UI virava venda fantasma que, no modo grupo, liberava a sincronização do time **com a bag cheia** (e a capacidade estourando de novo no ciclo seguinte). Agora falha de UI é erro de verdade.
- **O modal de "Detalhes da caçada" ficava aberto quando dava timeout** — e como ele é lido logo antes de "Sair da caçada", o modal bloqueava esse clique. Os 3 ciclos seguintes falhavam igual e a automação se desligava sozinha. Agora fecha sempre.
- **`leaveHunt()` seguia em frente sem ter clicado em nada** quando não achava o botão, esperava 20s à toa e dava um erro enganoso ("Cliquei em Sair da caçada, mas...").
- **Trocar a caçada no menu lateral não tinha efeito** enquanto o ciclo rodava: a retomada usava só a caçada anterior (de um cache que nunca era invalidado), voltando pra caçada antiga indefinidamente. Agora a caçada configurada tem prioridade, e o cache é limpo ao desligar a automação.
- **Os erros mais importantes não notificavam no Telegram**: `Erro: ...` do loop principal e "3 erros seguidos — desligando a automação" eram os **únicos** logs de falha sem a flag de erro. Ou seja, "não achei o menu do amigo" notificava, mas "a automação morreu" não.

### Regra do projeto que estava sendo violada

- **Todo clique real agora passa por `humanClick()`** (delay randômico anti-detecção). O loop que roda 24/7 — abrir seletor, escolher caçada, escolher tier, **iniciar caçada**, sair da caçada, vender, confirmar venda, fechar modais — era 100% `.click()` instantâneo; só as features de Party respeitavam a regra. Justamente o padrão mais óbvio de bot era o que não tinha proteção nenhuma.
  - Cuidado tomado: `clickHuntEntry`/`selectPullTier` viraram async, então **não podem** mais ser usados como predicado de `waitFor` (Promise é sempre truthy — bug silencioso). Os chamadores agora esperam pelo `findHuntEntry`/`findPullTier` (síncronos) e clicam depois.

### Validação

- `node --check` nos dois arquivos + JSON do manifest válido.
- Suíte de teste da lógica nova rodada fora do jogo (11 casos, todos passando): trava de venda única por ida à cidade, reset ao voltar a caçar, respeito ao toggle, não vender fora da cidade, e as regras de normalização de nome / `allReady` da sincronização do time.

## 0.9.14 — 2026-09-09

- **CAUSA RAIZ REAL do "modo Em grupo continua iniciando caçada solo" — achada pelo log.** Depois de 4 versões tentando corrigir isso no lugar errado, o André mandou o histórico da conta:
  > `Erro ao iniciar: Não consegui confirmar que a caçada "Dragon Lair" iniciou.` / `Automação ligada. Garantindo que a caçada configurada está ativa...`

  Essas duas linhas só existem em `startBot()` — a função que roda quando você clica **"Ligar automação"** —, não em `monitorTick()`. E o `startBot()` tinha uma **cópia própria** da lógica de iniciar caçada: chamava `ensureHunting(cfg)` direto, **sem olhar `huntMode`, sem olhar `isPartyLeader` e sem passar `useTeamButton`**. Ou seja, pra uma conta líder no modo "Em grupo", clicar "Ligar automação" sempre clicava **"Iniciar caçada" (SOLO)** — e todos os fixes das v0.9.10/v0.9.12 foram no `monitorTick()`, que só roda depois. Por isso "continuava igual" a cada teste.
  - **Fix**: `startBot()` não duplica mais nada — só liga o estado e chama `startMonitoring()`, que já invoca `monitorTick()` na hora. Agora existe **uma única lógica de verdade** pra iniciar caçada (solo x grupo, líder x membro, stamina, botão do time, tratamento de diálogo), em vez de duas cópias divergentes.
  - No modo "Em grupo", ligar a automação sem caçada configurada deixou de ser bloqueado — isso só importa pro líder (quem manda o convite); membro não precisa de caçada nenhuma pra ficar esperando o convite.
- **Entendimento corrigido do diálogo "Quer começar sem o time?".** A hipótese da v0.9.11 (membro não elegível / level mínimo) estava **errada**. O diálogo é a pergunta natural do jogo quando **o LÍDER de uma party tenta começar uma caçada sozinho** — ou seja, ele aparece no caminho SOLO, exatamente onde a v0.9.11/v0.9.13 não olhavam (a checagem estava atrás de `if (useTeamButton)`).
  - **Tratamento agora depende da intenção**: se a automação queria caçada **em grupo** e mesmo assim caiu nesse diálogo, ela clica "Cancelar" e reporta erro (nunca inicia sozinha); se queria caçada **solo mesmo** (modo Solo numa conta que é líder de party), ela clica "Iniciar sem o time" e segue — que é a resposta correta, em vez de travar esperando uma caçada que nunca começa. Esse segundo caso era um bug latente: qualquer conta em modo Solo que fosse líder de uma party ficava presa nesse diálogo.
- Aviso de "líder sem caçada configurada" agora tem throttle de 5min (o monitor roda a cada 4s — sem isso viraria spam no histórico).

## 0.9.13 — 2026-09-09

- **Fix: a detecção do diálogo "Quer começar sem o time?" (v0.9.11) não estava funcionando de verdade.** André testou com a Kina (líder) + Najwizzy em Dragon Lair de novo depois da v0.9.12 e reportou "continua do mesmo jeito" — o print mostrou a caçada travada em "Iniciando caçada" com o diálogo aberto, sem eu cancelar nada. Causa provável: a v0.9.11 procurava um elemento cujo texto batesse EXATAMENTE com a frase inteira "Quer começar sem o time?", transcrita de um PRINT (não extraída do DOM real) — qualquer diferença mínima de espaço/acento/pontuação, ou a frase estar quebrada em mais de um nó de texto no HTML real, já é suficiente pra nunca dar match.
  - **Fix** (`findTeamStartFallbackDialog()`, `automation/content-injected.js`): troquei a estratégia — em vez de casar a frase inteira, procura direto o botão **"Iniciar sem o time"** (rótulo curto e bem mais específico) e confirma que é o diálogo certo achando um botão "Cancelar" num ancestral próximo. Mais resistente a diferença de estrutura da frase.
  - **Ainda sem inspeção de DOM/classe ao vivo** — a próxima vez que esse diálogo aparecer com a conta parada na cidade, vale eu confirmar o HTML de verdade (`Inspecionar elemento`) pra fechar de vez essa pendência, em vez de continuar só com texto de botão visto em print.
  - **Enquanto isso não é confirmado**: se aparecer de novo, dá pra clicar "Cancelar" manualmente sem problema (é sempre a ação segura) — nunca "Iniciar sem o time".
- **Observação à parte (não mexida)**: durante a investigação, a aba do Dezin Zemsta mostrou um diálogo real "Seguir o líder da party" de uma OUTRA party (Amoxicilina/Santizao, não a Kina) — não toquei nele. Se isso não era esperado, vale conferir se o Dezin entrou numa party de terceiros sem querer (ex: aceite automático de convite de party pegando um convite de fora da allowlist, ou allowlist vazia).

## 0.9.12 — 2026-09-09

- **Revisão de design: o líder agora INICIA a caçada em grupo, não só espera.** André, depois de eu confirmar ao vivo (v0.9.11) que "Iniciar com o time" manda um convite de verdade, apontou que ainda estava bugado: "no caçada existem dois botões SOLO e em Grupo. o que você precisa arrumar e fazer iniciar a caçada em grupo é no botão em grupo". A decisão da v0.9.9 ("Ligar automação" NUNCA inicia sozinha em modo grupo, pra sempre depender de convite/entrada manual) foi tomada ANTES de saber que esse botão funciona de verdade — agora que está confirmado, faz sentido reverter só essa parte pra quem é líder.
  - **O que muda** (`automation/content-injected.js`, `monitorTick`): no modo "Em grupo", se a conta está marcada como **líder da party** (checkbox "Esta conta é a líder da party" da aba Party) e tem stamina suficiente, "Ligar automação" agora abre a "Caçada"/"Tamanho do pull" configurados na aba Caçada e clica "Iniciar com o time" de verdade — mandando o convite pro time de verdade, igual ao teste ao vivo. Contas marcadas como líder passam a USAR "Caçada" e "Tamanho do pull" de novo nesse modo (antes eram ignorados).
  - **Quem NÃO é líder continua exatamente como antes**: só espera o convite chegar (aceite automático já cuidava disso desde antes) e monitora capacidade depois de já estar caçando — sem essa opção, porque o próprio jogo só deixa o líder da party iniciar.
  - **Textos da aba Caçada atualizados** (`renderer/renderer.js`, `huntModeHintText()`) pra refletir o comportamento novo, diferenciando líder de não-líder — a versão antiga dizia "NUNCA inicia sozinha" pra qualquer conta no modo grupo, o que não é mais verdade pro líder.
  - Usa o mesmo tratamento do diálogo "Quer começar sem o time?" e o timeout de 60s da v0.9.11 — se o time não for elegível pra caçada escolhida, cancela e loga erro em vez de travar ou cair pra solo.
  - Sem confirmação ao vivo ainda deste fluxo específico (líder auto-iniciando ao ligar a automação) — o teste da v0.9.11 foi com o clique manual guiado por mim; o gatilho automático precisa ser validado na prática.

## 0.9.11 — 2026-09-09

- **"Iniciar com o time" CONFIRMADO AO VIVO com clique real** — testado no Dezin Zemsta (líder, Lv357) em party com a Kina Zemsta (Lv125), hunt "Rat Cellars": o clique abriu de verdade o popup nativo "CONVITE DE CAÇADA EM GRUPO" ("1 de 2 aceitaram") e, depois de aceito, a caçada sincronizou os dois personagens de verdade na mesma instância (XP contando pros dois, `ALVO: Seguir Kina Zemsta` setado sozinho no líder). Confirma que o mecanismo do fix da v0.9.10 (clicar "Iniciar com o time" em vez de "Iniciar caçada") está certo.
- **Fix: novo diálogo "Quer começar sem o time?" agora é tratado em vez de travar/cair pra solo.** André reportou (mesma conta Kina, mas líder de party com Najwizzy Zemsta Lv77, tentando "Dragon Lair"): "o em grupo está selecionado e a caçada iniciada foi solo" — investigando, apareceu um SEGUNDO diálogo que o v0.9.10 não conhecia: "INICIAR CAÇADA / Líder da party / Quer começar sem o time? / Cancelar / Iniciar sem o time". Suspeita mais forte (não 100% confirmada): aparece quando algum membro da party não é elegível pra caçada escolhida (ex: level mínimo — Najwizzy Lv77 pode não bater o requisito do Dragon Lair). Sem tratamento, a automação ficava travada esperando a caçada confirmar (nunca confirmava) até o André clicar manualmente em "Iniciar sem o time" pra destravar — e esse clique manual é o que iniciou a caçada solo, não um bug do clique em "Iniciar com o time" em si.
  - **Fix** (`ensureHunting()`, `automation/content-injected.js`): depois de clicar "Iniciar com o time", a automação agora também vigia esse segundo diálogo (`findTeamStartFallbackDialog()`, detecção por texto exato "Quer começar sem o time?" — ainda sem confirmação de classe/seletor DOM ao vivo). Se ele aparecer, clica "Cancelar" (nunca "Iniciar sem o time") e devolve um erro claro no log explicando que pelo menos um membro do time não parece elegível — em vez de travar pra sempre ou iniciar sozinho sem avisar.
  - **Timeout de espera maior pra convite de grupo**: como o convite real depende de outra pessoa aceitar (não é instantâneo — no teste ficou "1 de 2 aceitaram" por alguns segundos), o tempo de espera por `useTeamButton` subiu de 25s pra 60s antes de considerar que a caçada não iniciou.
  - **Pendência**: o seletor do diálogo "Quer começar sem o time?" foi confirmado só pelo TEXTO visto na tela (relatado pelo André), não por inspeção de DOM/classe ao vivo — se o jogo mudar o texto exato, o tratamento novo simplesmente para de detectar (sem risco de clicar errado, só volta a cair no timeout antigo). Falta também confirmar 100% que a causa é level mínimo (não testado com um time nivelado tentando Dragon Lair).

## 0.9.10 — 2026-09-09

- **Fix (provável causa raiz): "Modo de caçada" (em grupo) e "Sincronizar venda de loot em grupo" não funcionavam de verdade.** André reportou "as ultimas features que implementamos não está funcionando adequadamente" e sugeriu mapear tudo; enquanto investigávamos ao vivo (só-leitura, personagem Druid Dezin Zemsta em party com a Kina Zemsta) como o convite de caçada em grupo é enviado de verdade, apareceu a causa mais provável antes de terminar o mapeamento completo — e o André pediu pra entregar essa correção primeiro: "antes de fazer a varredura entregue a melhoria de caçada em grupo".
  - **Descoberta ao vivo (09/09/2026)**: a janela de escolha de caçada (`.hunt-window`) tem TRÊS botões de confirmar no rodapé, não um só — "Iniciar caçada" (solo — o único que a automação conhecia até agora), "Iniciar com o time" (novo — é esse botão que de fato manda o convite de caçada em grupo pros outros membros da party) e "Completar o time" (ainda não investigado nem usado — provavelmente convida gente de FORA da party até completar o tamanho do pull; fica fora do escopo por enquanto).
  - **Causa raiz**: `resumeGroupHuntAfterSync()` (`automation/content-injected.js`, disparado pelo app quando todo o time termina de vender o loot em grupo) chamava `ensureHunting()` sem indicar que precisava do botão de time — então sempre clicava em "Iniciar caçada" (solo). Toda a lógica de espera/sincronização entre contas (líder esperando o time, membros esperando o convite) rodava certinho por dentro, mas nenhum convite de verdade saía pra ninguém, porque o botão errado era clicado.
  - **Fix**: `clickConfirmButton()`, `pickAndStartHunt()` e `ensureHunting()` agora aceitam um parâmetro `useTeamButton` — quando `true`, procura "Iniciar com o time" (ou "Trocar com o time" como variante de troca de caçada já em andamento) em vez do botão solo. `resumeGroupHuntAfterSync()` passa `useTeamButton: true`; todas as outras chamadas (retomada solo normal, ciclo de sair/vender/voltar do modo Solo) continuam chamando sem esse parâmetro, então nada muda pra quem usa só o modo Solo.
  - **⚠️ Ainda sem confirmação ao vivo do fluxo completo**: o clique no botão "Iniciar com o time" nunca foi testado de ponta a ponta dentro do ciclo automático real (só foi visto existindo na tela, sem clicar — regra do projeto proíbe clicar ação real durante investigação). O texto "Trocar com o time" pro caso de já estar caçando é uma suposição por simetria com "Trocar de caçada", não confirmado ao vivo. Vale acompanhar de perto o primeiro ciclo de sincronização de verdade depois de atualizar — deve aparecer o convite de fato chegando pros membros do time.
  - **"Completar o time" continua fora do código**, de propósito — função ainda não confirmada.

## 0.9.9 — 2026-09-09

- **"Modo de caçada" (Solo / Em grupo) — separa de vez a caçada solo da caçada em grupo.** André, depois de perceber que a v0.9.8 linkava a sincronização de loot ao mesmo botão "Ligar automação" da caçada solo, pediu: "o ligar automação não pode estar linkado direto com a caçada solo. inclusive devemos ter uma funcionalidade caçada solo e caçada em grupo para que as coisas funcionem independentes sem conflitos". Decisões confirmadas via AskUserQuestion: um seletor único por conta (nunca os dois modos ao mesmo tempo — elimina conflito por construção), e no modo "Em grupo" a automação nunca tenta iniciar uma caçada sozinha, nem como plano B depois de esperar — só entra caçando por convite aceito ou entrada manual seguida.
  - **Novo controle "Modo de caçada"** no topo da aba Caçada: "Solo" (padrão — comportamento de sempre, sem nenhuma mudança) ou "Em grupo". Substitui o toggle avulso "Sincronizar venda de loot em grupo" da v0.9.8 — contas que já tinham ele ligado migram automaticamente pro modo "Em grupo" na primeira leitura do storage, sem precisar reconfigurar.
  - **O que muda no modo "Em grupo"** (`automation/content-injected.js`, `monitorTick`): a automação para de tentar "Iniciar caçada" sozinha quando o personagem não está caçando — só fica esperando, com o painel mostrando "Aguardando caçada em grupo". "Tamanho do pull", "Voltar a caçar com stamina" e a caçada selecionada ficam sem efeito nesse modo (só valem no Solo); "Sair quando capacidade ≤" continua valendo nos dois modos, porque é o gatilho que ainda dispara o ciclo sair/vender/sincronizar/retomar (mesma lógica da v0.9.8, só que agora amarrada ao modo em vez de um toggle à parte).
  - Pra começar a primeira caçada em grupo, ainda precisa entrar nela manualmente (ou aceitar um convite) — daí em diante a automação assume o ciclo. Isso é intencional (decisão confirmada: sem fallback automático) — não inventa um jeito de auto-iniciar caçada em grupo, que continua fora do escopo.
  - Sem confirmação ao vivo ainda.

## 0.9.8 — 2026-09-09

- **Nova feature: sincronizar venda de loot em grupo.** André pediu: "sempre que os membros sairem da caçada por falta de cap, todos devem vender o loot da cidade e só aceitam o novo convite do membro principal depois que todos venderem o loot" — e ajustou em seguida: "deveria ser uma feature separada e não da caçada principal... dentro de party, tem que ter uma opção pra checar e isso funcionar combinado com a caçada em party". Decisões confirmadas via AskUserQuestion: membro (não-líder) para de tentar voltar sozinho e só espera o convite; líder também espera o time inteiro terminar de vender antes de retomar (é a retomada dele que dispara o convite pros outros); "o time" é a mesma lista de "Personagens do time" já usada no auto-convite de party (v0.9.6).
  - **Novo toggle "Sincronizar venda de loot em grupo"** na aba Time (junto dos outros campos de time, v0.9.6) — feature própria, desligada por padrão, sem efeito nenhum no ciclo normal de sair/vender/voltar quando desligada. **Precisa estar ligada em TODAS as contas do time** (líder + cada membro) pra funcionar — uma conta com o toggle desligado simplesmente não entra na sincronização (nem bloqueia as outras, nem espera ninguém).
  - **Como funciona** (`automation/content-injected.js`): quando a capacidade bate o limite configurado e o toggle está ligado, depois de vender o loot na cidade — a conta-líder fica esperando (`groupHuntSyncStatus: "leaderWaitingTeam"`, painel mostra "Aguardando o time") em vez de retomar a caçada sozinha; cada conta-membro fica esperando também (`"memberWaitingInvite"`, painel "Aguardando convite") em vez de tentar voltar a caçar por conta própria.
  - **Coordenação entre contas** (`renderer/renderer.js`, `checkGroupHuntTeamReady()`): como cada conta roda isolada no próprio webview, quem enxerga o estado de todas as contas ao mesmo tempo é o app principal — sempre que qualquer conta reporta uma mudança de estado, o app confere se a conta-líder está esperando o time e se todo mundo configurado como time já vendeu; quando sim, manda um comando `resumeGroupHunt` só pra ela. A retomada da líder é o que dispara o convite de caçada em grupo pros outros de verdade (mecanismo já existente do próprio jogo) — os membros aceitam esse convite normalmente pelo fluxo que já existia (auto aceitar convite de caçada em grupo).
  - **Limite conhecido, documentado de propósito**: se uma conta do time não estiver aberta no app no momento, ou estiver com o toggle desligado, ela não conta pra sincronização (a líder não fica travada esperando por ela pra sempre) — mas também não tem como avisar visualmente disso ainda; se o time não retomar a caçada, vale conferir se todas as contas configuradas em "Personagens do time" estão abertas E com "Sincronizar venda de loot em grupo" ligado.
  - Sem confirmação ao vivo ainda — depende do André testar com o time de verdade em caçada em grupo.

## 0.9.7 — 2026-09-09

- **Fix: janela de amigos ficava aberta depois do time já estar completo.** André reportou: "quando o bot identificar que está na party, deve fechar a janela de amigos". `tryAutoInviteParty()` (`automation/content-injected.js`) só fechava a janela de amigos no `finally` de quem a tinha aberto NESSE mesmo ciclo (`if (!alreadyOpen) closeFriendsWindow()`) — se ela ficasse aberta de um ciclo anterior (por exemplo, o alvo aceitou o convite rápido demais, antes desse `finally` rodar de novo), nenhum ciclo seguinte fechava ela, porque o caminho "todo mundo já está na party" (`if (!missing.length) return`) simplesmente retornava sem tocar na janela.
  - **Fix**: agora, sempre que a checagem de membros confirma que todos os alvos configurados já estão na party, a automação fecha a janela de amigos se ela estiver aberta — independente de ter sido ela mesma a abrir nesse ciclo ou não.

## 0.9.6 — 2026-09-08

- **Nova feature: auto convidar pra Party (convite de caçada em grupo).** André pediu: "eu quero uma feature de convidar pt para ir para caçada no multi hunt. atualmente a gente tem o aceite de party, aceite de caçada. porém não temos o convite de hunt em grupo. o principal da PT poderia ser classificado. inclusive poderiamos ter um auto convite também da Party". Decisões confirmadas via AskUserQuestion: convite totalmente automático (sem precisar clicar toda vez), líder marcado manualmente por conta (não detectado sozinho), e dois toggles separados — um pra marcar "essa conta é a líder", outro pra ligar/desligar o auto-convite.
  - **Nova seção "Time"** na aba Party de cada conta (`renderer/index.html`): checkbox "Esta conta é a líder da party", checkbox "Auto convidar pra party" e um campo de texto com os nomes dos personagens-alvo separados por vírgula (mesmo padrão do campo de allowlist do auto-aceite de convite, v0.7.0).
  - **Como convida** (`automation/content-injected.js`, `tryAutoInviteParty()` + `startAutoInvitePartyWatcher()`): só age quando a conta está marcada como líder E o auto-convite está ligado. Pra cada alvo configurado que ainda não está na party (`getPartyMemberNames()`), abre a lista de amigos (`ensureFriendsWindowOpen()`), procura o personagem (`findFriendRow()`) e clica com o novo `humanRightClick()` (simula um right-click de verdade via `mousedown`/`mouseup`/`contextmenu`, já que `.click()` só faz left-click) pra abrir o menu de contexto e clicar em "Convidar para a party". Fecha a janela de amigos de novo no final. Confirmado por André ao vivo (08/09/2026, personagem Druid) que convidar É melhor pela lista de amigos do que pela tela do personagem — foi o caminho escolhido.
  - **Auto adicionar como amigo**: André pediu de bônus — "se o personagem não estiver na lista de amigos. também adicione na lista de amigos, o que acha?" — se o alvo não aparece na lista, `tryAddFriend()` usa o campo de busca/adicionar (`aria-label="Buscar ou adicionar um personagem"` + botão "Adicionar") antes de tentar convidar.
  - **⚠️ Ainda sem teste ao vivo de um convite de verdade sendo enviado.** Toda a investigação dos seletores (lista de amigos, menu de contexto, botão "Convidar para a party", campo de adicionar) foi feita só-leitura no Druid do André (conta logada, mas em party no momento — regra do projeto proíbe clicar ação real durante investigação). Na primeira vez que "Auto convidar pra party" for ligado de verdade, vale acompanhar de perto: deve aparecer no log "Convite de party enviado automaticamente pra `<nome>`" e o alvo precisa realmente receber/aceitar o convite no jogo.
  - **Fora do escopo desta versão, de propósito**: convite de Caçada em Grupo (Group Hunt) em si — só dava pra investigar os seletores com o personagem FORA de uma party, e o André estava em party durante a sessão ("a caçada em grupo esse não vai dar para você validar, pois meu personagem está em party agora"). Fica pendente pra quando ele puder testar sem estar em party.

## 0.9.5 — 2026-09-08

- **Auto-resume mais rápido.** André confirmou que a v0.9.4 já retoma sozinho, mas achou lento: "está demorando cerca de 30 segundos, não da para ser mais rápido?". `startResumeSessionWatcher()` (`automation/content-injected.js`) agora checa a tela de seleção IMEDIATAMENTE ao iniciar (antes só o primeiro tick do `setInterval`, que só dispara depois do intervalo inteiro passar, já consumia um tempo à toa) e o intervalo de repetição caiu de 5s pra 1.5s — a checagem em si é barata, não tinha motivo real pra ser tão espaçada. Parte da demora reportada pode continuar sendo o próprio carregamento do jogo depois do clique em "Jogar" (fora do nosso controle) — isso já fica registrado no log quando acontece.
- **Fix: "Tamanho do pull" ficava vazio pra sempre em algumas caçadas.** André mandou print do painel de "Ghoul Graveyard" com o dropdown de tamanho do pull sem nenhuma opção, e reportou: "isso já deveria ser mapeado e salvo para não ficar falhando" — com razão, o cache de tiers por caçada (`hm_hunt_catalog_v1`, v0.9.0) já existia exatamente pra isso, mas tinha um bug que o deixava inútil nesse caso.
  - **Causa**: quando o scrape ao vivo não achava os botões de tier a tempo (jogo lento pra renderizar, timeout de 4s curto demais), `peekHuntTiers()` salvava um array VAZIO no cache mesmo assim — e um array vazio é "truthy" em JS, então o próximo pedido via `if (cached.tiersByHunt[huntName])` achava que "já sabia" o resultado (vazio) e nunca mais tentava buscar de novo. Só um "Atualizar" manual (forceRefresh) resolvia, e mesmo assim voltava a travar se falhasse de novo.
  - **Fix** (`automation/content-injected.js`, `peekHuntTiers()`/`requestTiersAndSend()`): só considera "já mapeado" um cache com PELO MENOS 1 tier de verdade — cache vazio ou ausente sempre tenta buscar ao vivo de novo, e só grava no cache quando o scrape realmente trouxe alguma coisa. Timeout de espera pelos tiers também subiu de 4s pra 6s (margem extra pro render atrasar um pouco), e uma falha de verdade agora vira um aviso no log em vez de silenciosamente ficar vazio.
  - Sobre "e ali poderia ser dificuldade" (sugestão do André no mesmo print): entendi como uma observação sobre o que o campo representa, não um pedido concreto de renomear "Tamanho do pull" — não mexi no rótulo por enquanto; avisa se quiser mudar pra "Dificuldade" de verdade.
  - **Sem confirmação ao vivo ainda** — depende do André selecionar "Ghoul Graveyard" (ou outra caçada que travou vazia antes) de novo e ver se o dropdown popula dessa vez, e confirmar se o auto-resume ficou visivelmente mais rápido.

## 0.9.4 — 2026-09-07

- **Fix: v0.9.3 continuava parada na tela de seleção de personagem.** André testou e mandou print: as duas contas (1 personagem cada, "Online há menos de uma hora") continuavam com "Jogar" disponível mas ninguém clicava sozinho — precisou clicar manualmente nas duas de novo.
  - **Causa — problema de "ovo e galinha"**: a v0.9.3 só preenche `autoResumeSessionCharacter`/liga o toggle sozinha DEPOIS que `startCharacterNameWatcher()` observa um personagem já DENTRO do jogo pelo menos uma vez rodando essa versão. Na primeira vez que a tela de seleção aparece pra uma conta (app recém-atualizado, ou conta nunca vista por essa automação) não existe nome nenhum salvo ainda pra clicar — a auto-configuração e o auto-clique nunca se encontravam.
  - **Fix** (`automation/content-injected.js`, `tryAutoResumeSession()`): quando a automação ainda não foi ligada, não foi desligada manualmente antes, e não tem personagem configurado, mas a tela de seleção mostra **exatamente UM personagem na lista**, não tem ambiguidade nenhuma sobre "qual é o do último login" — adota esse personagem na hora (liga o toggle + salva o nome) e já clica "Jogar" nele, sem depender de nenhum login manual prévio pra "ensinar" a conta primeiro. Com 2+ personagens na lista continua exigindo configuração manual (ou um primeiro "Jogar" manual, que a partir da v0.9.3 já fica lembrado pra próxima) — sem tentar adivinhar qual foi jogado por último quando há mais de uma opção.
  - Aproveitado pra fechar uma fresta na v0.9.3: o "freio de mão" (`autoResumeSessionManuallyDisabled`) agora é checado ANTES de decidir clicar em qualquer coisa, então uma conta que o André desligou manualmente nunca mais é tocada por engano, mesmo que já tenha um nome salvo de antes.
  - **Sem confirmação ao vivo ainda** — depende do André fechar e reabrir o app com essas mesmas duas contas (1 personagem cada) e ver se agora resolve sozinho, sem precisar clicar em nada.

## 0.9.3 — 2026-09-07

- **"Retomar sessão automaticamente" passa a se configurar sozinho, por conta.** André: "a opção de login. quando abre o app, não loga e fica parado na tela de login. ao abrir o app, pode logar as contas autenticadas nos personagens de ultimo login. por isso eu digo que precisamos salvar as configurações de ultima sessão, principalmente quando fechar o app". Confirmado via `AskUserQuestion` (escolhida a opção "Ligar por padrão + lembrar sozinho"): a automação de retomar sessão já existia (v0.8.0/v0.9.0) mas era opt-in por conta — precisava abrir o painel, ligar o toggle e digitar o nome do personagem na mão em cada uma das até 4 contas. **Escopo continua exatamente o mesmo de sempre** (ver `huntera-automacao/CLAUDE.md` pro histórico completo dessa exceção): só clica "Jogar" numa sessão JÁ AUTENTICADA que aparece na tela de seleção de personagem — nunca mexe em email, senha, "Trocar de conta" ou "Sair da conta". O que muda é só COMO a conta decide ligar o toggle e qual personagem usar, não O QUE o clique automático faz.
  - `automation/content-injected.js`: o watcher `startCharacterNameWatcher()` (novo na v0.9.2, antes só reportava o nome pro rótulo da conta) agora também salva esse nome como alvo do "retomar sessão" (`autoResumeSessionCharacter`) e liga o toggle sozinho (`autoResumeSessionEnabled = true`) toda vez que um personagem loga de verdade naquela conta — automaticamente "lembra" o último personagem jogado, sem precisar digitar nada.
  - **Freio de mão** (`autoResumeSessionManuallyDisabled`, novo campo no `DEFAULT_STATE`): se o André desligar o toggle manualmente pra uma conta específica (ex: uma conta que ele não quer que auto-resuma), essa flag liga e o preenchimento automático PARA de reativar o toggle daquela conta — só volta a mexer sozinho se ele ligar o toggle na tela de novo manualmente. Sem essa flag, a automação ficaria "brigando" com uma decisão explícita dele.
  - Como o campo `autoResumeSessionCharacter`/`autoResumeSessionEnabled` já ficava salvo em `localStorage` por conta (dentro da própria partição do Electron, sobrevive a reiniciar o app — não precisou de storage novo), na prática isso já resolve o pedido de "salvar a configuração de última sessão": assim que uma conta loga com um personagem uma vez, da próxima vez que o app abrir ela mesma tenta retomar sozinha, sem exigir que o André tenha fechado o app de um jeito especial.
  - **Sem confirmação ao vivo ainda** — depende do André: (a) fechar e reabrir o app com contas que já jogaram pelo menos uma vez, e ver se a tela de seleção de personagem é resolvida sozinha; (b) testar desligar manualmente numa conta específica e confirmar que ela para de tentar até ele ligar de novo.

## 0.9.2 — 2026-09-07

- **Fix crítico (regressão da v0.9.1): ativar/desativar o modo grade estava deslogando as contas.** André reportou ao vivo logo depois da v0.9.1: "temos um bug, a posição da janela do personagem ainda não altera. quando ativa e desativa o multi janelas, está deslogando os personagens. como se fosse abrindo outro navegador, não sei". Os dois sintomas tinham a mesma causa: a v0.9.1 reordenava os `<webview>` no modo grade chamando `containerEl.appendChild(wv)` a cada render — e mover um `<webview>` do Electron pra outra posição na árvore do DOM faz a guest view por trás dele RECARREGAR DO ZERO (comportamento conhecido do Electron, não é um reflow normal de elemento). Daí a sensação de "abriu outro navegador" (a sessão em memória se perde, joga de volta pra tela de seleção de personagem — o login/cookie da conta continua válido, só a página recarrega) e também por que a posição "não alterava de verdade": o recarregamento disfarçava o efeito.
  - **Fix** (`renderer/renderer.js`, `renderWebviews()`): trocado `containerEl.appendChild(wv)` por `wv.style.order = index` (índice da conta em `tabs`) — a propriedade CSS `order` funciona em CSS Grid do mesmo jeito que em Flexbox, muda só a posição VISUAL da célula sem tocar em nada da árvore do DOM, então o `<webview>` nunca é removido/reinserido e a guest view nunca recarrega. Cobre os layouts de auto-placement (1/2/4 contas); o layout de 3 contas continua usando `grid-area` explícito via classe (`.gridSlotMain/B/C`), que ignora `order` e nunca teve esse problema.
  - **Lição pro projeto**: qualquer mudança futura que mexa em `<webview>` já anexado ao DOM (mover, remover, reanexar) precisa considerar esse comportamento do Electron antes de implementar — nunca mover o nó em si, só propriedades visuais (CSS) que não disparam reload.
  - **Também nesta versão — André: "mostrar o nome do personagem logado e não Conta 1, Conta 2 por exemplo"**: a lista de contas na barra lateral trocava o rótulo padrão (`Conta N`) pelo nome do personagem assim que ele loga de verdade — mas só enquanto o rótulo ainda for o padrão gerado automaticamente; se o André já renomeou a conta manualmente antes, o nome dele nunca é sobrescrito.
    - `automation/content-injected.js`: `sendState()` agora sempre manda `characterName` (lido do mesmo header já usado em `getActiveCharacterName()`, `null` fora do jogo). Novo watcher leve `startCharacterNameWatcher()` (poll de 3s, só compara com o último nome reportado) manda o estado de novo assim que o personagem muda (logou, trocou de personagem, voltou pra seleção) — sem isso o rótulo só atualizaria por acaso, no próximo evento de log/config.
    - `renderer/renderer.js`: o handler de `ipc-message` (`hm:state`) troca `tab.label` pelo `characterName` recebido quando o rótulo atual ainda bate com o padrão `Conta N`, persiste e re-renderiza a lista.
  - **Sem confirmação ao vivo ainda** — depende do André: (a) reordenar contas com o modo grade ligado de novo e confirmar que a posição muda SEM deslogar; (b) conferir se o nome do personagem aparece na lista assim que uma conta termina de logar.

## 0.9.1 — 2026-09-07

- **Fix: reordenar a conta na lista não movia ela na visualização em grade.** André testou a v0.9.0 e reportou: "deu certo, mas a visualização no jogo não altera, precisa implementar isso também. caso altere a posição da conta, altere a posição na tela também" — o drag-and-drop já reordenava a lista de contas na barra lateral e persistia certinho, mas os elementos `<webview>` no modo grade (⊞ "Ver juntas") ficavam nas posições antigas.
  - **Causa**: `ensureWebview()` só anexa cada `<webview>` ao container UMA vez, na hora em que a conta é criada — nunca mais mexe na posição dele no DOM depois disso. No modo grade com **1, 2 ou 4 contas** (`renderer/styles.css`, `#webviewContainer.grid.count-1/2/4`), o CSS Grid posiciona as células por auto-placement, ou seja, pela ORDEM dos elementos no DOM — que continuava sendo a ordem de criação, não a ordem da lista (`tabs`). Só o layout de 3 contas nunca teve esse bug, porque ali a posição de cada webview já é fixada explicitamente por classe (`.gridSlotMain`/`.gridSlotB`/`.gridSlotC`, `renderWebviews()`) em vez de depender de auto-placement. Fora do modo grade o bug também não aparecia, porque lá cada conta cobre o container inteiro (`.active`) e a ordem no DOM não tem efeito visual.
  - **Fix** (`renderer/renderer.js`, `renderWebviews()`): mesmo loop que já percorre `tabs` pra aplicar classes agora também chama `containerEl.appendChild(wv)` pra cada webview, na ordem de `tabs` — `appendChild` num elemento que já está no DOM só move ele pro final, então isso realinha a ordem real dos filhos do container com a ordem da lista sempre que a tela renderiza de novo (drag-and-drop, adicionar/fechar conta, trocar aba ativa).
  - **Sem confirmação ao vivo ainda** — depende do André reordenar contas com o modo grade ligado (2, 3 ou 4 contas) e conferir se a posição na tela acompanha a nova ordem da lista.

## 0.9.0 — 2026-09-07

- **Três pedidos do André na mesma sessão, todos sobre "tudo tem que funcionar de forma fluida e ficar salvo".** Diferente do padrão usual do projeto (implementar na extensão primeiro, portar depois — ver `huntera-automacao/CLAUDE.md`), as três features abaixo nasceram e foram implementadas direto no `huntera-multiconta`, já que são específicas da experiência de múltiplas contas em paralelo (não fazem sentido na extensão de conta única).
  - **Reordenar contas arrastando (drag-and-drop).** André: "eu quero feature no multi account que eu possa escolher a posição das contas... eu quero logar o 3 e poder jogar ele para a visualização da conta, entendeu? tudo salvo, entendeu?". Investigação inicial mostrou que logar uma 3ª/4ª conta sem deslogar as outras já funcionava (cada aba tem sua própria `partition` do Electron, independente — ver `MAX_TABS = 4` em `renderer.js`); o problema real, confirmado via `AskUserQuestion`, era não dar pra escolher a ORDEM das contas na barra lateral. `renderer/renderer.js` (`renderTabs()`): nova alça de arrastar (`.acctDragHandle`, ícone de 6 pontinhos) em cada linha de conta — dedicada, não a linha inteira, pra não brigar com o label `contenteditable` nem com os botões de automação/fechar. HTML5 drag-and-drop nativo (`draggable`, `dragstart`/`dragover`/`dragleave`/`drop`/`dragend`), com uma linha indicadora (`.dragOverTop`/`.dragOverBottom`) mostrando onde a conta vai cair. `reorderTabs()` reordena o array `tabs` e chama `persistTabs()` — a ordem já é salva no arquivo de tabs existente (`window.hunteraFarm.saveTabs`), nada novo precisou de storage. `renderer/styles.css` ganhou os estilos da alça (só aparece no hover da linha) e das linhas de drop; escondida no modo de densidade "Dock" (grade com wrap, onde uma linha topo/baixo não faz sentido — reordenar por lá fica pra outra hora, se pedido).
  - **Cache da lista de caçadas/tiers (sem recarregar toda vez).** André: "a lista de hunt já está ficando salvo? no multiaccount? em um arquivo para que não tenha necessidade de sempre recarregar". Não estava — o `huntera-multiconta` fazia scrape ao vivo toda vez que o painel de automação abria (só tinha um cache em memória, perdido a cada reinício do app), diferente do `huntera-automacao` (extensão) que já cacheia em `chrome.storage.local`. `automation/content-injected.js` ganhou `HUNT_CATALOG_KEY = "hm_hunt_catalog_v1"` em `localStorage` (por conta, já que cada `<webview>` tem sua própria partition/`localStorage`), espelhando o formato `{names, tiersByHunt}` da extensão: `loadHuntCatalog()`/`saveHuntCatalogNames()`/`saveHuntCatalogTiers()`. `scrapeHuntNames()`, `peekHuntTiers()`, `refreshHuntsAndSend()` e `requestTiersAndSend()` agora checam o cache primeiro e só fazem scrape ao vivo se ele estiver vazio (ou se `forceRefresh` for passado). O botão "🔄 Atualizar" do painel de automação (`automationRefreshBtn` em `renderer.js`) sempre força o refresh ao vivo, ignorando o cache — pro André poder puxar caçadas novas do jogo manualmente quando quiser, sem esperar o cache expirar sozinho (não tem expiração automática por enquanto).
  - **Restaurar o último estado do app ao abrir.** André: "uma feature importante é garantir que tudo fique salvo da onde estava o ultimo estado do aplicativo". Vários estados de tela eram deliberadamente "só de tela" até aqui (comentário original no código dizia isso explicitamente) — decisão revertida a pedido dele. `renderer/renderer.js` estende o padrão de `localStorage` com prefixo `hunteraMulticonta:` já usado pro tema/cor/densidade (v0.8.0) pra também guardar: aba ativa (`activeTabId`, salvo em `setActiveTab`/`addTab`/`closeTab`), modo grade (`gridMode`), menu lateral recolhido (`sidebarCollapsed`), lista de contas recolhida (`tabsListCollapsed`) e zoom manual por conta + zoom da grade (`manualZoom`/`gridZoomOverride`, via nova `persistZoomState()` chamada de `adjustZoom()` e do reset de zoom). Tudo é lido de volta logo no início do `init()`, antes da primeira renderização, e reaplicado (classes CSS, seleção da aba, `applyZoomToAll()`) — se a aba salva não existir mais (conta removida enquanto o app estava fechado), cai pra primeira aba disponível em vez de dar erro.
  - **Sem confirmação ao vivo ainda** — depende do André reiniciar o app com essa versão e testar: (a) arrastar contas na lista e ver se a ordem se mantém depois de reiniciar o app; (b) abrir o painel de automação de uma conta e confirmar que a lista de caçadas aparece na hora (sem esperar scrape) numa segunda abertura, e que "🔄 Atualizar" ainda busca a lista atual do jogo; (c) fechar o app com uma aba específica ativa, zoom customizado numa conta, e grade/menu recolhidos, reabrir e conferir se tudo volta igual.

## 0.8.0 — 2026-09-04

- **Nova identidade visual (leão + "Idle Multiaccount") + reorganização por abas + auto retomar sessão — porte direto do protótipo aprovado no canvas de design, sem passar antes pela extensão Chrome.** Mudança de fluxo pedida pelo André no meio da sessão: "o auto retornar sessão tem que estar no multi account, tudo que implementarmos vamos já subir no multi account" — a partir de agora tudo que for implementado sobe pro `huntera-multiconta` imediatamente, em vez de esperar validação ao vivo na extensão primeiro (a diretriz antiga, "implementar em huntera-automacao primeiro, portar depois de validado", foi revisada — ver `huntera-automacao/CLAUDE.md`). Também confirmado explicitamente: "inclusive o novo template/design com a nova identidade visual, pode implementar".
  - **Sistema de tokens de cor (`renderer/styles.css`)**: os ~30 tons de cinza/cor que estavam todos como hex literal espalhados pelo arquivo viraram variáveis CSS (`--bg-app`, `--bg-sidebar`, `--text-primary`, `--accent`, etc.), com um bloco `:root` (tema escuro, valores originais do app — nada mudou visualmente por padrão) + `:root[data-theme="light"]` (tema claro) + `:root[data-accent="sapphire"|"violet"]` (cor de destaque alternativa) — mesmo sistema desenhado e aprovado no protótipo do canvas de design (accent dourado/safira/violeta comparados ao vivo). `--accent-tint-solid`/`--accent-tint-bg` derivados automaticamente via `color-mix()`, só `--accent` precisa trocar. As 6 cores que ficaram literais de propósito (verde/vermelho do botão ligar/desligar automação, preto de fundo do webview) são invariantes por design, mesmo padrão do protótipo.
  - **Tema claro/escuro + cor de destaque + densidade da lista de contas**, tudo com controle próprio na tela: botão ☀️/🌙 na trilha de ícones alterna tema na hora; aba "Aparência" nova em Configurações tem o seletor de tema (segmento Claro/Escuro) + 3 swatches de cor de destaque (Dourado/Safira/Violeta); aba "Contas" nova em Configurações tem o seletor de densidade da lista (Padrão/Compacto/Dock — mesmas 3 variações que o André pediu pra "ver ao vivo" no protótipo antes de aprovar). Preferência é só de tela, guardada em `localStorage` do próprio app (perfil do Electron já persiste isso em disco sozinho entre reinícios — não precisou mexer em `main.js`/`preload.js`/IPC pra isso).
  - **Reorganização em abas** — respondendo aos 3 pontos que o André marcou explicitamente insatisfeito ("Ordem/agrupamento dentro do painel de automação", "Navegação entre telas", "Como as Configurações estão divididas"): o painel de Automação agora tem uma barra de abas Caçada/Party/Histórico (o botão "Ligar/Desligar automação" subiu pra ficar sempre visível, logo abaixo do cabeçalho da conta, em vez de enterrado no meio dos campos); o painel de Configurações ganhou 3 abas — Aparência (nova, ver acima), Contas (nova, densidade da lista), Telegram (conteúdo igual de antes, só realocado). Título "Histórico" removido de dentro da aba (já é redundante com o rótulo da própria aba).
  - **Ícones**: todos os emojis da interface (☰ ⊞ 🤖 ⬇️ ⚙️ 🐺 ⚡ ⟳ ➕) viraram SVG inline (`currentColor`, adaptam à cor do tema/tema claro sozinhos) — mesmo conjunto desenhado na folha de referência do canvas de design. Marca lion (`assets/lion-mark.png`, baixado do protótipo) substituiu o emoji 🐺 na barra lateral; texto da marca trocado pra "Idle Multiaccount" (nome novo que o André definiu, refletindo a visão de projeto mais amplo pra múltiplos jogos idle) — escopo dessa troca ficou limitado ao rótulo visível na barra lateral; o título da janela/processo (`<title>` do HTML, `main.js`) não foi tocado, por ser uma decisão mais estrutural que não foi pedida explicitamente — avisar se quiser estender a troca pra lá também.
  - **Auto retomar sessão (tela de seleção de personagem)** — porte do `huntera-automacao` v0.18.0 (extensão Chrome), a MESMA exceção estreita e permanente à regra "nunca automatizar login/reconexão" (ver `huntera-automacao/CLAUDE.md` pro histórico completo da revisão, confirmada em duas rodadas pelo André). Escopo idêntico: só clica "Jogar" pra um personagem JÁ AUTENTICADO que aparece na lista de seleção — nunca mexe em email/senha/"Trocar de conta"/"Sair da conta"; se o personagem configurado não estiver na lista, não clica em nada. `automation/content-injected.js` ganhou os seletores `characterListItem`/`characterMetaName` (idênticos aos já confirmados ao vivo na extensão), `findCharacterArticle()`, `tryAutoResumeSession()` + `startResumeSessionWatcher()` (poll de 5s, roda sempre, independente do "Ligar automação" — mesmo padrão dos outros watchers sociais já portados na v0.7.0). Diferente da extensão (que sincroniza via `chrome.storage.onChanged`), aqui cada tick simplesmente lê `loadState()` fresco, mesma diferença de arquitetura já documentada pros outros watchers de Party. Config nova (`autoResumeSessionEnabled`, `autoResumeSessionCharacter`) exposta via `applyConfig()`/`sendState()`, com UI própria — toggle "Retomar sessão automaticamente" + campo de texto "Personagem a retomar" — numa seção nova "Sessão" no topo da aba Party do painel de Automação (mesma categoria dos outros toggles ali: convenientes, sempre ligados, independente do bot).
  - **Ícone do app/janela/instalador** (fix — André percebeu que o ícone continuava o genérico do Electron mesmo depois da identidade visual nova): a primeira entrega trocou o brand mark DENTRO do app (barra lateral) mas esqueceu o ícone da JANELA/taskbar e do instalador — ficaram faltando. Gerado `build/icon.ico` (7 resoluções, 16 a 512px) a partir da imagem-fonte original do leão (1024×1024, a mesma que o André enviou, maior qualidade que o `lion-mark.png` de 160×160 usado dentro do app) via Pillow; `package.json` ganhou `build.icon: "build/icon.ico"` (usado pelo electron-builder no `.exe`/instalador); `main.js` ganhou `icon: renderer/assets/app-icon.png` (256px) no construtor do `BrowserWindow` (ícone da janela/taskbar em tempo de execução — os dois lugares são independentes, um não substitui o outro). Ainda não mexe no `<title>` do HTML nem no texto "Huntera Multiconta" do `productName`/título da janela — só o ícone visual. **Fix 2** (André mandou print: cantinhos brancos no ícone): a imagem-fonte original é RGB sólido, sem canal alfa — os "cantos" fora do quadrado arredondado eram pixels brancos de verdade (255,255,255), não transparência; qualquer contexto que não recorta em CSS (janela do Windows, taskbar) mostrava esses quadradinhos brancos. Corrigido gerando alfa a partir da própria imagem (qualquer pixel próximo do branco puro vira transparente, com uma rampa suave na borda pra não serrilhar) antes de montar o `.ico`/PNGs — `build/icon.ico`, `renderer/assets/app-icon.png` e `renderer/assets/lion-mark.png` (o da barra lateral também tinha o mesmo problema, só não aparecia por estar sempre recortado com `border-radius` no CSS) foram regenerados com fundo realmente transparente.
  - **Sem confirmação ao vivo ainda** — depende do André abrir o app com essa versão e (a) conferir que o visual não quebrou em nenhuma tela, (b) testar o toggle de tema/cor/densidade, (c) configurar e testar "Retomar sessão automaticamente" numa conta de verdade (idealmente depois de um "Server save" real, pra ver o clique automático acontecer igual ele pediu no print original), (d) conferir se o ícone novo aparece na janela/taskbar (o do instalador só é visível depois de gerar um build novo com `npm run dist`, não só reabrindo o app via `npm start`). `renderer/CLAUDE.md` equivalente ao do `huntera-automacao` ainda não existe neste projeto — pendência separada, não bloqueia essa entrega.

## 0.7.3 — 2026-09-04

- **Botão manual de checar atualização.** André: "poderia ter um botão manual de check update, coloca por favor. botão de engrenagem e auto update fica no final da barra na esquerda lá em baixo". A checagem automática já existia (10s depois de abrir + a cada 4h, v0.6.0), mas era só silenciosa — sem jeito de checar na hora (ex: logo depois de publicar uma versão nova).
  - Novo botão ⬇️ na trilha de ícones, **movido pro rodapé da trilha junto com o ⚙️ Configurações** (antes ficava agrupado lá em cima com ⊞/🤖) — um `.railSpacer` (`flex:1`) empurra os dois pro final, separados dos botões de "trocar de tela".
  - `main.js`: `checkForUpdatesManually()` chama `autoUpdater.checkForUpdates()` e ouve os eventos (`update-available`/`update-not-available`/`error`) pra devolver uma resposta clara (achou uma versão nova e já começou a baixar / já está na mais recente / erro) — com timeout de segurança de 20s pra nunca deixar o botão "travado". Fora de um build empacotado (`npm start` de desenvolvimento) devolve aviso em vez de tentar checar (não tem instalador pra atualizar). Handlers IPC novos: `app:checkForUpdates`, `app:getVersion`.
  - `preload.js` expõe `checkForUpdates`/`getAppVersion`. `renderer.js`: clicar no botão desabilita ele + gira o ícone (feedback de "checando..."), e o resultado aparece por alguns segundos na pastilha de status da barra de ferramentas (mesmo lugar que mostra "N/4 contas").
  - Sem confirmação ao vivo ainda — depende do André reiniciar o app (mudança em `main.js`/`preload.js`).

## 0.7.2 — 2026-09-04

- **Removida a barra de menu nativa (File/Edit/View/Window/Help).** André: "tem uns botões em cima, file, edit, view e etc... eles não servem para nada. tira por favor". É a barra de menu que o próprio Electron cria sozinho por padrão em toda janela, a menos que a gente explicite que não quer — o app nunca usou nada dela. `Menu.setApplicationMenu(null)` em `main.js`, chamado antes de criar a janela, remove ela por completo (diferente de só "esconder", que ainda reaparece com Alt). Exige reiniciar o app de verdade (mudança no processo principal) — só recarregar a página não é suficiente.

## 0.7.1 — 2026-09-04

- **Botão hamburguer (☰) pra recolher o menu.** André mandou print apontando pro topo da barra lateral: "faz um botão hamburguer para recolher o menu". Novo botão ☰ no topo da trilha de ícones (separado dos outros 3 por uma linha divisória, já que faz uma coisa categoricamente diferente — esconde/mostra o menu inteiro, não troca de tela dentro dele) recolhe o `#sidebar` pra largura 0 (`renderer/styles.css`, `#app.sidebarCollapsed #sidebar`) — dá a tela inteira pro jogo. A trilha continua sempre visível (com o próprio ☰), então sempre dá pra abrir de volta. Não persiste entre reinícios do app, de propósito — mesmo padrão dos outros estados só-de-tela (`gridMode`, zoom).
- **Modo grade (⊞ "Ver juntas") adaptativo por quantidade de contas.** André: "se o usuário está só com duas, o mostrar várias janelas poderia adequar" — antes o modo grade sempre forçava uma grade 2×2 fixa, deixando célula(s) vazia(s) sobrando com menos de 4 contas. Agora o layout muda:
  - **1 conta**: célula única, ocupa tudo.
  - **2 contas**: uma em cima, outra embaixo (1 coluna × 2 linhas) — pedido exato do André.
  - **3 contas**: a conta **ativa** (a selecionada na lista, mesmo com o modo grade já ligado) fica em destaque — maior, ocupando a linha de cima inteira (2fr) — e as outras duas ficam embaixo, divididas lado a lado (1fr cada). Clicar noutra conta na lista promove ela pro destaque na hora.
  - **4 contas**: continua a grade 2×2 igual de sempre, sem mudança.
  - Implementado com `grid-template-areas` em `renderer/styles.css` (`.count-1`/`.count-2`/`.count-3`/`.count-4`) + `renderWebviews()` em `renderer.js` decidindo a classe certa e, no caso de 3 contas, marcando qual `<webview>` é a principal (`.gridSlotMain`) a cada render.
  - Sem confirmação ao vivo ainda — depende do André reiniciar o app.

## 0.7.0 — 2026-09-04

- **5 features portadas do `huntera-automacao` (extensão Chrome) — André: "pode portar todos esses para o multiaccount, essas funções estão funcionando de forma adequada"**: Notificações no Telegram, Auto aceitar convite de party + sincronia com a Friend List, Sincroniza Exura Sio + ALVO com o Tank da party, "Manter a atual" (Seguir o líder da party), Auto aceitar caçada em grupo. Todas as 5 já validadas ao vivo no `huntera-automacao` antes do porte (ver `CLAUDE.md` daquele projeto) — seguindo a diretriz do projeto de implementar/validar na extensão primeiro. Pedido explícito também respeitado: "lembre-se deixe as configurações de forma adequada, organizadas e com um layout limpo" e "esse é importante portar também" (o delay randômico anti-detecção 200ms-1s entre ações).
  - **`automation/content-injected.js`**: seletores DOM idênticos aos já confirmados ao vivo na extensão (`characterHeaderName`, `partyInviteDialog`/`partyInviteMsg`, `groupHuntInviteDialog`, `inviteRosterItems`/`Role`/`Name`, `followLeaderDialog`, `characterVocation`, `targetStrategySelect`, `hotbarSlots`/`hotbarSpellIcon`, `actionEditor` e afins). Novas funções portadas: `humanClick`/`randomClickDelayMs` (atraso randômico 200-1000ms antes de todo clique de ação real — pedido explícito do André, mesmo padrão anti-detecção já usado na extensão), `setSelectValue`, `getActiveCharacterName`, `parseInviterName`/`isInviterAllowed`/`tryAutoAcceptParty`, `parseGroupHuntStarterName`/`tryAutoAcceptGroupHunt`, `getGroupHuntInviteRoster`/`findEkInRoster`/`getActiveCharacterVocation`/`setHealTargetToEK`/`setFollowTargetToEK`/`syncHealAndTargetToEK`/`syncEkTargetIfNeeded`/`tryAutoSyncEkTarget`, `tryAutoKeepCurrentTarget`. Três watchers (`startPartyInviteWatcher` 1.2s, `startEkSyncWatcher` 1.5s, `startFollowLeaderWatcher` 1.2s) rodam a partir do `boot()`, **independente do "Ligar automação"** — mesmo comportamento da extensão (conveniência social, não depende do bot de caçada). Diferença de arquitetura em relação à extensão: em vez de reagir a `chrome.storage.onChanged`, cada tick lê `loadState()` fresco — mais simples aqui porque a config só muda via `applyConfig()` no mesmo contexto JS (não tem processo separado tipo o service worker/sidepanel da extensão).
  - **Telegram**: `main.js` ganhou `telegram.json` (mesmo padrão do `tabs.json`) + `loadTelegramConfig`/`saveTelegramConfig`/`sendTelegramMessage` (fetch nativo do Node, chamado do processo principal — nunca do preload do webview, pra não esbarrar na CSP da página do jogo) + handlers IPC `telegram:load`/`telegram:save`/`telegram:notify`/`telegram:test`. `telegram:notify` é chamado de CADA uma das 4 contas via `ipcRenderer.invoke` direto do preload do webview (chega no processo principal sem passar pelo `renderer.js` host) — por padrão só ERRO vira notificação, "notificar todo evento" manda tudo. `preload.js` expõe os 3 métodos em `window.hunteraFarm`.
  - **Configurações — layout limpo e organizado** (pedido explícito do André): novo botão ⚙️ na trilha de ícones abre um painel de Configurações DEDICADO (mesmo padrão visual do painel de Automação — troca de lugar com a lista de contas, nunca sobrepõe), com a seção "Notificações no Telegram" (token do bot, Chat ID, toggle "notificar todo evento", botão "Enviar notificação de teste" com resultado inline) — é config GLOBAL, vale pras 4 contas juntas (um bot/chat só). O painel de Automação de cada conta ganhou uma seção "Party" separada (checkbox "Aceitar convites automaticamente", campo de Friend List separado por vírgula, "Sincronizar Sio + ALVO com o Tank (Elder Druid)", "Manter alvo atual ao seguir o líder") — antes só tinha os campos de "Caçada"; agora os dois grupos têm título/separador visual próprio (`.automationGroup`/`.automationGroupTitle`).
  - Sem confirmação ao vivo ainda — depende do André religar o app (mudança em `main.js`/`preload.js` exige reiniciar de verdade, não só recarregar a página) e testar as 5 features + configurar o Telegram numa conta de verdade.

## 0.6.1 — 2026-09-04

- **Fix: login com Google não abria.** André: "quando o usuário tenta logar pelo Google, não abre a página do Google para conseguir autenticar". Causa: o bloqueio de segurança em `main.js` (desde o início do projeto) nega QUALQUER popup (`setWindowOpenHandler`) e QUALQUER navegação pra fora de `huntera.com.br` (`will-navigate`), sem exceção — nunca tinha sido testado com login via Google, que precisa abrir/navegar pra `accounts.google.com`. Fix: adicionada `isGoogleAuthUrl()`, que libera especificamente esse domínio (e subdomínios) tanto no popup quanto na navegação, mantendo o bloqueio pra qualquer outro destino — a proteção original contra a página do jogo abrir popups/navegar pra lugares aleatórios continua intacta pra tudo que não for o próprio login do Google. Sem confirmação ao vivo ainda.

## 0.6.0 — 2026-09-04

- **Atualização automática + instalador mais fácil de compartilhar.** André quer compartilhar o app com um amigo "de um modo mais profissional" — sem precisar reenviar o instalador toda vez que algo mudar. Perguntei visibilidade do repo (público, pra update sem fricção) e tipo de update (automático de verdade) — confirmou os dois.
  - Adicionado `electron-updater`. `main.js` ganhou `setupAutoUpdater()`: checa uma vez ~10s depois de abrir e depois a cada 4h, baixa em segundo plano, e SÓ pergunta (nunca força) se quer reiniciar pra aplicar quando termina de baixar — pensado especificamente pra não interromper uma automação rodando em alguma das 4 contas no meio de uma caçada. `autoInstallOnAppQuit = true` garante que aplica sozinho da próxima vez que o app fechar, mesmo se a pessoa nunca responder ao aviso. Só roda em build empacotada (`app.isPackaged`) — não faz nada em `npm start` de desenvolvimento.
  - `package.json` → `build.publish` configurado pro GitHub (provider `github`, `owner`/`repo` — André precisa trocar o owner placeholder pelo usuário real dele antes de publicar). Novo script `npm run publish` (`electron-builder --publish always`) gera o instalador E já sobe pro GitHub Releases, desde que a variável de ambiente `GH_TOKEN` (Personal Access Token dele, nunca commitado) esteja setada.
  - `build.nsis` ganhou `oneClick: true` + `perMachine: false`: instalador vira um clique só, sem assistente, sem pedir permissão de administrador (instala só pro usuário atual) — mais fácil pro amigo dele rodar, e evita prompt de UAC quebrar a atualização silenciosa depois.
  - Documentado no README o fluxo completo: criar o repo público, gerar um token, publicar (`npm run publish`), e o que o amigo precisa fazer (baixar o instalador manualmente só a PRIMEIRA vez — depois disso o app se atualiza sozinho).
  - **Confirmado ao vivo (04/09/2026)**: André criou o repositório público `dezin1/MultiAccount`, gerou o token e rodou `npm run publish` de verdade — gerou o `.exe` (NSIS) + `.zip`, criou a release `v0.6.0` no GitHub e subiu os dois arquivos com sucesso (log real do `electron-builder` conferido).
  - **Bug pego ao vivo na mesma hora**: o amigo do André, abrindo a página de Releases, viu "There aren't any releases here" — o `electron-builder` cria a release como **draft** por padrão (só o dono do repo enxerga), então pro público continuava parecendo vazio mesmo com o upload certo. Fix: `releaseType: "release"` em `build.publish` — publica direto, sem passo manual. A v0.6.0 já publicada precisou ser liberada manualmente uma vez (botão "Publish release" no GitHub); a partir da próxima versão sai pública sozinha.

## 0.5.0 — 2026-09-04

- **Verificador de stamina — feature nova.** André: "como acabar a stamina o personagem sai da caçada. quero que você cria um verificador de stamina, quando bater X stamina ele volta a rodar novamente". Perguntei se era pro `huntera-automacao` (que já tem a Automação #2 — TROCA de personagem quando a stamina zera) ou pro `huntera-multiconta`; ele confirmou multiconta, onde faz mais sentido (as 4 contas já ficam logadas ao mesmo tempo, não precisa trocar — só esperar a própria stamina regenerar). Implementado em `automation/content-injected.js`:
  - Novo seletor `staminaClock` (`.hud-stamina-clock`) e `parseStaminaClock`/`getStaminaRemainingMinutes` — mesma lógica já confirmada ao vivo na extensão Chrome (`huntera-automacao/content.js`), formato "H:MMh" → minutos restantes.
  - Novo campo de config `staminaResumeThreshold` (minutos, default 60), configurável no mesmo painel da Automação #1 ("Voltar a caçar com stamina ≥ (min)").
  - `monitorTick()`: quando detecta que o personagem não está caçando, agora checa a stamina ANTES de tentar re-entrar — se estiver abaixo do limiar, só loga (throttled, no máximo 1x a cada 5min, pra não floodar) e espera o próximo tick, em vez de tentar entrar de novo a cada 4s com a stamina ainda zerada (mesma classe de bug já resolvida no Auto Bestiary da extensão Chrome, v0.17.5 — "entra e sai" sem sentido).
  - `startBot()`: mesma checagem ao ligar manualmente — se já estiver sem stamina no momento, não força a entrada, só liga o monitor e deixa ele esperar sozinho.
  - Painel lateral mostra a stamina atual ao lado do status ("· stamina 1h05") enquanto a automação está ligada.
  - Sem confirmação ao vivo ainda — depende do André religar a extensão/app e ver o comportamento numa conta que realmente zere a stamina.

## 0.4.5 — 2026-09-04

- **Desligado o supersampling (`RENDER_SUPERSAMPLE`) pra economizar RAM.** André reportou RAM alta com as 4 contas abertas. Levantei que o supersampling 1.5x (v0.3.2, nitidez em zoom reduzido) faz cada webview desenhar com 2.25x mais pixels reais por trás (1.5²) o tempo todo — pesa mais ainda no modo "Ver juntas" (as 4 renderizando ao mesmo tempo) — e que isso soma com o custo natural de manter as 4 contas sempre 100% ativas (v0.4.2/v0.4.4, pra não desconectar), que por si só já significa mais memória residente do que o Chromium liberaria normalmente de contas em segundo plano. Perguntei o que ele preferia (reduzir nitidez geral / só manter nítida a conta ativa / deixar como está) — escolheu reduzir bastante. `RENDER_SUPERSAMPLE` foi pra `1` (sem override — valor padrão do Chromium, sem custo extra), e o bloco que anexa o debugger (CDP) por webview agora só roda se a constante for `> 1`, pra não pagar nem o custo da sessão de debug à toa. Constante continua ajustável em `main.js` se a nitidez fizer falta depois. Sem confirmação ao vivo do quanto isso reduz a RAM na prática.

## 0.4.4 — 2026-09-04

- **Reforçado o fix de desconexão ao minimizar/cobrir janela (v0.4.2 não bastou sozinho).** André reportou de novo, quase com as mesmas palavras de antes: "o multi client ao minimizar ou outra tela por cima, perde a conexão". Ele confirmou que já estava rodando a build com o fix da v0.4.2 (`setBackgroundThrottling(false)` por webview) e mesmo assim continuava desconectando. Causa: aquele fix só desliga uma camada (throttling de timers por `webContents`) — o Chromium tem outras duas camadas independentes de "modo economia" quando a janela não está visível:
  1. Rebaixa a prioridade do processo do renderer em segundo plano.
  2. Trata uma janela COBERTA por outra (mesmo sem estar minimizada — "occluded") como se estivesse em segundo plano.

  Essas duas só têm equivalente via linha de comando do processo inteiro (`app.commandLine.appendSwitch`), não por webContents individual. Adicionado no topo do `main.js`, antes do app ficar pronto:
  - `--disable-renderer-backgrounding`
  - `--disable-backgrounding-occluded-windows`
  - `--disable-background-timer-throttling` (reforça a mesma proteção da v0.4.2, agora também a nível de processo)

  Junto com o `setBackgroundThrottling(false)` já existente, isso cobre as três camadas (timer, prioridade de processo, occlusion de janela). Ainda sem confirmação ao vivo — depende do André rodar `npm install`/gerar build nova e testar minimizando e cobrindo a janela com outra.

## 0.4.3 — 2026-08-31

- **Botão de automação migrou pro iconRail.** André mandou print apontando
  bem específico pra "a barrinha onde você altera a visualização de multi
  janela" — ou seja, a trilha estreita de ícones à esquerda (`#iconRail`),
  onde já morava só o botão de grade ⊞. Adicionado um botão 🤖 ali do lado,
  mesmo estilo/comportamento do ⊞ (acende em âmbar quando ligado): clicar
  nele abre o painel de automação (o mesmo painel dedicado da v0.4.1) pra
  conta que estiver ativa no momento, e clicar de novo fecha. O ⚡ de cada
  linha da lista continua funcionando como atalho (abre a automação já
  naquela conta específica, sem precisar trocar de conta ativa antes) — os
  dois caminhos levam ao mesmo painel, só mudam o ponto de entrada.

## 0.4.2 — 2026-08-31

- **Corrigido: contas desconectando do jogo quando o app fica minimizado.**
  André reportou: "quando o multi client não fica em tela cheia, eu perco a
  conexão com os clientes e eles desconectam do jogo". Causa: por padrão o
  Chromium trata todo `<webview>` como "processo em segundo plano" sempre
  que a janela do app não está visível (minimizada ou coberta), e reduz
  bastante a frequência de timers (`setTimeout`/`setInterval`/rAF) nesse
  estado — inclusive dentro do processo de cada webview, que é onde o jogo
  roda de verdade. É esse throttling que atrasa o heartbeat/ping do jogo o
  suficiente pro servidor entender que o cliente sumiu e derrubar a conexão.
  Ajuste: `contents.setBackgroundThrottling(false)` em cada webview (feito
  no processo principal, `main.js`, dentro do `web-contents-created` já
  existente — reforçado também via o atributo `webpreferences` no
  `<webview>` do lado do renderer, como segunda camada). Com isso os 4
  clientes continuam rodando em tempo real mesmo com o app minimizado ou em
  segundo plano no Windows — trade-off: um pouco mais de CPU nesse estado,
  já que as contas não "pausam" mais.

## 0.4.1 — 2026-08-31

- **Painel de automação virou uma tela dedicada.** Na v0.4.0 o botão ⚡
  expandia um painel DENTRO da própria linha da conta — André reportou
  ("horrível onde você deixou o bot") que isso empurrava as outras contas
  pra baixo e ficava espremido. Agora clicar no ⚡ de uma conta troca o
  CONTEÚDO do menu lateral inteiro: a lista de contas some, entra um
  painel só daquela conta (avatar grande, status, caçada/tier/limiar, log)
  ocupando toda a largura/altura disponível, com um "‹ Contas" no topo pra
  voltar. Cabeçalho (nome do app) e rodapé ("Iniciar com o sistema"/
  "Recarregar todas") continuam sempre visíveis — só a área do meio troca.
  Mesma ponte IPC da v0.4.0 por trás (`hm:state`/`hm:command`), só a
  organização visual mudou.
- Cada conta na lista continua com o ⚡ mostrando de relance se a
  automação está ligada (acende âmbar), mesmo sem abrir o painel dela.

## 0.4.0 — 2026-08-31

- **Automação controlada pelo menu lateral, não mais dentro da tela do
  jogo.** André pediu pra tirar a automação de dentro da interface do
  Huntera — o painel flutuante (pill "Automação" arrastável) foi removido.
  No lugar, cada conta na barra lateral agora tem um botão **⚡** que abre
  um painel expansível ali mesmo (status, caçada, tier, limiar de
  capacidade, log e o botão de ligar/desligar), na coluna do app, nunca
  sobreposto ao jogo.
  - **Como isso foi feito** (fica registrado porque é a base pra próximas
    features cross-conta, tipo a coordenação de Party): a lógica da
    automação continua rodando isolada dentro do `<webview>` de cada conta
    (`automation/content-injected.js`), mas agora ela conversa com o host
    (`renderer.js`) por **IPC do próprio Electron** — a conta manda o
    estado dela (`ipcRenderer.sendToHost("hm:state", ...)`) toda vez que
    algo muda, e o host manda comandos pra ela (`webview.send("hm:command",
    ...)`) quando o André mexe nos controles. Escolhido em vez de
    `webview.executeJavaScript()` (ficaria fazendo polling) — IPC é
    orientado a evento, mais leve e é o canal oficial recomendado pelo
    Electron pra comunicação host↔webview.
  - Config (caçada/tier/limiar) continua salva no `localStorage` da própria
    conta (isolado pela partição) — o host só reflete/edita esse estado,
    não duplica onde a verdade mora.
  - Sem mudança nenhuma na lógica de automação em si (ciclo sair/vender/
    voltar, monitor de capacidade) — só migrou de onde a interface dela
    aparece.

## 0.3.2 — 2026-08-31

- **Corrigida a regressão da v0.3.1** — André confirmou ao vivo que o
  `force-device-scale-factor` deixou o app inteiro "enorme", não só mais
  nítido. Causa: esse switch é global (linha de comando do Chromium) — não
  dá pra escopar só pros webviews, ele muda quantos pixels CSS cabem na
  janela pra TODOS os processos de renderização, inclusive a nossa própria
  interface (sidebar/barra de ferramentas), que refluiu maior/mais
  grosseira.
- **Nova versão do mesmo truque, agora escopada só ao jogo**: cada
  `<webview>` recebe uma emulação de tela de densidade mais alta só pra
  ELE, via protocolo do DevTools (`webContents.debugger` +
  `Emulation.setDeviceMetricsOverride`, com `deviceScaleFactor:
  RENDER_SUPERSAMPLE` e `width`/`height: 0` — não sobrescreve as
  dimensões, só a densidade). A nossa interface (HTML puro, fora dos
  webviews) nunca é tocada por isso, continua sempre no tamanho normal.
  Combinado com o zoom reduzido que já era aplicado via
  `webview.setZoomFactor()` (modo grade ou zoom manual), o resultado é a
  interface do JOGO ficando menor e nítida ao mesmo tempo — sem afetar o
  resto do app. `RENDER_SUPERSAMPLE` continua em `main.js`, mesmo trade-off
  de sempre (mais nítido = mais pesado em CPU/GPU com as 4 contas abertas).

## 0.3.1 — 2026-08-31

- **Qualidade de renderização em zoom reduzido.** André notou que no app de
  referência (Multi Idle Manager) a tela em ~70% de zoom fica nítida,
  diferente do nosso zoom forçado — mesmo já usando zoom de página de
  verdade (`setZoomFactor`, não CSS transform). Causa: sem ajuste extra, o
  Chromium desenha cada webview na mesma densidade de pixels do monitor
  (que em telas comuns, não Retina/4K com escala alta, é relativamente
  baixa) — reduzir o zoom só faz o texto ficar menor com essa mesma
  densidade, então as bordas ficam mais ásperas. Corrigido forçando o app
  inteiro a renderizar numa resolução interna 1.5× mais alta
  (`app.commandLine.appendSwitch("force-device-scale-factor", "1.5")`,
  antes de `app.whenReady()`) e só depois reduzir pra exibir — mesmo
  princípio de uma tela Retina: mais pixels de verdade disponíveis pra
  desenhar fontes/ícones antes de qualquer zoom ser aplicado. Constante
  `RENDER_SUPERSAMPLE` em `main.js`, fácil de subir (mais nítido, mais
  pesado) ou baixar (mais leve, menos nítido) — 4 contas abertas ao mesmo
  tempo custam mais CPU/GPU com isso ligado, então pode precisar ajustar
  dependendo do PC.
- **Zoom liberado no modo grade.** Antes a barra de ferramentas inteira
  (incluindo zoom) travava no modo "Ver juntas". Agora só voltar/avançar/
  recarregar/URL travam (não fazem sentido apontando pra uma conta só com
  as 4 visíveis) — os botões de zoom continuam ativos e passam a ajustar as
  4 contas JUNTAS (um "zoom da grade" único, em vez do valor fixo
  `ZOOM_GRID` do código). Dá pra achar o equilíbrio ideal entre legibilidade
  e ver as 4 contas inteiras direto pela interface, sem editar código.

## 0.3.0 — 2026-08-31

- **Interface reescrita**, inspirada no visual do app "Multi Idle Manager"
  (multidl.online) que o André mostrou em screenshot. A barra de abas
  horizontal virou uma barra lateral estilo gerenciador multi-conta:
  - **Trilha de ícones** à esquerda com o botão **⊞ Ver juntas** (antes era
    um botão de texto no topo).
  - **Barra lateral** com cabeçalho (nome do app + botão "+" de adicionar
    conta), uma seção **"HUNTERA"** (colapsável, clique no cabeçalho)
    listando as contas — cada uma com avatar colorido (inicial do nome),
    bolinha de status (acende quando a página do jogo termina de carregar
    pela primeira vez), domínio (`huntera.com.br`) e **tempo desde que a
    conta foi criada** (`Xh Ym`, `Xd Yh`, etc — calculado a partir de
    quando a aba foi adicionada, persistido em `tabs.json`).
  - Rodapé da barra lateral com **"Iniciar com o sistema"** (liga/desliga
    de verdade via `app.setLoginItemSettings` do Electron — abre o app
    sozinho junto com o login do Windows) e **"Recarregar todas"**.
  - **Barra de ferramentas** em cima da área do jogo, estilo navegador:
    voltar/avançar/recarregar (agem na conta ativa), campo de URL
    (mostra a URL atual da conta ativa ao vivo; dá pra digitar e navegar —
    a trava de domínio do Huntera em `main.js` continua valendo, então só
    funciona pra dentro do próprio jogo) e controles de **zoom manual**
    (−/100%/+, por conta, sobrepõe o zoom automático normal/grade; clicar
    no "100%" volta ao zoom automático). Fica desativada no modo grade
    (não faz sentido apontar pra uma conta só com as 4 na tela ao mesmo
    tempo).
  - Sem "Trial" nem contador de plano (o app original tem porque é um
    produto pago — o nosso não é nada disso) — no lugar, um selo simples
    mostrando quantas contas estão abertas (`N/4 contas`).
  - **Nada da lógica muda**: mesma partição isolada por conta, mesma
    Automação #1 injetada em cada webview, mesmo modo "Ver juntas" (grade
    2×2 com zoom real via `setZoomFactor`).

## 0.2.2 — 2026-08-27

- **Automação #1 confirmada funcionando ao vivo pelo André** — ciclo
  completo (sair/vender/voltar) rodou de verdade numa conta.
- **Painel agora é arrastável.** O canto superior direito padrão colide com
  os ícones do próprio HUD do jogo em algumas telas (não dá pra prever um
  canto sempre livre). Agora é só clicar e arrastar a pill "Automação" pra
  qualquer lugar da tela — a posição fica salva por conta (localStorage,
  igual o resto da config) e volta pro mesmo lugar da próxima vez que
  aquela conta carregar. Um clique normal (sem arrastar) continua
  abrindo/fechando o painel como antes — só vira "arrastar" se o mouse
  realmente se mover mais que uns pixels.

## 0.2.1 — 2026-08-27

- **Corrigido: "erro ao carregar" na lista de caçadas logo ao abrir uma
  conta.** Causa: o painel injeta e já tenta ler a lista de caçadas quase
  assim que a página começa a carregar — bem antes de a SPA em Angular do
  jogo terminar de montar a barra de navegação (ou até antes do login
  acontecer, se a conta ainda não estava logada), então o botão que abre o
  seletor de caçadas ainda não existia. `ensureHuntWindowOpen()` agora
  espera de verdade até 20s pelo botão aparecer, em vez de checar só uma
  vez — cobre tanto "ainda carregando" quanto "acabou de logar agora".
- Adicionado um botão **↻** ao lado do rótulo "Caçada" no painel, pra
  tentar de novo manualmente (útil se a conta simplesmente ainda não
  estava logada quando o painel carregou pela primeira vez — não precisa
  recarregar a aba inteira).
- Mensagem de erro mais clara: "— faça login e clique em ↻ —" em vez de
  "— erro ao carregar —".

## 0.2.0 — 2026-08-27

- **Automação #1 portada pra dentro do app** (sair da caçada quando a
  capacidade encher, vender na cidade, voltar pra mesma caçada) — mesma
  lógica já validada em `huntera-automacao/content.js`, adaptada pra rodar
  sozinha dentro de cada webview isolado, sem depender de popup nenhum:
  - Anexada via o atributo `preload` de cada `<webview>`
    (`automation/content-injected.js`) — roda automaticamente assim que
    cada conta carrega o jogo, continua rodando através de trocas de rota
    internas do jogo (personagem → cidade → caçada, etc, tudo client-side,
    sem recarregar a página de verdade).
  - Configuração (caçada/tier/limiar de capacidade) e log ficam no
    `localStorage` da PRÓPRIA página — já isolado por conta automaticamente
    graças à partição do webview, sem precisar de nenhum mecanismo de
    isolamento extra.
  - Painel flutuante injetado direto na tela do jogo (canto superior
    direito) — uma pill com bolinha de status que expande pra mostrar
    caçada/tier/limiar (lidos ao vivo do jogo, igual os dropdowns da
    extensão), botão Ligar/Desligar e um log dos últimos eventos.
  - Se a automação estava ligada quando o app é fechado e reaberto, religa
    sozinha (lê o `running` salvo no localStorage daquela conta).
- Ainda SEM troca de personagem por stamina, expedição da guild ou
  fraqueza elemental (automações #2/#3 da extensão) — ficam pra uma
  próxima versão, depois de validar essa base rodando de verdade.

## 0.1.1 — 2026-08-27

- **Zoom no modo grade.** André reportou: no "Ver juntas", o jogo fica com
  a UI pequena/cortada demais pra ler (o Huntera não é responsivo pra caber
  numa célula de 1/4 da tela). Corrigido aplicando zoom de página de
  verdade em cada webview (`webview.setZoomFactor()`, não CSS transform) —
  50% no modo grade, volta a 100% no modo de uma conta só. Zoom de verdade
  faz o navegador REFLUIR o layout (texto/ícones ficam legíveis, não só
  "encolhidos"), diferente de um `transform: scale()` que só reduziria os
  pixels já renderizados. Reaplica o zoom certo toda vez que um webview
  termina de carregar (login, troca de personagem, etc. não resetam o
  zoom sozinhos). `ZOOM_GRID` em `renderer.js` é fácil de ajustar se ainda
  precisar de mais ou menos zoom.

## 0.1.0 — 2026-08-27

Primeira versão do projeto. Reescrita do zero, inspirada no HunteraFarm
(app de terceiro pra Windows, descontinuado) depois de investigar como ele
funcionava (confirmado via GitHub: Electron + electron-builder).

- App Electron com janela única e barra de abas — uma aba por conta do
  Huntera, até 4.
- Cada aba é um `<webview>` com partição própria (`persist:conta-N`) — é
  isso que dá isolamento real de cookies/localStorage por conta, permitindo
  várias contas logadas ao mesmo tempo sem uma derrubar a sessão da outra.
- Botão **+ Nova conta** (até 4), fechar aba (remove a sessão local daquela
  conta), nome de aba editável.
- Botão **⊞ Ver juntas** — grade 2×2 mostrando as 4 contas ao mesmo tempo.
- Lista de abas (nome + id, nunca credenciais) persistida em
  `app.getPath("userData")/tabs.json`, lida/escrita via IPC
  (`main.js` ↔ `preload.js` ↔ `renderer.js`).
- Navegação de cada webview travada no domínio do Huntera
  (`will-navigate`) e popups bloqueados (`setWindowOpenHandler`) — cuidado
  de segurança básico por rodar conteúdo de terceiro dentro do app.
- Sem automação nenhuma ainda (fica pra v0.2.0, portando a lógica já
  validada em `huntera-automacao/`) e sem painéis de estatísticas (tipo
  "Analisador de caçada" do HunteraFarm original).
