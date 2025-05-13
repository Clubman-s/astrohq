const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const systemPrompt = `
Ты — София, эксперт по астрологии и эзотерике. Отвечай глубоко, мягко, с лёгким вдохновением. Избегай сухих или формальных ответов.
`;

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
    // 💾 Сохраняем сообщение пользователя в таблицу messages
    console.log('💬 Пытаемся сохранить сообщение в таблицу messages:', {
      session_id: chatId,
      role: 'user',
      content: userMessage
    });

    const insertUserMessage = await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'user',
      content: userMessage,
    }]);

    console.log('📝 Результат вставки user в messages:', insertUserMessage);

    // 📥 Загружаем профиль из таблицы user_profiles
    const { data: userProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('name, birthdate, birthtime, city')
      .eq('session_id', chatId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      console.error('❗ Ошибка при загрузке профиля:', profileError);
    } else {
      console.log('📜 Данные профиля пользователя:', userProfile);
    }

    // Если данных профиля нет, попросим пользователя их ввести
    if (!userProfile) {
      await bot.sendMessage(chatId, 'Пожалуйста, предоставьте мне свои данные для составления астрологического прогноза:\n1. Дата рождения\n2. Время рождения\n3. Место рождения');
      return res.status(200).end();
    }

    // Если данные профиля есть, продолжаем с ними
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Мне нужно рассчитать астрологический прогноз для следующей информации: \nДата рождения: ${userProfile.birthdate}\nВремя рождения: ${userProfile.birthtime}\nГород рождения: ${userProfile.city}` },
      { role: 'user', content: userMessage }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0.7,
    });

    const reply = response.choices[0].message.content;

    // 💾 Сохраняем ответ Софии в таблицу messages
    const insertAssistantMessage = await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'assistant',
      content: reply,
    }]);

    console.log('🤖 Результат вставки assistant в messages:', insertAssistantMessage);

    await bot.sendMessage(chatId, reply);
    res.status(200).end();
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');
    res.status(200).end();
  }
};
