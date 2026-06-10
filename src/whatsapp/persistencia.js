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
// Documentação já gerada (gerada/<data>-atendimento-<chatId>.json)
// --------------------------------------

function salvarDocGerada(chatId, doc) {
  try {
    const nome = `${dataArquivo()}-atendimento-${nomeSeguro(chatId)}.json`;
    fs.writeFileSync(
      path.join(GERADA_DIR, nome),
      JSON.stringify(doc, null, 2)
    );
    return nome;
  } catch (e) {
    console.log("⚠️ Erro ao salvar documentação gerada:", e.message);
    return null;
  }
}

// --------------------------------------
// Verifica se um atendimento já tem documentação gerada (gerada/<...>-<chatId>.json).
// Usado pelo comando #finalizados para marcar (documentado) / (não documentado).
// --------------------------------------

function documentacaoExiste(chatId) {
  if (!chatId) return false;
  try {
    const sufixo = `-atendimento-${nomeSeguro(chatId)}.json`;
    return fs.readdirSync(GERADA_DIR).some((f) => f.endsWith(sufixo));
  } catch {
    return false;
  }
}

module.exports = {
  salvarEstadoDoc,
  removerEstadoDoc,
  carregarEstadosDoc,
  salvarSnapshotBruto,
  salvarDocGerada,
  documentacaoExiste,
};
