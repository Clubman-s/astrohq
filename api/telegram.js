const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const systemPrompt = `
Ты — София, эксперт по астрологии и эзотерике. Ответь на вопросы глубоко, мягко, с лёгким вдохновением. Избегай сухих или формальных ответов. 
Начни с того, чтобы представиться, объяснить свою роль и запросить данные пользователя для анализа (дату рождения, время и место).
`;

const topicMap = {
  '1': 'Семья и отношения',
  '2': 'Здоровье',
  '3': 'Финансовое положение',
  '4': 'Карьера и работа',
  '5': 'Личностный рост'
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
  const userMessage = message.text.trim();

  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

  try {
    // Сохраняем сообщение пользователя в Supabase
    await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'user',
      content: userMessage,
    }]);

    // Загружаем историю из Supabase
    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', chatId)
      .order('timestamp', { ascending: true })
      .limit(20);

    // Проверяем наличие профиля в базе данных
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    if (existingProfile) {
      // Если профиль есть и выбрана тема (1-5)
      if (Object.keys(topicMap).includes(userMessage)) {
        const selectedTopic = topicMap[userMessage];
        await bot.sendMessage(chatId, `Спасибо за выбор темы "${selectedTopic}"! Готовлю ваш прогноз...`);

        // Формируем промпт для OpenAI
        const messages = [
          { 
            role: 'system', 
            content: `${systemPrompt}\nПользователь выбрал тему: ${selectedTopic}. Сформируй подробный персонализированный астрологический прогноз на основе данных пользователя: 
            Дата рождения: ${existingProfile.birthdate}
            Время рождения: ${existingProfile.birthtime || 'не указано'}
            Место рождения: ${existingProfile.city || 'не указано'}`
          },
          ...(history || []).filter(msg => msg.role !== 'system'),
          { role: 'user', content: userMessage }
        ];

        // Запрос к OpenAI
        const completion = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages,
          temperature: 0.7,
        });

        const aiResponse = completion.choices[0].message.content;

        // Сохраняем и отправляем ответ
        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'assistant',
          content: aiResponse,
        }]);

        await bot.sendMessage(chatId, aiResponse);
      } 
      // Если профиль есть, но тема не выбрана (показываем варианты)
      else if (!userMessage.match(/1|2|3|4|5/)) {
        const reply = `Ваши данные уже сохранены! Пожалуйста, выберите тему прогноза:
        1. Семья и отношения
        2. Здоровье
        3. Финансовое положение
        4. Карьера и работа
        5. Личностный рост
        Напишите цифру от 1 до 5 или свою тему.`;
        await bot.sendMessage(chatId, reply);
      }
    } else {
      // Если профиля нет и введена дата рождения
      if (userMessage.match(/\d{2}\.\d{2}\.\d{4}/)) {
        const birthdate = userMessage.match(/\d{2}\.\d{2}\.\d{4}/)[0];
        const [day, month, year] = birthdate.split('.');
        const formattedDate = `${year}-${month}-${day}`;

        const userProfileData = {
          session_id: chatId,
          birthdate: formattedDate,
          birthtime: "07:00", // По умолчанию
          city: "Москва", // По умолчанию
        };

        await supabase.from('user_profiles').insert([userProfileData]);
        
        const reply = `Спасибо за ваши данные! Теперь выберите тему прогноза:
        1. Семья и отношения
        2. Здоровье
        3. Финансовое положение
        4. Карьера и работа
        5. Личностный рост
        Напишите цифру от 1 до 5.`;
        await bot.sendMessage(chatId, reply);
      } 
      // Если профиля нет и не введена дата рождения
      else {
        const reply = `Здравствуйте! Я — София, эксперт по астрологии. Для составления прогноза мне нужны:
        1. Дата рождения (в формате ДД.ММ.ГГГГ)
        2. Время рождения (если известно)
        3. Место рождения
        Пожалуйста, начните с даты рождения.`;
        await bot.sendMessage(chatId, reply);
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ Произошла ошибка при обработке вашего запроса. Попробуйте позже.');
    res.status(500).end();
  }
};
