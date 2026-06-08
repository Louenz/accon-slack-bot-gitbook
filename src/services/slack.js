// ======================================
// SERVIÇO: SLACK (imagem + busca de conversas)
// ======================================
//
// Baixa imagens anexadas e procura, nos canais permitidos, as conversas
// mais parecidas com a pergunta (filtro técnico + ranking com a IA).

const axios = require("axios");
const stringSimilarity = require("string-similarity");

const { openai } = require("../clients");
const { env, CHANNEL_LIMITS, synonyms, STOP_WORDS } = require("../config");
const { sanitizeSlackMentions } = require("../utils/text");

// --------------------------------------
// Baixa uma imagem privada do Slack e
// devolve em base64 (para enviar à IA).
// --------------------------------------

async function downloadSlackImage(fileUrl) {
  try {
    const response = await axios.get(fileUrl, {
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      },
    });

    return Buffer.from(response.data).toString("base64");
  } catch {
    return null;
  }
}

// --------------------------------------
// Procura conversas parecidas com a pergunta:
// 1) lê o histórico dos canais permitidos
// 2) filtra ruído e pontua por relevância técnica
// 3) usa a IA para escolher as 3 melhores
// --------------------------------------

async function searchSlackMessages(query, client) {
  try {
    const conversations = await client.conversations.list({ limit: 100 });
    const channels = conversations.channels || [];

    const allowedChannels = channels.filter(
      (channel) => CHANNEL_LIMITS[channel.name]
    );

    const userCache = {};
    let candidates = [];

    for (const channel of allowedChannels) {
      try {
        const history = await client.conversations.history({
          channel: channel.id,
          limit: CHANNEL_LIMITS[channel.name],
        });

        const messages = history.messages || [];

        for (const message of messages) {
          if (!message.user) continue;
          if (message.bot_id) continue;
          if (message.subtype) continue;
          if (!message.text) continue;
          if (message.text.length < 20) continue;

          // ignora mensagens do próprio bot
          if (message.text.includes(`<@${env.BOT_USER_ID}>`)) continue;

          const normalized = message.text.toLowerCase();

          // descarta ruído operacional (saudações, ids, etc.)
          let blocked = false;
          for (const stop of STOP_WORDS) {
            if (normalized.includes(stop)) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;

          // monta a lista de palavras da pergunta + sinônimos
          let queryWords = query
            .toLowerCase()
            .split(/\s+/)
            .filter((word) => word.length > 2);

          let expandedWords = [];
          for (const word of queryWords) {
            expandedWords.push(word);
            if (synonyms[word]) {
              expandedWords.push(...synonyms[word]);
            }
          }
          queryWords = [...new Set(expandedWords)];

          // pontua a mensagem: match literal (2) ou fuzzy (1)
          let technicalScore = 0;
          for (const word of queryWords) {
            if (normalized.includes(word)) {
              technicalScore += 2;
              continue;
            }

            const messageWords = normalized.split(/\s+/);
            for (const messageWord of messageWords) {
              const similarity = stringSimilarity.compareTwoStrings(
                word,
                messageWord
              );

              if (similarity >= 0.72) {
                technicalScore += 1;
                break;
              }
            }
          }

          if (technicalScore < 1) continue;

          // resolve o nome do autor (com cache)
          let userName = "Usuário";
          try {
            if (userCache[message.user]) {
              userName = userCache[message.user];
            } else {
              const userInfo = await client.users.info({
                user: message.user,
              });

              userName =
                userInfo.user?.profile?.real_name ||
                userInfo.user?.profile?.display_name ||
                userInfo.user?.real_name ||
                userInfo.user?.name ||
                "Usuário";

              userCache[message.user] = userName;
            }
          } catch {}

          candidates.push({
            preview: sanitizeSlackMentions(message.text).substring(0, 500),
            ts: message.ts,
            userName,
            channelName: channel.name,
            channelId: channel.id,
            technicalScore,
          });
        }
      } catch {}
    }

    candidates.sort((a, b) => b.technicalScore - a.technicalScore);

    const limited = candidates.slice(0, 10);

    // a IA escolhe as 3 conversas mais relevantes entre as candidatas
    const prompt = `
PERGUNTA:
${query}

Selecione SOMENTE as 3 conversas mais relevantes.

Priorize:
- mesmo assunto
- mesmo contexto
- mesma intenção
- suporte relacionado

IGNORE:
- assuntos aleatórios
- ids
- operacional
- mensagens sem contexto

Retorne apenas os índices separados por vírgula.

CONVERSAS:

${limited
  .map(
    (item, index) => `
[${index}]
${item.preview}
`
  )
  .join("\n\n")}
`;

    const ranking = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Você é especialista em busca semântica de suporte técnico.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0,
      max_tokens: 30,
    });

    const content = ranking.choices[0].message.content || "";

    const indexes = content.match(/\d+/g)?.map(Number) || [];

    const results = indexes
      .map((index) => limited[index])
      .filter(Boolean)
      .slice(0, 3);

    return results;
  } catch (error) {
    console.log("Erro Slack:", error.message);
    return [];
  }
}

module.exports = {
  downloadSlackImage,
  searchSlackMessages,
};
