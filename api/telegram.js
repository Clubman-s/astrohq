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
  const userMessage = message.text;

  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

  try {
    // 💾 Проверка, есть ли уже сохранённые данные пользователя в базе
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    if (!userProfile) {
      // 💬 Если данных нет, запрашиваем их
      if (!userMessage.match(/\d{2}\.\d{2}\.\d{4}/)) {
        const reply = `Здравствуйте! Я — София, эксперт по астрологии и эзотерике. Готова помочь вам. Пожалуйста, предоставьте мне следующие данные для составления прогноза:
        1. Дата рождения (в формате ДД.ММ.ГГГГ)
        2. Время рождения (если известно)
        3. Место рождения`;
        await bot.sendMessage(chatId, reply);
        return; // Прерываем выполнение функции, пока не получим данные
      }

      // Если данные получены, сохраняем их
      const birthdate = userMessage.match(/\d{2}\.\d{2}\.\d{4}/)[0]; // дата
      const birthtime = "07:00"; // По умолчанию, если время не указано
      const city = "Москва"; // По умолчанию или из текста, если место указано

      // Преобразуем дату в формат YYYY-MM-DD
      const [day, month, year] = birthdate.split('.');
      const formattedDate = `${year}-${month}-${day}`;

      const userProfileData = {
        session_id: chatId,
        birthdate: formattedDate,
        birthtime,
        city,
      };

      const { error: profileError } = await supabase
        .from('user_profiles')
        .upsert([userProfileData]);

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
      return; // Прерываем выполнение функции, пока не получим тему прогноза
    }

    // Если данные уже есть, продолжаем с запроса на тему прогноза
    if (!userMessage) {
      const reply = `Ваши данные сохранены! Ожидайте, я готова составить для вас прогноз. Пожалуйста, уточните, на какую тему вы хотите получить прогноз? Вот несколько вариантов:
      1. Семья и отношения
      2. Здоровье
      3. Финансовое положение
      4. Карьера и работа
      5. Личностный рост
      Пожалуйста, выберите одну тему или напишите свою.`;
      await bot.sendMessage(chatId, reply);
    } else {
      // Прогноз по выбранной теме
      const selectedTopic = userMessage; // Предполагаем, что тема уже введена

      // Здесь добавляем логику для запроса прогноза по выбранной теме
      // Используем OpenAI для генерации ответа по теме

      const openaiResponse = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Создай астрологический прогноз для человека с датой рождения ${userProfile.birthdate} и временем рождения ${userProfile.birthtime} по теме: ${selectedTopic}` },
        ],
      });

      const reply = openaiResponse.choices[0].message.content;
      await bot.sendMessage(chatId, reply);

      // Завершаем диалог или продолжаем взаимодействие
      await bot.sendMessage(chatId, 'Если у вас есть другие вопросы или хотите уточнить прогноз, не стесняйтесь обратиться!');
    }

    res.status(200).end();
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');
    res.status(200).end();
  }
};
