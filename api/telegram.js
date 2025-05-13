const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Начальный промпт для нового пользователя
const initialPrompt = `
Привет! 😊 Я — София, астролог и проводник по тайнам твоего рождения.
Чтобы составить точный прогноз, пожалуйста, напиши:

1. 📅 Дату рождения (ДД.ММ.ГГГГ)
2. ⏰ Время рождения (если знаешь)
3. 🌍 Город или место рождения

Как только будут данные — сразу приступим! 🔮
`;

function isValidDate(dateStr) {
  return /\d{2}\.\d{2}\.\d{4}/.test(dateStr);
}

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

  try {
    // Загружаем профиль пользователя
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .limit(1);

    const profile = profiles?.[0];

    // Если профиля нет — пытаемся извлечь данные из сообщения
    if (!profile) {
      let birthdateMatch = userMessage.match(/\d{2}\.\d{2}\.\d{4}/);
      let timeMatch = userMessage.match(/\b(\d{1,2}:\d{2})\b/);
      let placeMatch = userMessage.match(/(?:\d{2}\.\d{2}\.\d{4}|\d{1,2}:\d{2})\s*(.*?)$/);

      if (birthdateMatch) {
        const birthdate = birthdateMatch[0];
        const birthtime = timeMatch ? timeMatch[0] : null;
        const birthplace = placeMatch ? placeMatch[1].trim() : null;

        await supabase.from('user_profiles').insert([
          {
            session_id: chatId,
            birthdate,
            birthtime,
            birthplace
          }
        ]);

        await bot.sendMessage(chatId, 'Спасибо, данные записаны ✅. Задай свой вопрос, и я посмотрю, что звезды говорят об этом. ✨');
        res.status(200).end();
        return;
      } else {
        await bot.sendMessage(chatId, initialPrompt);
        res.status(200).end();
        return;
      }
    }

    // 💾 Сохраняем сообщение пользователя в Supabase
    await supabase.from('messages').insert([
      {
        session_id: chatId,
        role: 'user',
        content: userMessage,
      }
    ]);

    // 📥 Загружаем историю из Supabase
    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', chatId)
      .order('timestamp', { ascending: true })
      .limit(20);

    const systemPrompt = `
Ты — София, духовный астролог и проводник. Используй данные пользователя:
- Дата рождения: ${profile.birthdate}
- Время рождения: ${profile.birthtime || 'не указано'}
- Место рождения: ${profile.birthplace || 'не указано'}

Отвечай вдохновенно, глубоко и по существу. Избегай банальностей и общих фраз. Ты раскрываешь истину через натальную карту.
`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(history || []),
      { role: 'user', content: userMessage }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0.8,
    });

    const reply = response.choices[0].message.content;

    // 💾 Сохраняем ответ Софии в Supabase
    await supabase.from('messages').insert([
      {
        session_id: chatId,
        role: 'assistant',
        content: reply,
      }
    ]);

    await bot.sendMessage(chatId, reply);
    res.status(200).end();
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');
    res.status(200).end();
  }
};
