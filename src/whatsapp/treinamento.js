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
const { enviarTratativa } = require("./github");

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

  let conversa = "";

  for (const m of ordenadas) {
    const txt = (m?.content || m?.Content || "").trim();
    if (!txt) continue;
    if (txt.startsWith("#")) continue; // comandos administrativos

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
// Prompt da geração da tratativa (categoria + título + corpo).
// --------------------------------------

function promptSistema() {
  return `Você transforma um atendimento de suporte REAL em uma tratativa de documentação para treinamento interno da equipe Accon.

REGRAS:
- Use SOMENTE o que está explícito na conversa. NÃO invente passos, telas, menus ou funcionalidades.
- Anonimize qualquer dado pessoal/identificador que tenha escapado: nomes, telefone, e-mail, CNPJ, CPF, IDs de loja/pedido, valores financeiros, links privados. Nunca os inclua.
- Foque no conhecimento reaproveitável: qual era o PROBLEMA, a CAUSA e a SOLUÇÃO/procedimento.

CATEGORIA: escolha exatamente UMA desta lista (use "Outros" se nenhuma servir):
${TREINAMENTO.CATEGORIAS.join(", ")}

Responda APENAS um JSON válido no formato:
{
  "categoria": "<uma das categorias>",
  "titulo": "<nome curto da tratativa, ex: 'iFood não sincroniza pedidos'>",
  "markdown": "### Sintomas\\n...\\n\\n### Causa\\n...\\n\\n### Solução\\n..."
}

No "markdown" use títulos com ### e listas quando fizer sentido. Seja fiel à conversa.`;
}

// --------------------------------------
// Pipeline completo: gera e grava a tratativa. Retorna um status.
//   { status: "vazio" | "anydesk" | "erro" | "falha_persistencia" | "ok", categoria?, titulo? }
// --------------------------------------

async function gerarTreinamento(chatId, desde) {
  const historico = await buscarHistoricoChat(chatId, 100);

  const conversaBruta = montarConversaTreinamento(historico, desde);
  if (!conversaBruta) return { status: "vazio" };

  // filtro AnyDesk: não documenta atendimento resolvido por acesso remoto
  if (usouAcessoRemoto(conversaBruta)) return { status: "anydesk" };

  const conversa = anonimizar(conversaBruta);

  let dados;
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: promptSistema() },
        { role: "user", content: conversa },
      ],
      temperature: 0.2,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    });
    dados = JSON.parse(r.choices[0].message.content);
  } catch (error) {
    console.log("❌ Erro ao gerar treinamento (IA):", error.message);
    return { status: "erro" };
  }

  const categoria = TREINAMENTO.CATEGORIAS.includes(dados.categoria)
    ? dados.categoria
    : "Outros";
  const titulo = String(dados.titulo || "").trim();
  // anonimização extra no conteúdo final (defesa em profundidade)
  const markdown = anonimizar(String(dados.markdown || "").trim());

  if (!titulo || !markdown) return { status: "vazio" };

  const ok = await enviarTratativa(categoria, titulo, markdown);

  return { status: ok ? "ok" : "falha_persistencia", categoria, titulo };
}

module.exports = {
  gerarTreinamento,
  anonimizar,
  usouAcessoRemoto,
  montarConversaTreinamento,
};
