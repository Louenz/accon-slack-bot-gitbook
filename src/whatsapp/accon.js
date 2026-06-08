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
// Monta a nota interna com TODOS os campos retornados pela API.
// Promove "Nome da loja" para o título e o CNPJ para o topo; o restante
// é exibido na íntegra (nada é ocultado ou resumido).
// --------------------------------------

function formatarDadosEmpresa(textoApi, cnpjFormatado) {
  const linhas = String(textoApi || "").split(/\r?\n/);

  let nome = "";
  const corpo = [];

  for (const linha of linhas) {
    const matchNome = linha.match(/^\s*Nome da loja\s*:\s*(.+)$/i);
    if (matchNome) {
      nome = matchNome[1].trim();
      continue;
    }
    // o CNPJ é promovido para o topo; evita duplicar a linha
    if (/^\s*CNPJ\s*:/i.test(linha)) continue;

    corpo.push(linha);
  }

  const corpoTexto = corpo.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const titulo = nome ? `🏢 *${nome}*` : "🏢 *Empresa identificada*";

  let mensagem = `✅ Dados coletados\n\n${titulo}\n\nCNPJ:\n${cnpjFormatado}`;

  if (corpoTexto) {
    mensagem += `\n\n${corpoTexto}`;
  }

  return mensagem;
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

module.exports = {
  buscarDadosEmpresa,
  formatarDadosEmpresa,
  detectarVersaoAccon,
};
