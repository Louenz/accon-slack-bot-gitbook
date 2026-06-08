// ======================================
// WHATSAPP: ESTADO DA SESSÃO (modo IA + contexto)
// ======================================
//
// Guarda, por chat:
//  - se está em "modo IA" (cliente digitou o número 4);
//  - o contexto do atendimento (empresa identificada, marca, ID da loja).
//
// Enquanto o chat estiver em modo IA, cada mensagem do cliente é tratada
// pelo bot. O contexto evita pedir os mesmos dados duas vezes no mesmo
// atendimento.
//
// OBS: o estado fica em memória, então ZERA quando o servidor reinicia.
// Para testar é suficiente. Se precisar persistir entre reinícios ou
// rodar em várias instâncias, troque por Redis/banco depois.

const chatsEmModoIA = new Set();

// chatId -> { empresa?: {...}, marca?: string, idLoja?: string }
const contextoPorChat = new Map();

// --------------------------------------
// Modo IA
// --------------------------------------

function ativarModoIA(chatId) {
  chatsEmModoIA.add(chatId);
}

function desativarModoIA(chatId) {
  chatsEmModoIA.delete(chatId);
  // ao encerrar o atendimento, descarta o contexto coletado
  contextoPorChat.delete(chatId);
}

function estaEmModoIA(chatId) {
  return chatsEmModoIA.has(chatId);
}

// --------------------------------------
// Contexto do atendimento
// --------------------------------------

function obterContexto(chatId) {
  return contextoPorChat.get(chatId) || {};
}

function definirContexto(chatId, dados) {
  contextoPorChat.set(chatId, { ...obterContexto(chatId), ...dados });
}

function empresaIdentificada(chatId) {
  return Boolean(obterContexto(chatId).empresa);
}

module.exports = {
  ativarModoIA,
  desativarModoIA,
  estaEmModoIA,
  obterContexto,
  definirContexto,
  empresaIdentificada,
};
