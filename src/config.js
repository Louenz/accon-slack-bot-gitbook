// ======================================
// CONFIGURAÇÃO CENTRAL
// ======================================
//
// Este arquivo carrega as variáveis de ambiente (.env) e concentra
// todas as constantes do robô (spaces do GitBook, limites por canal,
// sinônimos e palavras a ignorar). Por ser o primeiro módulo carregado,
// garante que o dotenv rode antes de qualquer outro arquivo ler process.env.

require("dotenv").config();

// --------------------------------------
// Variáveis de ambiente
// --------------------------------------

const env = {
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  // App-Level Token (xapp-...) para Socket Mode — Slack não precisa de URL pública
  SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GITBOOK_TOKEN: process.env.GITBOOK_TOKEN,
  BOT_USER_ID: process.env.BOT_USER_ID,
  PORT: process.env.PORT || 3000,

  // Umbler (uTalk) — usado SOMENTE pelo bot do WhatsApp
  UMBLER_TOKEN: process.env.UMBLER_TOKEN,
  ORGANIZATION_ID: process.env.ORGANIZATION_ID,
  UMBLER_PORT: process.env.UMBLER_PORT || 3001,

  // API Accon (merchant-info) — usado SOMENTE pelo bot do WhatsApp
  ACCON_API_USER: process.env.ACCON_API_USER,
  ACCON_API_PASSWORD: process.env.ACCON_API_PASSWORD,

  // GitHub (escrita do treinamento no repo Git-Synced ao GitBook) — SÓ WhatsApp
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_REPO_TREINAMENTO: process.env.GITHUB_REPO_TREINAMENTO,

  // hora (0-23) do refresh diário do cache de categorias da Central — SÓ WhatsApp
  CACHE_CATEGORIAS_HORA: process.env.CACHE_CATEGORIAS_HORA,

  // intervalo (min) da rotina de reconciliação que documenta atendimentos
  // finalizados que o webhook ao vivo perdeu (padrão 20) — SÓ WhatsApp
  RECONCILIACAO_MINUTOS: process.env.RECONCILIACAO_MINUTOS,
};

// --------------------------------------
// Configuração exclusiva do bot do WhatsApp (Umbler / uTalk).
// Não afeta o Slack — é lida apenas pelos módulos em src/whatsapp/.
// --------------------------------------

const WHATSAPP = {
  // endpoint para enviar mensagem/nota interna
  API_URL: "https://app-utalk.umbler.com/api/v1/messages/",
  // o cliente digita este número para ativar o modo IA
  TRIGGER: "4",
  // palavras que desativam o modo IA
  EXIT: ["0", "sair", "menu"],
  // janela de espera antes de processar (agrupa mensagens/imagens seguidas)
  DEBOUNCE_MS: Number(process.env.WA_DEBOUNCE_MS) || 10000,
  // limite (em minutos) para a busca do INÍCIO do problema antes da
  // transferência ao Suporte — e também o fallback, caso o início não seja
  // identificado claramente. Configurável via CONTEXT_LOOKBACK_MINUTES (padrão 15).
  CONTEXT_LOOKBACK_MINUTES: Number(process.env.CONTEXT_LOOKBACK_MINUTES) || 15,
};

// --------------------------------------
// Treinamento automático (documentação no GitBook "Treinamento IA Whatsapp")
// --------------------------------------

const TREINAMENTO = {
  // categorias PREFERIDAS para a IA classificar a tratativa.
  // A IA pode criar uma nova categoria se nenhuma representar bem o problema.
  CATEGORIAS: [
    "Tuna Pagamentos",
    "Cardápio",
    "iFood",
    "Delivery",
    "Impressão",
    "Fiscal",
    "Marketplace",
    "Integrações",
    "Usuários",
    "Configurações",
    "Pedidos",
    "Produção",
    "Outros",
  ],
  // GATILHOS automáticos (notas do sistema Umbler) que controlam a captura.
  // Início: atendimento entrou no setor Suporte (qualquer uma destas notas).
  DOC_INICIO: [
    "Chat transferido com sucesso para o setor Suporte!",
    "Transferido para o setor Suporte",
  ],
  // Fim: qualquer uma destas encerra o atendimento e gera a documentação.
  DOC_FIM: [
    'Chatbot "Avaliação de Atendimento->Avaliação de Satisfação" iniciado manualmente.',
    'Chatbot "Encerramento (Sem avaliação e sem mensagem)->Início" iniciado manualmente.',
    "Chat finalizado por bot",
  ],

  // se a conversa indicar acesso remoto, NÃO documenta (não gera conhecimento)
  ANYDESK_TERMS: [
    "anydesk",
    "any desk",
    "acesso remoto",
    "conexão remota",
    "conexao remota",
    "compartilhamento de tela",
    "compartilhar a tela",
    "teamviewer",
    "rustdesk",
    "controle remoto",
  ],
};

