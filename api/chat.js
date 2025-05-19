const { OpenAI } = require('openai');
const { supabase } = require('../lib/supabase');

module.exports = async (req, res) => {
  // Настройка CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  try {
    const { message, session_id, birthdate } = req.body;
    const sessionId = session_id || 'demo-session';

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_KEY
    });

    // 🧠 Сохраняем сообщение пользователя в Supabase
    console.log('🧠 Сохраняем сообщение в Supabase:', message);

    const insertUser = await supabase.from('messages').insert([{
      session_id: sessionId,
      role: 'user',
      content: message,
    }]);

    console.log('📦 Результат сохранения user-сообщения:', insertUser);

    // 📚 Загружаем историю сообщений
    const { data: history, error: historyError } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true });

    if (historyError) {
      console.error('🚨 Ошибка загрузки истории:', historyError);
    } else {
      console.log('📜 Загруженная история:', history);
    }

    // Подготовка системного запроса с учётом астрологии
    let systemPrompt = `
     Ты — София, эксперт по астрологии с 8-летним опытом.
Стиль общения: профессиональный, но дружелюбный.
Запрещено: упоминать, что ты ИИ или используешь базу данных.
Отвечай кратко, но полно, не углубляясь в теории. Используй конкретные примеры и рекомендации, основанные на астрологии.
    `;

    // Если предоставлены данные о дате рождения, подставляем их в запрос
    if (birthdate) {
      systemPrompt += `\n\nВнимание! Пользователь родился ${birthdate}. Исходя из этих данных, учитываем его астрологические особенности при ответах.`;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(history || [])
    ];

    // 📡 GPT-запрос
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 300,
      top_p: 0.9,
      frequency_penalty: 0.2,
      presence_penalty: 0.2
    });

    let reply = response.choices[0].message.content;

    // 🔍 Чистим от лишнего
    reply = reply.replace(/как (искусственный интеллект|ИИ|бот)/gi, '');
    reply = reply.replace(/согласно моим (данным|материалам)/gi, 'в практике');

    // 💾 Сохраняем ответ Софии в Supabase
    const insertAssistant = await supabase.from('messages').insert([{
      session_id: sessionId,
      role: 'assistant',
      content: reply,
    }]);

    console.log('📦 Результат сохранения assistant-сообщения:', insertAssistant);

    res.json({ reply });

  } catch (error) {
    console.error('❌ GPT Error:', error);
    res.status(500).json({
      error: "София временно недоступна. Попробуйте задать вопрос позже 🌸",
      details: error.message
    });
  }
};
