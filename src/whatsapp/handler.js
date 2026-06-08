// ======================================
// WHATSAPP: LÓGICA DO BOT
// ======================================
//
// Fluxo:
//   1. Cliente digita "4"        -> ativa o modo IA e JÁ procura um CNPJ no
//      histórico recente da conversa (o cliente pode tê-lo informado antes).
//   2. IDENTIFICAÇÃO DA EMPRESA  -> antes de responder dúvidas técnicas, o
//      bot identifica a empresa pelo CNPJ (consulta a API da Accon).
//   3. VERSÃO DA ACCON           -> Accon 1.0 (campo "Último pedido 2.0" = N/A)
//      encerra a IA e direciona para a equipe; Accon 2.0 segue o atendimento.
//   4. Empresa 2.0 identificada  -> responde dúvidas com base na documentação
//      (GitBook), postando como NOTA INTERNA (teste seguro).
//   5. Cliente digita "0/sair"   -> desativa o modo IA e limpa o contexto.
//
// Reaproveita a busca e a geração de resposta compartilhadas
// (services/gitbook + services/openai), restritas ao comportamento do
// WhatsApp por configuração (PUBLIC_SPACES + includeSources:false).

const { WHATSAPP, PUBLIC_SPACES } = require("../config");
const { searchGitBook, getFullPageContent } = require("../services/gitbook");
const { generateAnswer } = require("../services/openai");
const { enviarNotaInterna, buscarHistoricoChat } = require("../services/umbler");
const { cleanText } = require("../utils/text");
const { extrairDadosWebhook } = require("./parser");
const {
  ativarModoIA,
  desativarModoIA,
  estaEmModoIA,
  definirContexto,
  empresaIdentificada,
} = require("./session");
const { extrairCNPJ, formatarCNPJ } = require("./identify");
const {
  buscarDadosEmpresa,
  formatarDadosEmpresa,
  detectarVersaoAccon,
} = require("./accon");

// --------------------------------------
// Mensagens fixas (notas internas)
// --------------------------------------
//
// A API da Accon só consulta por CNPJ. Por isso, qualquer outro dado
// (marca, ID da loja, nome da rede, etc.) NÃO é suficiente: sem CNPJ,
// o bot sempre pede o CNPJ.

const MSG_PEDIR_CNPJ =
  "Para que eu consiga identificar sua empresa e coletar os dados do " +
  "cadastro, preciso que me informe o CNPJ da empresa.";

// Loja na Accon 1.0: não há atendimento automático — direciona para a equipe.
const MSG_ACCON_1_0 =
  "Identifiquei que você ainda está na versão 1.0 da Accon.\n\n" +
  "Aguarde o nosso time especialista entrar às 10:00 horas que irão te " +
  "chamar assim que iniciar o expediente para te auxiliar.";

// ======================================
// ENTRADA
// ======================================

async function handleWebhook(body) {
  const { chatId, texto, source, isPrivate } = extrairDadosWebhook(body);

  // sem chat ou sem texto, não há o que fazer
  if (!chatId) return;

  // --------------------------------------
  // Proteção contra loop:
  // ignora notas internas (inclusive as que o próprio bot cria) e
  // mensagens enviadas por operadores/membros do time.
  // Só seguimos com mensagens vindas do CLIENTE.
  // --------------------------------------
  if (isPrivate === true) return;
  if (source === "Member") return;

  const limpo = (texto || "").trim();
  if (!limpo) return;

  // --------------------------------------
  // Ativa o modo IA quando o cliente digita "4".
  // Já tenta identificar a empresa por um CNPJ que o cliente possa ter
  // informado ANTES, no histórico recente da conversa.
  // --------------------------------------
  if (limpo === WHATSAPP.TRIGGER) {
    ativarModoIA(chatId);
    await enviarNotaInterna(
      chatId,
      "🤖 *Modo IA ativado (teste interno).*\n\nA partir de agora as perguntas deste cliente serão respondidas automaticamente como nota interna. Digite 0 para desativar."
    );

    const cnpjHistorico = await buscarCNPJnoHistorico(chatId);
    if (cnpjHistorico) {
      // CNPJ já informado antes -> consulta imediata, sem pedir de novo
      await coletarEmpresa(chatId, cnpjHistorico);
    } else {
      await enviarNotaInterna(chatId, MSG_PEDIR_CNPJ);
    }
    return;
  }

  // --------------------------------------
  // Desativa o modo IA
  // --------------------------------------
  if (WHATSAPP.EXIT.includes(limpo.toLowerCase())) {
    desativarModoIA(chatId);
    await enviarNotaInterna(chatId, "🤖 Modo IA desativado.");
    return;
  }

  // só age se o chat estiver em modo IA
  if (!estaEmModoIA(chatId)) return;

  // --------------------------------------
  // Antes de responder dúvidas técnicas, identificar a empresa.
  // Enquanto a empresa não estiver identificada, o bot não responde
  // dúvidas — ele coleta/solicita os dados de identificação.
  // --------------------------------------
  if (!empresaIdentificada(chatId)) {
    await identificarEmpresa(chatId, limpo);
    return;
  }

  // empresa já identificada -> responder a dúvida pela documentação
  await responderDuvida(chatId, limpo);
}

