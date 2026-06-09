// ======================================
// WHATSAPP: ESTADO DA SESSÃO (modo IA + contexto)
// ======================================
//
// Guarda, por chat:
//  - se está em "modo IA" (cliente digitou o número 4);
//  - o contexto do atendimento (empresa identificada pelo CNPJ).
//
// Enquanto o chat estiver em modo IA, cada mensagem do cliente é tratada
// pelo bot. O contexto evita pedir o CNPJ duas vezes no mesmo atendimento.
//
// OBS: o estado fica em memória, então ZERA quando o servidor reinicia.
// Para testar é suficiente. Se precisar persistir entre reinícios ou
// rodar em várias instâncias, troque por Redis/banco depois.

const persistencia = require("./persistencia");

const chatsEmModoIA = new Set();

// chatId -> { empresa?: { cnpj, dados } }
const contextoPorChat = new Map();

// chatId -> { desde: timestamp }  (presença = captura de treinamento ativa)
const docPorChat = new Map();

// chats onde a documentação foi bloqueada por #desativardoc
const docBloqueado = new Set();

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

// --------------------------------------
// Reset completo da conversa (#resetar): apaga TODO o contexto coletado
// (empresa, CNPJ, versão, flags, memória). Mantém o modo IA ativo e marca
// o momento do reset (`resetEm`) para o transcript "esquecer" o passado.
// --------------------------------------

function resetarConversa(chatId) {
  contextoPorChat.delete(chatId);
  contextoPorChat.set(chatId, { resetEm: Date.now() });
}

// --------------------------------------
// Captura de treinamento (#ativar inicia, #desativar/#desativardoc encerra).
// Marca o instante de início para delimitar a janela da conversa.
// --------------------------------------

function iniciarDoc(chatId) {
  const desde = Date.now();
  docPorChat.set(chatId, { desde });
  persistencia.salvarEstadoDoc(chatId, desde); // sobrevive a restart
}

function pararDoc(chatId) {
  docPorChat.delete(chatId);
  persistencia.removerEstadoDoc(chatId);
}

function estaDocAtivo(chatId) {
  return docPorChat.has(chatId);
}

function obterDocInicio(chatId) {
  return docPorChat.get(chatId)?.desde || 0;
}

// #desativardoc: interrompe a captura e bloqueia a documentação desta conversa.
function bloquearDoc(chatId) {
  docPorChat.delete(chatId);
  persistencia.removerEstadoDoc(chatId);
  docBloqueado.add(chatId);
}

// Restaura os atendimentos em documentação do disco (chamado no boot).
function restaurarEstadosDoc() {
  const estados = persistencia.carregarEstadosDoc();
  for (const e of estados) {
    if (e?.chatId) docPorChat.set(e.chatId, { desde: e.desde || 0 });
  }
  return estados.length;
}

function docEstaBloqueado(chatId) {
  return docBloqueado.has(chatId);
}

module.exports = {
  ativarModoIA,
  desativarModoIA,
  estaEmModoIA,
  obterContexto,
  definirContexto,
  empresaIdentificada,
  resetarConversa,
  iniciarDoc,
  pararDoc,
  estaDocAtivo,
  obterDocInicio,
  bloquearDoc,
  docEstaBloqueado,
  restaurarEstadosDoc,
};
