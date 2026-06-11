// ======================================
// WHATSAPP: TREINAMENTO AUTOMÁTICO
// ======================================
//
// Ao encerrar a captura (#desativar), transforma a conversa real em uma
// tratativa de documentação e grava no espaço "Treinamento IA Whatsapp"
// (via GitHub/Git Sync). Usa SOMENTE mensagens de cliente e atendente
// (ignora notas internas, respostas da IA e comandos), anonimiza dados
// sensíveis e descarta atendimentos resolvidos por acesso remoto (AnyDesk).

const { openai } = require("../clients");
const { TREINAMENTO, PUBLIC_SPACES } = require("../config");
const categoriasCache = require("./categorias");
const { searchGitBook, getFullPageContent } = require("../services/gitbook");
const { buscarHistoricoChat, buscarContatoChat } = require("../services/umbler");
const { enviarTratativa, lerCategoria } = require("./github");
const { obterImagemBase64 } = require("./imagem");
const { transcreverAudio } = require("./audio");
const persistencia = require("./persistencia");

// teto de mídias (áudio/imagem) processadas por atendimento ao documentar,
// para limitar custo/tempo na finalização. Vale para cliente E atendente.
const MAX_MIDIA_DOC = 12;

// --------------------------------------
// Data de uma mensagem (várias chaves possíveis)
// --------------------------------------

function dataMsg(m) {
  return (
    m?.createdAtUTC ||
    m?.eventAtUTC ||
    m?.CreatedAtUTC ||
    m?.EventAtUTC ||
    m?.createdAt
  );
}

// --------------------------------------
// Anonimização: remove dados sensíveis antes de enviar à IA / salvar.
// --------------------------------------

function anonimizar(texto) {
  return String(texto)
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi, "[email]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[cnpj]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]")
    .replace(/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, "[telefone]")
    .replace(/\b\d{7,}\b/g, "[id]"); // IDs longos (loja/pedido)
}

// --------------------------------------
// Verifica se o atendimento usou acesso remoto (AnyDesk e similares).
// --------------------------------------

function usouAcessoRemoto(texto) {
  const t = texto.toLowerCase();
  return TREINAMENTO.ANYDESK_TERMS.some((termo) => t.includes(termo));
}

// --------------------------------------
// Monta a conversa (janela do treinamento), só cliente + atendente público.
// --------------------------------------

function montarConversaTreinamento(mensagens, desde) {
  const ordenadas = [...mensagens].sort(
    (a, b) => new Date(dataMsg(a)) - new Date(dataMsg(b))
  );

  const ehGatilho = (txt) =>
    TREINAMENTO.DOC_INICIO.some((f) => txt.includes(f)) ||
    TREINAMENTO.DOC_FIM.some((f) => txt.includes(f));

  let conversa = "";

  for (const m of ordenadas) {
    const txt = (m?.content || m?.Content || "").trim();
    if (!txt) continue;
    if (txt.startsWith("#")) continue; // comandos administrativos
    if (ehGatilho(txt)) continue; // notas-gatilho de início/fim

    // ignora notas internas (inclui as respostas da IA, que são privadas)
    if (m?.isPrivate || m?.IsPrivate) continue;

    // só dentro da janela do treinamento (a partir do #ativar)
    const ts = Date.parse(dataMsg(m));
    if (desde && !Number.isNaN(ts) && ts < desde) continue;

    const origem = m?.source || m?.Source;
    const autor = origem === "Member" ? "ATENDENTE" : "CLIENTE";

    conversa += `[${autor}] ${txt}\n`;
  }

  return conversa.trim();
}

// --------------------------------------
// Descreve, de forma curta e objetiva, o conteúdo relevante de uma imagem
// para incorporar à documentação. Ciente do autor: imagem do CLIENTE costuma
// mostrar o problema/erro; imagem do ATENDENTE costuma mostrar a solução,
// a configuração correta ou a orientação. Não inventa nada.
// --------------------------------------

