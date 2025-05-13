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

    // Если профиль существует, проверяем, есть ли тема
    if (existingProfile) {
      if (!userMessage.match(/1|2|3|4|5/)) {
        const reply = `Ваши данные уже сохранены! Ожидайте, я готова составить для вас прогноз. Пожалуйста, уточните, на какую тему вы хотите получить прогноз? Вот несколько вариантов:
        1. Семья и отношения
        2. Здоровье
        3. Финансовое положение
        4. Карьера и работа
        5. Личностный рост
        Пожалуйста, выберите одну тему или напишите свою.`;

        // 💬 Сохраняем сообщение от бота
        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: reply,
        }]);

        await bot.sendMessage(chatId, reply);
      } else {
        // Если пользователь выбрал тему, готовим прогноз
        const topic = userMessage.trim();

        // Генерация прогноза с помощью OpenAI или другой логики
        let forecast = '';
        switch (topic) {
          case '1':
            forecast = 'Ваш прогноз на тему "Семья и отношения": ваше взаимодействие с близкими в 2025 году будет наполнено гармонией и взаимопониманием...';
            break;
          case '2':
            forecast = 'Ваш прогноз на тему "Здоровье": в 2025 году стоит обратить внимание на поддержание здоровья, особенно на улучшение питания...';
            break;
          case '3':
            forecast = 'Ваш прогноз на тему "Финансовое положение": в 2025 году финансовая стабильность будет зависеть от вашего подхода к инвестициям...';
            break;
          case '4':
            forecast = 'Ваш прогноз на тему "Карьера и работа": на горизонте возможны карьерные изменения, которые приведут к долгожданному продвижению...';
            break;
          case '5':
            forecast = 'Ваш прогноз на тему "Личностный рост": в 2025 году вы будете стремиться к самосовершенствованию и обретению внутреннего покоя...';
            break;
          default:
            forecast = 'Я не совсем поняла вашу тему, но готова предложить общий прогноз: в 2025 году вам предстоит важный этап трансформации, ищите гармонию внутри себя...';
            break;
        }

        // 💬 Сохраняем прогноз от бота
        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: forecast,
        }]);

        await bot.sendMessage(chatId, forecast);
      }
    } else {
      // Если профиль не найден, продолжаем запрашивать данные
      if (!userMessage.match(/\d{2}\.\d{2}\.\d{4}/)) {
        const reply = `Здравствуйте! Я — София, эксперт по астрологии и эзотерике. Готова помочь вам. Пожалуйста, предоставьте мне следующие данные для составления прогноза:
        1. Дата рождения (в формате ДД.ММ.ГГГГ)
        2. Время рождения (если известно)
        3. Место рождения`;

        // 💬 Сохраняем сообщение от бота
        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: reply,
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

          // 💬 Сохраняем сообщение от бота
          await supabase.from('messages').insert([{
            session_id: chatId,
            role: 'bot',
            content: 'Спасибо за ваши данные! Я начала готовить ваш прогноз. Пожалуйста, подождите.',
          }]);

          // После сохранения данных, запрашиваем тему прогноза
          const reply = `Ваши данные сохранены! Ожидайте, я готова составить для вас прогноз. Пожалуйста, уточните, на какую тему вы хотите получить прогноз? Вот несколько вариантов:
          1. Семья и отношения
          2. Здоровье
          3. Финансовое положение
          4. Карьера и работа
          5. Личностный рост
          Пожалуйста, выберите одну тему или напишите свою.`;

          // 💬 Сохраняем сообщение от бота
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

    // 💬 Сохраняем сообщение от бота об ошибке
    await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'bot',
      content: '⚠️ София временно недоступна. Попробуйте позже.',
    }]);

    res.status(200).end();
  }
};
