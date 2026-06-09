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
const { TREINAMENTO } = require("../config");
const { buscarHistoricoChat } = require("../services/umbler");
const { enviarTratativa, lerCategoria } = require("./github");

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
// 1) Classifica a categoria (modelo econômico). Prefere a lista, mas pode
//    criar uma categoria nova se nenhuma representar bem o problema.
// --------------------------------------

async function classificarCategoria(conversa) {
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `Classifique o atendimento de suporte da Accon em UMA categoria.
Prefira uma destas: ${TREINAMENTO.CATEGORIAS.join(", ")}.
Se NENHUMA representar bem, responda uma categoria curta e adequada (1-3 palavras, ex: "Tuna Pagamentos").
Responda SOMENTE o nome da categoria, sem aspas nem pontuação.`,
        },
        { role: "user", content: conversa },
      ],
      temperature: 0,
      max_tokens: 20,
    });

    const cat = (r.choices[0].message.content || "")
      .trim()
      .replace(/^["'.\s]+|["'.\s]+$/g, "");

    return cat || "Outros";
  } catch (error) {
    console.log("❌ Erro ao classificar categoria:", error.message);
    return "Outros";
  }
}

// --------------------------------------
// 2) Gera a tratativa (modelo avançado). Recebe as tratativas existentes da
//    categoria para REAPROVEITAR/ENRIQUECER a equivalente (sem duplicar).
// --------------------------------------

function promptTratativa(categoria, existentes, manual = false) {
  const base =
    existentes && existentes.trim()
      ? `TRATATIVAS JÁ EXISTENTES na categoria "${categoria}" (markdown com expandables <details>):\n\n${existentes}\n`
      : `Ainda não há tratativas nesta categoria.\n`;

  const fonte = manual
    ? "uma INSTRUÇÃO de um especialista humano da equipe Accon (conhecimento validado, de ALTA prioridade)"
    : "um atendimento de suporte REAL da Accon";

  return `Você transforma ${fonte} em UMA tratativa de documentação para treinamento interno, na categoria "${categoria}".

REGRAS:
- Use SOMENTE o que está explícito no conteúdo recebido. NÃO invente passos, telas, menus ou funcionalidades.
- Anonimize qualquer dado pessoal/identificador que tenha escapado (nomes, telefone, e-mail, CNPJ, CPF, IDs, valores, links). Nunca os inclua.
- UMA tratativa = UM problema específico. Não misture vários problemas.

REAPROVEITAMENTO (não duplicar conhecimento):
${base}- Se a conversa atual corresponde a UMA das tratativas existentes acima, REUTILIZE o título EXATO dela e devolva um conteúdo ENRIQUECIDO (combine o conhecimento existente com o novo, melhorando o diagnóstico e o passo a passo).
- Se for um problema diferente, crie um título NOVO, curto e específico (ex: "Como resolver erro de autenticação da Tuna").

CONTEÚDO (markdown com ### nas seções; omita uma seção se a conversa não trouxer a informação):
### Problema
### Sintomas
### Causa
### Como diagnosticar
### Como resolver
### Observações

Responda APENAS um JSON válido:
{ "titulo": "<título da tratativa>", "markdown": "<conteúdo em markdown>" }`;
}

async function gerarTratativa(entrada, categoria, existentes, manual = false) {
  const r = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [
      { role: "system", content: promptTratativa(categoria, existentes, manual) },
      { role: "user", content: entrada },
    ],
    temperature: 0.2,
    max_tokens: 1800,
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

  const conversaBruta = montarConversaTreinamento(historico, desde);
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

  // 3) gera (ou enriquece) a tratativa
  let dados;
  try {
    dados = await gerarTratativa(conversa, categoria, existentes);
  } catch (error) {
    console.log("❌ Erro ao gerar treinamento (IA):", error.message);
    return { status: "erro" };
  }

  const titulo = String(dados.titulo || "").trim();
  // anonimização extra no conteúdo final (defesa em profundidade)
  const markdown = anonimizar(String(dados.markdown || "").trim());

  if (!titulo || !markdown) return { status: "vazio" };

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

  let dados;
  try {
    dados = await gerarTratativa(texto, categoria, existentes, true);
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
};
