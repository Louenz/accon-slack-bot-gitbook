// ======================================
// WHATSAPP: LÓGICA DO BOT
// ======================================
//
// Fluxo:
//   1. Cliente digita "4"        -> ativa o modo IA naquele chat
//   2. IDENTIFICAÇÃO DA EMPRESA  -> antes de responder dúvidas técnicas, o
//      bot tenta identificar a empresa pelo CNPJ (consulta a API da Accon).
//   3. Empresa identificada      -> responde dúvidas com base na documentação
//      (GitBook), postando como NOTA INTERNA (teste seguro).
//   4. Cliente digita "0/sair"   -> desativa o modo IA e limpa o contexto.
//
// Reaproveita a busca e a geração de resposta compartilhadas
// (services/gitbook + services/openai), restritas ao comportamento do
// WhatsApp por configuração (PUBLIC_SPACES + includeSources:false).

const { WHATSAPP, PUBLIC_SPACES } = require("../config");
const { searchGitBook, getFullPageContent } = require("../services/gitbook");
const { generateAnswer } = require("../services/openai");
const { enviarNotaInterna } = require("../services/umbler");
const { cleanText } = require("../utils/text");
const { extrairDadosWebhook } = require("./parser");
const {
  ativarModoIA,
  desativarModoIA,
  estaEmModoIA,
  definirContexto,
  empresaIdentificada,
} = require("./session");
const {
  extrairCNPJ,
  formatarCNPJ,
  detectarMarca,
  detectarIdLoja,
} = require("./identify");
const { buscarDadosEmpresa, formatarDadosEmpresa } = require("./accon");

// --------------------------------------
// Mensagens fixas (notas internas)
// --------------------------------------

const MSG_PEDIR_DADOS =
  "Antes de continuar, poderia me informar um dos dados abaixo?\n\n" +
  "• CNPJ da empresa\n" +
  "• Nome da marca\n" +
  "• ID da loja";

const MSG_SO_MARCA =
  "Identifiquei a marca informada.\n\n" +
  "Atualmente consigo consultar automaticamente apenas por CNPJ.\n\n" +
  "Poderia me informar o CNPJ da empresa?";

const MSG_SO_ID_LOJA =
  "Identifiquei o ID da loja informado.\n\n" +
  "Atualmente consigo consultar automaticamente apenas por CNPJ.\n\n" +
  "Poderia me informar o CNPJ da empresa?";

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
  // Ativa o modo IA quando o cliente digita "4"
  // --------------------------------------
  if (limpo === WHATSAPP.TRIGGER) {
    ativarModoIA(chatId);
    await enviarNotaInterna(
      chatId,
      "🤖 *Modo IA ativado (teste interno).*\n\nA partir de agora as perguntas deste cliente serão respondidas automaticamente como nota interna. Digite 0 para desativar."
    );
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
  // 1) CNPJ -> busca imediata na API da Accon (sem perguntas adicionais)
  const cnpjDigitos = extrairCNPJ(texto);
  if (cnpjDigitos) {
    const cnpj = formatarCNPJ(cnpjDigitos);

    await enviarNotaInterna(chatId, "🔄 Coletando dados da empresa...");

    try {
      const dados = await buscarDadosEmpresa(cnpj);
      definirContexto(chatId, { empresa: { cnpj, dados } });
      await enviarNotaInterna(chatId, formatarDadosEmpresa(dados, cnpj));
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
    }
    return;
  }

  // 2) Apenas nome da marca -> armazena para uso futuro (ainda não busca)
  const marca = detectarMarca(texto);
  if (marca) {
    definirContexto(chatId, { marca });
    await enviarNotaInterna(chatId, MSG_SO_MARCA);
    return;
  }

  // 3) Apenas ID da loja -> armazena para uso futuro (ainda não busca)
  const idLoja = detectarIdLoja(texto);
  if (idLoja) {
    definirContexto(chatId, { idLoja });
    await enviarNotaInterna(chatId, MSG_SO_ID_LOJA);
    return;
  }

  // 4) Nada informado -> pede um dos dados de identificação
  await enviarNotaInterna(chatId, MSG_PEDIR_DADOS);
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