async function descreverImagemParaDoc(file, autor = "CLIENTE") {
  try {
    const img = await obterImagemBase64(file);
    if (!img) return "";

    const foco =
      autor === "ATENDENTE"
        ? "Esta imagem foi enviada pelo ATENDENTE: capture a orientação, a configuração correta, o passo a passo ou a solução demonstrada."
        : "Esta imagem foi enviada pelo CLIENTE: capture o erro, a tela com problema, o alerta ou o sintoma.";

    const r = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content:
            "Você descreve, de forma objetiva e curta (1-3 frases), o conteúdo relevante de um print de suporte técnico (mensagens de erro, telas, configurações, orientações). Não invente. NÃO inclua dados pessoais (nomes, telefone, e-mail, CPF, CNPJ).",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${foco}\nDescreva o conteúdo relevante desta imagem para documentação de suporte:`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${img.contentType || "image/png"};base64,${img.base64}`,
              },
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 200,
    });

    return (r.choices[0].message.content || "").trim();
  } catch (error) {
    console.log("⚠️ Falha ao descrever imagem para doc:", error.message);
    return "";
  }
}

// --------------------------------------
// Igual ao montarConversaTreinamento, mas ENRIQUECE a conversa com a
// transcrição dos áudios e a descrição das imagens enviadas — para que a
// documentação reflita também o que veio em mídia (quando relevante).
// --------------------------------------

async function montarConversaComMidia(mensagens, desde) {
  const ordenadas = [...mensagens].sort(
    (a, b) => new Date(dataMsg(a)) - new Date(dataMsg(b))
  );

  const ehGatilho = (txt) =>
    TREINAMENTO.DOC_INICIO.some((f) => txt.includes(f)) ||
    TREINAMENTO.DOC_FIM.some((f) => txt.includes(f));

  let conversa = "";
  let midias = 0;

  for (const m of ordenadas) {
    // ignora notas internas (inclui respostas da IA, que são privadas)
    if (m?.isPrivate || m?.IsPrivate) continue;

    // só dentro da janela do treinamento
    const ts = Date.parse(dataMsg(m));
    if (desde && !Number.isNaN(ts) && ts < desde) continue;

    const origem = m?.source || m?.Source;
    // ignora mensagens de bot/triagem (não são do cliente nem do atendente) —
    // relevante porque a janela agora inclui o período antes da transferência.
    if (origem === "Bot") continue;
    const autor = origem === "Member" ? "ATENDENTE" : "CLIENTE";

    // texto
    const txt = (m?.content || m?.Content || "").trim();
    if (txt && !txt.startsWith("#") && !ehGatilho(txt)) {
      conversa += `[${autor}] ${txt}\n`;
    }

    // mídia (áudio/imagem), respeitando o teto
    const file = m?.file || m?.File;
    if (file && midias < MAX_MIDIA_DOC) {
      const ct = String(file.contentType || file.ContentType || "").toLowerCase();
      if (ct.startsWith("audio/")) {
        const t = await transcreverAudio(file);
        if (t) {
          conversa += `[${autor} - áudio] ${t}\n`;
          midias++;
          console.log("🎧 (doc) áudio transcrito incorporado à documentação");
        }
      } else if (ct.startsWith("image/")) {
        const d = await descreverImagemParaDoc(file, autor);
        if (d) {
          conversa += `[${autor} - imagem] ${d}\n`;
          midias++;
          console.log(
            `🖼️ (doc) imagem do ${autor.toLowerCase()} descrita incorporada à documentação`
          );
        }
      }
    }
  }

  return conversa.trim();
}

function formatarCategorias(categorias) {
  return categorias
    .map((c) =>
      c.subs && c.subs.length
        ? `- ${c.nome}: ${c.subs.map((s) => s.nome).join(", ")}`
        : `- ${c.nome}`
    )
    .join("\n");
}

