const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const systemPrompt = `
Ты — София, эксперт по астрологии и эзотерике. Отвечай глубоко, мягко, с лёгким вдохновением. Избегай сухих или формальных ответов.
`;

// Функция для обработки времени, включая неформальные записи
function processTime(inputTime) {
  const timePatterns = [
    { pattern: /около (\d{1,2})\s*(утра|вечера|дня|ночи)/i, replacement: '$1:00' }, // Пример: около 7 утра
    { pattern: /(\d{1,2})\s*(утра|вечера|дня|ночи)/i, replacement: '$1:00' }, // Пример: 7 утра, 9 вечера
    { pattern: /^(\d{1,2}):(\d{1,2})$/, replacement: '$1:$2' }, // Пример: 07:00 или 18:30
    { pattern: /^(\d{1,2})$/, replacement: '$1:00' } // Пример: 7 -> 07:00
  ];

  for (let { pattern, replacement } of timePatterns) {
    const match = inputTime.match(pattern);
    if (match) {
      return match[0].replace(pattern, replacement);
    }
  }

  return '12:00'; // Если не найдено, возвращаем 12:00
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

    const insertUser = await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'user',
      content: userMessage,
    }]);

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

    const messages = [
      { role: 'system', content: systemPrompt },
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

    // Если это первый запрос на данные, то собираем информацию для профиля
    if (userMessage.toLowerCase().includes('дата рождения') || userMessage.toLowerCase().includes('время рождения') || userMessage.toLowerCase().includes('место рождения')) {
      const birthdate = "18.12.1970";  // Пример: здесь можно подставить фактические данные
      const birthtime = processTime("примерно 7 утра");  // Пример обработки времени
      const birthplace = "Москва";  // Пример: здесь подставьте место рождения

      // 💾 Сохраняем данные в таблицу user_profiles
      const { error: insertProfileError } = await supabase.from('user_profiles').upsert([{
        session_id: chatId,
        birthdate,
        birthtime,
        city: birthplace,
      }]);

      if (insertProfileError) {
        console.error('❗ Ошибка при вставке в user_profiles:', insertProfileError);
      } else {
        console.log('✅ Данные пользователя успешно сохранены в user_profiles');
      }

      reply += `\n\nБлагодарю за уточнение. Теперь у меня есть все необходимые данные для составления астрологического прогноза. Позвольте мне немного времени, чтобы подготовить информацию для вас.`;
    }

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
    console.error('❌ GPT Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');
    res.status(200).end();
  }
};
