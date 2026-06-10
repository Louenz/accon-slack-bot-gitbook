// ======================================
// WHATSAPP: INÍCIO DO CONTEXTO (lookback inteligente)
// ======================================
//
// Ao transferir para o Suporte, em vez de usar uma janela fixa, PROCURA no
// histórico anterior o INÍCIO REAL do problema: a primeira dúvida/relato/
// imagem/áudio do cliente, ignorando saudações e confirmações isoladas.
//
// A busca é limitada a CONTEXT_LOOKBACK_MINUTES (padrão 15) antes da
// transferência (limite de segurança, para não puxar conversa antiga sem
// relação). Se nenhum início claro for encontrado, usa esse limite como
// fallback.

const { WHATSAPP } = require("../config");
const { buscarHistoricoChat } = require("../services/umbler");

function dataMsg(m) {
  return (
    m?.createdAtUTC ||
    m?.eventAtUTC ||
    m?.CreatedAtUTC ||
    m?.EventAtUTC ||
    m?.createdAt
  );
}

// normaliza para comparação: minúsculas, sem acentos, pontuação/símbolos viram espaço
function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, " ")
    .trim();
}

// saudações / confirmações isoladas (sem contexto de problema)
const RUIDO = new Set([
  "bom dia", "boa tarde", "boa noite", "oi", "ola", "opa", "eai", "e ai",
  "fala", "salve", "tudo bem", "tudo bom", "como vai", "ok", "okay", "blz",
  "beleza", "valeu", "vlw", "obrigado", "obrigada", "obg", "agradecido",
  "sim", "nao", "certo", "perfeito", "entendi", "otimo", "show", "ata",
  "aham", "uhum", "isso", "isso mesmo", "deu certo", "resolvido", "bom", "boa",
]);

// É ruído? (saudação / confirmação / emoji / vazio / muito curto)
function ehRuido(texto) {
  const original = String(texto || "");
  if (!original.trim()) return true; // vazio
  if (!/[\p{L}\p{N}]/u.test(original)) return true; // só emoji/símbolo/pontuação
  const t = normalizar(original);
  if (!t) return true;
  if (RUIDO.has(t)) return true; // saudação/confirmação isolada
  if (t.length <= 3) return true; // "ok", "blz", "vlw"...
  return false;
}

function ehMidiaRelevante(file) {
  if (!file) return false;
  const ct = String(file.contentType || file.ContentType || "").toLowerCase();
  return ct.startsWith("image/") || ct.startsWith("audio/");
}

// --------------------------------------
// (PURA / testável) Acha o timestamp (ms) da primeira evidência real do
// problema entre as mensagens do CLIENTE dentro de [limiteInferior, transferMs]:
// mídia (imagem/áudio) OU texto não-ruído. Retorna null se não encontrar.
// --------------------------------------

function acharInicioProblema(mensagens, limiteInferior, transferMs) {
  const candidatos = (mensagens || [])
    .filter((m) => {
      const src = m?.source || m?.Source;
      if (src !== "Contact") return false; // só o cliente relata o problema
      if (m?.isPrivate || m?.IsPrivate) return false;
      const ts = Date.parse(dataMsg(m));
      if (Number.isNaN(ts)) return false;
      return ts >= limiteInferior && ts <= transferMs;
    })
    .sort((a, b) => Date.parse(dataMsg(a)) - Date.parse(dataMsg(b)));

  for (const m of candidatos) {
    const file = m?.file || m?.File;
    const txt = m?.content || m?.Content || "";
    if (ehMidiaRelevante(file) || !ehRuido(txt)) {
      return Date.parse(dataMsg(m));
    }
  }
  return null;
}

// --------------------------------------
// Calcula o timestamp (ms) em que a documentação deve começar: o início real
// do problema, buscado no histórico anterior à transferência (limitado a
// CONTEXT_LOOKBACK_MINUTES). Fallback: o próprio limite de segurança.
// --------------------------------------

async function calcularInicioContexto(chatId, transferenciaEm) {
  const maxMin = WHATSAPP.CONTEXT_LOOKBACK_MINUTES || 15;
  const tBase = transferenciaEm ? Date.parse(transferenciaEm) : Date.now();
  const transferMs = Number.isNaN(tBase) ? Date.now() : tBase;
  const limiteInferior = transferMs - maxMin * 60 * 1000;

  let mensagens = [];
  try {
    mensagens = await buscarHistoricoChat(chatId, 100);
  } catch {}

  const inicio = acharInicioProblema(mensagens, limiteInferior, transferMs);

  if (inicio != null) {
    console.log(
      `🕵️ Início do problema localizado ~${Math.max(0, Math.round((transferMs - inicio) / 60000))} min antes da transferência (chat ${chatId}).`
    );
    return inicio;
  }

  console.log(
    `🕵️ Início do problema não identificado; usando fallback de ${maxMin} min antes da transferência (chat ${chatId}).`
  );
  return limiteInferior;
}

module.exports = {
  calcularInicioContexto,
  acharInicioProblema,
  ehRuido,
};