// chamada única ao modelo: classifica com base na lista fornecida
async function chamarClassificador(conversa, lista) {
  const r = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: `Você classifica um atendimento de suporte da Accon em UMA categoria, ESPELHANDO a organização da Central de Ajuda Accon (referência oficial de nomes).

CATEGORIAS DISPONÍVEIS (formato "Categoria: subcategorias"):
${lista}

REGRAS (nesta ordem de prioridade):
1. Identifique o ASSUNTO PRINCIPAL do atendimento.
2. Encontre a categoria ou SUBCATEGORIA acima que melhor representa o assunto (correspondência exata ou semântica) e use o NOME EXATO dela.
3. Prefira a SUBCATEGORIA mais específica quando ela combinar (ex.: "Robô WhatsApp" em vez de "Delivery"; "Notas fiscais" em vez de "Fiscal"; "Integrações de marketplace" para iFood/marketplace).
4. NÃO use categorias genéricas inventadas (ex.: "Outros", "Problemas Gerais", "Configurações") se houver uma compatível acima.
5. Só crie uma categoria NOVA quando NENHUMA acima representar o assunto.
6. O campo "categoria" deve conter SOMENTE o nome da categoria/subcategoria escolhida (a folha), exatamente como aparece na lista. NUNCA combine o pai com a subcategoria — ERRADO: "Delivery: Robô WhatsApp"; CERTO: "Robô WhatsApp".

Responda APENAS um JSON válido:
{ "tema": "<assunto principal em 1-3 palavras>", "categoriaCentral": "<categoria/subcategoria da lista que combina, ou string vazia se nenhuma>", "categoria": "<SOMENTE o nome da categoria a USAR, sem o pai>", "nova": <true se for categoria nova, false se veio da lista> }`,
      },
      { role: "user", content: conversa },
    ],
    temperature: 0,
    max_tokens: 150,
    response_format: { type: "json_object" },
  });
  return JSON.parse(r.choices[0].message.content || "{}");
}

// --------------------------------------
// 1) Classifica a categoria ESPELHANDO a Central de Ajuda Accon, consultando
//    primeiro o CACHE LOCAL. Se nenhuma categoria compatível for encontrada,
//    reconsulta a Central direto, atualiza o cache e tenta de novo.
// --------------------------------------

async function classificarCategoria(conversa) {
  let categorias = await categoriasCache.obterCategorias();
  let origem = "Cache Local";
  const lista = categorias.length
    ? formatarCategorias(categorias)
    : TREINAMENTO.CATEGORIAS.map((c) => `- ${c}`).join("\n");

  try {
    let d = await chamarClassificador(conversa, lista);

    // não achou compatível -> reconsulta a Central, atualiza o cache e tenta de novo
    if (d.nova) {
      const frescas = await categoriasCache.atualizarCache();
      origem = "Consulta Direta Central de Ajuda";
      if (frescas.length) {
        d = await chamarClassificador(conversa, formatarCategorias(frescas));
      }
    }

    const categoria = String(d.categoria || "").trim() || "Dúvidas";

    // AUDITORIA da categorização
    console.log(
      `🗂️ Categorização:\n` +
        `   Tema identificado: ${d.tema || "(?)"}\n` +
        `   Categoria encontrada: ${d.categoria || "(?)"}${d.nova ? " (NOVA)" : ""}\n` +
        `   Origem: ${origem}`
    );

    return categoria;
  } catch (error) {
    console.log("❌ Erro ao classificar categoria:", error.message);
    return "Dúvidas";
  }
}

// --------------------------------------
// Busca a documentação OFICIAL relacionada na Central de Ajuda Accon (SOMENTE
// LEITURA — searchGitBook só lê) para enriquecer a tratativa. Usa a categoria
// + o conteúdo do atendimento como consulta. Retorna o texto oficial ou "".
// --------------------------------------