// ======================================
// IDENTIFICAÇÃO DA EMPRESA
// ======================================

async function identificarEmpresa(chatId, texto) {
  const cnpjDigitos = extrairCNPJ(texto);

  // Sem CNPJ válido -> SEMPRE pedir o CNPJ (marca/ID/nome não bastam).
  if (!cnpjDigitos) {
    await enviarNotaInterna(chatId, MSG_PEDIR_CNPJ);
    return;
  }

  // Com CNPJ -> busca imediata na API da Accon (sem perguntas adicionais).
  await coletarEmpresa(chatId, cnpjDigitos);
}

// --------------------------------------
// Procura um CNPJ no histórico recente da conversa (últimas mensagens).
// O histórico tem PRIORIDADE: o cliente pode ter informado o CNPJ antes
// de acionar o bot. Retorna os 14 dígitos ou null.
// --------------------------------------

async function buscarCNPJnoHistorico(chatId) {
  const mensagens = await buscarHistoricoChat(chatId, 20);

  for (const msg of mensagens) {
    const texto = msg?.content || msg?.Content || "";
    const cnpj = extrairCNPJ(texto);
    if (cnpj) return cnpj;
  }

  return null;
}

// --------------------------------------
// Consulta a API da Accon e salva os dados da empresa na sessão.
// Enquanto a sessão estiver ativa, não consulta de novo (o contexto
// guarda os dados e evita repetir a busca / o pedido de CNPJ).
// --------------------------------------

async function coletarEmpresa(chatId, cnpjDigitos) {
  const cnpj = formatarCNPJ(cnpjDigitos);

  await enviarNotaInterna(chatId, "🔄 Coletando dados da empresa...");

  let dados;
  try {
    dados = await buscarDadosEmpresa(cnpj);
  } catch (error) {
    console.log(
      "❌ Erro ao consultar a API Accon:",
      error.response?.status,
      error.message
    );
    await enviarNotaInterna(
      chatId,
      "❌ Não consegui coletar os dados dessa empresa agora. Tente novamente em instantes."
    );
    return;
  }

  await enviarNotaInterna(chatId, formatarDadosEmpresa(dados, cnpj));

  // --------------------------------------
  // Identificação da versão da Accon — ANTES de qualquer busca no GitBook.
  // Accon 1.0 -> NÃO há atendimento automático: avisa e encerra a IA.
  // Accon 2.0 -> segue o atendimento automático normalmente.
  // --------------------------------------
  const versao = detectarVersaoAccon(dados);

  if (versao === "1.0") {
    await enviarNotaInterna(chatId, MSG_ACCON_1_0);
    // encerra o fluxo da IA: nada de responder dúvidas, aguarda atendimento humano
    desativarModoIA(chatId);
    return;
  }

  // Accon 2.0 -> empresa identificada; o atendimento automático continua
  definirContexto(chatId, { empresa: { cnpj, dados, versao } });
}

// ======================================
// RESPOSTA DA DÚVIDA (documentação)
// ======================================

async function responderDuvida(chatId, pergunta) {
  // IMPORTANTE: somente spaces públicos (PUBLIC_SPACES) — o cliente final
  // nunca pode acessar a "Base de conhecimento Accon" (dados sensíveis).
  let docs = await searchGitBook(pergunta, PUBLIC_SPACES);

  if (docs[0]) {
    const fullPage = await getFullPageContent(docs[0].spaceId, docs[0].pageId);
    if (fullPage) {
      docs[0].body = fullPage;
    }
  }

  // includeSources: false -> a IA não envia links/fontes ao cliente final
  let resposta = await generateAnswer(pergunta, docs, null, {
    includeSources: false,
  });
  resposta = cleanText(resposta);

  // segurança extra: remove qualquer bloco de fontes que escape do modelo
  resposta = resposta.split("📚 Fontes:")[0].trim();

  await enviarNotaInterna(chatId, `📘 *Resposta da IA (teste)*\n\n${resposta}`);
}

module.exports = {
  handleWebhook,
};
