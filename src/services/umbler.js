// ======================================
// SERVIÇO: UMBLER (uTalk / WhatsApp)
// ======================================
//
// Envia mensagens para a Umbler. Por enquanto usamos somente a NOTA
// INTERNA (IsPrivate: true) — ela aparece na conversa apenas para a
// equipe, NÃO é enviada ao cliente. Ideal para testar o bot com segurança
// antes de responder de verdade.
//
// Para "ir ao ar" (responder o cliente) basta trocar IsPrivate para false
// ou usar o endpoint /messages/simplified/ (com FromPhone/ToPhone).

const axios = require("axios");
const { env, WHATSAPP } = require("../config");

// --------------------------------------
// Envia uma nota interna no chat (invisível ao cliente).
// --------------------------------------

async function enviarNotaInterna(chatId, mensagem) {
  try {
    await axios.post(
      WHATSAPP.API_URL,
      {
        Message: mensagem,
        ChatId: chatId,
        IsPrivate: true, // <- torna a mensagem uma NOTA INTERNA
        OrganizationId: env.ORGANIZATION_ID,
      },
      {
        headers: {
          Authorization: `Bearer ${env.UMBLER_TOKEN}`,
          accept: "application/json",
          "content-type": "application/json",
        },
      }
    );

    return true;
  } catch (error) {
    console.log(
      "❌ Erro ao enviar nota na Umbler:",
      error.response?.status,
      error.response?.data || error.message
    );
    return false;
  }
}

module.exports = {
  enviarNotaInterna,
};