const MAX_OFICIAL_CHARS = 4000; // limite por página, p/ não estourar o prompt

async function buscarDocsOficiais(texto, categoria) {
  try {
    const query = `${categoria} ${String(texto || "").replace(/\s+/g, " ")}`
      .trim()
      .slice(0, 500);
    const docs = await searchGitBook(query, PUBLIC_SPACES); // Central de Ajuda
    if (!docs || !docs.length) return "";

    const partes = [];
    for (const d of docs.slice(0, 2)) {
      let corpo = "";
      try {
        corpo = await getFullPageContent(d.spaceId, d.pageId);
      } catch {}
      corpo = String(corpo || d.body || "").slice(0, MAX_OFICIAL_CHARS);
      if (corpo.trim()) partes.push(`[${d.title}]\n${corpo}`);
    }
    if (partes.length) {
      console.log(`📚 Documentação oficial encontrada na Central: ${docs.slice(0, 2).map((d) => d.title).join(", ")}`);
    }
    return partes.join("\n\n---\n\n");
  } catch (error) {
    console.log("⚠️ Falha ao buscar documentação oficial na Central:", error.message);
    return "";
  }
}

// --------------------------------------
// 2) Gera a tratativa (modelo avançado). Enriquece com a DOCUMENTAÇÃO OFICIAL
//    da Central de Ajuda e produz uma base de conhecimento que ENSINA a IA.
// --------------------------------------

