// ======================================
// HANDLERS: BOTÕES (ações do Slack)
// ======================================
//
// - search_slack_answer: busca as 3 conversas mais parecidas no Slack
//   e lista cada uma com um botão "Ver resposta".
// - open_slack_result: abre a thread completa da conversa escolhida.

const { app } = require("../clients");
const { searchSlackMessages } = require("../services/slack");
const { sanitizeSlackMentions } = require("../utils/text");

// --------------------------------------
// Botão "Receber resposta do Slack?"
// --------------------------------------

app.action("search_slack_answer", async ({ ack, body, client }) => {
  await ack();

  setTimeout(async () => {
    try {
      const payload = JSON.parse(body.actions[0].value);
      const question = payload.question;

      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message.ts,
        text: "🔎 Buscando respostas relevantes no Slack...",
      });

      const matches = await searchSlackMessages(question, client);

      if (!matches.length) {
        await client.chat.postMessage({
          channel: body.channel.id,
          thread_ts: body.message.ts,
          text: "❌ Não encontrei respostas relevantes.",
        });
        return;
      }

      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "💬 *Conversas encontradas no Slack*",
          },
        },
      ];

      let index = 1;

      for (const match of matches) {
        const date = new Date(
          parseFloat(match.ts) * 1000
        ).toLocaleString("pt-BR");

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `
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
                type: "plain_text",
                text: "📖 Ver resposta",
              },
              action_id: "open_slack_result",
              value: JSON.stringify({
                channel: match.channelId,
                ts: match.ts,
                text: match.preview,
                user: match.userName,
                date,
              }),
            },
          ],
        });

        blocks.push({ type: "divider" });

        index++;
      }

      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message.ts,
        text: "💬 Conversas encontradas",
        blocks,
      });
    } catch (error) {
      console.log("Erro search_slack_answer:", error);
    }
  }, 0);
});

// --------------------------------------
// Botão "Ver resposta" (abre a thread completa)
// --------------------------------------

app.action("open_slack_result", async ({ ack, body, client }) => {
  await ack();

  setTimeout(async () => {
    try {
      const payload = JSON.parse(body.actions[0].value);

      let fullThread = payload.text;

      try {
        const replies = await client.conversations.replies({
          channel: payload.channel,
          ts: payload.ts,
          limit: 15,
        });

        const messages = replies.messages || [];

        fullThread = messages
          .map((message) => sanitizeSlackMentions(message.text || ""))
          .join("\n\n");

        if (fullThread.length > 2500) {
          fullThread =
            fullThread.substring(0, 2500) +
            "\n\n⚠️ Thread muito longa. Abra no Slack para continuar lendo.";
        }
      } catch {}

      const link = `https://slack.com/archives/${payload.channel}/p${payload.ts.replace(".", "")}`;

      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message.ts,
        text: "💬 Resposta encontrada",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `
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
      console.log("Erro open_slack_result:", error);
    }
  }, 0);
});
