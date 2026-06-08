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

function agendarProcessamento(chatId, { texto, imagem }, processar) {
  let buf = buffers.get(chatId);
  if (!buf) {
    buf = { textos: [], imagens: [], timer: null };
    buffers.set(chatId, buf);
  }

  if (texto) buf.textos.push(texto);
  if (imagem) buf.imagens.push(imagem);

  // reinicia a contagem a cada nova mensagem
  if (buf.timer) clearTimeout(buf.timer);

  buf.timer = setTimeout(() => {
    buffers.delete(chatId);

    const pergunta = buf.textos.join(" ").replace(/\s+/g, " ").trim();

    Promise.resolve(
      processar({ chatId, pergunta, imagens: buf.imagens })
    ).catch((error) =>
      console.log("❌ Erro no processamento agrupado:", error.message)
    );
  }, WHATSAPP.DEBOUNCE_MS);

  if (buf.timer.unref) buf.timer.unref();
}

module.exports = {
  agendarProcessamento,
};
