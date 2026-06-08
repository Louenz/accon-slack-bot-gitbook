// ======================================
// WHATSAPP: PARSER DO WEBHOOK
// ======================================
//
// Extrai os dados úteis do payload que a Umbler envia. O parser é
// tolerante a PascalCase e camelCase (a API mistura os dois).
//
// Caminhos confirmados no payload da Umbler:
//   texto       -> Payload.Content.LastMessage.Content
//   chatId      -> Payload.Content.Id
//   origem      -> Payload.Content.LastMessage.Source   ("Contact" | "Member")
//   nota interna-> Payload.Content.LastMessage.IsPrivate (true = nota)
//   contato     -> Payload.Content.Contact.Name / .PhoneNumber

function extrairDadosWebhook(body) {
  const payload = body?.Payload || body?.payload || {};
  const content = payload?.Content || payload?.content || {};
  const lastMessage = content?.LastMessage || content?.lastMessage || {};
  const contact = content?.Contact || content?.contact || {};

  return {
    tipoEvento: body?.Type || body?.type || "",
    chatId: content?.Id || content?.id || "",
    texto: lastMessage?.Content || lastMessage?.content || "",
    source: lastMessage?.Source || lastMessage?.source || "",
    isPrivate: lastMessage?.IsPrivate ?? lastMessage?.isPrivate ?? false,
    contactName: contact?.Name || contact?.name || "",
    contactPhone: contact?.PhoneNumber || contact?.phoneNumber || "",
  };
}

module.exports = {
  extrairDadosWebhook,
};
