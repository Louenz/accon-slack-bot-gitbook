// ======================================
// SERVIÇO: GITBOOK
// ======================================
//
// Responsável por consultar a documentação no GitBook: busca por termo
// nos spaces configurados e leitura do conteúdo completo de uma página.

const axios = require("axios");
const { env, SPACES } = require("../config");

// --------------------------------------
// Busca a pergunta nos spaces informados e
// retorna os 5 resultados mais relevantes.
//
// Por padrão busca em TODOS os spaces (comportamento do Slack — inalterado).
// O bot do WhatsApp passa apenas os spaces públicos (PUBLIC_SPACES).
// --------------------------------------

async function searchGitBook(query, spaces = SPACES) {
  try {
    let allResults = [];

    for (const space of spaces) {
      try {
        const response = await axios.get(
          `https://api.gitbook.com/v1/spaces/${space.id}/search`,
          {
            headers: {
              Authorization: `Bearer ${env.GITBOOK_TOKEN}`,
            },
            params: { query },
          }
        );

        const items = response.data.items || [];

        const mapped = items.map((item) => ({
          title: item.title || "",
          url: item.urls?.app || "",
          pageId: item.id,
          spaceId: space.id,
          score: item.score || 0,
          body:
            item.sections?.map((s) => s.body || "").join("\n\n") || "",
        }));

        allResults.push(...mapped);
      } catch {}
    }

    allResults.sort((a, b) => b.score - a.score);

    return allResults.slice(0, 5);
  } catch {
    return [];
  }
}

// --------------------------------------
// Lê o conteúdo completo (markdown) de uma
// página específica do GitBook.
// --------------------------------------

async function getFullPageContent(spaceId, pageId) {
  try {
    const response = await axios.get(
      `https://api.gitbook.com/v1/spaces/${spaceId}/content/page/${pageId}?format=markdown`,
      {
        headers: {
          Authorization: `Bearer ${env.GITBOOK_TOKEN}`,
        },
      }
    );

    return response.data.markdown || response.data.content || "";
  } catch {
    return null;
  }
}

module.exports = {
  searchGitBook,
  getFullPageContent,
};
