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

    // Проверяем, есть ли профиль пользователя
    const { data: userProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('birthdate, birthtime, birthplace')
      .eq('session_id', chatId)
      .single();

    if (profileError) {
      console.error('❗ Ошибка при загрузке профиля:', profileError);
    }

    // Если профиль не найден, запросим данные у пользователя
    let personalizedPrompt = systemPrompt;
    if (!userProfile) {
      personalizedPrompt = `
        Пожалуйста, предоставьте свои данные для точного астрологического прогноза.
        Введите свою дату рождения в формате ДД.ММ.ГГГГ, время рождения и место.
      `;
    } else {
      // Используем профиль пользователя для персонализированного запроса
      personalizedPrompt = `
        Ты — София, эксперт по астрологии и эзотерике. Отвечай глубоко, мягко, с лёгким вдохновением.
        Используй данные пользователя:
        Дата рождения: ${userProfile.birthdate}
        Время рождения: ${userProfile.birthtime}
        Место рождения: ${userProfile.birthplace}
        Избегай сухих или формальных ответов.
      `;
    }

    const messages = [
      { role: 'system', content: personalizedPrompt },
      ...(history || []),
      { role: 'user', content: userMessage }  // Добавляем новое сообщение пользователя
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
