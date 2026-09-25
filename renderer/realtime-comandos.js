// v0.13.5 — COMANDOS DO PAINEL POR REALTIME, NÃO POR CONSULTA A CADA 3s.
//
// Medido nos logs do Supabase (25/09/2026): de 183 mil requisições em 24h, 145
// mil (79%) eram o app perguntando "tem comando novo?" a cada 3 segundos —
// resposta quase sempre vazia, mas cada uma com ~0,5 KB de cabeçalho. Com 7
// usuários isso levava o projeto ao teto de 5 GB de egress do plano grátis.
//
// Agora a interface abre UMA conexão Realtime (WebSocket) e o Supabase avisa
// quando nasce um comando pra este computador. O aviso não traz o comando em
// si: só dispara `aoChegarComando`, e o processo principal busca os pendentes
// pelo caminho de sempre (`swagPollCommands`), que já trata duplicidade,
// timeout e status. Se o Realtime cair, o processo principal volta a
// consultar sozinho (ver `swagRealtimeAtivo` no main.js).
//
// Fica na interface e não no processo principal porque o Node do Electron 32
// (20.18) não tem WebSocket nativo, e o Chromium tem — sem dependência nova.
//
// Protocolo: Phoenix channels (vsn 1.0.0), o mesmo que o supabase-js usa.
(function (global) {
  const HEARTBEAT_MS = 25000;
  const ESPERAS_RECONEXAO_MS = [2000, 5000, 10000, 30000, 60000];

  function criarRealtimeComandos(opcoes) {
    const {
      WebSocketImpl,
      setTimeoutFn = setTimeout,
      clearTimeoutFn = clearTimeout,
      setIntervalFn = setInterval,
      clearIntervalFn = clearInterval,
      aoChegarComando,
      aoMudarStatus,
    } = opcoes;

    let cfg = null;
    let ws = null;
    let ref = 0;
    let topico = null;
    let joinRef = null;
    let batimento = null;
    let religar = null;
    let tentativas = 0;
    let ativo = false;

    function mudarStatus(v) {
      if (v === ativo) return;
      ativo = v;
      try {
        aoMudarStatus(v);
      } catch (e) {}
    }

    function avisar(motivo) {
      try {
        aoChegarComando(motivo);
      } catch (e) {}
    }

    function enviar(msg) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    }

    function derrubar() {
      if (batimento) {
        clearIntervalFn(batimento);
        batimento = null;
      }
      if (religar) {
        clearTimeoutFn(religar);
        religar = null;
      }
      if (ws) {
        const w = ws;
        ws = null;
        w.onopen = w.onmessage = w.onclose = w.onerror = null;
        try {
          w.close();
        } catch (e) {}
      }
      mudarStatus(false);
    }

    function reconectarDepois() {
      derrubar();
      if (!cfg) return;
      const espera = ESPERAS_RECONEXAO_MS[Math.min(tentativas, ESPERAS_RECONEXAO_MS.length - 1)];
      tentativas++;
      religar = setTimeoutFn(() => {
        religar = null;
        conectar();
      }, espera);
    }

    function conectar() {
      if (!cfg) return;
      const url =
        cfg.url.replace(/^http/, "ws") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(cfg.anonKey) + "&vsn=1.0.0";
      let w;
      try {
        w = new WebSocketImpl(url);
      } catch (e) {
        reconectarDepois();
        return;
      }
      ws = w;
      topico = "realtime:lh-comandos-" + cfg.deviceId;
      w.onopen = () => {
        joinRef = String(++ref);
        enviar({
          topic: topico,
          event: "phx_join",
          ref: joinRef,
          join_ref: joinRef,
          payload: {
            config: {
              broadcast: { ack: false, self: false },
              presence: { key: "" },
              // Só INSERT deste computador. O RLS (commands_select_own) garante
              // que o Supabase nunca manda comando de outro usuário.
              postgres_changes: [
                { event: "INSERT", schema: "public", table: "commands", filter: "device_id=eq." + cfg.deviceId },
              ],
              private: false,
            },
            access_token: cfg.accessToken,
          },
        });
        batimento = setIntervalFn(() => enviar({ topic: "phoenix", event: "heartbeat", payload: {}, ref: String(++ref) }), HEARTBEAT_MS);
      };
      w.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        if (!m || m.topic !== topico) return;
        if (m.event === "phx_reply" && m.ref === joinRef) {
          if (m.payload && m.payload.status === "ok") {
            tentativas = 0;
            mudarStatus(true);
            // Pode ter nascido comando enquanto estava desconectado: busca uma vez.
            avisar("conectou");
          } else {
            reconectarDepois();
          }
          return;
        }
        if (m.event === "postgres_changes") {
          avisar("comando");
          return;
        }
        if (m.event === "phx_error" || m.event === "phx_close") {
          reconectarDepois();
          return;
        }
        // O Supabase manda `system` com status "error" quando a assinatura de
        // postgres_changes não pega (ex.: token recusado).
        if (m.event === "system" && m.payload && m.payload.status === "error") reconectarDepois();
      };
      w.onclose = () => reconectarDepois();
      w.onerror = () => {};
    }

    // `novo` = { url, anonKey, accessToken, deviceId } ou null (sem login/licença).
    function configurar(novo) {
      const antigo = cfg;
      cfg = novo || null;
      if (!cfg) {
        tentativas = 0;
        derrubar();
        return;
      }
      const mesmaConexao = !!antigo && antigo.url === cfg.url && antigo.deviceId === cfg.deviceId && antigo.anonKey === cfg.anonKey;
      if (mesmaConexao && ws) {
        // Token renovado (a cada ~1h): avisa o canal em vez de reconectar.
        if (antigo.accessToken !== cfg.accessToken) {
          enviar({ topic: topico, event: "access_token", payload: { access_token: cfg.accessToken }, ref: String(++ref), join_ref: joinRef });
        }
        return;
      }
      if (mesmaConexao && religar) return; // já vai reconectar, e com o cfg novo
      tentativas = 0;
      derrubar();
      conectar();
    }

    return {
      configurar,
      get ativo() {
        return ativo;
      },
    };
  }

  global.criarRealtimeComandos = criarRealtimeComandos;
})(typeof window !== "undefined" ? window : globalThis);
