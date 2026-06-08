// ======================================
// WHATSAPP: LÓGICA DO BOT
// ======================================
//
// Controle MANUAL pelos atendentes via NOTAS INTERNAS da Umbler.
// O cliente NÃO ativa mais nada (sem "4"); a IA só age em conversas
// explicitamente ativadas por um atendente.
//
// Comandos (SOMENTE em notas internas):
//   #ativar           -> ativa a IA nesta conversa
//   #desativar        -> desativa a IA e limpa o estado
//   #cnpj [valor]     -> define o CNPJ, consulta a API Accon e salva empresa+versão
//   #comandos         -> lista os comandos
//
// Mensagem do CLIENTE (só processada se a IA estiver ativada):
//   1. IA ativada?  2. CNPJ salvo?  3. Versão identificada?
//   -> 1.0: informa para aguardar a equipe (não usa IA/GitBook)
//   -> 2.0: agrupa (janela de espera) e responde com IA + contexto + imagens
//
// Reaproveita a BUSCA do GitBook e o CLIENT OpenAI compartilhados, sem
// alterar o comportamento do Slack. A geração da resposta é própria
// (whatsapp/ia.js). Tudo é postado como NOTA INTERNA (cliente não vê).

const { PUBLIC_SPACES } = require("../config");
const { searchGitBook, getFullPageContent } = require("../services/gitbook");
const { enviarNotaInterna, buscarHistoricoChat } = require("../services/umbler");
const { cleanText } = require("../utils/text");
const { extrairDadosWebhook } = require("./parser");
const {
  ativarModoIA,
  desativarModoIA,
  estaEmModoIA,
  definirContexto,
  obterContexto,
} = require("./session");
const { extrairCNPJ, formatarCNPJ } = require("./identify");
const {
  buscarDadosEmpresa,
  extrairNomeEmpresa,
  detectarVersaoAccon,
} = require("./accon");
const { gerarRespostaIA } = require("./ia");
const { obterImagemBase64 } = require("./imagem");
const { agendarProcessamento } = require("./buffer");

// --------------------------------------
// Mensagens fixas (notas internas)
// --------------------------------------

const MSG_ACCON_1_0 =
  "Identifiquei que você ainda está na versão 1.0 da Accon.\n\n" +
  "Aguarde o nosso time especialista entrar às 10:00 horas que irão te " +
  "chamar assim que iniciar o expediente para te auxiliar.";

const MSG_COMANDOS =
  "📋 Comandos disponíveis\n\n" +
  "#ativar\n→ Ativa a IA nesta conversa.\n\n" +
  "#desativar\n→ Desativa a IA nesta conversa.\n\n" +
  "#cnpj [CNPJ]\n→ Define manualmente o CNPJ da empresa e coleta os dados da API Accon.\n\n" +
  "#comandos\n→ Exibe esta lista de comandos.";

// ======================================
// ENTRADA
// ======================================

async function handleWebhook(body) {
  const { chatId, texto, source, isPrivate, file } = extrairDadosWebhook(body);

  if (!chatId) return;

  const limpo = (texto || "").trim();

  // --------------------------------------
  // NOTAS INTERNAS -> comandos do atendente.
  // Só reage a notas que começam com um comando conhecido (#...), o que
  // evita reagir às notas que o próprio bot cria (que nunca começam com #).
  // Comandos NUNCA são interpretados em mensagens do cliente.
  // --------------------------------------
  if (isPrivate === true) {
    if (ehComando(limpo)) {
      await executarComando(chatId, limpo);
    }
    return;
  }

  // --------------------------------------
  // Daqui pra baixo: mensagens NÃO privadas.
  // Ignora mensagens de operadores (visíveis ao cliente) — só o cliente segue.
  // --------------------------------------
  if (source === "Member") return;

  // a IA só age em conversas explicitamente ativadas
  if (!estaEmModoIA(chatId)) return;

  const ctx = obterContexto(chatId);

  // PRIORIDADE 2 e 3: precisa de CNPJ + versão já definidos (via #cnpj)
  if (!ctx.empresa) {
    if (!ctx.avisadoSemCnpj) {
      definirContexto(chatId, { avisadoSemCnpj: true });
      await enviarNotaInterna(
        chatId,
        "⚠️ IA ativada, mas ainda sem CNPJ nesta conversa. Use *#cnpj [CNPJ]* para coletar os dados antes de responder."
      );
    }
    return;
  }

  // PRIORIDADE 4: loja 1.0 -> não há atendimento automático
  if (ctx.empresa.versao === "1.0") {
    await enviarNotaInterna(chatId, MSG_ACCON_1_0);
    return;
  }

  // loja 2.0 -> agrupa (texto + imagem) e processa após a janela de espera
  const imagem = await obterImagemBase64(file);
  if (!limpo && !imagem) return;

  agendarProcessamento(chatId, { texto: limpo, imagem }, processarAgrupado);
}

