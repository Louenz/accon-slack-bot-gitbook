// ======================================
// WHATSAPP: ÁUDIO (download + transcrição)
// ======================================
//
// Quando o cliente envia um áudio (nota de voz do WhatsApp, geralmente
// audio/ogg; codecs=opus), baixamos o arquivo e transcrevemos com a OpenAI
// para incorporar a fala ao contexto da conversa — exatamente como um
// atendente humano que ouve o áudio antes de responder.
//
// Modelo: gpt-4o-transcribe (mais preciso); cai para whisper-1 se falhar.
// Formatos aceitos: ogg/opus, mp3, wav, m4a, webm (cobre o que a Umbler envia).

const axios = require("axios");
const { toFile } = require("openai");
const { openai } = require("../clients");
const { env } = require("../config");

const MODELO_TRANSCRICAO = "gpt-4o-transcribe";
const MODELO_FALLBACK = "whisper-1";

// --------------------------------------
// É um arquivo de áudio?
// --------------------------------------

function ehAudio(file) {
  if (!file) return false;
  const ct = file.contentType || file.ContentType || "";
  return String(ct).toLowerCase().startsWith("audio/");
}

// --------------------------------------
// Extensão a partir do contentType (a OpenAI usa o nome do arquivo para
// detectar o formato). WhatsApp manda audio/ogg; codecs=opus.
// --------------------------------------

function extensaoDe(contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("ogg") || ct.includes("opus")) return "ogg";
  if (ct.includes("mpeg") || ct.includes("mp3")) return "mp3";
  if (ct.includes("wav")) return "wav";
  if (ct.includes("mp4") || ct.includes("m4a") || ct.includes("x-m4a") || ct.includes("aac")) return "m4a";
  if (ct.includes("webm")) return "webm";
  return "ogg"; // padrão do WhatsApp
}

// --------------------------------------
// Baixa o áudio (base64 inline ou via URL; com/sem auth da Umbler).
// Mesma estratégia tolerante usada para imagens.
// --------------------------------------

async function baixarBuffer(file) {
  const data = file.data || file.Data;
  if (typeof data === "string" && data.length > 100) {
    return Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
  }

  const url = file.url || file.Url;
  if (!url) return null;

  const baixar = (comAuth) =>
    axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: comAuth ? { Authorization: `Bearer ${env.UMBLER_TOKEN}` } : {},
    });

  try {
    let resp;
    try {
      resp = await baixar(false);
    } catch (error) {
      if ([401, 403].includes(error.response?.status)) resp = await baixar(true);
      else throw error;
    }
    return Buffer.from(resp.data);
  } catch (error) {
    console.log(
      "❌ Erro ao baixar áudio da Umbler:",
      error.response?.status,
      error.message
    );
    return null;
  }
}

// --------------------------------------
// Transcreve um buffer de áudio (com fallback de modelo).
// --------------------------------------

async function transcreverBuffer(buffer, ext) {
  const tentar = async (model) => {
    const arquivo = await toFile(buffer, `audio.${ext}`);
    const r = await openai.audio.transcriptions.create({
      file: arquivo,
      model,
      language: "pt",
    });
    return (r.text || "").trim();
  };

  try {
    return await tentar(MODELO_TRANSCRICAO);
  } catch (error) {
    console.log(
      `⚠️ Falha no ${MODELO_TRANSCRICAO} (${error.message}); tentando ${MODELO_FALLBACK}...`
    );
    try {
      return await tentar(MODELO_FALLBACK);
    } catch (error2) {
      console.log("❌ Erro ao transcrever áudio:", error2.message);
      return "";
    }
  }
}

// --------------------------------------
// Pipeline: recebe o `file` da mensagem; se for áudio, baixa e transcreve.
// Retorna a transcrição (string) ou null se não for áudio / falhar.
// --------------------------------------

async function transcreverAudio(file) {
  if (!ehAudio(file)) return null;

  const ct = file.contentType || file.ContentType || "";
  console.log(`🎧 Áudio recebido (${ct}) — baixando para transcrição...`);

  const buffer = await baixarBuffer(file);
  if (!buffer || !buffer.length) {
    console.log("⚠️ Áudio não baixado ou vazio.");
    return null;
  }

  const ext = extensaoDe(ct);
  const texto = await transcreverBuffer(buffer, ext);

  if (texto) {
    const previa = texto.slice(0, 80).replace(/\s+/g, " ");
    console.log(
      `📝 Áudio transcrito (${texto.length} chars): "${previa}${texto.length > 80 ? "…" : ""}"`
    );
  } else {
    console.log("⚠️ Transcrição vazia.");
  }

  return texto || null;
}

module.exports = {
  transcreverAudio,
  ehAudio,
  // exportados para reaproveitamento (documentação) e teste
  baixarBuffer,
  transcreverBuffer,
  extensaoDe,
};
