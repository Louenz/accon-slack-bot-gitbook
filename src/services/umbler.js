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

// --------------------------------------
// Lê as mensagens recentes de um chat.
// GET /v1/chats/{id}/?organizationId=...&includeMessages=N
// Retorna o array de mensagens (latestMessages) ou [] em caso de erro.
// --------------------------------------

async function buscarHistoricoChat(chatId, includeMessages = 20) {
  try {
    const response = await axios.get(
      `https://app-utalk.umbler.com/api/v1/chats/${chatId}/`,
      {
        headers: {
          Authorization: `Bearer ${env.UMBLER_TOKEN}`,
          accept: "application/json",
        },
        params: {
          organizationId: env.ORGANIZATION_ID,
          includeMessages,
        },
      }
    );

    const data = response.data || {};
    return data.latestMessages || data.messages || data.Messages || [];
  } catch (error) {
    console.log(
      "❌ Erro ao buscar histórico na Umbler:",
      error.response?.status,
      error.message
    );
    return [];
  }
}

// --------------------------------------
// Lista os atendimentos FINALIZADOS (chats fechados), do mais recente para
// o mais antigo. Usado pelo comando administrativo #finalizados.
//
// A API da Umbler só lista chats abertos por padrão; é o parâmetro
// ChatState=Closed que traz os encerrados. Ordenação por última mensagem,
// decrescente. Retorna uma lista já normalizada (id, contato, setor, data).
// --------------------------------------

async function listarChatsFinalizados(take = 15) {
  try {
    const response = await axios.get(
      "https://app-utalk.umbler.com/api/v1/chats/",
      {
        headers: {
          Authorization: `Bearer ${env.UMBLER_TOKEN}`,
          accept: "application/json",
        },
        params: {
          organizationId: env.ORGANIZATION_ID,
          ChatState: "Closed", // <- só os encerrados (Open | Closed | All)
          ChatOrderBy: "LastMessage",
          Order: "Desc", // mais recente primeiro
          Take: Math.min(250, Math.max(1, take)), // maxTake da API = 250
        },
        timeout: 20000,
      }
    );

    const items = response.data?.items || [];
    return items.map((c) => ({
      chatId: c?.id || "",
      // o nome do contato já vem como "Atendente - Empresa" nesta organização
      contato: c?.contact?.name || "(sem nome)",
      telefone: c?.contact?.phoneNumber || "",
      setor: c?.sector?.name || "",
      // data de finalização (cai para o último evento se vier vazia)
      finalizadoEm: c?.closedAtUTC || c?.eventAtUTC || null,
    }));
  } catch (error) {
    console.log(
      "❌ Erro ao listar atendimentos finalizados na Umbler:",
      error.response?.status,
      error.message
    );
    return [];
  }
}

// --------------------------------------
// Retorna o nome do contato de um chat (ex.: "João - Donna Toscana").
// Usado APENAS para nomear o arquivo de documentação local (o conteúdo
// permanece anônimo). Retorna "" em caso de erro.
// --------------------------------------

async function buscarContatoChat(chatId) {
  try {
    const response = await axios.get(
      `https://app-utalk.umbler.com/api/v1/chats/${chatId}/`,
      {
        headers: {
          Authorization: `Bearer ${env.UMBLER_TOKEN}`,
          accept: "application/json",
        },
        params: { organizationId: env.ORGANIZATION_ID, includeMessages: 0 },
        timeout: 15000,
      }
    );
    const data = response.data || {};
    const contato = data.contact || data.Contact || {};
    return contato.name || contato.Name || "";
  } catch (error) {
    console.log(
      "⚠️ Não foi possível obter o nome do contato:",
      error.response?.status,
      error.message
    );
    return "";
  }
}

// ======================================
// OBSERVAÇÕES DO CONTATO (notas) — armazenamento persistente das lojas
// ======================================

const CONTACTS_URL = "https://app-utalk.umbler.com/api/v1/contacts";

// id do contato a partir do chat (necessário para ler/gravar as notas)
async function buscarIdContato(chatId) {
  try {
    const r = await axios.get(
      `https://app-utalk.umbler.com/api/v1/chats/${chatId}/`,
      {
        headers: { Authorization: `Bearer ${env.UMBLER_TOKEN}`, accept: "application/json" },
        params: { organizationId: env.ORGANIZATION_ID, includeMessages: 0 },
        timeout: 15000,
      }
    );
    const c = r.data?.contact || r.data?.Contact || {};
    return c.id || c.Id || "";
  } catch (error) {
    console.log("⚠️ Erro ao obter id do contato:", error.response?.status, error.message);
    return "";
  }
}

// lista as notas (observações) do contato -> [{ id, content }]
async function buscarNotasContato(contactId) {
  try {
    const r = await axios.get(`${CONTACTS_URL}/${contactId}/notes/`, {
      headers: { Authorization: `Bearer ${env.UMBLER_TOKEN}`, accept: "application/json" },
      params: { organizationId: env.ORGANIZATION_ID },
      timeout: 15000,
    });
    const arr = Array.isArray(r.data) ? r.data : r.data?.items || r.data?.notes || [];
    return arr.map((n) => ({ id: n.id || n.Id, content: n.content || n.Content || "" }));
  } catch (error) {
    console.log("⚠️ Erro ao ler notas do contato:", error.response?.status, error.message);
    return [];
  }
}

// cria uma nota (observação) no contato
async function criarNotaContato(contactId, content) {
  try {
    await axios.post(
      `${CONTACTS_URL}/${contactId}/notes/`,
      { content, organizationId: env.ORGANIZATION_ID },
      {
        headers: {
          Authorization: `Bearer ${env.UMBLER_TOKEN}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        timeout: 15000,
      }
    );
    return true;
  } catch (error) {
    console.log("❌ Erro ao criar nota do contato:", error.response?.status, error.message);
    return false;
  }
}

// remove uma nota do contato
async function removerNotaContato(contactId, noteId) {
  try {
    await axios.delete(`${CONTACTS_URL}/${contactId}/notes/${noteId}/`, {
      headers: { Authorization: `Bearer ${env.UMBLER_TOKEN}`, accept: "application/json" },
      params: { organizationId: env.ORGANIZATION_ID },
      timeout: 15000,
    });
    return true;
  } catch (error) {
    console.log("❌ Erro ao remover nota do contato:", error.response?.status, error.message);
    return false;
  }
}

module.exports = {
  enviarNotaInterna,
  buscarHistoricoChat,
  listarChatsFinalizados,
  buscarContatoChat,
  buscarIdContato,
  buscarNotasContato,
  criarNotaContato,
  removerNotaContato,
};
