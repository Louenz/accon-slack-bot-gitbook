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
// Slack (Bolt)
// --------------------------------------

const app = new App({
  token: env.SLACK_BOT_TOKEN,
  signingSecret: env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: env.PORT,
});

module.exports = {
  openai,
  app,
};
