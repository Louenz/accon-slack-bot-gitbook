// ======================================
// HANDLER: MENÇÃO AO BOT (@ajuda)
// ======================================
//
// Disparado quando alguém menciona o robô no Slack. Faz a busca na
// documentação, lê a página completa, trata imagem (se houver), gera a
// resposta com a IA e publica com o botão "Receber resposta do Slack?".

const { app } = require("../clients");
const { searchGitBook, getFullPageContent } = require("../services/gitbook");
const { downloadSlackImage } = require("../services/slack");
const { generateAnswer } = require("../services/openai");
const { cleanText } = require("../utils/text");

app.event("app_mention", async ({ event, client }) => {
  try {
    if (event.bot_id) return;

    // remove a menção <@bot> e mantém apenas a dúvida
    const question = event.text.replace(/<@.*?>/g, "").trim();

    const thinking = await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: "🤖 Pensando...",
    });

    // busca na documentação e enriquece com a página completa
    let docs = await searchGitBook(question);

    if (docs[0]) {
      const fullPage = await getFullPageContent(
        docs[0].spaceId,
        docs[0].pageId
      );

      if (fullPage) {
        docs[0].body = fullPage;
      }
    }

    // se houver imagem anexada, baixa para enviar à IA
    let imageBase64 = null;
    const files = event.files || [];

    if (files.length > 0) {
      const image = files.find((file) =>
        file.mimetype?.startsWith("image/")
      );

      if (image) {
        imageBase64 = await downloadSlackImage(image.url_private);
      }
    }

    let answer = await generateAnswer(question, docs, imageBase64);
    answer = cleanText(answer);

    // --------------------------------------
    // Respeita o limite de tamanho do Slack,
    // preservando o bloco de fontes no final.
    // --------------------------------------

    if (answer.length > 2500) {
      let sources = "";

      if (answer.includes("📚 Fontes:")) {
        const split = answer.split("📚 Fontes:");
        answer = split[0];
        sources = "\n\n📚 Fontes:\n" + split[1];
      }

      answer = answer.replace(/\|[-| ]+\|/g, "");
      answer = answer.replace(/\n{3,}/g, "\n\n");

      const reservedSpace = sources.length + 250;
      const maxContent = 2900 - reservedSpace;

      answer = answer.substring(0, maxContent);

      const lastParagraph = answer.lastIndexOf("\n\n");
      if (lastParagraph > 0) {
        answer = answer.substring(0, lastParagraph);
      }

      answer +=
        "\n\n⚠️ Resposta muito longa. Continue lendo na documentação.";
      answer += sources;
    }

    await client.chat.update({
      channel: event.channel,
      ts: thinking.ts,
      text: answer,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📘 *Resposta da IA*\n\n${answer}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              style: "primary",
              text: {
                type: "plain_text",
                text: "💬 Receber resposta do Slack?",
              },
              action_id: "search_slack_answer",
              value: JSON.stringify({ question }),
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.log(error);
  }
});
