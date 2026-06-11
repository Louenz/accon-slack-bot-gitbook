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
  buscarContatoChat,
} = require("../services/umbler");
const {
  buscarDadosEmpresa,
  extrairNomeEmpresa,
  detectarVersaoAccon,
  extrairIdLoja,
  extrairCampoApi,
} = require("./accon");

const MARCADOR = "=== LOJAS ACCON ===";
const RODAPE_VALIDACAO = "Última validação da IA:";

// --------------------------------------
// Helpers puros (parse / serialização / merge)
// --------------------------------------

function chaveCnpj(cnpj) {
  return String(cnpj || "").replace(/\D/g, "");
}

// data/hora atual no fuso de Brasília, formato YYYY-MM-DD HH:mm:ss
function agoraFormatado() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

// converte data DD/MM/AAAA -> AAAA-MM-DD (mantém o original se não casar)
function converterData(d) {
  const m = String(d || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(d || "");
}

// monta o objeto loja a partir da resposta (texto) da API Accon.
// `dados` (texto bruto) fica em memória para a IA usar — NÃO é persistido na nota.
function montarLoja(dadosApi, cnpjFormatado) {
  return {
    nome: extrairNomeEmpresa(dadosApi) || "(não informado)",
    cnpj: cnpjFormatado,
    id10: extrairIdLoja(dadosApi, "1.0"),
    id20: extrairIdLoja(dadosApi, "2.0"),
    versao: detectarVersaoAccon(dadosApi),
    status: extrairCampoApi(dadosApi, "Status da assinatura") || "N/A",
    proximoPagamento:
      converterData(extrairCampoApi(dadosApi, "Data do próximo pagamento")) || "N/A",
    linkPagamento: extrairCampoApi(dadosApi, "Link do próximo pagamento") || "N/A",
    dados: dadosApi,
  };
}

function blocoLoja(l) {
  return (
    `Loja: ${l.nome}\n` +
    `CNPJ: ${l.cnpj}\n` +
    `ID 1.0: ${l.id10 || "N/A"}\n` +
    `ID 2.0: ${l.id20 || "N/A"}\n` +
    `Versão Atual: ${l.versao || "N/A"}\n` +
    `Status da Assinatura: ${l.status || "N/A"}\n` +
    `Próximo Pagamento: ${l.proximoPagamento || "N/A"}\n` +
    `Link do Próximo Pagamento: ${l.linkPagamento || "N/A"}`
  );
}

// Serializa a nota: lojas + rodapé com a data/hora da última validação da IA
// (uma informação GLOBAL por contato, mesmo com várias lojas).
function serializar(lojas, validadoEm) {
  const ts = validadoEm || agoraFormatado();
  return (
    `${MARCADOR}\n\n` +
    lojas.map(blocoLoja).join("\n\n") +
    `\n\n${RODAPE_VALIDACAO}\n${ts}\n`
  );
}

// extrai um campo "Campo: valor" de um bloco de texto. Usa [ \t] (não \s) para
// NÃO atravessar quebras de linha — assim um campo vazio não "rouba" o valor da
// linha seguinte (robustez contra observações corrompidas).
function campo(bloco, nome) {
  const m = bloco.match(new RegExp(`${nome}[ \\t]*:[ \\t]*(.+)`, "i"));
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
      status: campo(b, "Status da Assinatura") || campo(b, "Status da assinatura") || "",
      proximoPagamento: campo(b, "Próximo Pagamento") || campo(b, "Proximo Pagamento") || "",
      linkPagamento: campo(b, "Link do Próximo Pagamento") || campo(b, "Link do Proximo Pagamento") || "",
    });
  }
  return lojas;
}

// extrai o carimbo "Última validação da IA" (a data na linha seguinte ao rótulo)
function extrairValidadoEm(content) {
  const rotulo = RODAPE_VALIDACAO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = String(content || "").match(new RegExp(`${rotulo}\\s*\\r?\\n\\s*(.+)`));
  return m ? m[1].trim() : "";
}