// --------------------------------------
// Spaces do GitBook consultados na busca.
//
// public: true  -> conteúdo que o cliente final PODE ver (WhatsApp + Slack)
// public: false -> conteúdo interno/sensível (SOMENTE Slack)
//
// O Slack busca em TODOS os spaces (ignora a flag). O WhatsApp usa apenas
// PUBLIC_SPACES — por isso a flag não altera o comportamento do Slack.
// --------------------------------------

const SPACES = [
  {
    name: "Central de ajuda Accon",
    id: "f70xibkjOuE6vUYi8iTR",
    public: true,
  },
  {
    name: "Base de conhecimento Accon",
    id: "lRDxW1FXy0nHj5b8YF1w",
    public: false, // dados sensíveis — nunca expor ao cliente no WhatsApp
  },
];

// Apenas os spaces públicos (usados pelo bot do WhatsApp).
const PUBLIC_SPACES = SPACES.filter((space) => space.public);

// --------------------------------------
// Quantidade de mensagens lidas por canal
// ao buscar conversas parecidas no Slack
// --------------------------------------

const CHANNEL_LIMITS = {
  suporte: 600,
  duvidas: 200,
  // financeiro: 50,
};

// --------------------------------------
// Sinônimos usados para expandir a busca de
// conversas no Slack (melhora o "match" técnico)
// --------------------------------------

const synonyms = {
  deletar: ["excluir", "remover", "apagar", "deletar"],
  excluir: ["excluir", "remover", "apagar", "deletar"],
  remover: ["excluir", "remover", "apagar", "deletar"],
  apagar: ["excluir", "remover", "apagar", "deletar"],
  cashback: ["cashback", "saldo", "credito", "crédito"],
  cancelar: ["cancelar", "cancelado", "cancelamento", "estornar", "estorno"],
  mesa: ["mesa", "comanda", "mesa/comanda"],
  comanda: ["mesa", "comanda", "mesa/comanda"],
};

// --------------------------------------
// Mensagens descartadas na busca do Slack
// (ruído operacional, saudações, ids, etc.)
// --------------------------------------

const STOP_WORDS = [
  "id pedido",
  "id loja",
  "id rede",
  "segue print",
  "segue video",
  "segue vídeo",
  "bom dia",
  "boa tarde",
  "boa noite",
  "consegue verificar",
  "por favor fazer",
  "estorno desse pedido",
  "estorno desses pedidos",
  "segue anexo",
  "teste",
  "pedido manual",
];

// --------------------------------------
// Isolamento dos espaços do GitBook (REGRA CRÍTICA).
// Escrita é PERMITIDA apenas no espaço "Treinamento IA Whatsapp".
// Os demais (Central de Ajuda, Base de Conhecimento) são SOMENTE LEITURA.
// --------------------------------------

const GITBOOK = {
  // único espaço onde a gravação é permitida
  TREINAMENTO_SPACE_ID: "PWe8JBlvnABvGnRhvJGa",
  TREINAMENTO_SPACE_NAME: "Treinamento IA Whatsapp",

  // Central de Ajuda Accon — SOMENTE LEITURA, usada como referência de
  // categorias para classificar os treinamentos (espelhar a organização oficial).
  CENTRAL_AJUDA_SPACE_ID: "f70xibkjOuE6vUYi8iTR",

  // espaços SOMENTE LEITURA (jamais gravar): Central de Ajuda + Base de Conhecimento
  READONLY_SPACE_IDS: ["f70xibkjOuE6vUYi8iTR", "lRDxW1FXy0nHj5b8YF1w"],

  // repositórios conhecidos de espaços somente-leitura (denylist de escrita)
  READONLY_REPOS: ["accondelivery/gitbook-centraldeajuda"],
};

module.exports = {
  env,
  SPACES,
  PUBLIC_SPACES,
  CHANNEL_LIMITS,
  synonyms,
  STOP_WORDS,
  WHATSAPP,
  TREINAMENTO,
  GITBOOK,
};
