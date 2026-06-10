// ======================================
// WHATSAPP: COMANDO #finalizados (auditoria)
// ======================================
//
// Lista os últimos atendimentos finalizados (chats encerrados na Umbler) e
// informa, para cada um, se a documentação automática foi gerada. Serve para
// auditoria, validação da documentação e identificação de atendimentos que
// precisam de revisão — tudo por NOTA INTERNA, sem acessar o sistema de
// treinamento.
//
// Uso (somente em notas internas):
//   #finalizados                  -> 15 últimos finalizados
//   #finalizados 50               -> 50 últimos
//   #finalizados nao-documentados -> apenas os que NÃO têm documentação
//   #finalizados hoje             -> apenas os finalizados hoje

const { listarChatsFinalizados } = require("../services/umbler");
const { chatsDocumentados } = require("./persistencia");

const LIMITE_PADRAO = 15;
const TAKE_MAXIMO = 250; // teto da API (maxTake)
const TZ = "America/Sao_Paulo";

// --------------------------------------
// Interpreta os argumentos do comando.
// Retorna { limite, filtro }. Estrutura pronta para novos filtros futuros.
// --------------------------------------

function parseArgs(texto) {
  const resto = String(texto || "")
    .replace(/#finalizados/i, "")
    .trim()
    .toLowerCase();

  let limite = LIMITE_PADRAO;
  let filtro = "todos";

  if (resto) {
    const num = resto.match(/\d+/);
    if (num) {
      limite = Math.min(TAKE_MAXIMO, Math.max(1, parseInt(num[0], 10)));
    }
    if (/n[aã]o[-\s]?documentados?/.test(resto)) filtro = "nao-documentados";
    else if (/\bhoje\b/.test(resto)) filtro = "hoje";
  }

  return { limite, filtro };
}

// --------------------------------------
// Datas (no fuso de Brasília).
// --------------------------------------

function formatarDataHora(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (t) => partes.find((p) => p.type === t)?.value || "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

function diaLocal(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function ehHoje(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return diaLocal(d) === diaLocal(new Date());
}

// --------------------------------------
// Montagem do texto da nota.
// --------------------------------------

function rotuloFiltro(filtro) {
  if (filtro === "nao-documentados") return " não documentados";
  if (filtro === "hoje") return " de hoje";
  return "";
}

function formatarRelatorio(lista, limite, filtro) {
  const extra = rotuloFiltro(filtro);

  if (lista.length === 0) {
    return `📋 Últimos chamados finalizados${extra}\n\nNenhum atendimento finalizado encontrado.`;
  }

  let cabecalho;
  if (lista.length < limite) {
    cabecalho =
      `📋 Últimos chamados finalizados${extra}\n\n` +
      `Foram encontrados apenas ${lista.length} atendimento(s) finalizado(s).`;
  } else {
    cabecalho = `📋 ${limite} últimos chamados finalizados${extra}`;
  }

  const linhas = lista.map((c, i) => {
    const status = c.documentado ? "(documentado)" : "(não documentado)";
    const quando = formatarDataHora(c.finalizadoEm);
    const linhaData = quando ? `\nFinalizado: ${quando}` : "";
    return `#${i + 1} ${c.contato}${linhaData}\n${status}`;
  });

  return `${cabecalho}\n\n${linhas.join("\n\n")}`;
}

// --------------------------------------
// Pipeline: busca finalizados -> marca documentação -> filtra -> formata.
// Retorna { texto, quantidade }.
// --------------------------------------

async function gerarRelatorioFinalizados({ limite = LIMITE_PADRAO, filtro = "todos" } = {}) {
  // Filtros pós-processados (hoje / nao-documentados) precisam de um pool
  // maior, porque a filtragem acontece depois de buscar da Umbler.
  const precisaPool = filtro !== "todos";
  const take = precisaPool ? Math.min(TAKE_MAXIMO, Math.max(limite, 100)) : limite;

  const chats = await listarChatsFinalizados(take);

  // varre o disco UMA vez e marca quais chats já têm documentação
  const documentados = chatsDocumentados();
  let lista = chats.map((c) => ({
    ...c,
    documentado: documentados.has(c.chatId),
  }));

  if (filtro === "nao-documentados") lista = lista.filter((c) => !c.documentado);
  if (filtro === "hoje") lista = lista.filter((c) => ehHoje(c.finalizadoEm));

  const selecionados = lista.slice(0, limite);

  return {
    texto: formatarRelatorio(selecionados, limite, filtro),
    quantidade: selecionados.length,
  };
}

module.exports = {
  gerarRelatorioFinalizados,
  parseArgs,
  // exportados para teste
  formatarRelatorio,
  formatarDataHora,
  ehHoje,
};
