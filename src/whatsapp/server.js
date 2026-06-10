// ======================================
// WHATSAPP: SERVIDOR DO WEBHOOK (Umbler)
// ======================================
//
// Sobe um servidor Express que recebe os webhooks da Umbler. Responde 200
// imediatamente (para a Umbler não reenviar por timeout) e processa a
// mensagem em seguida. A mesma rota é registrada em "/" e "/webhook"
// porque a Umbler envia para a raiz quando a URL não tem caminho.

const express = require("express");
const { env } = require("../config");
const { jaProcessado } = require("./dedupe");
const { handleWebhook } = require("./handler");
const { restaurarEstadosDoc } = require("./session");
const { iniciarCacheCategorias } = require("./categorias");

function startUmblerServer() {
  // restaura atendimentos em documentação que ficaram em aberto antes de um
  // restart (nodemon/deploy/crash) — nenhum atendimento é perdido.
  const restaurados = restaurarEstadosDoc();
  if (restaurados > 0) {
    console.log(
      `📂 ${restaurados} atendimento(s) em documentação restaurado(s) do disco.`
    );
  }

  // cache local das categorias da Central de Ajuda (carrega + agenda refresh diário)
  iniciarCacheCategorias();

  const app = express();

  app.use(express.json({ limit: "50mb" }));

  async function rotaWebhook(req, res) {
    // responde já, processa depois
    res.sendStatus(200);

    try {
      if (jaProcessado(req.body)) return;
      await handleWebhook(req.body);
    } catch (error) {
      console.log("❌ Erro no webhook Umbler:", error.message);
    }
  }

  app.post("/", rotaWebhook);
  app.post("/webhook", rotaWebhook);

  // rota simples para testar no navegador se o servidor está no ar
  app.get("/", (_req, res) => res.send("Webhook Umbler no ar ✅"));

  app.listen(env.UMBLER_PORT, () => {
    console.log(`📲 Webhook Umbler rodando na porta ${env.UMBLER_PORT}`);
  });
}

module.exports = {
  startUmblerServer,
};