function promptTratativa(categoria, existentes, manual = false, docsOficiais = "") {
  const base =
    existentes && existentes.trim()
      ? `TRATATIVAS JÁ EXISTENTES na categoria "${categoria}" (markdown com expandables <details>):\n\n${existentes}\n`
      : `Ainda não há tratativas nesta categoria.\n`;

  const fonte = manual
    ? "uma INSTRUÇÃO de um especialista humano da equipe Accon (conhecimento validado, de ALTA prioridade)"
    : "um atendimento de suporte REAL da Accon";

  // Orientação multimodal só faz sentido no fluxo de conversa (não no #treinamento manual)
  const multimodal = manual
    ? ""
    : `
CONTEÚDO MULTIMODAL (considere TUDO, não só o texto):
- A conversa pode trazer linhas marcadas como [CLIENTE - áudio], [CLIENTE - imagem], [ATENDENTE - áudio] e [ATENDENTE - imagem]. Trate-as como parte integral do atendimento.
- O CLIENTE traz o PROBLEMA: erro, sintoma, print do erro, áudio relatando a falha.
- O ATENDENTE traz o DIAGNÓSTICO e a SOLUÇÃO: orientações, a configuração correta (em imagem), o procedimento e a explicação (em áudio). Use isso para "Como diagnosticar" e "Como resolver".
- A tratativa deve refletir o atendimento REAL, mesmo quando a solução foi demonstrada por imagem ou explicada por áudio (do cliente OU do atendente).
`;

  const oficial =
    docsOficiais && docsOficiais.trim()
      ? `DOCUMENTAÇÃO OFICIAL RELACIONADA (Central de Ajuda Accon — use para a seção "Procedimento Oficial" e para enriquecer Diagnóstico, Erros Comuns e Boas Práticas; ADAPTE ao caso, não copie cegamente):\n\n${docsOficiais}\n`
      : `Não há documentação oficial relacionada disponível. Em "Procedimento Oficial", escreva "Sem referência oficial localizada na Central de Ajuda."\n`;

  return `Você transforma ${fonte} em UMA tratativa para a BASE DE CONHECIMENTO que ENSINA a IA a atender clientes sozinha, na categoria "${categoria}". O objetivo NÃO é só registrar o atendimento — é ENSINAR a IA a resolver esse problema no futuro, alinhada à documentação oficial.

PRIORIDADE DAS FONTES (da mais forte para a mais fraca):
1. Instrução de especialista (#treinamento), quando for a fonte.
2. DOCUMENTAÇÃO OFICIAL da Central de Ajuda Accon.
3. O atendimento real resolvido.
4. Sua inferência — só para conectar as informações, NUNCA para inventar passos/telas.

REGRAS:
- Use SOMENTE o que está explícito no conteúdo recebido e na documentação oficial. NÃO invente passos, telas, menus ou funcionalidades.
- Anonimize qualquer dado pessoal/identificador (nomes, telefone, e-mail, CNPJ, CPF, IDs, valores, links). Nunca os inclua.
- UMA tratativa = UM problema específico.
${multimodal}
${oficial}
REAPROVEITAMENTO (não duplicar conhecimento):
${base}- Se a conversa corresponde a UMA das tratativas existentes acima, REUTILIZE o título EXATO e devolva um conteúdo ENRIQUECIDO. Senão, crie um título NOVO, curto e específico (ex: "Como resolver erro de autenticação da Tuna").

ESTRUTURA OBRIGATÓRIA (markdown, use ### nas seções; omita uma seção apenas se realmente não houver informação — EXCETO "Como a IA Deve Responder Futuramente", que é SEMPRE obrigatória):
### Problema
### Sintomas
### Diagnóstico
### Solução Aplicada
### Procedimento Oficial
### Erros Comuns
### Boas Práticas
### Como Explicar ao Cliente
### Perguntas que a IA Deve Fazer
### Como a IA Deve Responder Futuramente
### Observações

DETALHES DAS SEÇÕES:
- "Solução Aplicada": o que de fato resolveu o caso — pergunte-se "o que o atendente fez que resolveu?" e registre.
- "Procedimento Oficial": o passo a passo conforme a Central de Ajuda Accon (use a documentação oficial fornecida).
- "Perguntas que a IA Deve Fazer": lista de PERGUNTAS DE DIAGNÓSTICO objetivas que a IA deve fazer ANTES de sugerir solução para este problema — que reduzam possibilidades e levem à causa raiz (ex.: modelo/versão, quando começou, mensagem de erro, se ocorre sempre ou às vezes, se já funcionou antes). Baseie-se no que o atendente perguntou e no procedimento oficial. SEMPRE preencha esta seção.
- "Como a IA Deve Responder Futuramente": passo a passo de como a IA deve conduzir o atendimento quando um cliente relatar este problema (ex.: 1. confirmar o cenário; 2. fazer as perguntas de diagnóstico acima; 3. verificar a configuração X; 4. orientar conforme o procedimento oficial; 5. confirmar a resolução).

Responda APENAS um JSON válido:
{ "titulo": "<título da tratativa>", "markdown": "<conteúdo em markdown com as seções acima>" }`;
}

async function gerarTratativa(entrada, categoria, existentes, manual = false, docsOficiais = "") {
  const r = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [
      {
        role: "system",
        content: promptTratativa(categoria, existentes, manual, docsOficiais),
      },
      { role: "user", content: entrada },
    ],
    temperature: 0.2,
    max_tokens: 3000,
    response_format: { type: "json_object" },
  });

  return JSON.parse(r.choices[0].message.content);
}

// --------------------------------------
// Pipeline completo: categoria -> tratativas existentes -> gera/enriquece
// -> grava. Retorna um status.
//   { status: "vazio" | "anydesk" | "erro" | "falha_persistencia" | "ok", categoria?, titulo? }
// --------------------------------------

