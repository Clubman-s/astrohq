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
    // 💾 Сохраняем сообщение пользователя в Supabase
    const insertUser = await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'user',
      content: userMessage,
    }]);

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

    // Проверяем наличие уже сохранённого профиля в базе данных
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    if (existingProfile) {
      if (existingProfile.birthdate && existingProfile.birthtime && existingProfile.city) {
        // Если все данные есть, запрашиваем тему прогноза
        if (!userMessage.match(/1|2|3|4|5/)) {
          const reply = `Ваши данные уже сохранены! Ожидайте, я готова составить для вас прогноз. Пожалуйста, уточните, на какую тему вы хотите получить прогноз? Вот несколько вариантов:
          1. Семья и отношения
          2. Здоровье
          3. Финансовое положение
          4. Карьера и работа
          5. Личностный рост
          Пожалуйста, выберите одну тему или напишите свою.`;
          await bot.sendMessage(chatId, reply);
        } else {
          // Если пользователь выбрал тему, генерируем прогноз
          const topic = userMessage.trim();
          let prediction = '';

          // Логика генерации прогноза на основе темы
          switch (topic) {
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

          // Для использования OpenAI API для генерации более глубокого прогноза
          try {
            const response = await openai.chat.completions.create({
              model: 'gpt-4',
              messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prediction }]
            });

            const aiPrediction = response.choices[0].message.content.trim();
            await bot.sendMessage(chatId, aiPrediction);
          } catch (error) {
            console.error('Ошибка при запросе OpenAI:', error);
            await bot.sendMessage(chatId, 'Возникла ошибка при создании прогноза. Попробуйте позже.');
          }
        }
      } else {
        // Если данные не полные, запрашиваем недостающие данные
        let reply = '';
        if (!existingProfile.birthdate) {
          reply = 'Пожалуйста, укажите вашу дату рождения (в формате ДД.ММ.ГГГГ).';
        } else if (!existingProfile.birthtime) {
          reply = 'Пожалуйста, укажите ваше время рождения (если известно).';
        } else if (!existingProfile.city) {
          reply = 'Пожалуйста, укажите ваше место рождения (если отличается от Москвы).';
        }
        await bot.sendMessage(chatId, reply);
      }
    } else {
      // Если профиль не найден, продолжаем запрашивать данные
      if (!userMessage.match(/\d{2}\.\d{2}\.\d{4}/)) {
        const reply = `Здравствуйте! Я — София, эксперт по астрологии и эзотерике. Готова помочь вам. Пожалуйста, предоставьте мне следующие данные для составления прогноза:
        1. Дата рождения (в формате ДД.ММ.ГГГГ)
        2. Время рождения (если известно)
        3. Место рождения`;
        await bot.sendMessage(chatId, reply);
      } else {
        // Логика для сохранения данных в профиль
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

          // После сохранения данных, запрашиваем тему прогноза
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
    }

    res.status(200).end();
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');
    res.status(200).end();
  }
};
