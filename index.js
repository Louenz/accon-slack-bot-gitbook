// ======================================
// IMPORTS
// ======================================

require("dotenv").config();

const { App } = require("@slack/bolt");
const axios = require("axios");
const OpenAI = require("openai");
const stringSimilarity =
  require("string-similarity");

// ======================================
// OPENAI
// ======================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ======================================
// SLACK
// ======================================

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000,
});

// ======================================
// LIMITES POR CANAL
// ======================================

const CHANNEL_LIMITS = {

  suporte: 600,

  duvidas: 200,

  //financeiro: 50,

};

// ======================================
// GITBOOK SPACES
// ======================================

const SPACES = [
  {
    name: "Central de ajuda Accon",
    id: "f70xibkjOuE6vUYi8iTR",
  },
  {
    name: "Base de conhecimento Accon",
    id: "lRDxW1FXy0nHj5b8YF1w",
  },
];

// ======================================
// SINÔNIMOS
// ======================================

const synonyms = {

  deletar: [
    "excluir",
    "remover",
    "apagar",
    "deletar",
  ],

  excluir: [
    "excluir",
    "remover",
    "apagar",
    "deletar",
  ],

  remover: [
    "excluir",
    "remover",
    "apagar",
    "deletar",
  ],

  apagar: [
    "excluir",
    "remover",
    "apagar",
    "deletar",
  ],

  cashback: [
    "cashback",
    "saldo",
    "credito",
    "crédito",
  ],

  cancelar: [
    "cancelar",
    "cancelado",
    "cancelamento",
    "estornar",
    "estorno",
  ],

  mesa: [
    "mesa",
    "comanda",
    "mesa/comanda",
  ],

  comanda: [
    "mesa",
    "comanda",
    "mesa/comanda",
  ],

};

// ======================================
// REMOVE MENÇÕES DO SLACK
// ======================================

function sanitizeSlackMentions(text = "") {

  return text

    // usuários
    .replace(
      /<@([A-Z0-9]+)>/g,
      "usuário"
    )

    // grupos
    .replace(
      /<!subteam\^[A-Z0-9]+\|([^>]+)>/g,
      "$1"
    )

    // especiais
    .replace(/<!channel>/g, "canal")
    .replace(/<!here>/g, "here")
    .replace(/<!everyone>/g, "everyone");

}

// ======================================
// MODEL
// ======================================

function chooseModel(hasImage = false) {

  if (hasImage) {

    return {
      model: "gpt-4.1",
      maxTokens: 5000,
    };

  }

  return {
    model: "gpt-4.1-mini",
    maxTokens: 2500,
  };

}

// ======================================
// CLEAN TEXT
// ======================================

function cleanText(text = "") {

  return text

    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")

    .replace(/\n{3,}/g, "\n\n")

    .trim();

}

// ======================================
// GITBOOK SEARCH
// ======================================

async function searchGitBook(query) {

  try {

    let allResults = [];

    for (const space of SPACES) {

      try {

        const response =
          await axios.get(
            `https://api.gitbook.com/v1/spaces/${space.id}/search`,
            {
              headers: {
                Authorization:
                  `Bearer ${process.env.GITBOOK_TOKEN}`,
              },
              params: {
                query,
              },
            }
          );

        const items =
          response.data.items || [];

        const mapped =
          items.map(item => ({

            title:
              item.title || "",

            url:
              item.urls?.app || "",

            pageId:
              item.id,

            spaceId:
              space.id,

            score:
              item.score || 0,

            body:
              item.sections
                ?.map(s =>
                  s.body || ""
                )
                .join("\n\n") || "",

          }));

        allResults.push(...mapped);

      } catch {}

    }

    allResults.sort(
      (a, b) =>
        b.score - a.score
    );

    return allResults.slice(0, 5);

  } catch {

    return [];

  }

}

// ======================================
// FULL PAGE
// ======================================

async function getFullPageContent(spaceId, pageId) {

  try {

    const response =
      await axios.get(
        `https://api.gitbook.com/v1/spaces/${spaceId}/content/page/${pageId}?format=markdown`,
        {
          headers: {
            Authorization:
              `Bearer ${process.env.GITBOOK_TOKEN}`,
          },
        }
      );

    return (
      response.data.markdown ||
      response.data.content ||
      ""
    );

  } catch {

    return null;

  }

}

// ======================================
// DOWNLOAD IMAGE
// ======================================

