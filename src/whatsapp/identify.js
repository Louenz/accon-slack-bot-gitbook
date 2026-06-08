// ======================================
// WHATSAPP: IDENTIFICAÇÃO DA EMPRESA
// ======================================
//
// A API da Accon só consulta por CNPJ, então a identificação é feita
// EXCLUSIVAMENTE por CNPJ. O cliente pode informar em QUALQUER formato:
// o sistema normaliza (remove pontos, barras, hífens, espaços e demais
// caracteres) e, se sobrarem 14 dígitos, considera um CNPJ válido para
// consulta — sem exigir formatação correta do cliente.

// --------------------------------------
// Normaliza um valor mantendo apenas os dígitos.
// "54.706.921/0001-01" -> "54706921000101"
// --------------------------------------

function normalizarCNPJ(valor = "") {
  return String(valor).replace(/\D/g, "");
}

// --------------------------------------
// Procura no texto um número que, após normalização, tenha 14 dígitos.
// Tolera pontuação ausente/errada, espaços e barras/hífens faltando.
// Retorna os 14 dígitos (sem pontuação) ou null.
// --------------------------------------

function extrairCNPJ(texto = "") {
  // candidatos = sequências de dígitos com separadores comuns (. - / e espaço)
  const candidatos =
    String(texto).match(/\d[\d.\-/ ]{12,}\d/g) || [];

  for (const bruto of candidatos) {
    const digitos = normalizarCNPJ(bruto);
    if (digitos.length === 14) {
      return digitos;
    }
  }

  return null;
}

// --------------------------------------
// Formata 14 dígitos como 54.706.921/0001-01 (usado na exibição e no
// envio à API, que aceita o formato pontuado).
// --------------------------------------

function formatarCNPJ(digitos) {
  return digitos.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5"
  );
}

module.exports = {
  normalizarCNPJ,
  extrairCNPJ,
  formatarCNPJ,
};
