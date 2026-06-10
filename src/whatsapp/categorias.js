// ======================================
// WHATSAPP: CACHE LOCAL DAS CATEGORIAS DA CENTRAL DE AJUDA
// ======================================
//
// Mantém um cache em disco das categorias/subcategorias da "Central de Ajuda
// Accon" para categorizar os treinamentos com rapidez e consistência, sem
// consultar a Central a cada atendimento.
//
// REGRA CRÍTICA: a Central de Ajuda é SOMENTE LEITURA. Aqui só fazemos GET do
// conteúdo (estrutura de páginas). NUNCA escreve/edita/cria/apaga nada nela.
//
// - Atualiza na inicialização e uma vez por dia (CACHE_CATEGORIAS_HORA, padrão 02:00).
// - Fallback: se não houver cache, consulta a Central direto e gera o cache.

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { env, GITBOOK } = require("../config");

const CACHE_DIR = path.join(process.cwd(), "documentacao-ia-whatsapp", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "categorias-central.json");
const HORA_REFRESH = Number(env.CACHE_CATEGORIAS_HORA);
const HORA = Number.isInteger(HORA_REFRESH) && HORA_REFRESH >= 0 && HORA_REFRESH <= 23 ? HORA_REFRESH : 2;

let _categorias = null; // em memória: [{ nome, path, subs: [{ nome, path }] }]

function agoraFormatado() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date());
}

// --------------------------------------
// Busca a estrutura da Central de Ajuda (SOMENTE GET — leitura).
// --------------------------------------

async function buscarDaCentral() {
  const r = await axios.get(
    `https://api.gitbook.com/v1/spaces/${GITBOOK.CENTRAL_AJUDA_SPACE_ID}/content`,
    { headers: { Authorization: `Bearer ${env.GITBOOK_TOKEN}` }, timeout: 15000 }
  );
  const pages = r.data?.pages || [];
  return pages
    .map((p) => ({
      nome: String(p.title || "").trim(),
      path: p.path || p.slug || "",
      subs: (p.pages || [])
        .map((s) => ({ nome: String(s.title || "").trim(), path: s.path || s.slug || "" }))
        .filter((s) => s.nome),
    }))
    .filter((c) => c.nome);
}

// --------------------------------------
// Disco
// --------------------------------------

function carregarDoDisco() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function salvarNoDisco(categorias) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ atualizadoEm: agoraFormatado(), categorias }, null, 2)
    );
  } catch (e) {
    console.log("⚠️ Erro ao salvar cache de categorias:", e.message);
  }
}

// --------------------------------------
// Atualiza o cache a partir da Central (consulta direta). Atualiza memória + disco.
// --------------------------------------

async function atualizarCache() {
  try {
    const categorias = await buscarDaCentral();
    if (categorias.length) {
      _categorias = categorias;
      salvarNoDisco(categorias);
      console.log(`🗂️ Cache de categorias atualizado da Central (${categorias.length} categorias de topo).`);
    }
    return _categorias || [];
  } catch (e) {
    console.log("⚠️ Não consegui atualizar o cache de categorias (Central):", e.response?.status, e.message);
    return _categorias || [];
  }
}

// --------------------------------------
// Retorna as categorias: memória -> disco -> Central (gera cache no fallback).
// --------------------------------------

async function obterCategorias() {
  if (_categorias && _categorias.length) return _categorias;

  const doDisco = carregarDoDisco();
  if (doDisco && Array.isArray(doDisco.categorias) && doDisco.categorias.length) {
    _categorias = doDisco.categorias;
    return _categorias;
  }

  // sem cache -> consulta direta e gera o cache
  return atualizarCache();
}

// --------------------------------------
// Inicialização: garante o cache no boot e agenda o refresh diário.
// --------------------------------------

function agendarRefreshDiario() {
  const agora = new Date();
  const prox = new Date(agora);
  prox.setHours(HORA, 0, 0, 0);
  if (prox <= agora) prox.setDate(prox.getDate() + 1);
  const ms = prox - agora;

  const t = setTimeout(() => {
    atualizarCache().catch(() => {});
    const i = setInterval(() => atualizarCache().catch(() => {}), 24 * 60 * 60 * 1000);
    if (i.unref) i.unref();
  }, ms);
  if (t.unref) t.unref();

  console.log(`🗂️ Refresh diário do cache de categorias agendado para ${String(HORA).padStart(2, "0")}:00 (em ~${Math.round(ms / 3600000)}h).`);
}

function iniciarCacheCategorias() {
  const doDisco = carregarDoDisco();
  if (doDisco && Array.isArray(doDisco.categorias) && doDisco.categorias.length) {
    _categorias = doDisco.categorias;
    console.log(`🗂️ Cache de categorias carregado do disco (${_categorias.length} categorias, atualizado em ${doDisco.atualizadoEm}).`);
  } else {
    console.log("🗂️ Sem cache de categorias — consultando a Central...");
  }
  // freshen em background no boot (não bloqueia a subida do servidor)
  atualizarCache().catch(() => {});
  agendarRefreshDiario();
}

module.exports = {
  obterCategorias,
  atualizarCache,
  iniciarCacheCategorias,
  // util p/ teste
  carregarDoDisco,
  CACHE_FILE,
};