// ======================================
// COMANDOS (notas internas)
// ======================================

const COMANDOS = ["#desativar", "#ativar", "#cnpj", "#comandos"];

function ehComando(texto) {
  const t = texto.toLowerCase();
  return COMANDOS.some((cmd) => t.startsWith(cmd));
}

async function executarComando(chatId, texto) {
  const t = texto.toLowerCase();

  if (t.startsWith("#desativar")) {
    desativarModoIA(chatId);
    await enviarNotaInterna(
      chatId,
      "⛔ IA desativada com sucesso.\n\nEsta conversa não será mais processada automaticamente."
    );
    return;
  }

  if (t.startsWith("#ativar")) {
    ativarModoIA(chatId);
    await enviarNotaInterna(
      chatId,
      "🤖 IA ativada com sucesso.\n\nA partir de agora esta conversa será analisada automaticamente pela IA."
    );
    return;
  }

  if (t.startsWith("#cnpj")) {
    await comandoCnpj(chatId, texto);
    return;
  }

  if (t.startsWith("#comandos")) {
    await enviarNotaInterna(chatId, MSG_COMANDOS);
    return;
  }
}

// --------------------------------------
// #cnpj [valor] -> normaliza, consulta a API Accon e salva empresa + versão.
// --------------------------------------

async function comandoCnpj(chatId, texto) {
  // remove o "#cnpj" e procura um CNPJ no restante
  const resto = texto.replace(/#cnpj/i, " ");
  const cnpjDigitos = extrairCNPJ(resto);

  if (!cnpjDigitos) {
    await enviarNotaInterna(
      chatId,
      "⚠️ CNPJ inválido. Use: *#cnpj 08.665.931/0001-40* (ou só os números)."
    );
    return;
  }

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

  const versao = detectarVersaoAccon(dados);
  const nome = extrairNomeEmpresa(dados) || "(não informado)";

  // vincula os dados à conversa; não pede o CNPJ novamente
  definirContexto(chatId, { empresa: { cnpj, dados, versao, nome } });

  await enviarNotaInterna(
    chatId,
    `✅ Dados coletados com sucesso.\n\nEmpresa:\n${nome}\n\nCNPJ:\n${cnpj}\n\nVersão:\n${versao}`
  );
}

// ======================================
// RESPOSTA DA DÚVIDA (agrupada + contexto + imagens) — lojas 2.0
// ======================================

// --------------------------------------
// Monta um transcript legível das últimas mensagens do chat, para dar
// memória de conversa à IA. Ignora comandos (#...) para não poluir.
// --------------------------------------

function montarTranscricao(mensagens) {
  return mensagens
    .map((m) => {
      const txt = (m?.content || m?.Content || "").trim();
      if (!txt) return "";
      if (txt.startsWith("#")) return ""; // não inclui comandos no contexto

      const origem = m?.source || m?.Source;
      const privada = m?.isPrivate || m?.IsPrivate;

      let quem = origem === "Member" ? "Atendente" : "Cliente";
      if (privada) quem = "Nota interna";

      return `${quem}: ${txt}`;
    })
    .filter(Boolean)
    .slice(-20)
    .join("\n");
}

async function processarAgrupado({ chatId, pergunta, imagens }) {
  if (!pergunta && (!imagens || imagens.length === 0)) return;

  // PRIORIDADE 1: dados da empresa (API Accon), já coletados na sessão
  const dadosEmpresa = obterContexto(chatId).empresa?.dados || "";

  // PRIORIDADE 2: contexto recente da conversa (memória)
  let transcricao = "";
  try {
    const mensagens = await buscarHistoricoChat(chatId, 20);
    transcricao = montarTranscricao(mensagens);
  } catch {}

  // PRIORIDADE 4: documentação (apenas spaces públicos — Central de Ajuda)
  let docs = await searchGitBook(pergunta || "", PUBLIC_SPACES);
  if (docs[0]) {
    const fullPage = await getFullPageContent(docs[0].spaceId, docs[0].pageId);
    if (fullPage) {
      docs[0].body = fullPage;
    }
  }

  // PRIORIDADE 5: resposta da IA (texto + imagens)
  let resposta = await gerarRespostaIA({
    pergunta,
    docs,
    transcricao,
    dadosEmpresa,
    imagens,
  });

  resposta = cleanText(resposta);
  // segurança extra: remove qualquer bloco de fontes que escape do modelo
  resposta = resposta.split("📚 Fontes:")[0].trim();

  await enviarNotaInterna(chatId, `📘 *Resposta da IA (teste)*\n\n${resposta}`);
}

module.exports = {
  handleWebhook,
};
