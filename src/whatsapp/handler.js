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

const { PUBLIC_SPACES, TREINAMENTO, GITBOOK } = require("../config");
const { searchGitBook, getFullPageContent } = require("../services/gitbook");
const {
  enviarNotaInterna,
  buscarHistoricoChat,
  buscarNomeMembro,
} = require("../services/umbler");
const { cleanText } = require("../utils/text");
const { extrairDadosWebhook } = require("./parser");
const {
  ativarModoIA,
  desativarModoIA,
  estaEmModoIA,
  definirContexto,
  obterContexto,
  resetarConversa,
  iniciarDoc,
  pararDoc,
  estaDocAtivo,
  obterDocInicio,
  bloquearDoc,
  docEstaBloqueado,
} = require("./session");
const { extrairCNPJ, formatarCNPJ } = require("./identify");
const {
  buscarDadosEmpresa,
  extrairNomeEmpresa,
  detectarVersaoAccon,
} = require("./accon");
const { gerarRespostaIA } = require("./ia");
const { obterImagemBase64 } = require("./imagem");
const { transcreverAudio } = require("./audio");
const { agendarProcessamento, limparBuffer } = require("./buffer");
const { calcularInicioContexto } = require("./contexto");
const {
  salvarLoja,
  montarLoja,
  revalidarLojas,
  limparObservacoes,
  obterLojasContato,
  formatarRelatorioLojas,
  agoraFormatado,
} = require("./lojas");
const { gerarTreinamento, treinarManual } = require("./treinamento");
const {
  gerarRelatorioFinalizados,
  parseArgs: parseFinalizadosArgs,
} = require("./finalizados");

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
  "#resetar\n→ Remove todos os dados armazenados pela IA nesta conversa e reinicia o atendimento do zero.\n\n" +
  "#desativardoc\n→ Mantém a IA ativa, mas interrompe a documentação automática desta conversa.\n\n" +
  "#treinamento [texto]\n→ Ensina uma nova informação diretamente para a IA. O conteúdo será categorizado e armazenado na base de treinamento para uso futuro.\n\n" +
  "#finalizados\n→ Exibe os 15 atendimentos finalizados mais recentes e informa se cada um foi documentado ou não.\n\n" +
  "#lojas\n→ Exibe todas as lojas atualmente cadastradas nas Observações do contato.\n\n" +
  "#limpar\n→ Remove completamente todas as informações armazenadas nas Observações do contato atual.\n\n" +
  "#comandos\n→ Exibe esta lista de comandos.";

const MSG_RESET =
  "🔄 Conversa resetada com sucesso.\n\n" +
  "Todos os dados da IA foram removidos.\n\n" +
  "Na próxima interação será necessário informar novamente o CNPJ da empresa para iniciar o atendimento.";

// --------------------------------------
// Detecção das notas-gatilho (sistema Umbler)
// --------------------------------------

function ehGatilhoInicioDoc(texto) {
  return TREINAMENTO.DOC_INICIO.some((frase) => texto.includes(frase));
}

function ehGatilhoFimDoc(texto) {
  return TREINAMENTO.DOC_FIM.some((frase) => texto.includes(frase));
}

// ======================================
// ENTRADA
// ======================================

