// ======================================
// WHATSAPP: API ACCON (dados da empresa)
// ======================================
//
// Consulta a API de suporte da Accon para coletar os dados da loja a
// partir do CNPJ. A API responde em TEXTO já formatado ("Campo: valor").
// Mostramos todos os campos retornados, sem ocultar nem resumir.

const axios = require("axios");
const { env } = require("../config");

const MERCHANT_INFO_URL =
  "https://api.accon.ai/api/support/merchant-info";

// --------------------------------------
// Busca os dados da empresa pelo CNPJ (Basic Auth).
// Retorna o texto cru da API. Lança erro em caso de falha.
// --------------------------------------

async function buscarDadosEmpresa(cnpjFormatado) {
  const response = await axios.get(MERCHANT_INFO_URL, {
    params: { cnpj: cnpjFormatado },
    auth: {
      username: env.ACCON_API_USER,
      password: env.ACCON_API_PASSWORD,
    },
    timeout: 15000,
  });

  return response.data;
}

// --------------------------------------
// Extrai o nome da loja ("Nome da loja: ...") do texto da API.
// Retorna "" se não encontrar.
// --------------------------------------

function extrairNomeEmpresa(textoApi) {
  const match = String(textoApi || "").match(/Nome da loja\s*:\s*(.+)/i);
  return match ? match[1].trim() : "";
}

// --------------------------------------
// Determina a versão da Accon a partir do campo "Último pedido 2.0":
//   - "N/A" (ou ausente)  -> "1.0" (loja nunca pediu na 2.0)
//   - qualquer outro valor -> "2.0"
//
// Default conservador: se o campo não existir, assume "1.0" — assim nunca
// liberamos atendimento automático sem confirmar que a loja é 2.0.
// --------------------------------------

function detectarVersaoAccon(textoApi) {
  const match = String(textoApi || "").match(/pedido\s*2\.0\s*:\s*(.+)/i);

  if (!match) return "1.0";

  const valor = match[1].trim();
  if (!valor || /^n\/?a$/i.test(valor)) return "1.0";

  return "2.0";
}

// --------------------------------------
// Extrai o ID da loja por versão a partir do texto da API:
//   "MerchantID (1.0): 609030..."  /  "MerchantID (2.0): 424"
// Retorna "N/A" se ausente ou vazio.
// --------------------------------------

function extrairIdLoja(textoApi, versao) {
  const v = String(versao).replace(".", "\\.");
  const m = String(textoApi || "").match(
    new RegExp(`MerchantID\\s*\\(\\s*${v}\\s*\\)\\s*:\\s*(.+)`, "i")
  );
  const val = m ? m[1].trim() : "";
  return val && !/^n\/?a$/i.test(val) ? val : "N/A";
}

// --------------------------------------
// Extrai um campo "Rótulo: valor" qualquer do texto da API (uma linha).
// Ex.: extrairCampoApi(txt, "Status da assinatura") -> "Ativa".
// --------------------------------------

function extrairCampoApi(textoApi, rotulo) {
  const r = String(rotulo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = String(textoApi || "").match(new RegExp(`${r}[ \\t]*:[ \\t]*(.+)`, "i"));
  return m ? m[1].trim() : "";
}

module.exports = {
  buscarDadosEmpresa,
  extrairNomeEmpresa,
  detectarVersaoAccon,
  extrairIdLoja,
  extrairCampoApi,
};
