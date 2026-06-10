// ======================================
// WHATSAPP: LOJAS DO CONTATO (Observações persistentes)
// ======================================
//
// Usa as "Observações do contato" (notas da Umbler) como armazenamento
// persistente das lojas Accon do cliente: nome, CNPJ, ID 1.0, ID 2.0 e versão.
// Serve de cache/histórico/identificação rápida — mas a API Accon continua
// sendo a FONTE DA VERDADE (sempre revalidada).
//
// Bloco salvo na nota (uma nota única, marcada):
//   === LOJAS ACCON ===
//
//   Loja: Donna Toscana
//   CNPJ: 12.345.678/0001-99
//   ID 1.0: 1234
//   ID 2.0: 9876
//   Versão Atual: 2.0
//
// Regras: nunca apagar loja válida; apenas adicionar/atualizar (por CNPJ);
// remover CNPJ inválido apenas quando a API confirmar que não existe.

const {
  buscarIdContato,
  buscarNotasContato,
  criarNotaContato,
  removerNotaContato,
} = require("../services/umbler");
const {
  buscarDadosEmpresa,
  extrairNomeEmpresa,
  detectarVersaoAccon,
  extrairIdLoja,
} = require("./accon");

const MARCADOR = "=== LOJAS ACCON ===";

// --------------------------------------
// Helpers puros (parse / serialização / merge)
// --------------------------------------

function chaveCnpj(cnpj) {
  return String(cnpj || "").replace(/\D/g, "");
}

// monta o objeto loja a partir da resposta (texto) da API Accon.
// `dados` (texto bruto) fica em memória para a IA usar — NÃO é persistido na
// nota (blocoLoja/serializar só gravam os 5 campos estruturados).
function montarLoja(dadosApi, cnpjFormatado) {
  return {
    nome: extrairNomeEmpresa(dadosApi) || "(não informado)",
    cnpj: cnpjFormatado,
    id10: extrairIdLoja(dadosApi, "1.0"),
    id20: extrairIdLoja(dadosApi, "2.0"),
    versao: detectarVersaoAccon(dadosApi),
    dados: dadosApi,
  };
}

function blocoLoja(l) {
  return (
    `Loja: ${l.nome}\n` +
    `CNPJ: ${l.cnpj}\n` +
    `ID 1.0: ${l.id10 || "N/A"}\n` +
    `ID 2.0: ${l.id20 || "N/A"}\n` +
    `Versão Atual: ${l.versao || "N/A"}`
  );
}

function serializar(lojas) {
  return `${MARCADOR}\n\n` + lojas.map(blocoLoja).join("\n\n") + "\n";
}

// extrai um campo "Campo: valor" de um bloco de texto
function campo(bloco, nome) {
  const m = bloco.match(new RegExp(`${nome}\\s*:\\s*(.+)`, "i"));
  return m ? m[1].trim() : "";
}

// parse de uma nota LOJAS ACCON -> array de lojas
function parse(content) {
  const lojas = [];
  if (!content || !content.includes(MARCADOR)) return lojas;

  const corpo = content.split(MARCADOR)[1] || "";
  const blocos = corpo.split(/\n(?=\s*Loja\s*:)/i);

  for (const b of blocos) {
    const nome = campo(b, "Loja");
    const cnpj = campo(b, "CNPJ");
    if (!nome && !cnpj) continue;
    lojas.push({
      nome,
      cnpj,
      id10: campo(b, "ID 1\\.0") || "N/A",
      id20: campo(b, "ID 2\\.0") || "N/A",
      versao: campo(b, "Versão Atual") || campo(b, "Versao Atual") || "",
    });
  }
  return lojas;
}

// adiciona uma nova loja ou atualiza a existente (mesmo CNPJ). Nunca remove as demais.
function upsert(lojas, nova) {
  const k = chaveCnpj(nova.cnpj);
  const idx = lojas.findIndex((l) => chaveCnpj(l.cnpj) === k);
  if (idx >= 0) lojas[idx] = nova;
  else lojas.push(nova);
  return lojas;
}

// --------------------------------------
// Persistência (lê/escreve a nota no contato da Umbler)
// --------------------------------------

// reescreve a nota LOJAS ACCON: remove a(s) antiga(s) e cria uma atualizada
async function escreverNota(contactId, notasAtuais, lojas) {
  for (const n of notasAtuais) {
    if (String(n.content || "").includes(MARCADOR)) {
      await removerNotaContato(contactId, n.id);
    }
  }
  if (lojas.length) {
    await criarNotaContato(contactId, serializar(lojas));
  }
}

// --------------------------------------
// #cnpj: salva/atualiza UMA loja validada nas observações do contato.
// --------------------------------------

async function salvarLoja(chatId, loja) {
  const contactId = await buscarIdContato(chatId);
  if (!contactId) return false;

  const notas = await buscarNotasContato(contactId);
  const notaLojas = notas.find((n) => String(n.content || "").includes(MARCADOR));
  const lojas = notaLojas ? parse(notaLojas.content) : [];

  upsert(lojas, loja);
  await escreverNota(contactId, notas, lojas);

  console.log(
    `🏬 Loja salva nas observações do contato: ${loja.nome} (${loja.cnpj}) v${loja.versao}`
  );
  return true;
}

// --------------------------------------
// Revalida UM CNPJ na API Accon.
//   { valida:true, loja }            -> dados ok (atualizar)
//   { valida:false, definitivo:true} -> CNPJ não existe (remover)
//   { valida:false, definitivo:false}-> erro transitório (manter o que existe)
// --------------------------------------

async function revalidarUma(cnpj) {
  try {
    const dados = await buscarDadosEmpresa(cnpj);
    if (!extrairNomeEmpresa(dados)) return { valida: false, definitivo: true };
    return { valida: true, loja: montarLoja(dados, cnpj) };
  } catch (error) {
    const status = error.response?.status;
    // CNPJ inexistente/ inválido -> definitivo; demais (timeout/5xx) -> transitório
    const definitivo = status === 404 || status === 400 || status === 422;
    return { valida: false, definitivo };
  }
}

// --------------------------------------
// Início de atendimento: revalida TODAS as lojas conhecidas do contato e
// atualiza as observações (versões/IDs). Remove apenas CNPJ confirmado inválido.
// --------------------------------------

async function revalidarLojas(chatId) {
  const contactId = await buscarIdContato(chatId);
  if (!contactId) return [];

  const notas = await buscarNotasContato(contactId);
  const notaLojas = notas.find((n) => String(n.content || "").includes(MARCADOR));
  if (!notaLojas) return []; // contato sem lojas cadastradas -> nada a fazer

  const lojas = parse(notaLojas.content);
  if (!lojas.length) return [];

  const atualizadas = [];
  let removidas = 0;
  for (const l of lojas) {
    const r = await revalidarUma(l.cnpj);
    if (r.valida) atualizadas.push(r.loja); // atualiza versão/IDs
    else if (!r.definitivo) atualizadas.push(l); // erro transitório -> mantém
    else removidas++; // inválido confirmado -> remove
  }

  await escreverNota(contactId, notas, atualizadas);
  console.log(
    `🔄 Lojas revalidadas: ${atualizadas.length} válida(s)` +
      (removidas ? `, ${removidas} CNPJ inválido(s) removido(s)` : "") +
      ` (contato ${contactId}).`
  );

  // devolve as lojas atualizadas para carregar no contexto da conversa
  return atualizadas;
}

module.exports = {
  // orquestração
  salvarLoja,
  revalidarLojas,
  montarLoja,
  // puros (testáveis)
  parse,
  serializar,
  upsert,
  chaveCnpj,
  MARCADOR,
};
