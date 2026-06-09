# accon-slack-bot-gitbook

Robô de ajuda para o Slack que responde dúvidas usando **GitBook** + **OpenAI**.

Ao ser mencionado no Slack (`@ajuda <dúvida>`), o robô busca a resposta na
documentação de 2 spaces do GitBook (um interno do time e outro externo de
clientes). Ele responde **somente** com base no que existe na documentação —
se não encontrar, avisa que a informação não está documentada (não inventa).
Também oferece um botão para ver as conversas mais parecidas já respondidas no
próprio Slack.

## Como funciona

1. **Menção (`@ajuda`)** → busca na documentação do GitBook.
2. Lê a página mais relevante por completo e, se houver imagem anexada, usa um
   modelo com visão.
3. Gera a resposta com a OpenAI, restrita à documentação.
4. Botão **"Receber resposta do Slack?"** → rankeia as 3 conversas mais
   parecidas nos canais permitidos e permite abrir a thread completa.

## Estrutura do projeto

```
index.js                 Ponto de entrada (inicia Slack + webhook do WhatsApp)
src/
  config.js              Variáveis de ambiente e constantes (spaces, limites, sinônimos, Umbler)
  clients.js             Instâncias do Slack (Bolt) e da OpenAI
  utils/
    text.js              Tratamento de texto (limpeza e menções)
  services/
    gitbook.js           Busca e leitura da documentação no GitBook
    openai.js            Escolha de modelo e geração da resposta
    slack.js             Download de imagem e busca de conversas no Slack
    umbler.js            Envio de nota interna no WhatsApp (Umbler / uTalk)
  handlers/
    mention.js           Evento app_mention (@ajuda) — Slack
    actions.js           Botões: ver conversas / abrir thread — Slack
  whatsapp/
    server.js            Servidor Express que recebe o webhook da Umbler
    handler.js           Lógica do bot (comandos de atendente, versão, respostas)
    parser.js            Lê o payload do webhook da Umbler
    session.js           Estado "modo IA" + contexto da empresa por chat (em memória)
    dedupe.js            Evita processar o mesmo evento duas vezes
    identify.js          Detecção e normalização de CNPJ (aceita qualquer formato)
    accon.js             Consulta a API da Accon + detecção da versão (1.0/2.0)
    ia.js                Geração da resposta (gpt-4.1, multimodal, com contexto)
    imagem.js            Download de imagem anexada (base64 para a IA)
    buffer.js            Janela de espera (agrupa mensagens/imagens seguidas)
    treinamento.js       Gera a documentação do atendimento (anonimiza, categoriza)
    github.js            Grava a tratativa como expandable no repo (Git Sync → GitBook)
```

## Bot do WhatsApp (Umbler / uTalk)

A IA é controlada **manualmente pelos atendentes**, através de **notas internas**
da Umbler — o cliente não ativa nada. A IA só age em conversas onde foi
explicitamente ativada, e o estado é **individual por conversa**.

> 🔒 **Segurança:** o WhatsApp busca **apenas** no space público
> **"Central de ajuda Accon"**. A **"Base de conhecimento Accon"** (interna,
> com dados sensíveis) é usada só pelo bot do Slack e **nunca** é consultada
> no WhatsApp. Isso é controlado pela flag `public` em `src/config.js`.

> ⚠️ **Fase de teste:** hoje o bot responde como **nota interna**
> (`IsPrivate: true`) — a resposta aparece na conversa **só para a equipe**, o
> cliente **não vê**. Para colocar no ar de verdade, troque `IsPrivate` para
> `false` em `src/services/umbler.js`.

### Comandos (somente em notas internas)

Os comandos são interpretados **apenas em notas internas** (do atendente). O bot
**nunca** executa comandos enviados pelo cliente e nunca reage às próprias notas
(só reage a notas que começam com `#`).

| Comando | Ação |
|---|---|
| `#ativar` | Ativa a IA nesta conversa |
| `#desativar` | Desativa a IA e limpa o estado da conversa |
| `#cnpj [CNPJ]` | Define o CNPJ, consulta a API Accon e salva empresa + versão |
| `#resetar` | Apaga **todo** o estado da IA na conversa (empresa, CNPJ, versão, memória, agrupamento pendente) e reinicia do zero — mantém a IA ativada |
| `#desativardoc` | Interrompe **só o treinamento/documentação** da conversa; a IA continua respondendo |
| `#comandos` | Exibe a lista de comandos |

### Treinamento automático (documentação no GitBook)

Entre o `#ativar` e o `#desativar`, a conversa é capturada. No `#desativar`, a IA
transforma o atendimento numa **tratativa de documentação** e grava no espaço
**"Treinamento IA Whatsapp"**:

- **Fonte:** apenas mensagens de **cliente** e **atendente** (público). Ignora
  notas internas, respostas da IA e comandos.
- **Privacidade:** anonimiza nome, telefone, e-mail, CNPJ, CPF, IDs e links
  antes de salvar (regex + instrução à IA).
