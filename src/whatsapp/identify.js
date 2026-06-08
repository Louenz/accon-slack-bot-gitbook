// ======================================
// WHATSAPP: IDENTIFICAÇÃO DA EMPRESA
// ======================================
//
// Detecta na mensagem do cliente os dados que identificam a empresa.
// Hoje SOMENTE o CNPJ está implementado (detecção + validação). Marca e
// ID da loja ficam como stubs preparados para o futuro — quando houver
// um formato definido, basta implementar detectarMarca/detectarIdLoja.

// --------------------------------------
// Valida um CNPJ (14 dígitos) pelos dígitos verificadores.
// --------------------------------------

function cnpjValido(digitos) {
  if (!/^\d{14}$/.test(digitos)) return false;
  if (/^(\d)\1{13}$/.test(digitos)) return false; // rejeita 000... 111...

  const calcDigito = (base) => {
    const len = base.length;
    let pos = len - 7;
    let soma = 0;

    for (let i = len; i >= 1; i--) {
      soma += Number(base[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }

    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = calcDigito(digitos.slice(0, 12));
  const d2 = calcDigito(digitos.slice(0, 13));

  return d1 === Number(digitos[12]) && d2 === Number(digitos[13]);
}

// --------------------------------------
// Procura um CNPJ válido dentro do texto.
// Aceita formatado (54.706.921/0001-01) ou só dígitos.
// Retorna os 14 dígitos (sem pontuação) ou null.
// --------------------------------------

function extrairCNPJ(texto = "") {
  const candidatos =
    String(texto).match(
      /(?<!\d)\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}(?!\d)/g
    ) || [];

  for (const bruto of candidatos) {
    const digitos = bruto.replace(/\D/g, "");
    if (digitos.length === 14 && cnpjValido(digitos)) {
      return digitos;
    }
  }

  return null;
}

// --------------------------------------
// Formata 14 dígitos como 54.706.921/0001-01.
// --------------------------------------

function formatarCNPJ(digitos) {
  return digitos.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5"
  );
}

// --------------------------------------
// STUBS (ainda não implementados — só CNPJ está ativo hoje).
// Retornam null para que o fluxo nunca dispare a busca por marca/ID.
// --------------------------------------

function detectarMarca(_texto = "") {
  // TODO: implementar detecção de nome da marca quando houver critério.
  return null;
}

function detectarIdLoja(_texto = "") {
  // TODO: implementar detecção de ID da loja quando houver formato definido.
  return null;
}

module.exports = {
  cnpjValido,
  extrairCNPJ,
  formatarCNPJ,
  detectarMarca,
  detectarIdLoja,
};
