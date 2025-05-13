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

    // Проверяем наличие уже сохранённого профиля в базе данных
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    // Если профиль существует, проверяем, есть ли все необходимые данные
    if (existingProfile) {
      if (existingProfile.birthdate && existingProfile.birthtime && existingProfile.city) {
        // Данные есть, проверяем тему прогноза
        if (!userMessage.match(/1|2|3|4|5/)) {
          const reply = `Ваши данные уже сохранены! Ожидайте, я готова составить для вас прогноз. Пожалуйста, уточните, на какую тему вы хотите получить прогноз? Вот несколько вариантов:
          1. Семья и отношения
          2. Здоровье
          3. Финансовое положение
          4. Карьера и работа
          5. Личностный рост
          Пожалуйста, выберите одну тему или напишите свою.`;

          // 💾 Сохраняем сообщение бота в Supabase
          await supabase.from('messages').insert([{
            session_id: chatId,
            role: 'bot',
            content: reply
          }]);

          await bot.sendMessage(chatId, reply);
        } else {
          // Если пользователь выбрал тему, генерируем прогноз
          const topic = userMessage.trim();
          let prediction = '';

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

          // 💾 Сохраняем сообщение бота в Supabase
          await supabase.from('messages').insert([{
            session_id: chatId,
            role: 'bot',
            content: prediction
          }]);

          await bot.sendMessage(chatId, prediction);

          // Генерация более глубокого прогноза через OpenAI
          try {
            const response = await openai.chat.completions.create({
              model: 'gpt-3.5-turbo',
              messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prediction }]
            });
            
            const aiPrediction = response.choices[0].message.content.trim();
            
            // 💾 Сохраняем сообщение бота с результатом от OpenAI в Supabase
            await supabase.from('messages').insert([{
              session_id: chatId,
              role: 'bot',
              content: aiPrediction
            }]);

            await bot.sendMessage(chatId, aiPrediction);
          } catch (error) {
            console.error('Ошибка при запросе OpenAI:', error);
            await bot.sendMessage(chatId, 'Возникла ошибка при создании прогноза. Попробуйте позже.');
          }
        }
      } else {
        // Если профиль есть, но данные неполные
        const reply = `Здравствуйте! Вы уже начали заполнение данных. Пожалуйста, уточните:
        1. Время рождения (если известно).
        2. Место рождения (если отличается от Москвы).`;

        // 💾 Сохраняем сообщение бота в Supabase
        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: reply
        }]);

        await bot.sendMessage(chatId, reply);
      }
    } else {
      // Если профиль не найден, продолжаем запрашивать данные
      if (!userMessage.match(/\d{2}\.\d{2}\.\d{4}/)) {
        const reply = `Здравствуйте! Я — София, эксперт по астрологии и эзотерике. Готова помочь вам. Пожалуйста, предоставьте мне следующие данные для составления прогноза:
        1. Дата рождения (в формате ДД.ММ.ГГГГ)
        2. Время рождения (если известно)
        3. Место рождения`;

        // 💾 Сохраняем сообщение бота в Supabase
        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: reply
        }]);

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

          // 💾 Сохраняем сообщение бота в Supabase
          await supabase.from('messages').insert([{
            session_id: chatId,
            role: 'bot',
            content: reply
          }]);

          await bot.sendMessage(chatId, reply);
        }
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error('
