// ======================================
// WHATSAPP: RECONCILIAÇÃO DA DOCUMENTAÇÃO
// ======================================
//
// Rede de segurança para os webhooks perdidos: periodicamente varre os
// atendimentos FINALIZADOS recentes e documenta os que entraram no Suporte mas
// ainda não têm documentação (porque o evento de início/fim chegou durante um
// reinício/queda e a Umbler não reenvia). Torna a documentação eventualmente
// consistente, independentemente da entrega ao vivo do webhook.

const { listarChatsFinalizados, buscarHistoricoChat } = require("../services/umbler");
const { chatsDocumentados } = require("./persistencia");
const { gerarTreinamento } = require("./treinamento");
const { env, TREINAMENTO } = require("../config");

const INTERVALO_MIN =
  Number(env.RECONCILIACAO_MINUTOS) > 0 ? Number(env.RECONCILIACAO_MINUTOS) : 20;
const QTD_FINALIZADOS = 25; // quantos finalizados recentes olhar por varredura
const MAX_POR_VARREDURA = 8; // teto de documentações por varredura (controla custo)

function dataMsg(m) {
  return m?.createdAtUTC || m?.eventAtUTC || m?.CreatedAtUTC || m?.EventAtUTC;
}

// timestamp (ms) do início do Suporte (DOC_INICIO mais recente). null se nunca entrou.
function acharInicioSuporte(msgs) {
  let inicio = null;
  for (const m of msgs || []) {
    const txt = (m?.content || m?.Content || "").trim();
    if (txt && TREINAMENTO.DOC_INICIO.some((f) => txt.includes(f))) {
      const ts = Date.parse(dataMsg(m));
      if (!Number.isNaN(ts)) inicio = inicio === null ? ts : Math.max(inicio, ts);
    }
  }
  return inicio;
}

let _rodando = false;

// Varre os finalizados recentes e documenta os de Suporte ainda não documentados.
async function reconciliar() {
  if (_rodando) return { documentados: 0, pendentes: 0 }; // evita sobreposição
  _rodando = true;
  try {
    const chats = await listarChatsFinalizados(QTD_FINALIZADOS);
    const documentados = chatsDocumentados();
    const pendentes = chats.filter((c) => !documentados.has(c.chatId));

    let feitos = 0;
    for (const c of pendentes) {
      if (feitos >= MAX_POR_VARREDURA) break;

      let msgs = [];
      try {
        msgs = await buscarHistoricoChat(c.chatId, 100);
      } catch {
        continue;
      }

      const inicio = acharInicioSuporte(msgs);
      if (!inicio) continue; // não entrou no Suporte -> não é p/ documentar

      try {
        const r = await gerarTreinamento(c.chatId, inicio);
        if (r.status === "ok") {
          feitos++;
          console.log(
            `🔁 Reconciliação documentou (perdido pelo webhook): ${c.contato} -> ${r.categoria} | ${r.titulo}`
          );
        } else {
          console.log(`🔁 Reconciliação: ${c.contato} -> status=${r.status}`);
        }
      } catch (e) {
        console.log(`🔁 Reconciliação: erro em ${c.contato} -> ${e.message}`);
      }
    }

    if (feitos) console.log(`🔁 Reconciliação concluída: ${feitos} atendimento(s) recuperado(s).`);
    return { documentados: feitos, pendentes: pendentes.length };
  } catch (e) {
    console.log("⚠️ Erro na reconciliação:", e.message);
    return { documentados: 0, pendentes: 0 };
  } finally {
    _rodando = false;
  }
}

function iniciarReconciliacao() {
  console.log(`🔁 Reconciliação da documentação ativa (a cada ${INTERVALO_MIN} min).`);
  // primeira passada ~2 min após o boot (deixa o serviço estabilizar)
  const t1 = setTimeout(() => reconciliar().catch(() => {}), 2 * 60 * 1000);
  if (t1.unref) t1.unref();
  const iv = setInterval(() => reconciliar().catch(() => {}), INTERVALO_MIN * 60 * 1000);
  if (iv.unref) iv.unref();
}

module.exports = { reconciliar, iniciarReconciliacao, acharInicioSuporte };
