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
  const userMessage = message.text.trim();

  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

  const timestamp = new Date().toISOString();  // Получаем текущую дату и время в формате ISO

  // Функция для записи сообщения в таблицу messages
  async function saveMessageToDb(sessionId, role, content) {
    const { error } = await supabase
      .from('messages')
      .insert([{
        session_id: sessionId,
        role: role,
        content: content,
        timestamp: timestamp
      }]);

    if (error) {
      console.error('Ошибка при сохранении сообщения:', error);
    }
  }

  try {
    // 1. Проверяем наличие профиля в базе
    const { data: existingProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    // 2. Если профиля нет - запрашиваем данные
    if (!existingProfile || profileError) {
      // Проверяем, содержит ли сообщение дату в формате ДД.ММ.ГГГГ
      const dateMatch = userMessage.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      
      if (!dateMatch) {
        const greetingMessage = `Здравствуйте! Я — София, ваш астрологический помощник. 
Для составления персонального прогноза мне потребуются:
1. Дата рождения (в формате ДД.ММ.ГГГГ)
2. Время рождения (если известно)
3. Место рождения

Пожалуйста, начните с ввода даты рождения.`;
        await bot.sendMessage(chatId, greetingMessage);

        // Сохраняем сообщение пользователя в базе
        await saveMessageToDb(chatId, 'user', userMessage);

        return res.status(200).end();
      }

      // Извлекаем компоненты даты
      const [_, day, month, year] = dateMatch;
      const formattedDate = `${year}-${month}-${day}`;

      // Сохраняем базовый профиль
      const { error: insertError } = await supabase
        .from('user_profiles')
        .insert([{
          session_id: chatId,
          birthdate: formattedDate,
          birthtime: '07:00', // дефолтное время
          city: 'Москва'      // дефолтный город
        }]);

      if (insertError) {
        console.error('Ошибка сохранения:', insertError);
        await bot.sendMessage(chatId, 'Произошла ошибка при сохранении данных. Попробуйте ещё раз.');
        return res.status(200).end();
      }

      // После сохранения предлагаем выбрать тему
      const topicMessage = `Спасибо! Ваши данные сохранены. 
Выберите интересующую вас тему:
1️⃣ Семья и отношения
2️⃣ Здоровье
3️⃣ Финансы
4️⃣ Карьера
5️⃣ Личностный рост

Просто отправьте цифру от 1 до 5.`;
      await bot.sendMessage(chatId, topicMessage);

      // Сохраняем сообщение бота в базе
      await saveMessageToDb(chatId, 'bot', topicMessage);

      return res.status(200).end();
    }

    // 3. Если профиль есть - обрабатываем выбор темы
    if (/^[1-5]$/.test(userMessage)) {
      const topics = [
        "Семья и отношения",
        "Здоровье",
        "Финансовое положение",
        "Карьера и работа",
        "Личностный рост"
      ];
      const selectedTopic = topics[parseInt(userMessage) - 1];

      // Формируем контекст для OpenAI
      const userContext = `Дата рождения: ${existingProfile.birthdate}
Время рождения: ${existingProfile.birthtime}
Место рождения: ${existingProfile.city}
Выбранная тема: ${selectedTopic}`;

      try {
        // Запрос к OpenAI
        const response = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContext }
          ],
          temperature: 0.7
        });

        const prediction = response.choices[0].message.content;
        await bot.sendMessage(chatId, prediction);
        
        // Сохраняем сообщение бота в базе
        await saveMessageToDb(chatId, 'bot', prediction);

        // Предлагаем выбрать новую тему
        const newTopicMessage = `Хотите узнать о другой сфере жизни?
1️⃣ Семья
2️⃣ Здоровье
3️⃣ Финансы
4️⃣ Карьера
5️⃣ Личностный рост

Или введите "стоп" для завершения.`;
        await bot.sendMessage(chatId, newTopicMessage);

        // Сохраняем сообщение бота в базе
        await saveMessageToDb(chatId, 'bot', newTopicMessage);

        return res.status(200).end();
      } catch (error) {
        console.error('OpenAI Error:', error);
        await bot.sendMessage(chatId, 'Извините, возникла ошибка при генерации прогноза. Попробуйте позже.');
        return res.status(200).end();
      }
    }

    // 4. Если тема не выбрана - повторяем предложение
    const repeatTopicMessage = `Пожалуйста, выберите тему:
1️⃣ Семья и отношения
2️⃣ Здоровье
3️⃣ Финансы
4️⃣ Карьера
5️⃣ Личностный рост

Отправьте цифру от 1 до 5.`;
    await bot.sendMessage(chatId, repeatTopicMessage);

    // Сохраняем сообщение бота в базе
    await saveMessageToDb(chatId, 'bot', repeatTopicMessage);

    return res.status(200).end();

  } catch (err) {
    console.error('❌ Global Error:', err);
    await bot.sendMessage(chatId, '⚠️ Произошла непредвиденная ошибка. Пожалуйста, попробуйте позже.');
    return res.status(200).end();
  }
};
