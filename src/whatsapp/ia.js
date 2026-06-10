// ======================================
// WHATSAPP: GERAÇÃO DA RESPOSTA (IA)
// ======================================
//
// Geração da resposta do bot do WhatsApp. Reaproveita o CLIENT OpenAI
// compartilhado (clients.js), mas com lógica própria do WhatsApp — não
// altera o generateAnswer do Slack.
//
// Usa um modelo multimodal de contexto longo (gpt-4.1) e monta o prompt
// com prioridade: dados da empresa > histórico da conversa > imagens >
// documentação. A IA nunca responde olhando só a última mensagem.

const { openai } = require("../clients");

// modelo avançado para a resposta final (texto + imagem, contexto longo)
const MODELO = "gpt-4.1";
const MAX_TOKENS = 3000;

const SYSTEM_PROMPT = `Você é um especialista de suporte técnico da Accon, atendendo um cliente pelo WhatsApp.

REGRAS:
- Responda SOMENTE com base na DOCUMENTAÇÃO fornecida. Nunca invente telas, botões, menus, passos ou funcionalidades que não estejam nela.
- Se a documentação não cobrir o caso, diga que não encontrou essa informação e oriente aguardar o suporte. Não chute.
- Nunca diga "provavelmente", "geralmente" ou "normalmente".
- Não inclua links nem cite fontes.

CONTEXTO (use sempre, nesta ordem de prioridade):
1. DADOS DA EMPRESA (cadastro, versão, integrações) — leve em conta ao responder.
2. HISTÓRICO RECENTE da conversa — entenda o assunto em andamento; a mensagem atual é continuação dele.
3. ÁUDIOS enviados (transcrições da fala do cliente) — trate como fala do próprio cliente, parte da mensagem atual.
4. IMAGENS enviadas (prints de erro, telas, configurações) — interprete-as no contexto da conversa, nunca como pedido isolado.
5. DOCUMENTAÇÃO da Accon.
Texto, áudio e imagem formam UMA ÚNICA solicitação — combine tudo. NUNCA responda analisando apenas a última mensagem de forma isolada.

Responda como um especialista humano: claro, objetivo e organizado. Se faltar informação para resolver com segurança, peça o que falta antes de prosseguir.`;

async function gerarRespostaIA({
  pergunta = "",
  docs = [],
  transcricao = "",
  dadosEmpresa = "",
  imagens = [],
  audios = [],
}) {
  try {
    const docsText = docs
      .map(
        (doc, index) => `[DOC ${index + 1}] ${doc.title}\n${doc.body}`
      )
      .join("\n\n");

    const audiosText = (audios || [])
      .filter(Boolean)
      .map((a, i) => `(áudio ${i + 1}) ${a}`)
      .join("\n");

    // descreve as mídias presentes para a IA nunca tratar como pedido isolado
    const semTexto = !pergunta
      ? audiosText
        ? "(somente áudio — veja a transcrição acima)"
        : "(somente imagem, sem texto)"
      : pergunta;

    const partesTexto = [
      dadosEmpresa ? `DADOS DA EMPRESA:\n${dadosEmpresa}` : "",
      transcricao ? `HISTÓRICO RECENTE DA CONVERSA:\n${transcricao}` : "",
      audiosText ? `ÁUDIOS DO CLIENTE (transcritos):\n${audiosText}` : "",
      `MENSAGEM ATUAL DO CLIENTE:\n${semTexto}`,
      `DOCUMENTAÇÃO DISPONÍVEL:\n${docsText || "(nenhum documento encontrado)"}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const content = [{ type: "text", text: partesTexto }];

    for (const img of imagens) {
      if (!img || !img.base64) continue;
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${img.contentType || "image/png"};base64,${img.base64}`,
        },
      });
    }

    const response = await openai.chat.completions.create({
      model: MODELO,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
      temperature: 0.1,
      max_tokens: MAX_TOKENS,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.log("❌ Erro ao gerar resposta da IA (WhatsApp):", error.message);
    return "❌ Erro ao gerar resposta.";
  }
}

module.exports = {
  gerarRespostaIA,
};
