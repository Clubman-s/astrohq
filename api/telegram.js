const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const openai = new OpenAI({ apiKey: OPENAI_KEY });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

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

  try {
    // Сохраняем сообщение пользователя в Supabase
    await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'user',
      content: userMessage,
    }]);

    // Загружаем историю из Supabase
    const { data: history, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', chatId)
      .order('timestamp', { ascending: true })
      .limit(20);

    if (error) {
      console.error('Ошибка при загрузке истории:', error);
    }

    // Проверяем наличие профиля
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    if (existingProfile) {
      if (!userMessage.match(/1|2|3|4|5/)) {
        const reply = `Ваши данные уже сохранены! Пожалуйста, уточните, на какую тему вы хотите получить прогноз? Вот несколько вариантов:
        1. Семья и отношения
        2. Здоровье
        3. Финансовое положение
        4. Карьера и работа
        5. Личностный рост`;

        // Сохраняем сообщение от бота
        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: reply,
        }]);

        await bot.sendMessage(chatId, reply);
      } else {
        const topic = userMessage.trim();
        const { birthdate, birthtime, city } = existingProfile;

        // Формируем запрос к OpenAI
        const prompt = `
        Пользователь с датой рождения ${birthdate}, временем рождения ${birthtime} и местом рождения ${city} интересуется прогнозом на тему "${topic}". 
        Проанализируй эту информацию и подготовь персонализированный прогноз для него. Тема: ${topic}.
        `;

        try {
          const response = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
              { role: 'user', content: prompt }
            ]
          });

          const forecast = response.choices[0].message.content;

          // Сохраняем прогноз от бота в Supabase
          await supabase.from('messages').insert([{
            session_id: chatId,
            role: 'bot',
            content: forecast,
          }]);

          await bot.sendMessage(chatId, forecast);
        } catch (error) {
          console.error('Ошибка при генерации прогноза:', error);
          await bot.sendMessage(chatId, 'Что-то пошло не так, не удалось сгенерировать прогноз.');
        }
      }
    } else {
      // Логика для запроса данных пользователя, если профиль не найден
      if (!userMessage.match(/\d{2}\.\d{2}\.\d{4}/)) {
        const reply = `Здравствуйте! Я — София, эксперт по астрологии и эзотерике. Готова помочь вам. Пожалуйста, предоставьте мне следующие данные для составления прогноза:
        1. Дата рождения (в формате ДД.ММ.ГГГГ)
        2. Время рождения (если известно)
        3. Место рождения`;

        // Сохраняем сообщение от бота
        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: reply,
        }]);

        await bot.sendMessage(chatId, reply);
      } else {
        const birthdate = userMessage.match(/\d{2}\.\d{2}\.\d{4}/)[0]; 
        const birthtime = "07:00"; // По умолчанию
        const city = "Москва"; // По умолчанию

        const [day, month, year] = birthdate.split('.');
        const formattedDate = `${year}-${month}-${day}`;

        const userProfileData = {
          session_id: chatId,
          birthdate: formattedDate,
          birthtime,
          city,
        };

        // Сохраняем данные в профиль
        const { error: insertError } = await supabase
          .from('user_profiles')
          .insert([userProfileData]);

        if (insertError) {
          console.error('Ошибка при сохранении профиля:', insertError);
          await bot.sendMessage(chatId, 'Что-то пошло не так, не удалось сохранить ваши данные.');
        } else {
          const reply = `Спасибо за ваши данные! Я начала готовить ваш прогноз. Пожалуйста, подождите.`;

          // Сохраняем сообщение от бота
          await supabase.from('messages').insert([{
            session_id: chatId,
            role: 'bot',
            content: reply,
          }]);

          await bot.sendMessage(chatId, reply);
        }
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');

    // Сохраняем сообщение об ошибке
    await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'bot',
      content: '⚠️ София временно недоступна. Попробуйте позже.',
    }]);

    res.status(200).end();
  }
};