async function downloadSlackImage(fileUrl) {

  try {

    const response =
      await axios.get(
        fileUrl,
        {
          responseType:
            "arraybuffer",

          headers: {
            Authorization:
              `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          },
        }
      );

    return Buffer
      .from(response.data)
      .toString("base64");

  } catch {

    return null;

  }

}

// ======================================
// SEARCH SLACK
// ======================================

async function searchSlackMessages(query, client) {

  try {

    const conversations =
      await client.conversations.list({
        limit: 100,
      });

    const channels =
      conversations.channels || [];

    const allowedChannels =
      channels.filter(channel =>
        CHANNEL_LIMITS[
          channel.name
        ]
      );

    const userCache = {};

    let candidates = [];

    for (const channel of allowedChannels) {

      try {

        const history =
          await client.conversations.history({

            channel:
              channel.id,

            limit:
              CHANNEL_LIMITS[
                channel.name
              ],

          });

        const messages =
          history.messages || [];

        for (const message of messages) {

          if (!message.user) continue;

          if (message.bot_id) continue;

          if (message.subtype) continue;

          if (!message.text) continue;

          if (
            message.text.length < 20
          ) continue;

          // ignora mensagens do bot
          if (
            message.text.includes(
              `<@${process.env.BOT_USER_ID}>`
            )
          ) continue;

          const normalized =
            message.text.toLowerCase();

          const stopWords = [

            "id pedido",
            "id loja",
            "id rede",

            "segue print",
            "segue video",
            "segue vídeo",

            "bom dia",
            "boa tarde",
            "boa noite",

            "consegue verificar",

            "por favor fazer",

            "estorno desse pedido",
            "estorno desses pedidos",

            "segue anexo",

            "teste",

            "pedido manual",

          ];

          let blocked = false;

          for (const stop of stopWords) {

            if (
              normalized.includes(stop)
            ) {

              blocked = true;
              break;

            }

          }

          if (blocked) continue;

          let queryWords =
            query
              .toLowerCase()
              .split(/\s+/)
              .filter(word =>
                word.length > 2
              );

          let expandedWords = [];

          for (const word of queryWords) {

            expandedWords.push(word);

            if (synonyms[word]) {

              expandedWords.push(
                ...synonyms[word]
              );

            }

          }

          queryWords =
            [...new Set(expandedWords)];

          let technicalScore = 0;

          for (const word of queryWords) {

            // literal
            if (
              normalized.includes(word)
            ) {

              technicalScore += 2;
              continue;

            }

            // fuzzy
            const messageWords =
              normalized.split(/\s+/);

            let matched = false;

            for (const messageWord of messageWords) {

              const similarity =
                stringSimilarity.compareTwoStrings(
                  word,
                  messageWord
                );

              if (similarity >= 0.72) {

                technicalScore += 1;
                matched = true;
                break;

              }

            }

            if (matched) continue;

          }

          if (technicalScore < 1) {

            continue;

          }

          let userName =
            "Usuário";

          try {

            if (
              userCache[message.user]
            ) {

              userName =
                userCache[
                  message.user
                ];

            } else {

              const userInfo =
                await client.users.info({

                  user:
                    message.user,

                });

              userName =
                userInfo.user?.profile?.real_name ||
                userInfo.user?.profile?.display_name ||
                userInfo.user?.real_name ||
                userInfo.user?.name ||
                "Usuário";

              userCache[
                message.user
              ] = userName;

            }

          } catch {}

          candidates.push({

            preview:
              sanitizeSlackMentions(
                message.text
              ).substring(0, 500),

            ts:
              message.ts,

            userName,

            channelName:
              channel.name,

            channelId:
              channel.id,

            technicalScore,

          });

        }

      } catch {}

    }

    candidates.sort(
      (a, b) =>
        b.technicalScore -
        a.technicalScore
    );

    const limited =
      candidates.slice(0, 10);

    const prompt =
`
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

${limited.map((item, index) => `
[${index}]
${item.preview}
`).join("\n\n")}
`;

    const ranking =
      await openai.chat.completions.create({

        model:
          "gpt-4.1-mini",

        messages: [

          {
            role: "system",
            content:
              "Você é especialista em busca semântica de suporte técnico.",
          },

          {
            role: "user",
            content:
              prompt,
          },

        ],

        temperature: 0,

        max_tokens: 30,

      });

    const content =
      ranking.choices[0]
        .message
        .content || "";

    const indexes =
      content
        .match(/\d+/g)
        ?.map(Number) || [];

    const results =
      indexes
        .map(index =>
          limited[index]
        )
        .filter(Boolean)
        .slice(0, 3);

    return results;

  } catch (error) {

    console.log(
      "Erro Slack:",
      error.message
    );

    return [];

  }

}

// ======================================
// GENERATE ANSWER
// ======================================

async function generateAnswer(
  question,
  docs,
  imageBase64 = null
) {

  try {

    const model =
      chooseModel(
        !!imageBase64
      );

    const docsText =
      docs
        .map(
          (doc, index) => `
[FONTE ${index + 1}]

Título:
${doc.title}

Conteúdo:
${doc.body}

Link:
${doc.url}
`
        )
        .join("\n\n");

    const messages = [

      {
        role: "system",
        content:
`
Você é um assistente da documentação da Accon.

REGRAS CRÍTICAS:

- Responda SOMENTE com informações presentes na documentação enviada.
- Nunca invente menus, botões, telas ou funcionalidades.
- Nunca complete lacunas usando conhecimento próprio.
- Nunca assuma comportamentos do sistema.
- Nunca crie URLs.
- Nunca invente fontes.
- Nunca diga "provavelmente", "geralmente" ou "normalmente".

SE A DOCUMENTAÇÃO NÃO CONTIVER A RESPOSTA EXATA:
- diga claramente que não encontrou essa informação na documentação disponível.
- sugira consultar o suporte interno.

FONTES:
- utilize APENAS URLs reais presentes nos documentos enviados.
- nunca crie links fictícios.
- nunca invente artigos.

FORMATAÇÃO:
- resposta organizada para Slack
- utilize listas quando necessário
- não use markdown complexo
- utilize emojis para deixar mais bonito o markdown

IMPORTANTE:
Se a pergunta pedir uma configuração muito específica e ela não estiver explicitamente documentada, responda que essa informação não foi encontrada na documentação.

NO FINAL:
📚 Fontes:
• Nome → URL
`,
      },

    ];

    if (imageBase64) {

      messages.push({

        role: "user",

        content: [

          {
            type: "text",

            text:
`
PERGUNTA:
${question}

CONTEÚDOS:
${docsText}
`,
          },

          {
            type: "image_url",

            image_url: {
              url:
                `data:image/png;base64,${imageBase64}`,
            },
          },

        ],

      });

    } else {

      messages.push({

        role: "user",

        content:
`
PERGUNTA:
${question}

CONTEÚDOS:
${docsText}
`,
      });

    }

    const response =
      await openai.chat.completions.create({

        model:
          model.model,

        messages,

        temperature: 0.1,

        max_tokens:
          model.maxTokens,

      });

    return response
      .choices[0]
      .message
      .content;

  } catch (error) {

    console.log(error);

    return "❌ Erro ao gerar resposta.";

  }

}

// ======================================
// APP MENTION
// ======================================

app.event(
  "app_mention",
  async ({ event, client }) => {

    try {

      if (event.bot_id) return;

      const question =
        event.text
          .replace(/<@.*?>/g, "")
          .trim();

      const thinking =
        await client.chat.postMessage({

          channel:
            event.channel,

          thread_ts:
            event.ts,

          text:
            "🤖 Pensando...",

        });

      let docs =
        await searchGitBook(
          question
        );

      if (docs[0]) {

        const fullPage =
          await getFullPageContent(
            docs[0].spaceId,
            docs[0].pageId
          );

        if (fullPage) {

          docs[0].body =
            fullPage;

        }

      }

      let imageBase64 =
        null;

      const files =
        event.files || [];

      if (files.length > 0) {

        const image =
          files.find(file =>
            file.mimetype?.startsWith(
              "image/"
            )
          );

        if (image) {

          imageBase64 =
            await downloadSlackImage(
              image.url_private
            );

        }

      }

      let answer =
        await generateAnswer(
          question,
          docs,
          imageBase64
        );

      answer =
        cleanText(answer);

      // ======================================
      // LIMITE SLACK
      // ======================================

      if (
        answer.length > 2500
      ) {

        let sources = "";

        if (
          answer.includes("📚 Fontes:")
        ) {

          const split =
            answer.split(
              "📚 Fontes:"
            );

          answer =
            split[0];

          sources =
            "\n\n📚 Fontes:\n" +
            split[1];

        }

        answer =
          answer.replace(
            /\|[-| ]+\|/g,
            ""
          );

        answer =
          answer.replace(
            /\n{3,}/g,
            "\n\n"
          );

        const reservedSpace =
          sources.length +
          250;

        const maxContent =
          2900 -
          reservedSpace;

        answer =
          answer.substring(
            0,
            maxContent
          );

        const lastParagraph =
          answer.lastIndexOf(
            "\n\n"
          );

        if (
          lastParagraph > 0
        ) {

          answer =
            answer.substring(
              0,
              lastParagraph
            );

        }

        answer +=
          "\n\n⚠️ Resposta muito longa. Continue lendo na documentação.";

        answer += sources;

      }

      await client.chat.update({

        channel:
          event.channel,

        ts:
          thinking.ts,

        text:
          answer,

        blocks: [

          {
            type: "section",

            text: {
              type:
                "mrkdwn",

              text:
                `📘 *Resposta da IA*\n\n${answer}`,
            },
          },

          {
            type: "actions",

            elements: [

              {
                type: "button",

                style:
                  "primary",

                text: {
                  type:
                    "plain_text",

                  text:
                    "💬 Receber resposta do Slack?",
                },

                action_id:
                  "search_slack_answer",

                value:
                  JSON.stringify({
                    question,
                  }),
              },

            ],
          },

        ],

      });

    } catch (error) {

      console.log(error);

    }

  }
);

// ======================================
// SEARCH BUTTON
// ======================================

app.action(
  "search_slack_answer",
  async ({
    ack,
    body,
    client,
  }) => {

    await ack();

    setTimeout(async () => {

      try {

        const payload =
          JSON.parse(
            body.actions[0].value
          );

        const question =
          payload.question;

        await client.chat.postMessage({

          channel:
            body.channel.id,

          thread_ts:
            body.message.ts,

          text:
            "🔎 Buscando respostas relevantes no Slack...",

        });

        const matches =
          await searchSlackMessages(
            question,
            client
          );

        if (!matches.length) {

          await client.chat.postMessage({

            channel:
              body.channel.id,

            thread_ts:
              body.message.ts,

            text:
              "❌ Não encontrei respostas relevantes.",

          });

          return;

        }

        const blocks = [

          {
            type: "section",

            text: {
              type:
                "mrkdwn",

              text:
                "💬 *Conversas encontradas no Slack*",
            },
          },

        ];

        let index = 1;

        for (const match of matches) {

          const date =
            new Date(
              parseFloat(
                match.ts
              ) * 1000
            ).toLocaleString(
              "pt-BR"
            );

          blocks.push({

            type: "section",

            text: {
              type:
                "mrkdwn",

              text:
`
👤 ${match.userName}
📅 ${date}
📍 #${match.channelName}

━━━━━━━━━━━━━━━━━━

*${index}. ${match.preview}*
`,
            },

          });

          blocks.push({

            type: "actions",

            elements: [

              {
                type: "button",

                text: {
                  type:
                    "plain_text",

                  text:
                    "📖 Ver resposta",
                },

                action_id:
                  "open_slack_result",

                value:
                  JSON.stringify({

                    channel:
                      match.channelId,

                    ts:
                      match.ts,

                    text:
                      match.preview,

                    user:
                      match.userName,

                    date,

                  }),
              },

            ],

          });

          blocks.push({
            type: "divider",
          });

          index++;

        }

        await client.chat.postMessage({

          channel:
            body.channel.id,

          thread_ts:
            body.message.ts,

          text:
            "💬 Conversas encontradas",

          blocks,

        });

      } catch (error) {

        console.log(
          "Erro search_slack_answer:",
          error
        );

      }

    }, 0);

  }
);

// ======================================
// OPEN RESULT
// ======================================

app.action(
  "open_slack_result",
  async ({
    ack,
    body,
    client,
  }) => {

    await ack();

    setTimeout(async () => {

      try {

        const payload =
          JSON.parse(
            body.actions[0].value
          );

        let fullThread =
          payload.text;

        try {

          const replies =
            await client.conversations.replies({

              channel:
                payload.channel,

              ts:
                payload.ts,

              limit: 15,

            });

          const messages =
            replies.messages || [];

          fullThread =
            messages
              .map(message => {

                return sanitizeSlackMentions(
                  message.text || ""
                );

              })
              .join("\n\n");

          if (
            fullThread.length > 2500
          ) {

            fullThread =
              fullThread.substring(
                0,
                2500
              ) +
              "\n\n⚠️ Thread muito longa. Abra no Slack para continuar lendo.";

          }

        } catch {}

        const link =
          `https://slack.com/archives/${payload.channel}/p${payload.ts.replace(".", "")}`;

        await client.chat.postMessage({

          channel:
            body.channel.id,

          thread_ts:
            body.message.ts,

          text:
            "💬 Resposta encontrada",

          blocks: [

            {
              type: "section",

              text: {
                type:
                  "mrkdwn",

                text:
`
💬 *Resposta encontrada*

👤 *Responsável:*
${payload.user}

📅 *Data:*
${payload.date}

━━━━━━━━━━━━━━━━━━

📝 *Thread completa:*

${fullThread}

━━━━━━━━━━━━━━━━━━

🔗 *Abrir conversa completa:*
${link}
`,
              },
            },

          ],

        });

      } catch (error) {

        console.log(
          "Erro open_slack_result:",
          error
        );

      }

    }, 0);

  }
);

// ======================================
// START
// ======================================

(async () => {

  await app.start();

  console.log(
    "⚡ Bot rodando!"
  );

})();