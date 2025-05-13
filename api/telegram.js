const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const systemPrompt = `Ты — София, эксперт по астрологии и эзотерике. Ответь на вопросы глубоко, мягко, с лёгким вдохновением. Избегай сухих или формальных ответов. 
Начни с того, чтобы представиться, объяснить свою роль и запросить данные пользователя для анализа (дату рождения, время и место).`;

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
    // Проверяем, есть ли данные пользователя в базе
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    if (!existingProfile) {
      // Если данных нет в базе, запрашиваем их
      if (!userMessage.match(/\d{2}\.\d{2}\.\d{4}/)) {
        const reply = `Здравствуйте! Я — София, эксперт по астрологии и эзотерике. Готова помочь вам. Пожалуйста, предоставьте мне следующие данные для составления прогноза:
        1. Дата рождения (в формате ДД.ММ.ГГГГ)
        2. Время рождения (если известно)
        3. Место рождения`;
        await bot.sendMessage(chatId, reply);
      } else {
        // Логика для сохранения данных
        const birthdate = userMessage.match(/\d{2}\.\d{2}\.\d{4}/)[0]; 
        const birthtime = "07:00"; // По умолчанию
        const city = "Москва"; // По умолчанию

        // Преобразуем дату в формат YYYY-MM-DD
        const [day, month, year] = birthdate.split('.');
        const formattedDate = `${year}-${month}-${day}`;

        const userProfileData = {
          session_id: chatId,
          birthdate: formattedDate,
          birthtime,
          city,
        };

        // Сохраняем профиль в базе данных
        const { error: insertError } = await supabase
          .from('user_profiles')
          .insert([userProfileData]);

        if (insertError) {
          console.error('Ошибка при сохранении профиля:', insertError);
          await bot.sendMessage(chatId, 'Что-то пошло не так, не удалось сохранить ваши данные.');
        } else {
          await bot.sendMessage(chatId, 'Спасибо за ваши данные! Я начала готовить ваш прогноз. Пожалуйста, подождите.');

          // После сохранения данных, предлагаем выбрать тему прогноза
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
    } else {
      // Если данные уже сохранены, предлагаем выбрать тему
      if (userMessage.match(/1|2|3|4|5/)) {
        let prediction = '';

        // Логика для генерации прогноза в зависимости от выбранной темы
        switch (userMessage.trim()) {
          case '1':
            prediction = 'Прогноз для темы "Семья и отношения"...';
            break;
          case '2':
            prediction = 'Прогноз для темы "Здоровье"...';
            break;
          case '3':
            prediction = 'Прогноз для темы "Финансовое положение"...';
            break;
          case '4':
            prediction = 'Прогноз для темы "Карьера и работа"...';
            break;
          case '5':
            prediction = 'Прогноз для темы "Личностный рост"...';
            break;
          default:
            prediction = 'Пожалуйста, уточните правильную тему.';
            break;
        }

        // Отправляем прогноз пользователю
        await bot.sendMessage(chatId, prediction);

        // Используем OpenAI для более глубокого прогноза
        try {
          const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prediction }]
          });

          const aiPrediction = response.choices[0].message.content.trim();
          await bot.sendMessage(chatId, aiPrediction);
        } catch (error) {
          console.error('Ошибка при запросе OpenAI:', error);
          await bot.sendMessage(chatId, 'Возникла ошибка при создании прогноза. Попробуйте позже.');
        }
      } else {
        // Если тема ещё не выбрана, предлагаем выбор темы
        const reply = `Пожалуйста, уточните, на какую тему вы хотите получить прогноз? Вот несколько вариантов:
        1. Семья и отношения
        2. Здоровье
        3. Финансовое положение
        4. Карьера и работа
        5. Личностный рост
        Пожалуйста, выберите одну тему или напишите свою.`;
        await bot.sendMessage(chatId, reply);
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');
    res.status(200).end();
  }
};
