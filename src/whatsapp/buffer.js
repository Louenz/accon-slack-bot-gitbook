// ======================================
// WHATSAPP: JANELA DE ESPERA / AGRUPAMENTO
// ======================================
//
// Em vez de responder imediatamente, acumula as mensagens (e imagens) que
// chegam em sequência e só processa após ~10s sem novas mensagens. Assim o
// cliente pode mandar complemento, segundo texto, print, etc., e o bot trata
// tudo como UMA única solicitação.
//
// Estado em memória, por chat. Se o servidor reiniciar durante a espera, o
// buffer é perdido (aceitável para teste).

const { WHATSAPP } = require("../config");

const buffers = new Map();

function agendarProcessamento(chatId, { texto, imagem, transcricao }, processar) {
  let buf = buffers.get(chatId);
  if (!buf) {
    buf = { textos: [], imagens: [], transcricoes: [], timer: null };
    buffers.set(chatId, buf);
  }

  if (texto) buf.textos.push(texto);
  if (imagem) buf.imagens.push(imagem);
  if (transcricao) buf.transcricoes.push(transcricao); // áudios já transcritos

  // reinicia a contagem a cada nova mensagem
  if (buf.timer) clearTimeout(buf.timer);

  buf.timer = setTimeout(() => {
    buffers.delete(chatId);

    const pergunta = buf.textos.join(" ").replace(/\s+/g, " ").trim();

    Promise.resolve(
      processar({
        chatId,
        pergunta,
        imagens: buf.imagens,
        transcricoes: buf.transcricoes,
      })
    ).catch((error) =>
      console.log("❌ Erro no processamento agrupado:", error.message)
    );
  }, WHATSAPP.DEBOUNCE_MS);

  if (buf.timer.unref) buf.timer.unref();
}

// Descarta qualquer agrupamento pendente de um chat (usado no #resetar).
function limparBuffer(chatId) {
  const buf = buffers.get(chatId);
  if (buf && buf.timer) clearTimeout(buf.timer);
  buffers.delete(chatId);
}

module.exports = {
  agendarProcessamento,
  limparBuffer,
};