async function handleWebhook(body) {
  const { chatId, texto, source, isPrivate, file, eventAt, autorId } =
    extrairDadosWebhook(body);

  if (!chatId) return;

  const limpo = (texto || "").trim();

  // --------------------------------------
  // GATILHOS AUTOMÁTICOS DE DOCUMENTAÇÃO (eventos do sistema Umbler).
  // Independentes de #ativar/#desativar e de quem enviou:
  //  - INÍCIO: o chat entra no setor Suporte -> começa a captura.
  //  - FIM: o atendimento é encerrado -> gera a documentação.
  // --------------------------------------
  if (limpo && ehGatilhoInicioDoc(limpo)) {
    // procura o INÍCIO REAL do problema antes da transferência (lookback
    // inteligente, limitado a CONTEXT_LOOKBACK_MINUTES) e começa a captura lá.
    if (!docEstaBloqueado(chatId)) {
      const desde = await calcularInicioContexto(chatId, eventAt);
      iniciarDoc(chatId, desde);
    }
    // novo atendimento: revalida as lojas conhecidas do contato na API Accon e
    // carrega no contexto da conversa (dispensa #cnpj).
    await carregarLojasContato(chatId);
    return;
  }
  if (limpo && ehGatilhoFimDoc(limpo)) {
    if (estaDocAtivo(chatId)) await finalizarTreinamento(chatId);
    pararDoc(chatId);
    return;
  }

  // --------------------------------------
  // NOTAS INTERNAS -> comandos do atendente.
  // Só reage a notas que começam com um comando conhecido (#...), o que
  // evita reagir às notas que o próprio bot cria (que nunca começam com #).
  // Comandos NUNCA são interpretados em mensagens do cliente.
  // --------------------------------------
  if (isPrivate === true) {
    if (ehComando(limpo)) {
      await executarComando(chatId, limpo, autorId);
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
  const lojasContato = ctx.lojas || [];

  // empresa selecionada: #cnpj tem prioridade; senão, loja única carregada.
  let empresa = ctx.empresa || null;
  if (!empresa && lojasContato.length === 1) empresa = lojasContato[0];

  // Sem NENHUMA loja conhecida (nem #cnpj nem cadastro no contato) -> pede CNPJ.
  if (!empresa && lojasContato.length === 0) {
    if (!ctx.avisadoSemCnpj) {
      definirContexto(chatId, { avisadoSemCnpj: true });
      await enviarNotaInterna(
        chatId,
        "⚠️ IA ativada, mas ainda sem CNPJ nesta conversa. Use *#cnpj [CNPJ]* para coletar os dados antes de responder."
      );
    }
    return;
  }

  // Loja SELECIONADA (única ou via #cnpj) na versão 1.0 -> sem atendimento
  // automático. Quando há múltiplas lojas e nenhuma selecionada, `empresa` é
  // null: a IA identifica a loja e trata o 1.0 conforme o prompt.
  if (empresa && empresa.versao === "1.0") {
    await enviarNotaInterna(chatId, MSG_ACCON_1_0);
    return;
  }

  // loja 2.0 -> agrupa (texto + imagem + áudio transcrito) e processa após a
  // janela de espera. Texto, imagem e áudio compõem UMA única solicitação.
  const imagem = await obterImagemBase64(file);
  if (imagem) {
    console.log(
      `🖼️ Imagem processada (${imagem.contentType}) — enviada ao modelo multimodal.`
    );
  }
  const transcricao = await transcreverAudio(file);
  if (!limpo && !imagem && !transcricao) return;

  agendarProcessamento(
    chatId,
    { texto: limpo, imagem, transcricao },
    processarAgrupado
  );
}

// ======================================
// COMANDOS (notas internas)
// ======================================

const COMANDOS = [
  "#desativardoc",
  "#desativar",
  "#ativar",
  "#cnpj",
  "#resetar",
  "#treinamento",
  "#finalizados",
  "#lojas",
  "#limpar",
  "#comandos",
];

function ehComando(texto) {
  const t = texto.toLowerCase();
  return COMANDOS.some((cmd) => t.startsWith(cmd));
}

async function executarComando(chatId, texto, autorId) {
  const t = texto.toLowerCase();

  // IMPORTANTE: #desativardoc vem ANTES de #desativar (prefixo em comum).
  // A documentação é controlada pelos eventos da Umbler; este comando apenas
  // interrompe e BLOQUEIA a documentação desta conversa (não gera no fim).
  if (t.startsWith("#desativardoc")) {
    bloquearDoc(chatId);
    await enviarNotaInterna(
      chatId,
      "📕 Documentação automática interrompida nesta conversa.\n\nA IA continua respondendo normalmente; apenas a documentação foi desativada."
    );
    return;
  }

  // #desativar/#ativar controlam SOMENTE as respostas da IA (não a documentação).
  if (t.startsWith("#desativar")) {
    desativarModoIA(chatId);
    await enviarNotaInterna(
      chatId,
      "⛔ Respostas automáticas da IA desativadas nesta conversa."
    );
    return;
  }

  if (t.startsWith("#ativar")) {
    ativarModoIA(chatId);
    // lê as Observações do contato, revalida as lojas na API e carrega no
    // contexto — se já houver CNPJ salvo, NÃO pede o CNPJ de novo.
    const lojas = await carregarLojasContato(chatId);
    const msg = lojas.length
      ? `🤖 IA ativada. ${lojas.length} loja(s) já cadastrada(s) no contato — carregada(s) e revalidada(s) na API. Não é preciso informar o CNPJ.`
      : "🤖 IA ativada. Nenhuma loja cadastrada neste contato — use *#cnpj [CNPJ]* para vincular uma loja.";
    await enviarNotaInterna(chatId, msg);
    return;
  }

  if (t.startsWith("#cnpj")) {
    await comandoCnpj(chatId, texto);
    return;
  }

  if (t.startsWith("#resetar")) {
    // apaga TODO o estado da conversa (contexto + agrupamento pendente).
    // Mantém a IA ativada; a próxima interação começa do zero (sem CNPJ).
    resetarConversa(chatId);
    limparBuffer(chatId);
    await enviarNotaInterna(chatId, MSG_RESET);
    return;
  }

  if (t.startsWith("#treinamento")) {
    await comandoTreinamento(chatId, texto);
    return;
  }

  if (t.startsWith("#finalizados")) {
    await comandoFinalizados(chatId, texto);
    return;
  }

  if (t.startsWith("#lojas")) {
    await comandoLojas(chatId, autorId);
    return;
  }

  if (t.startsWith("#limpar")) {
    await comandoLimpar(chatId, autorId);
    return;
  }

  if (t.startsWith("#comandos")) {
    await enviarNotaInterna(chatId, MSG_COMANDOS);
    return;
  }
}

// --------------------------------------
// #lojas -> exibe as lojas cadastradas nas Observações do contato (leitura).
// Só por nota interna (atendente). Registra log de auditoria.
// --------------------------------------

async function comandoLojas(chatId, autorId) {
  let dados;
  try {
    dados = await obterLojasContato(chatId);
  } catch (error) {
    console.log("❌ Erro ao consultar lojas:", error.message);
    await enviarNotaInterna(
      chatId,
      "❌ Não consegui consultar as lojas agora. Tente novamente em instantes."
    );
    return;
  }

  // LOG de auditoria
  const autor = (await buscarNomeMembro(autorId)) || autorId || "(atendente)";
  console.log(
    `🏪 Ação: Consulta de lojas | Executado por: ${autor} | ` +
      `Data: ${agoraFormatado()} | Quantidade: ${dados.lojas.length}`
  );

  await enviarNotaInterna(
    chatId,
    formatarRelatorioLojas(dados.lojas, dados.validadoEm)
  );
}

// --------------------------------------
// #limpar -> remove COMPLETAMENTE as Observações do contato atual.
// Só por nota interna (atendente). Registra log de auditoria.
// --------------------------------------

async function comandoLimpar(chatId, autorId) {
  let res;
  try {
    res = await limparObservacoes(chatId);
  } catch (error) {
    console.log("❌ Erro ao limpar observações:", error.message);
    await enviarNotaInterna(
      chatId,
      "❌ Não consegui limpar as observações agora. Tente novamente em instantes."
    );
    return;
  }

  if (!res.ok) {
    await enviarNotaInterna(
      chatId,
      "❌ Não consegui identificar o contato desta conversa para limpar as observações."
    );
    return;
  }

  // LOG de auditoria: quem executou, quando e qual contato
  const autor = (await buscarNomeMembro(autorId)) || autorId || "(atendente)";
  console.log(
    `🧹 Ação: Limpeza das observações | Executado por: ${autor} | ` +
      `Data: ${agoraFormatado()} | Contato: ${res.contato || "(?)"} | ` +
      `notas removidas: ${res.removidas}`
  );

  await enviarNotaInterna(
    chatId,
    "🧹 Observações do contato limpas com sucesso.\n\nTodas as informações armazenadas foram removidas."
  );
}

// --------------------------------------
// #finalizados [n | nao-documentados | hoje] -> lista os últimos atendimentos
// finalizados na Umbler e marca quais já têm documentação gerada.
// --------------------------------------

async function comandoFinalizados(chatId, texto) {
  const args = parseFinalizadosArgs(texto);

  let relatorio;
  try {
    relatorio = await gerarRelatorioFinalizados(args);
  } catch (error) {
    console.log("❌ Erro ao consultar finalizados:", error.message);
    await enviarNotaInterna(
      chatId,
      "❌ Não consegui consultar os atendimentos finalizados agora. Tente novamente em instantes."
    );
    return;
  }

  // LOG da consulta (auditoria)
  console.log(
    `📋 Consulta de finalizados executada | origem(chat)=${chatId} | ` +
      `filtro=${args.filtro} | quantidade retornada=${relatorio.quantidade}`
  );

  await enviarNotaInterna(chatId, relatorio.texto);
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
  const nomeApi = extrairNomeEmpresa(dados); // "" se a API não trouxe dados válidos
  const nome = nomeApi || "(não informado)";

  // vincula os dados à conversa; não pede o CNPJ novamente
  definirContexto(chatId, { empresa: { cnpj, dados, versao, nome } });

  await enviarNotaInterna(
    chatId,
    `✅ Dados coletados com sucesso.\n\nEmpresa:\n${nome}\n\nCNPJ:\n${cnpj}\n\nVersão:\n${versao}`
  );

  // persiste a loja nas Observações do contato (cache/histórico) — SOMENTE se a
  // API retornou dados válidos (tem nome de loja). CNPJ inválido é ignorado.
  if (nomeApi) {
    try {
      await salvarLoja(chatId, montarLoja(dados, cnpj));
    } catch (error) {
      console.log("⚠️ Falha ao salvar loja nas observações:", error.message);
    }
  }
}

// --------------------------------------
// #treinamento [texto] -> conhecimento explícito do atendente para a IA.
// --------------------------------------

async function comandoTreinamento(chatId, texto) {
  const conteudo = texto.replace(/#treinamento/i, "").trim();

  if (!conteudo) {
    await enviarNotaInterna(
      chatId,
      "⚠️ Use: *#treinamento <o que você quer ensinar à IA>*"
    );
    return;
  }

  const res = await treinarManual(conteudo);

  const notas = {
    ok:
      `🧠 Treinamento registrado com sucesso.\n\n` +
      `Categoria identificada: ${res.categoria}\n\n` +
      `O conhecimento foi incorporado à base de treinamento da IA.`,
    vazio:
      "⚠️ Não consegui extrair um conhecimento desse texto. Tente detalhar melhor o problema e a solução.",
    erro: "❌ Não consegui registrar o treinamento agora. Tente novamente em instantes.",
    falha_persistencia:
      "⚠️ Treinamento gerado, mas NÃO salvo no GitBook. Configure GITHUB_TOKEN + GITHUB_REPO_TREINAMENTO (repo Git-Synced ao espaço).",
  };

  await enviarNotaInterna(chatId, notas[res.status] || notas.erro);
}

// --------------------------------------
// Gera e grava a documentação de treinamento da janela atual e avisa o
// resultado por nota interna.
// --------------------------------------

async function finalizarTreinamento(chatId) {
  let res;
  try {
    res = await gerarTreinamento(chatId, obterDocInicio(chatId));
  } catch (error) {
    console.log("❌ Erro no treinamento:", error.message);
    res = { status: "erro" };
  }

  const notas = {
    ok: `📚 Treinamento salvo: *${res.categoria}* → ${res.titulo}`,
    vazio:
      "ℹ️ Nada para documentar (sem conversa de cliente/atendente na janela).",
    anydesk:
      "ℹ️ Atendimento resolvido por acesso remoto (AnyDesk) — não documentado (não gera conhecimento reaproveitável).",
    erro: "❌ Não consegui gerar a documentação de treinamento agora.",
    falha_persistencia:
      "⚠️ Documentação gerada, mas NÃO salva no GitBook. Configure GITHUB_TOKEN + GITHUB_REPO_TREINAMENTO (repo Git-Synced ao espaço).",
  };

  await enviarNotaInterna(chatId, notas[res.status] || notas.erro);
}

// ======================================
// RESPOSTA DA DÚVIDA (agrupada + contexto + imagens) — lojas 2.0
// ======================================

// --------------------------------------
// Monta um transcript legível das últimas mensagens do chat, para dar
// memória de conversa à IA. Ignora comandos (#...) para não poluir.
// --------------------------------------

function montarTranscricao(mensagens, resetEm = 0) {
  return mensagens
    .filter((m) => {
      // após um #resetar, ignora o que veio ANTES do reset (esquece o passado)
      if (!resetEm) return true;
      const ts = Date.parse(m?.eventAtUTC || m?.EventAtUTC || "");
      return Number.isNaN(ts) ? true : ts >= resetEm;
    })
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

// --------------------------------------
// Revalida as lojas do contato na API Accon (lendo as Observações) e carrega
// no contexto da conversa. Auto-seleciona quando há 1 loja. Retorna o array
// (vazio se o contato não tiver loja cadastrada). Usado no início do
// atendimento e no #ativar — evita pedir CNPJ quando já existe um salvo.
// --------------------------------------

async function carregarLojasContato(chatId) {
  try {
    const lojasContato = await revalidarLojas(chatId);
    if (lojasContato && lojasContato.length) {
      definirContexto(chatId, { lojas: lojasContato });
      if (lojasContato.length === 1 && !obterContexto(chatId).empresa) {
        const l = lojasContato[0];
        definirContexto(chatId, {
          empresa: { cnpj: l.cnpj, dados: l.dados || "", versao: l.versao, nome: l.nome },
        });
        console.log(`🏬 Loja única carregada no contexto: ${l.nome} (v${l.versao}).`);
      } else if (lojasContato.length > 1) {
        console.log(`🏬 ${lojasContato.length} lojas do contato carregadas no contexto.`);
      }
    }
    return lojasContato || [];
  } catch (error) {
    console.log("⚠️ Falha ao revalidar/carregar lojas:", error.message);
    return [];
  }
}

async function processarAgrupado({ chatId, pergunta, imagens, transcricoes }) {
  const audios = transcricoes || [];
  if (!pergunta && (!imagens || imagens.length === 0) && audios.length === 0) {
    return;
  }

  // PRIORIDADE 1: dados da(s) loja(s) do cliente (API Accon), já no contexto
  const ctx = obterContexto(chatId);
  const lojas = ctx.lojas || [];
  const empresa = ctx.empresa || (lojas.length === 1 ? lojas[0] : null);
  const dadosEmpresa = empresa?.dados || "";

  // PRIORIDADE 2: contexto recente da conversa (memória), ignorando o que
  // veio antes de um eventual #resetar.
  let transcricao = "";
  try {
    const mensagens = await buscarHistoricoChat(chatId, 20);
    transcricao = montarTranscricao(mensagens, ctx.resetEm || 0);
  } catch {}

  // PRIORIDADE 4: documentação (apenas spaces públicos — Central de Ajuda).
  // A busca usa texto + transcrições de áudio (essencial quando o cliente
  // manda só áudio, sem texto).
  const textoBusca = [pergunta, ...audios].filter(Boolean).join(" ").trim();
  // busca na Central de Ajuda (oficial) E no Treinamento IA Whatsapp (perguntas
  // de diagnóstico e como responder, aprendidas de atendimentos anteriores).
  const espacosBusca = [
    ...PUBLIC_SPACES,
    { name: GITBOOK.TREINAMENTO_SPACE_NAME, id: GITBOOK.TREINAMENTO_SPACE_ID },
  ];
  let docs = await searchGitBook(textoBusca, espacosBusca);
  if (docs[0]) {
    const fullPage = await getFullPageContent(docs[0].spaceId, docs[0].pageId);
    if (fullPage) {
      docs[0].body = fullPage;
    }
  }

  // PRIORIDADE 5: resposta da IA (texto + áudios transcritos + imagens)
  let resposta = await gerarRespostaIA({
    pergunta,
    docs,
    transcricao,
    dadosEmpresa,
    imagens,
    audios,
    lojas,
  });

  resposta = cleanText(resposta);
  // segurança extra: remove qualquer bloco de fontes que escape do modelo
  resposta = resposta.split("📚 Fontes:")[0].trim();

  await enviarNotaInterna(chatId, `📘 *Resposta da IA (teste)*\n\n${resposta}`);
}

module.exports = {
  handleWebhook,
};
