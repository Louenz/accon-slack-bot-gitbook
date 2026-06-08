// ======================================
// UTILITÁRIOS DE TEXTO
// ======================================
//
// Funções puras de tratamento de texto usadas em vários pontos do robô.

// --------------------------------------
// Remove menções do Slack (<@U123>, grupos, @channel...)
// deixando o texto legível para a IA e para o preview.
// --------------------------------------

function sanitizeSlackMentions(text = "") {
  return text
    // usuários
    .replace(/<@([A-Z0-9]+)>/g, "usuário")
    // grupos
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, "$1")
    // especiais
    .replace(/<!channel>/g, "canal")
    .replace(/<!here>/g, "here")
    .replace(/<!everyone>/g, "everyone");
}

// --------------------------------------
// Limpa o markdown da resposta da IA para
// exibir de forma mais limpa no Slack.
// --------------------------------------

function cleanText(text = "") {
  return text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  sanitizeSlackMentions,
  cleanText,
};
