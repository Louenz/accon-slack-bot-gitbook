// ======================================
// CLIENTES EXTERNOS (Slack + OpenAI)
// ======================================
//
// Cria e exporta as instâncias compartilhadas do app do Slack (Bolt)
// e do cliente da OpenAI. Importar "./config" primeiro garante que o
// dotenv já carregou as variáveis de ambiente antes de instanciar.

const { App } = require("@slack/bolt");
const OpenAI = require("openai");
const { env } = require("./config");

// --------------------------------------
// OpenAI
// --------------------------------------

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

// --------------------------------------
// Slack (Bolt) — Socket Mode
// --------------------------------------
//
// Em Socket Mode o Slack se conecta por WebSocket de saída: NÃO precisa de
// URL pública nem de porta HTTP. Assim o ngrok fica livre para o webhook do
// WhatsApp (porta 3001) e os dois bots funcionam ao mesmo tempo.
//
// Requer um App-Level Token (xapp-..., escopo connections:write) gerado no
// painel do Slack e salvo em SLACK_APP_TOKEN.

let app;

if (env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN) {
  app = new App({
    token: env.SLACK_BOT_TOKEN,
    appToken: env.SLACK_APP_TOKEN,
    socketMode: true,
  });
} else {
  // Sem tokens do Slack: não derruba o processo (o WhatsApp continua de pé).
  // Stub para os handlers registrarem sem erro; start() avisa e falha.
  console.log(
    "⚠️ Slack desativado: defina SLACK_BOT_TOKEN e SLACK_APP_TOKEN (Socket Mode) no .env."
  );
  app = {
    event() {},
    action() {},
    async start() {
      throw new Error("SLACK_APP_TOKEN ausente (Socket Mode não iniciado).");
    },
  };
}

module.exports = {
  openai,
  app,
};
