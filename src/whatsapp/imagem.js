// ======================================
// WHATSAPP: DOWNLOAD DE IMAGEM
// ======================================
//
// Extrai a imagem de um arquivo anexado à mensagem (Payload.Content.
// LastMessage.File) e devolve em base64 para enviar à OpenAI.
//
// O File (MessageFileModel) tem: url, contentType, data, originalName...
// Tolerante a PascalCase/camelCase. Se não for imagem, retorna null.

const axios = require("axios");
const { env } = require("../config");

async function obterImagemBase64(file) {
  if (!file) return null;

  const contentType = file.contentType || file.ContentType || "";
  if (!String(contentType).startsWith("image/")) return null;

  // 1) base64 inline, se a Umbler já mandar o conteúdo
  const data = file.data || file.Data;
  if (typeof data === "string" && data.length > 100) {
    return {
      base64: data.replace(/^data:[^;]+;base64,/, ""),
      contentType,
    };
  }

  // 2) baixa pela URL
  const url = file.url || file.Url;
  if (!url) return null;

  const baixar = (comAuth) =>
    axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20000,
      headers: comAuth ? { Authorization: `Bearer ${env.UMBLER_TOKEN}` } : {},
    });

  try {
    let resp;
    try {
      // a maioria das URLs de arquivo é pública/assinada (sem auth)
      resp = await baixar(false);
    } catch (error) {
      // se exigir autenticação, tenta com o token da Umbler
      if ([401, 403].includes(error.response?.status)) {
        resp = await baixar(true);
      } else {
        throw error;
      }
    }

    return {
      base64: Buffer.from(resp.data).toString("base64"),
      contentType,
    };
  } catch (error) {
    console.log(
      "❌ Erro ao baixar imagem da Umbler:",
      error.response?.status,
      error.message
    );
    return null;
  }
}

module.exports = {
  obterImagemBase64,
};
