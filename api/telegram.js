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
    // Проверяем, есть ли у пользователя профиль в базе данных
    const { data: userProfile, error: userProfileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    if (!userProfile) {
      // Если нет профиля, запрашиваем данные
      await bot.sendMessage(chatId, "Здравствуйте! Я София, эксперт по астрологии. Чтобы составить для вас персонализированный прогноз, мне нужно несколько данных. Пожалуйста, предоставьте свою дату рождения в формате ДД.ММ.ГГГГ, время рождения и место рождения.");
      res.status(200).end();
      return;
    }

    // Если профиль есть, проверяем, по какому вопросу человек хочет получить прогноз
    if (userMessage.toLowerCase() === "по какому вопросу вы хотите прогноз?" || userMessage === "") {
      await bot.sendMessage(chatId, "Пожалуйста, уточните, по какой теме вы хотите получить прогноз. Например, по личной жизни, карьере, здоровью и т.д.");
      res.status(200).end();
      return;
    }

    // Получаем данные пользователя из профиля
    const { birthdate, birthtime, birthplace } = userProfile;

    // Если данные все еще не собраны, запросим их
    if (!birthdate || !birthtime || !birthplace) {
      await bot.sendMessage(chatId, "Не все данные собраны. Пожалуйста, предоставьте свою дату, время и место рождения.");
      res.status(200).end();
      return;
    }

    // Если данные собраны, начинаем составление прогноза
    const question = userMessage || "Общий прогноз"; // Тема может быть из последнего сообщения

    const prompt = `На основе данных пользователя:
Дата рождения: ${birthdate}
Время рождения: ${birthtime}
Место рождения: ${birthplace}

Запрос: ${question}

Пожалуйста, составь астрологический прогноз для пользователя.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    // 🤖 Запрашиваем ответ у OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0.7,
    });

    const reply = response.choices[0].message.content;

    // 💾 Сохраняем ответ Софии в Supabase
    const insertAssistant = await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'assistant',
      content: reply,
    }]);

    console.log('🤖 Результат вставки assistant:', insertAssistant);

    await bot.sendMessage(chatId, reply);
    res.status(200).end();
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');
    res.status(200).end();
  }
};