// monta o texto da nota do comando #lojas (registros válidos + carimbo)
function formatarRelatorioLojas(lojas, validadoEm) {
  if (!lojas || !lojas.length) {
    return (
      "⚠️ Nenhuma loja cadastrada foi encontrada para este contato.\n\n" +
      "Utilize um CNPJ válido ou o comando:\n\n" +
      "#cnpj [CNPJ]\n\n" +
      "para vincular uma loja ao contato."
    );
  }

  const blocos = lojas.map((l, i) => {
    let t =
      `#${i + 1} ${l.nome || "(sem nome)"}\n` +
      `CNPJ: ${l.cnpj || "N/A"}\n` +
      `ID 1.0: ${l.id10 || "N/A"}\n` +
      `ID 2.0: ${l.id20 || "N/A"}\n` +
      `Versão Atual: ${l.versao || "N/A"}\n` +
      `Status da Assinatura: ${l.status || "N/A"}`;
    if (l.proximoPagamento && l.proximoPagamento !== "N/A") t += `\nPróximo Pagamento: ${l.proximoPagamento}`;
    if (l.linkPagamento && l.linkPagamento !== "N/A") t += `\nLink do Próximo Pagamento: ${l.linkPagamento}`;
    return t;
  });

  let texto = "🏪 Lojas cadastradas para este contato\n\n" + blocos.join("\n\n");
  if (validadoEm) texto += `\n\n${RODAPE_VALIDACAO}\n${validadoEm}`;
  return texto;
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
// Trava por contato: serializa o read-modify-write da nota, evitando que
// #cnpj/revalidação simultâneos leiam o mesmo estado e sobrescrevam um ao outro
// (race condition que apagava as lojas já cadastradas).
// --------------------------------------

const _locks = new Map();
function comLock(chave, fn) {
  const anterior = _locks.get(chave) || Promise.resolve();
  const atual = anterior.then(fn, fn); // executa após a operação anterior terminar
  _locks.set(
    chave,
    atual.then(
      () => {},
      () => {}
    )
  );
  return atual;
}

// lê TODAS as notas LOJAS do contato e junta num único array (robusto a notas
// duplicadas que tenham sobrado de gravações concorrentes antigas).
function lojasDasNotas(notas) {
  const lojas = [];
  for (const n of notas) {
    if (String(n.content || "").includes(MARCADOR)) {
      for (const l of parse(n.content)) upsert(lojas, l);
    }
  }
  return lojas;
}

// --------------------------------------
// #cnpj: ADICIONA ou ATUALIZA uma loja nas observações do contato, SEM remover
// as demais (cadastro acumulativo). Serializado por trava p/ não haver race.
// --------------------------------------

async function salvarLoja(chatId, loja) {
  const contactId = await buscarIdContato(chatId);
  if (!contactId) return false;

  return comLock(contactId, async () => {
    const notas = await buscarNotasContato(contactId);
    const lojas = lojasDasNotas(notas); // todas as lojas já cadastradas

    const antes = lojas.length;
    const jaExistia = lojas.some((l) => chaveCnpj(l.cnpj) === chaveCnpj(loja.cnpj));
    upsert(lojas, loja); // adiciona nova OU atualiza a de mesmo CNPJ
    const depois = lojas.length;

    await escreverNota(contactId, notas, lojas);

    // AUDITORIA
    console.log(
      `🏬 #cnpj | Lojas antes: ${antes} | ${jaExistia ? "Loja atualizada" : "Loja adicionada"}: ${loja.nome} (${loja.cnpj}) | Lojas após: ${depois}`
    );
    return true;
  });
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

  return comLock(contactId, async () => {
    const notas = await buscarNotasContato(contactId);
    const lojas = lojasDasNotas(notas); // todas as lojas cadastradas
    if (!lojas.length) return []; // contato sem lojas -> nada a fazer

    const atualizadas = [];
    let validadas = 0;
    let removidas = 0;
    for (const l of lojas) {
      const r = await revalidarUma(l.cnpj);
      if (r.valida) {
        atualizadas.push(r.loja); // atualiza versão/IDs/assinatura
        validadas++;
      } else if (!r.definitivo) {
        atualizadas.push(l); // erro transitório -> mantém
      } else {
        removidas++; // inválido confirmado -> remove
      }
    }

    // Só reescreve a nota (e atualiza "Última validação da IA") se a API
    // respondeu — válida (200) ou inválida confirmada (404). Se TODAS deram erro
    // transitório (API fora), preserva a nota e o carimbo antigos.
    const houveConsulta = validadas > 0 || removidas > 0;
    if (houveConsulta) {
      await escreverNota(contactId, notas, atualizadas);
      console.log(
        `🔄 Lojas revalidadas: ${atualizadas.length} válida(s)` +
          (removidas ? `, ${removidas} CNPJ inválido(s) removido(s)` : "") +
          ` (contato ${contactId}).`
      );
    } else {
      console.log(
        `⚠️ Revalidação sem resposta da API (erros transitórios) — nota e carimbo preservados (contato ${contactId}).`
      );
    }

    return atualizadas;
  });
}

// --------------------------------------
// #lojas: lê as lojas cadastradas nas Observações do contato (somente leitura).
// Retorna { lojas: [...], validadoEm: "<carimbo>" } — registros válidos apenas.
// --------------------------------------

async function obterLojasContato(chatId) {
  const contactId = await buscarIdContato(chatId);
  if (!contactId) return { lojas: [], validadoEm: "" };

  const notas = await buscarNotasContato(contactId);
  const nota = notas.find((n) => String(n.content || "").includes(MARCADOR));
  if (!nota) return { lojas: [], validadoEm: "" };

  return { lojas: parse(nota.content), validadoEm: extrairValidadoEm(nota.content) };
}

// --------------------------------------
// #limpar: remove COMPLETAMENTE as Observações do contato atual (todas as
// notas — lojas, validação e qualquer outra informação). Afeta SOMENTE este
// contato. Retorna { ok, contato, removidas }.
// --------------------------------------

async function limparObservacoes(chatId) {
  const contactId = await buscarIdContato(chatId);
  if (!contactId) return { ok: false, contato: "", removidas: 0 };

  const contato = await buscarContatoChat(chatId);

  return comLock(contactId, async () => {
    const notas = await buscarNotasContato(contactId);
    let removidas = 0;
    for (const n of notas) {
      if (await removerNotaContato(contactId, n.id)) removidas++;
    }
    return { ok: true, contato, removidas };
  });
}

module.exports = {
  // orquestração
  salvarLoja,
  revalidarLojas,
  limparObservacoes,
  obterLojasContato,
  montarLoja,
  // puros (testáveis)
  parse,
  serializar,
  upsert,
  chaveCnpj,
  agoraFormatado,
  extrairValidadoEm,
  formatarRelatorioLojas,
  MARCADOR,
  RODAPE_VALIDACAO,
};
