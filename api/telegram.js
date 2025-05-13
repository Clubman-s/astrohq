const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

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
  const userMessage = message.text.trim();

  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

  try {
    // 🧠 Проверяем наличие профиля
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    // 📌 Если профиля нет
    if (!profile || profileError) {
      // 🗓 Проверяем, ввёл ли пользователь дату рождения
      const dateRegex = /^(\d{2})\.(\d{2})\.(\d{4})$/;
      const match = userMessage.match(dateRegex);

      if (!match) {
        await bot.sendMessage(
          chatId,
          '✨ Привет! Чтобы составить астрологический разбор, напиши, пожалуйста, свою дату рождения в формате ДД.ММ.ГГГГ (например, 13.05.1985).'
        );
        return res.status(200).end();
      }

      // ✅ Если ввёл дату — сохраняем
      const formattedDate = `${match[3]}-${match[2]}-${match[1]}`;

      await supabase.from('user_profiles').insert([
        {
          chat_id: chatId,
          birthdate: formattedDate,
        },
      ]);

      await bot.sendMessage(chatId, '🌟 Спасибо! Теперь задай любой вопрос — и я постараюсь дать тебе персонализированный ответ.');
      return res.status(200).end();
    }

    // 💾 Сохраняем сообщение пользователя в Supabase
    await supabase.from('messages').insert([
      {
        session_id: chatId,
        role: 'user',
        content: userMessage,
      },
    ]);

    // 📥 Загружаем историю из Supabase
    const { data: history, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', chatId)
      .order('timestamp', { ascending: true })
      .limit(20);

    if (error) {
      console.error('❗ Ошибка при загрузке истории:', error);
    }

    // ✨ Формируем systemPrompt с датой рождения
    const systemPrompt = `
Ты — София, профессиональный астролог с многолетним опытом. 
Дата рождения пользователя: ${profile.birthdate}. 
Используй ведическую и западную астрологию для анализа личности, жизненных периодов, судьбоносных событий. 
Говори уверенно, избегай общих фраз и водянистости. 
Объясняй всё простыми словами, можно немного с душой и юмором 🌟
`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(history || []),
      { role: 'user', content: userMessage },
    ];

    // 🤖 Запрашиваем ответ у OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0.7,
    });

    const reply = response.choices[0].message.content;

    // 💾 Сохраняем ответ Софии в Supabase
    await supabase.from('messages').insert([
      {
        session_id: chatId,
        role: 'assistant',
        content: reply,
      },
    ]);

    await bot.sendMessage(chatId, reply);
    res.status(200).end();
  } catch (err) {
    console.error('❌ GPT Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуй позже.');
    res.status(200).end();
  }
};
