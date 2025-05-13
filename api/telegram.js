const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const systemPrompt = `
Ты — София, эксперт по госзакупкам 44-ФЗ с 8-летним опытом.
Стиль общения: профессиональный, но дружелюбный.
Запрещено: упоминать, что ты ИИ или используешь базу данных.
`;

// Получаем данные пользователя, такие как дата рождения
const getPersonalizedPrompt = (birthdate) => {
  // Пример: можно использовать данные для определения астрологической информации, если нужно
  return `С учетом вашего дня рождения (${birthdate}), я предлагаю рассмотреть следующие рекомендации по вашей ситуации...`;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const message = req.body?.message;
  if (!message || !message.text || message.text.startsWith('/')) {
    res.status(200).end();
    return;
  }

  const chatId = message.chat.id.toString();
  const userMessage = message.text;

  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

  try {
    // 💾 Сохраняем сообщение пользователя в Supabase
    console.log('💬 Пытаемся сохранить сообщение в Supabase:', {
      session_id: chatId,
      role: 'user',
      content: userMessage
    });

    const insertUser = await supabase.from('messages').insert([
      {
        session_id: chatId,
        role: 'user',
        content: userMessage,
      }
    ]);

    console.log('📝 Результат вставки user:', insertUser);

    // 📥 Загружаем историю из Supabase
    const { data: history, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', chatId)
      .order('timestamp', { ascending: true })
      .limit(20);

    if (error) {
      console.error('❗ Ошибка при загрузке истории:', error);
    } else {
      console.log('📜 История загружена:', history);
    }

    // Проверяем, есть ли в сообщении дата рождения, если да - добавляем персонализированный prompt
    const birthdate = userMessage.match(/(\d{2})\.(\d{2})\.(\d{4})/); // пример формата даты: 12.12.1990
    const personalizedPrompt = birthdate ? getPersonalizedPrompt(birthdate[0]) : '';

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(history || []),
      { role: 'user', content: userMessage },
      { role: 'system', content: personalizedPrompt }, // добавляем персонализированное обращение, если дата есть
    ];

    // 🤖 Запрашиваем ответ у OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0.7,
    });

    const reply = response.choices[0].message.content;

    // 💾 Сохраняем ответ Софии в Supabase
    const insertAssistant = await supabase.from('messages').insert([
      {
        session_id: chatId,
        role: 'assistant',
        content: reply,
      }
    ]);

    console.log('🤖 Результат вставки assistant:', insertAssistant);

    await bot.sendMessage(chatId, reply);
    res.status(200).end();
  } catch (err) {
    console.error('❌ GPT Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');
    res.status(200).end();
  }
};
