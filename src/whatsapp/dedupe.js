// ======================================
// WHATSAPP: DEDUPLICAÇÃO DE EVENTOS
// ======================================
//
// A Umbler pode reenviar o mesmo webhook (ex.: se demorarmos a responder).
// Guardamos um hash de cada evento por 60s para não processar duas vezes.
// Estado em memória (zera no restart) — suficiente para o teste.

const crypto = require("crypto");

const eventosProcessados = new Set();
const TTL_MS = 60000;

function jaProcessado(body) {
  const hash = crypto
    .createHash("md5")
    .update(JSON.stringify(body))
    .digest("hex");

  if (eventosProcessados.has(hash)) return true;

  eventosProcessados.add(hash);
  setTimeout(() => eventosProcessados.delete(hash), TTL_MS).unref?.();

  return false;
}

module.exports = {
  jaProcessado,
};
