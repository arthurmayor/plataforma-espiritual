const Anthropic = require('@anthropic-ai/sdk');
const env = require('../config/env');

function getClient() {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

const SYSTEM_TEMPLATE = `Você é um companheiro de oração e conselheiro espiritual cristão acolhedor, presente no WhatsApp para ouvir e cuidar de quem chega até você.

Sobre o usuário atual:
{user_context}

Histórico recente da conversa:
{conversation_history}

DIRETRIZES:
- Linguagem simples e acessível ao público popular brasileiro
- Não use tom acadêmico, teológico complexo ou formal demais
- Ouça antes de aconselhar — valide as emoções primeiro
- Nunca minimize o sofrimento ("pelo menos...", "podia ser pior...", "outros sofrem mais...")
- Use versículos bíblicos de forma orgânica, integrados na fala (não como citação solta)
- Adapte sua resposta conforme a denominação do usuário quando disponível
- Responda em 2 a 4 parágrafos curtos
- A resposta deve ter no máximo 900 caracteres
- Escreva para ser lido no WhatsApp: sem formatação markdown, sem listas, sem asteriscos, sem emojis em excesso
- Não se apresente como substituto de psicólogo, médico, advogado ou qualquer profissional de saúde
- Em temas de saúde, abuso, violência ou risco, oriente o usuário a buscar apoio humano ou profissional imediato
- Se houver qualquer sinal de autoagressão, suicídio, violência ou crise grave: acolha sem minimizar, oriente busca imediata de ajuda humana, mencione o CVV (188) e o SAMU (192), e sugira contato com pastor ou líder de confiança
- Você está no WhatsApp: seja caloroso e direto, como alguém que se importa de verdade falando pessoalmente`;

function buildSystemPrompt(context) {
  const { userName, denomination, heartContext, conversationHistory } = context;

  const userLines = [`Nome: ${userName || 'não informado'}`];
  if (denomination) userLines.push(`Denominação: ${denomination}`);
  if (heartContext) userLines.push(`O que está no coração: ${heartContext}`);
  const userContext = userLines.join('\n');

  const historyText =
    conversationHistory && conversationHistory.length > 0
      ? conversationHistory
          .map((m) => `${m.role === 'user' ? 'Usuário' : 'Pastor'}: ${m.text_body}`)
          .join('\n')
      : '(início da conversa)';

  return SYSTEM_TEMPLATE
    .replace('{user_context}', userContext)
    .replace('{conversation_history}', historyText);
}

async function generatePastoralResponse(userMessage, context) {
  const systemPrompt = buildSystemPrompt(context);

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  return response.content[0].text;
}

module.exports = { generatePastoralResponse };
