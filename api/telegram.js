const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

// Функция для приведения даты в формат YYYY-MM-DD
const formatDate = (dateString) => {
  const dateParts = dateString.split('.');
  if (dateParts.length === 3) {
    const [day, month, year] = dateParts;
    return `${year}-${month}-${day}`; // Преобразуем в формат YYYY-MM-DD
  }
  return null; // Если дата некорректная, возвращаем null
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

    // Логика для запросов данных, если их еще нет
    if (!userMessage.match(/\d{2}\.\d{2}\.\d{4}/)) {
      // Если дата не указана, запросим данные
      const reply = `Здравствуйте! Я — София, эксперт по астрологии и эзотерике. Готова помочь вам. Пожалуйста, предоставьте мне следующие данные для составления прогноза:
      1. Дата рождения (в формате ДД.ММ.ГГГГ)
      2. Время рождения (если известно)
      3. Место рождения`;
      await bot.sendMessage(chatId, reply);
    } else {
      // Преобразуем дату в нужный формат
      const formattedDate = formatDate(userMessage.match(/\d{2}\.\d{2}\.\d{4}/)[0]);

      if (formattedDate) {
        // Если дата валидна, сохраняем в user_profiles
        const userProfileData = {
          session_id: chatId,
          birthdate: formattedDate, // Дата в формате YYYY-MM-DD
          // Дополнительно можно проверить время и место рождения, если есть
          birthtime: "07:00", // По умолчанию, если не указано время
          city: "Москва" // По умолчанию или из текста, если место указано
        };

        const { error: profileError } = await supabase.from('user_profiles').upsert([userProfileData]);

        if (profileError) {
          console.error('Ошибка при сохранении профиля:', profileError);
          await bot.sendMessage(chatId, 'Что-то пошло не так, не удалось сохранить ваши данные.');
        } else {
          await bot.sendMessage(chatId, 'Спасибо за ваши данные! Я начала готовить ваш прогноз. Пожалуйста, подождите.');
          // Теперь можно продолжить обработку данных
        }
      } else {
        await bot.sendMessage(chatId, 'Ваш формат даты некорректен. Пожалуйста, укажите дату в формате ДД.ММ.ГГГГ.');
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');
    res.status(200).end();
  }
};
