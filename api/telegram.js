const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const systemPrompt = `
Ты — София, эксперт по астрологии и эзотерике. Ответь на вопросы глубоко, мягко, с лёгким вдохновением. Избегай сухих или формальных ответов. 
Начни с того, чтобы представиться, объяснить свою роль и запросить данные пользователя для анализа (дату рождения, время и место).
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
  const userMessage = message.text.trim();

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
      // Если данные получены, сохраняем в user_profiles
      const birthdate = userMessage.match(/\d{2}\.\d{2}\.\d{4}/)[0]; // дата
      const birthtime = "07:00"; // По умолчанию, если время не указано
      const city = "Москва"; // По умолчанию или из текста, если место указано

      // Преобразуем дату в формат YYYY-MM-DD
      const [day, month, year] = birthdate.split('.');
      const formattedDate = `${year}-${month}-${day}`;

      // Пытаемся найти профиль пользователя
      const { data: existingProfile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('session_id', chatId)
        .single();

      const userProfileData = {
        session_id: chatId,
        birthdate: formattedDate,
        birthtime,
        city,
      };

      let profileError;

      if (existingProfile) {
        // Если профиль уже существует, обновляем его
        const { error: updateError } = await supabase
          .from('user_profiles')
          .update(userProfileData)
          .eq('session_id', chatId);
        
        profileError = updateError;
      } else {
        // Если профиль новый, вставляем
        const { error: insertError } = await supabase
          .from('user_profiles')
          .insert([userProfileData]);
        
        profileError = insertError;
      }

      if (profileError) {
        console.error('Ошибка при сохранении профиля:', profileError);
        await bot.sendMessage(chatId, 'Что-то пошло не так, не удалось сохранить ваши данные.');
      } else {
        await bot.sendMessage(chatId, 'Спасибо за ваши данные! Я начала готовить ваш прогноз. Пожалуйста, подождите.');

        // Запрос на тему прогноза
        const reply = `Ваши данные сохранены! Ожидайте, я готова составить для вас прогноз. Пожалуйста, уточните, на какую тему вы хотите получить прогноз? Вот несколько вариантов:
1. Семья и отношения
2. Здоровье
3. Финансовое положение
4. Карьера и работа
5. Личностный рост
Пожалуйста, выберите одну тему или напишите свою.`;
        await bot.sendMessage(chatId, reply);
      }
    }

    // Обработка выбора темы
    if (['1', '2', '3', '4', '5'].includes(userMessage)) {
      // Генерация прогноза по теме
      const theme = {
        '1': 'Семья и отношения',
        '2': 'Здоровье',
        '3': 'Финансовое положение',
        '4': 'Карьера и работа',
        '5': 'Личностный рост',
      }[userMessage];

      const openaiResponse = await openai.completions.create({
        model: 'text-davinci-003',
        prompt: `Предсказание по теме: ${theme}. Пользователь: ${chatId}`,
        max_tokens: 200,
      });

      const prediction = openaiResponse.choices[0].text.trim();
      await bot.sendMessage(chatId, `Прогноз по теме "${theme}":\n\n${prediction}`);
    }

    res.status(200).end();
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');
    res.status(200).end();
  }
};
