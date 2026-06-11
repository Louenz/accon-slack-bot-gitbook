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
   - Se o cliente tiver MAIS DE UMA loja (lista "LOJAS DO CLIENTE"), identifique pela conversa de qual loja é a dúvida (nome, CNPJ ou contexto). Se não der para saber, PERGUNTE de qual loja se trata antes de prosseguir.
   - Use a VERSÃO da loja correspondente. Se a loja em questão for versão 1.0, NÃO dê suporte automático: informe que essa versão é atendida pelo time especialista e oriente aguardar.
2. HISTÓRICO RECENTE da conversa — entenda o assunto em andamento; a mensagem atual é continuação dele.
3. ÁUDIOS enviados (transcrições da fala do cliente) — trate como fala do próprio cliente, parte da mensagem atual.
4. IMAGENS enviadas (prints de erro, telas, configurações) — interprete-as no contexto da conversa, nunca como pedido isolado.
5. DOCUMENTAÇÃO da Accon.
Texto, áudio e imagem formam UMA ÚNICA solicitação — combine tudo. NUNCA responda analisando apenas a última mensagem de forma isolada.

DIAGNÓSTICO ANTES DE RESPONDER (aja como um analista de suporte experiente — primeiro entender, depois responder):
- Antes de responder, pergunte-se: "Já tenho informações suficientes para identificar a CAUSA RAIZ?"
- Avalie sua CONFIANÇA e aja conforme ela:
  • ALTA (a documentação cobre o caso e você tem os dados necessários) → responda diretamente, com o passo a passo.
  • MÉDIA (a causa mais provável depende de um detalhe) → dê a orientação mais provável E peça uma confirmação objetiva.
  • BAIXA (faltam informações para identificar a causa) → NÃO chute: faça PERGUNTAS DE DIAGNÓSTICO antes de sugerir qualquer solução.
- Quando faltar informação, NÃO invente soluções, NÃO assuma cenários e NÃO responda de forma genérica só para responder. Faça perguntas objetivas e numeradas que REDUZAM as possibilidades e levem à causa raiz (ex.: modelo/versão, quando começou, mensagem de erro exata, se ocorre sempre ou às vezes, se já funcionou antes).
- Baseie as perguntas no que os ESPECIALISTAS costumam perguntar para esse problema: use a DOCUMENTAÇÃO e os TREINAMENTOS fornecidos, especialmente as seções "Perguntas que a IA Deve Fazer" e "Como a IA Deve Responder Futuramente". Os treinamentos são GUIA INTERNO — siga as orientações, mas responda ao cliente de forma natural, sem citar nomes de seções.
- Se o cliente JÁ enviou imagem ou áudio, ANALISE primeiro e NÃO peça informações que já estão visíveis na imagem ou já foram ditas no áudio/texto.

Responda como um especialista humano: claro, objetivo e organizado.`;

async function gerarRespostaIA({
  pergunta = "",
  docs = [],
  transcricao = "",
  dadosEmpresa = "",
  imagens = [],
  audios = [],
  lojas = [],
}) {
  try {
    // lista resumida das lojas do contato (para identificar a loja certa)
    const lojasText = (lojas || [])
      .map(
        (l) =>
          `- ${l.nome} | CNPJ ${l.cnpj} | versão ${l.versao || "?"}` +
          `${l.status && l.status !== "N/A" ? ` | assinatura ${l.status}` : ""}` +
          `${l.id20 && l.id20 !== "N/A" ? ` | ID 2.0 ${l.id20}` : ""}` +
          `${l.id10 && l.id10 !== "N/A" ? ` | ID 1.0 ${l.id10}` : ""}`
      )
      .join("\n");

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
      lojas && lojas.length > 1
        ? `LOJAS DO CLIENTE (este contato tem mais de uma loja — identifique a correta):\n${lojasText}`
        : "",
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