- **AnyDesk:** se o atendimento foi resolvido por acesso remoto, **não documenta**.
- **Categorização:** a IA classifica em uma categoria (Integrações, Impressão,
  Fiscal, Financeiro, …) → cada categoria é um arquivo `.md`.
- **Sem duplicar:** se já existir uma tratativa com o mesmo título, **atualiza**
  o expandable; senão, anexa um novo.

> **Como persiste (importante):** a API do GitBook **não escreve conteúdo**. Igual
> ao projeto `gitbook-centraldeajuda`, o bot grava markdown (com `<details>`
> expandables) num **repositório GitHub conectado ao espaço por Git Sync** — o
> GitBook sincroniza. Requer:
> 1. Conectar o espaço "Treinamento IA Whatsapp" a um repo GitHub (Git Sync, no painel do GitBook).
> 2. `GITHUB_TOKEN` (com escrita no repo) e `GITHUB_REPO_TREINAMENTO=org/repo` no `.env`.
>
> Sem essas variáveis, a documentação é gerada mas **não é salva** (o bot avisa por nota interna).

O `#cnpj` aceita o CNPJ em **qualquer formato** (normaliza removendo pontos,
barras, hífens e espaços; aceita se sobrarem 14 dígitos). Responde
`🔄 Coletando dados da empresa...` e, após o retorno, um resumo:
`✅ Dados coletados com sucesso.` com **Empresa**, **CNPJ** e **Versão**. Os
dados ficam vinculados à conversa — não pede o CNPJ de novo.

### Fluxo da mensagem do cliente

Quando o **cliente** manda uma mensagem, o bot verifica, nesta ordem:

1. A IA está ativada nesta conversa? (senão, ignora)
2. Existe CNPJ/empresa salvo? (senão, avisa o atendente uma vez para usar `#cnpj`)
3. Qual a versão identificada?
   - **Accon 1.0** (`Último pedido 2.0: N/A`) → o bot informa que a loja é 1.0 e
     direciona para a equipe; **não** usa IA nem GitBook.
   - **Accon 2.0** → segue para a resposta automática (GitBook + IA).

### Qualidade das respostas (lojas 2.0)

Para lojas 2.0, a resposta da IA é gerada com mais contexto e qualidade:

- **Modelo:** `gpt-4.1` (multimodal, contexto longo) para a resposta final.
- **Memória de conversa:** usa o histórico recente (~20 mensagens — cliente,
  atendente e notas anteriores da IA), os dados da empresa (API Accon) e a
  documentação. **Nunca** responde olhando só a última mensagem.
- **Imagens:** analisa prints/telas enviados pelo cliente, interpretando-os no
  contexto da conversa (ex.: print de erro do iFood ligado ao assunto em curso).
- **Janela de espera (~10s):** ao receber uma mensagem, o bot **aguarda** alguns
  segundos antes de processar. Mensagens e imagens enviadas em sequência são
  **agrupadas** e tratadas como uma única solicitação — evita respostas
  prematuras. Configurável por `WA_DEBOUNCE_MS` (padrão `10000`).
- Ordem de prioridade do contexto: dados da empresa → conversa → imagens →
  documentação → resposta.

**Para testar (passo a passo):**
1. `npm run dev` (Slack via Socket Mode — sem porta; webhook do WhatsApp na `3001`).
2. Exponha a porta `3001` com um túnel público, ex.: `ngrok http 3001`.
3. No painel da Umbler: **Módulos → Integrações API/Webhook → Configurar
   Webhook**, aponte a URL pública (a do ngrok) e assine o evento **Message**.
4. Numa conversa de teste, um atendente envia a nota interna `#ativar` e depois
   `#cnpj [CNPJ]`. As respostas aparecem como **nota interna** no Umbler.

> **Slack e WhatsApp ao mesmo tempo:** o Slack usa **Socket Mode** (conexão
> WebSocket de saída — não precisa de URL pública nem de porta), então o ngrok
> fica livre para o WhatsApp (`3001`). Os dois rodam juntos sem conflito. O
> Slack exige um **App-Level Token** (`xapp-...`) em `SLACK_APP_TOKEN`.

> Observação: o "modo IA" fica em memória, então **zera quando o servidor
> reinicia** (o cliente precisa enviar `4` de novo). Para testes é suficiente.

## Configuração

Crie um arquivo `.env` na raiz com:

```
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_APP_TOKEN=        # App-Level Token (xapp-...) — Socket Mode
OPENAI_API_KEY=
GITBOOK_TOKEN=
BOT_USER_ID=
PORT=3000

# Umbler / WhatsApp
UMBLER_TOKEN=
ORGANIZATION_ID=
UMBLER_PORT=3001

# API Accon (identificação da empresa por CNPJ) — só WhatsApp
ACCON_API_USER=
ACCON_API_PASSWORD=

# Janela de espera (ms) antes de processar/agrupar mensagens — opcional
WA_DEBOUNCE_MS=10000

# Treinamento automático → GitHub (repo Git-Synced ao espaço "Treinamento IA Whatsapp")
GITHUB_TOKEN=
GITHUB_REPO_TREINAMENTO=org/repo
```

## Executar

```bash
npm install
npm start
```
