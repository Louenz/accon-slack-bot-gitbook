// ======================================
// WHATSAPP: ESCRITA NO GITBOOK (via GitHub / Git Sync)
// ======================================
//
// A API do GitBook NÃO escreve conteúdo. O caminho comprovado (igual ao
// projeto gitbook-centraldeajuda) é: gravar markdown num repositório GitHub
// que esteja conectado ao espaço por Git Sync — o GitBook sincroniza.
//
// Cada CATEGORIA vira um arquivo .md; cada TRATATIVA vira um expandable
// (<details>). Se já existir um expandable com o mesmo título, ATUALIZA o
// conteúdo (não duplica conhecimento); senão, anexa um novo.
//
// Requer GITHUB_TOKEN (escrita) e GITHUB_REPO_TREINAMENTO ("org/repo").

const axios = require("axios");
const { env, GITBOOK } = require("../config");

// ======================================
// GUARD DE ISOLAMENTO (REGRA CRÍTICA)
// ======================================
//
// Garante que a escrita só ocorra no repo conectado ao espaço
// "Treinamento IA Whatsapp". Bloqueia qualquer outro alvo (Central de
// Ajuda / Base de Conhecimento são somente-leitura).

let _treinamentoConfirmado = null; // cache (true) após confirmar

async function escritaPermitida() {
  if (_treinamentoConfirmado === true) return true;

  const repo = String(env.GITHUB_REPO_TREINAMENTO || "").toLowerCase().trim();
  if (!repo) return false; // sem repo configurado (tratado antes)

  // 1) denylist explícita: repos de espaços somente-leitura
  if (GITBOOK.READONLY_REPOS.some((r) => r.toLowerCase() === repo)) {
    console.log(
      `🚫 ESCRITA BLOQUEADA: "${repo}" é repositório de espaço SOMENTE LEITURA.`
    );
    return false;
  }

  // 2) confirmação POSITIVA: o repo é o Git Sync do espaço de treinamento?
  if (!env.GITBOOK_TOKEN) {
    console.log(
      "🚫 ESCRITA BLOQUEADA: sem GITBOOK_TOKEN para confirmar o espaço de treinamento."
    );
    return false;
  }

  try {
    const r = await axios.get(
      `https://api.gitbook.com/v1/spaces/${GITBOOK.TREINAMENTO_SPACE_ID}/git/info`,
      { headers: { Authorization: `Bearer ${env.GITBOOK_TOKEN}` } }
    );

    const repoName = String(r.data?.repoName || "").toLowerCase();
    const url = String(r.data?.url || "").toLowerCase();
    const repoCurto = repo.split("/").pop();

    const confere =
      (repoName && (repoName === repo || repoName === repoCurto)) ||
      (url && url.includes(repo));

    if (confere) {
      _treinamentoConfirmado = true;
      return true;
    }

    console.log(
      `🚫 ESCRITA BLOQUEADA: o repo configurado ("${repo}") NÃO corresponde ao Git Sync do espaço "${GITBOOK.TREINAMENTO_SPACE_NAME}" (git/info repoName="${r.data?.repoName || ""}").`
    );
    return false;
  } catch (error) {
    console.log(
      "🚫 ESCRITA BLOQUEADA: não foi possível confirmar o espaço de treinamento (git/info):",
      error.response?.status,
      error.message
    );
    return false;
  }
}

// --------------------------------------
// slug de categoria -> nome de arquivo
// --------------------------------------

function slugCategoria(categoria) {
  return String(categoria)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "outros";
}

// --------------------------------------
// normaliza um título para comparar (detectar tratativa já existente)
// --------------------------------------

function normalizarTitulo(t) {
  return String(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// --------------------------------------
// FUNÇÃO PURA (testável): insere ou atualiza um expandable no conteúdo.
// - se existir <details> com <summary> de título equivalente -> substitui
// - senão -> anexa ao final
// --------------------------------------

function inserirOuAtualizarExpandable(conteudoAtual, titulo, corpo) {
  const bloco =
    `<details>\n<summary>${titulo}</summary>\n\n${corpo}\n\n</details>`;

  const conteudo = conteudoAtual || "";
  const alvo = normalizarTitulo(titulo);

  // procura blocos <details>...<summary>X</summary>...</details>
  const regex = /<details>\s*<summary>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g;

  let match;
  let inicio = -1;
  let fim = -1;
  while ((match = regex.exec(conteudo)) !== null) {
    if (normalizarTitulo(match[1]) === alvo) {
      inicio = match.index;
      fim = match.index + match[0].length;
      break;
    }
  }

  if (inicio >= 0) {
    // ATUALIZA o bloco existente
    return conteudo.slice(0, inicio) + bloco + conteudo.slice(fim);
  }

  // ANEXA novo bloco
  const sep = conteudo.trim() ? "\n\n---\n\n" : "";
  return conteudo.replace(/\s+$/, "") + sep + bloco + "\n";
}

// --------------------------------------
// Grava a tratativa no arquivo da categoria (cria se não existir).
// --------------------------------------

async function enviarTratativa(categoria, titulo, corpo) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO_TREINAMENTO) {
    console.log(
      "⚠️ Treinamento não persistido: defina GITHUB_TOKEN e GITHUB_REPO_TREINAMENTO no .env (repo Git-Synced ao espaço)."
    );
    return false;
  }

  // REGRA CRÍTICA: só grava se o alvo for o espaço "Treinamento IA Whatsapp".
  if (!(await escritaPermitida())) {
    return false;
  }

  const caminho = `${slugCategoria(categoria)}.md`;
  const baseUrl = `https://api.github.com/repos/${env.GITHUB_REPO_TREINAMENTO}/contents/${caminho}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };

  try {
    let conteudoAtual = `# ${categoria}\n`;
    let sha;

    // tenta ler o arquivo existente (para pegar sha + conteúdo)
    try {
      const r = await axios.get(baseUrl, { headers });
      sha = r.data.sha;
      conteudoAtual = Buffer.from(r.data.content, "base64").toString("utf-8");
    } catch (e) {
      if (e.response?.status !== 404) throw e; // 404 = arquivo novo
    }

    const conteudoFinal = inserirOuAtualizarExpandable(
      conteudoAtual,
      titulo,
      corpo
    );

    await axios.put(
      baseUrl,
      {
        message: `Treinamento IA: ${titulo}`,
        content: Buffer.from(conteudoFinal).toString("base64"),
        ...(sha ? { sha } : {}),
      },
      { headers }
    );

    return true;
  } catch (error) {
    console.log(
      "❌ Erro ao gravar treinamento no GitHub:",
      error.response?.status,
      error.response?.data?.message || error.message
    );
    return false;
  }
}

// --------------------------------------
// Lê o conteúdo atual do arquivo de uma categoria (para a IA reaproveitar/
// enriquecer tratativas existentes). Retorna "" se não houver/sem acesso.
// --------------------------------------

async function lerCategoria(categoria) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO_TREINAMENTO) return "";

  const caminho = `${slugCategoria(categoria)}.md`;

  try {
    const r = await axios.get(
      `https://api.github.com/repos/${env.GITHUB_REPO_TREINAMENTO}/contents/${caminho}`,
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
    return Buffer.from(r.data.content, "base64").toString("utf-8");
  } catch {
    return ""; // 404 (categoria nova) ou sem acesso
  }
}

module.exports = {
  enviarTratativa,
  lerCategoria,
  inserirOuAtualizarExpandable,
  slugCategoria,
};
