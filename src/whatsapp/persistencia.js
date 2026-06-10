// ======================================
// WHATSAPP: PERSISTÊNCIA EM DISCO (anti-restart)
// ======================================
//
// Garante que um atendimento em documentação não se perca se o servidor
// reiniciar (nodemon, deploy, crash). Três coisas vão para o disco:
//
//  - state/   : marca "este chat está em documentação desde X" (restaurado no boot)
//  - raw/     : snapshot BRUTO do atendimento, salvo ANTES de qualquer IA
//  - gerada/  : a documentação já gerada (caso o GitBook/GitHub falhe)
//
// Pasta: ./documentacao-ia-whatsapp/ (ignorada pelo git).

const fs = require("fs");
const path = require("path");

const BASE = path.join(process.cwd(), "documentacao-ia-whatsapp");
const STATE_DIR = path.join(BASE, "state");
const RAW_DIR = path.join(BASE, "raw");
const GERADA_DIR = path.join(BASE, "gerada");

for (const dir of [BASE, STATE_DIR, RAW_DIR, GERADA_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function nomeSeguro(valor) {
  return String(valor).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function dataArquivo() {
  // YYYY-MM-DD (data local do sistema)
  return new Date().toISOString().slice(0, 10);
}

// --------------------------------------
// Estado da captura (state/<chatId>.json)
// --------------------------------------

function salvarEstadoDoc(chatId, desde) {
  try {
    fs.writeFileSync(
      path.join(STATE_DIR, nomeSeguro(chatId) + ".json"),
      JSON.stringify({ chatId, desde })
    );
  } catch (e) {
    console.log("⚠️ Erro ao salvar estado de documentação:", e.message);
  }
}

function removerEstadoDoc(chatId) {
  try {
    fs.unlinkSync(path.join(STATE_DIR, nomeSeguro(chatId) + ".json"));
  } catch {}
}

function carregarEstadosDoc() {
  try {
    return fs
      .readdirSync(STATE_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// --------------------------------------
// Snapshot bruto do atendimento (raw/<data>-atendimento-<chatId>.json)
// Salvo ANTES de qualquer processamento de IA.
// --------------------------------------

function salvarSnapshotBruto(chatId, pacote) {
  try {
    const nome = `${dataArquivo()}-atendimento-${nomeSeguro(chatId)}.json`;
    fs.writeFileSync(path.join(RAW_DIR, nome), JSON.stringify(pacote, null, 2));
    return nome;
  } catch (e) {
    console.log("⚠️ Erro ao salvar snapshot bruto:", e.message);
    return null;
  }
}

// --------------------------------------
// Sanitiza um texto (contato/categoria) para uso em nome de arquivo/pasta:
// remove acentos, troca espaços/caracteres inválidos por hífen.
// Ex.: "João da Silva" -> "Joao-da-Silva"; "Tuna Pagamentos" -> "Tuna-Pagamentos".
// --------------------------------------

function sanitizarParaArquivo(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^a-zA-Z0-9]+/g, "-") // inválidos/espaços -> hífen
    .replace(/^-+|-+$/g, ""); // tira hífens das pontas
}

// marcador OCULTO com o chatId (id de sistema, NÃO dado pessoal) — permite
// localizar a documentação por chat sem expor o nome no conteúdo.
function marcadorChat(chatId) {
  return `<!-- chatId: ${chatId} -->`;
}

// --------------------------------------
// Documentação gerada -> arquivo .md por CATEGORIA, identificado pelo NOME DO
// CONTATO (apenas no nome do arquivo). O CONTEÚDO permanece anônimo.
//   /documentacao-ia-whatsapp/<Categoria>/<data>-<Nome-Contato>.md
// --------------------------------------

function salvarDocGerada(chatId, doc) {
  try {
    const categoria = sanitizarParaArquivo(doc.categoria) || "Outros";
    const dir = path.join(BASE, categoria);
    fs.mkdirSync(dir, { recursive: true });

    // nome do contato SOMENTE no nome do arquivo (cai para o chatId se faltar)
    const nomeContato = sanitizarParaArquivo(doc.contato) || nomeSeguro(chatId);
    const arquivo = `${dataArquivo()}-${nomeContato}.md`;

    // conteúdo anonimizado: título + tratativa + marcador oculto de chatId.
    // NÃO inclui o nome do contato.
    const titulo = String(doc.titulo || "").trim();
    const corpo = String(doc.markdown || "").trim();
    const conteudo =
      (titulo ? `# ${titulo}\n\n` : "") + corpo + `\n\n${marcadorChat(chatId)}\n`;

    const caminho = path.join(dir, arquivo);
    fs.writeFileSync(caminho, conteudo);

    // log interno (aqui o nome PODE aparecer — facilita auditoria/localização)
    console.log(`📄 Documentação salva: ${categoria}/${arquivo}`);
    return path.join(categoria, arquivo);
  } catch (e) {
    console.log("⚠️ Erro ao salvar documentação gerada:", e.message);
    return null;
  }
}

// --------------------------------------
// Pastas de categoria = subpastas de BASE, exceto as internas (state/raw/gerada).
// --------------------------------------

function pastasCategoria() {
  const internas = new Set(["state", "raw", "gerada"]);
  try {
    return fs
      .readdirSync(BASE, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !internas.has(d.name))
      .map((d) => path.join(BASE, d.name));
  } catch {
    return [];
  }
}

// Conjunto de chatIds que já têm documentação gerada (via marcador oculto nos
// .md das pastas de categoria). Varre o disco UMA vez.
function chatsDocumentados() {
  const set = new Set();
  for (const dir of pastasCategoria()) {
    let arquivos = [];
    try {
      arquivos = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {}
    for (const f of arquivos) {
      try {
        const conteudo = fs.readFileSync(path.join(dir, f), "utf8");
        const m = conteudo.match(/<!--\s*chatId:\s*([^\s>]+)\s*-->/i);
        if (m) set.add(m[1]);
      } catch {}
    }
  }
  return set;
}

// --------------------------------------
// Verifica se um atendimento já tem documentação gerada.
// Usado pelo comando #finalizados para marcar (documentado) / (não documentado).
// --------------------------------------

function documentacaoExiste(chatId) {
  if (!chatId) return false;
  return chatsDocumentados().has(chatId);
}

module.exports = {
  salvarEstadoDoc,
  removerEstadoDoc,
  carregarEstadosDoc,
  salvarSnapshotBruto,
  salvarDocGerada,
  documentacaoExiste,
  chatsDocumentados,
  sanitizarParaArquivo,
};
