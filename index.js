// ======================================
// PONTO DE ENTRADA DO ROBÔ
// ======================================
//
// Robô de ajuda do Slack que responde dúvidas com base na documentação
// do GitBook (2 spaces: interno do time e externo de clientes). Quando
// mencionado com @ajuda, busca na documentação, gera a resposta com a IA
// e oferece a opção de ver conversas parecidas já respondidas no Slack.
//
// A lógica está organizada em src/:
//   config.js            -> variáveis de ambiente e constantes
//   clients.js           -> instâncias do Slack e da OpenAI
//   utils/text.js        -> tratamento de texto
//   services/gitbook.js  -> busca na documentação
//   services/openai.js   -> geração da resposta
//   services/slack.js    -> imagens e busca de conversas
//   services/umbler.js   -> envio de nota interna no WhatsApp (Umbler)
//   handlers/mention.js  -> evento @ajuda (Slack)
//   handlers/actions.js  -> botões (Slack)
//   whatsapp/            -> bot do WhatsApp via Umbler (webhook + IA)

const { app } = require("./src/clients");
const { startUmblerServer } = require("./src/whatsapp/server");

// registra os listeners do Slack (efeito ao importar)
require("./src/handlers/mention");
require("./src/handlers/actions");

// --------------------------------------
// START
// --------------------------------------
// Sobe o bot do Slack e o webhook do WhatsApp (Umbler) de forma
// independente: se um falhar, o outro continua de pé.

(async () => {
  try {
    await app.start();
    console.log("⚡ Bot do Slack rodando!");
  } catch (error) {
    console.log("❌ Falha ao iniciar o Slack:", error.message);
  }

  startUmblerServer();
})();
