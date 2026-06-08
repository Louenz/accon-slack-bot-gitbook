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
    handler.js           Lógica do bot (modo IA, identifica empresa, responde dúvidas)
    parser.js            Lê o payload do webhook da Umbler
    session.js           Estado "modo IA" + contexto da empresa por chat (em memória)
    dedupe.js            Evita processar o mesmo evento duas vezes
    identify.js          Detecção e normalização de CNPJ (aceita qualquer formato)
    accon.js             Consulta a API da Accon (dados da empresa por CNPJ)
```

## Bot do WhatsApp (Umbler / uTalk)

Quando o cliente envia **`4`** na conversa, aquele chat entra em "modo IA": a
partir daí cada pergunta dele é respondida automaticamente com base na
documentação do GitBook. Enviar **`0`** (ou `sair`/`menu`) desativa.

> 🔒 **Segurança:** o WhatsApp busca **apenas** no space público
> **"Central de ajuda Accon"**. A **"Base de conhecimento Accon"** (interna,
> com dados sensíveis) é usada só pelo bot do Slack e **nunca** é consultada
> no WhatsApp. Isso é controlado pela flag `public` em `src/config.js`.

> ⚠️ **Fase de teste:** hoje o bot responde como **nota interna**
> (`IsPrivate: true`) — a resposta aparece na conversa **só para a equipe**, o
> cliente **não vê**. Para colocar no ar de verdade, troque `IsPrivate` para
> `false` em `src/services/umbler.js` (ou troque para o endpoint
> `/messages/simplified/` com `FromPhone`/`ToPhone`).

**Como funciona por dentro:**
1. A Umbler chama o webhook (porta `UMBLER_PORT`, padrão `3001`) a cada mensagem.
2. O bot ignora notas internas e mensagens de operadores (proteção contra loop) —
   só reage a mensagens do **cliente**.
3. Antes de responder dúvidas, **identifica a empresa** (ver abaixo).
4. Com a empresa identificada, busca no GitBook, gera a resposta com a IA e
   posta como nota.

### Identificação automática da empresa (por CNPJ)

Depois do `4`, antes de responder dúvidas técnicas, o bot identifica a empresa
do cliente. A API da Accon consulta **apenas por CNPJ**, então o CNPJ é
**obrigatório**:

- Se a mensagem contém um **CNPJ em qualquer formato** (o sistema normaliza —
  remove pontos, barras, hífens e espaços — e aceita se sobrarem 14 dígitos) →
  posta `🔄 Coletando dados da empresa...`, consulta a **API da Accon**
  (`merchant-info`, Basic Auth) e posta
  `✅ Dados coletados` com **todos** os campos retornados (nada é resumido). Os
  dados ficam salvos no contexto da conversa — não pergunta de novo no mesmo
  atendimento.
- Se **não** houver CNPJ → o bot **sempre** pede o CNPJ, independentemente de o
  cliente ter informado marca, ID da loja, nome do estabelecimento ou da rede
  (esses dados não identificam a empresa):

  > Para que eu consiga identificar sua empresa e coletar os dados do cadastro,
  > preciso que me informe o CNPJ da empresa.

O contexto é limpo quando o cliente envia `0`/`sair`/`menu`.

**Para testar (passo a passo):**
1. `npm run dev` (sobe Slack na `3000` e o webhook do WhatsApp na `3001`).
2. Exponha a porta `3001` com um túnel público, ex.: `ngrok http 3001`.
3. No painel da Umbler: **Módulos → Integrações API/Webhook → Configurar
   Webhook**, aponte a URL pública (a do ngrok) e assine o evento **Message**.
4. Numa conversa de teste no WhatsApp, envie `4` e depois uma pergunta. A
   resposta aparece como **nota interna** no Umbler.

> Observação: o "modo IA" fica em memória, então **zera quando o servidor
> reinicia** (o cliente precisa enviar `4` de novo). Para testes é suficiente.

## Configuração

Crie um arquivo `.env` na raiz com:

```
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
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
```

## Executar

```bash
npm install
npm start
```