async function gerarTreinamento(chatId, desde) {
  const historico = await buscarHistoricoChat(chatId, 100);

  // mensagens da janela (do início do atendimento até agora)
  const janela = (historico || []).filter((m) => {
    const ts = Date.parse(dataMsg(m));
    return !desde || Number.isNaN(ts) || ts >= desde;
  });

  // SNAPSHOT BRUTO em disco ANTES de qualquer IA — se o servidor reiniciar
  // durante a geração, o atendimento não se perde (pode ser regenerado).
  if (janela.length) {
    persistencia.salvarSnapshotBruto(chatId, {
      chatId,
      desde,
      capturadoEm: new Date().toISOString(),
      mensagens: janela,
      imagens: janela
        .map((m) => m?.file || m?.File)
        .filter((f) => f && String(f.contentType || f.ContentType || "").startsWith("image/")),
      meta: { totalMensagens: janela.length },
    });
  }

  const conversaBruta = await montarConversaComMidia(historico, desde);
  if (!conversaBruta) return { status: "vazio" };

  // filtro AnyDesk: não documenta atendimento resolvido por acesso remoto
  if (usouAcessoRemoto(conversaBruta)) return { status: "anydesk" };

  const conversa = anonimizar(conversaBruta);

  // 1) categoria
  const categoria = await classificarCategoria(conversa);

  // 2) tratativas já existentes na categoria (para enriquecer / não duplicar)
  let existentes = "";
  try {
    existentes = await lerCategoria(categoria);
  } catch {}

  // 2.1) documentação OFICIAL relacionada (Central de Ajuda) para enriquecer
  const docsOficiais = await buscarDocsOficiais(conversa, categoria);

  // 3) gera (ou enriquece) a tratativa, alinhada ao procedimento oficial
  let dados;
  try {
    dados = await gerarTratativa(conversa, categoria, existentes, false, docsOficiais);
  } catch (error) {
    console.log("❌ Erro ao gerar treinamento (IA):", error.message);
    return { status: "erro" };
  }

  const titulo = String(dados.titulo || "").trim();
  // anonimização extra no conteúdo final (defesa em profundidade)
  const markdown = anonimizar(String(dados.markdown || "").trim());

  if (!titulo || !markdown) return { status: "vazio" };

  // nome do contato — usado SOMENTE para nomear o arquivo local (o conteúdo
  // já está anonimizado). Não vai para o GitBook.
  const contato = await buscarContatoChat(chatId);

  // salva a documentação gerada em disco ANTES de enviar ao GitBook — se o
  // GitHub falhar ou o servidor reiniciar, a doc gerada não se perde.
  persistencia.salvarDocGerada(chatId, {
    chatId,
    categoria,
    titulo,
    markdown,
    contato,
    geradoEm: new Date().toISOString(),
  });

  const ok = await enviarTratativa(categoria, titulo, markdown);

  return { status: ok ? "ok" : "falha_persistencia", categoria, titulo };
}

// --------------------------------------
// Treinamento MANUAL (#treinamento): conhecimento explícito do atendente.
// Mesmo destino/dedup das tratativas, mas a fonte é texto validado por humano.
// --------------------------------------

async function treinarManual(textoExpert) {
  const texto = anonimizar(String(textoExpert || "").trim());
  if (!texto) return { status: "vazio" };

  const categoria = await classificarCategoria(texto);

  let existentes = "";
  try {
    existentes = await lerCategoria(categoria);
  } catch {}

  const docsOficiais = await buscarDocsOficiais(texto, categoria);

  let dados;
  try {
    dados = await gerarTratativa(texto, categoria, existentes, true, docsOficiais);
  } catch (error) {
    console.log("❌ Erro no treinamento manual (IA):", error.message);
    return { status: "erro" };
  }

  const titulo = String(dados.titulo || "").trim();
  const markdown = anonimizar(String(dados.markdown || "").trim());
  if (!titulo || !markdown) return { status: "vazio" };

  const ok = await enviarTratativa(categoria, titulo, markdown);

  return { status: ok ? "ok" : "falha_persistencia", categoria, titulo };
}

module.exports = {
  gerarTreinamento,
  treinarManual,
  anonimizar,
  usouAcessoRemoto,
  montarConversaTreinamento,
  montarConversaComMidia,
  gerarTratativa,
  classificarCategoria,
  buscarDocsOficiais,
};
