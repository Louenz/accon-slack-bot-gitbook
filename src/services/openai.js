// ======================================
// SERVIÇO: OPENAI (geração da resposta)
// ======================================
//
// Escolhe o modelo e gera a resposta usando SOMENTE a documentação
// enviada (o prompt impede a IA de inventar informações).

const { openai } = require("../clients");

// --------------------------------------
// Define modelo/limite conforme houver imagem.
// --------------------------------------

function chooseModel(hasImage = false) {
  if (hasImage) {
    return { model: "gpt-4.1", maxTokens: 5000 };
  }

  return { model: "gpt-4.1-mini", maxTokens: 2500 };
}

// --------------------------------------
// Gera a resposta baseada na documentação.
// Aceita imagem opcional (base64) para perguntas com print.
// --------------------------------------

async function generateAnswer(
  question,
  docs,
  imageBase64 = null,
  { includeSources = true } = {}
) {
  try {
    const model = chooseModel(!!imageBase64);

    const docsText = docs
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

    // includeSources = true (PADRÃO) -> comportamento do Slack, inalterado.
    // includeSources = false -> usado SÓ pelo WhatsApp (cliente não vê fontes).
    const sourcesSection = includeSources
      ? `
FONTES:
- utilize APENAS URLs reais presentes nos documentos enviados.
- nunca crie links fictícios.
- nunca invente artigos.
`
      : `
FONTES:
- NÃO inclua links, URLs ou uma seção de fontes na resposta.
- responda apenas com o conteúdo, sem citar de onde veio.
`;

    const finalSection = includeSources
      ? `
NO FINAL:
📚 Fontes:
• Nome → URL
`
      : "";

    const messages = [
      {
        role: "system",
        content: `
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
${sourcesSection}
FORMATAÇÃO:
- resposta organizada para Slack
- utilize listas quando necessário
- não use markdown complexo
- utilize emojis para deixar mais bonito o markdown

IMPORTANTE:
Se a pergunta pedir uma configuração muito específica e ela não estiver explicitamente documentada, responda que essa informação não foi encontrada na documentação.
${finalSection}`,
      },
    ];

    const userText = `
PERGUNTA:
${question}

CONTEÚDOS:
${docsText}
`;

    if (imageBase64) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: userText },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${imageBase64}`,
            },
          },
        ],
      });
    } else {
      messages.push({
        role: "user",
        content: userText,
      });
    }

    const response = await openai.chat.completions.create({
      model: model.model,
      messages,
      temperature: 0.1,
      max_tokens: model.maxTokens,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.log(error);
    return "❌ Erro ao gerar resposta.";
  }
}

module.exports = {
  chooseModel,
  generateAnswer,
};
