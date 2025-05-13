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
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

  try {
    // Сохраняем сообщение пользователя в Supabase
    const { error: insertError } = await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'user',
      content: userMessage,
    }]);

    if (insertError) {
      console.error('Ошибка при сохранении сообщения:', insertError);
    }

    // Проверяем наличие профиля в базе данных
    const { data: existingProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    if (profileError) {
      console.error('Ошибка при получении профиля:', profileError);
    }

    if (existingProfile) {
      // Если профиль есть и выбрана тема (1-5)
      if (Object.keys(topicMap).includes(userMessage)) {
        const selectedTopic = topicMap[userMessage];
        await bot.sendMessage(chatId, `Спасибо за выбор темы "${selectedTopic}"! Готовлю ваш прогноз...`);

        try {
          const openai = new OpenAI({
            apiKey: OPENAI_KEY,
            timeout: 10000 // 10 секунд таймаут
          });

          // Формируем промпт для OpenAI
          const messages = [
            { 
              role: 'system', 
              content: `${systemPrompt}\nПользователь выбрал тему: ${selectedTopic}. Сформируй подробный персонализированный астрологический прогноз на основе данных пользователя: 
              Дата рождения: ${existingProfile.birthdate}
              Время рождения: ${existingProfile.birthtime || 'не указано'}
              Место рождения: ${existingProfile.city || 'не указано'}`
            },
            { role: 'user', content: `Сделай астрологический прогноз по теме: ${selectedTopic}` }
          ];

          console.log('Отправляем запрос к OpenAI с сообщениями:', messages);

          // Запрос к OpenAI
          const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages,
            temperature: 0.7,
            max_tokens: 1000
          });

          console.log('Получен ответ от OpenAI:', completion);

          const aiResponse = completion.choices[0]?.message?.content || 'Не удалось сформировать прогноз.';

          // Сохраняем ответ
          await supabase.from('messages').insert([{
            session_id: chatId,
            role: 'assistant',
            content: aiResponse,
          }]);

          // Отправляем ответ частями, если он слишком длинный
          if (aiResponse.length > 4096) {
            for (let i = 0; i < aiResponse.length; i += 4096) {
              await bot.sendMessage(chatId, aiResponse.substring(i, i + 4096));
            }
          } else {
            await bot.sendMessage(chatId, aiResponse);
          }

        } catch (openaiError) {
          console.error('Ошибка OpenAI:', openaiError);
          await bot.sendMessage(chatId, '⚠️ Произошла ошибка при генерации прогноза. Попробуйте позже.');
        }
      } 
      // Если профиль есть, но тема не выбрана
      else if (!userMessage.match(/^[1-5]$/)) {
        const reply = `Ваши данные уже сохранены! Пожалуйста, выберите тему прогноза:
        1. Семья и отношения
        2. Здоровье
        3. Финансовое положение
        4. Карьера и работа
        5. Личностный рост
        Напишите цифру от 1 до 5.`;
        await bot.sendMessage(chatId, reply);
      }
    } else {
      // Если профиля нет и введена дата рождения
      if (userMessage.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
        const [day, month, year] = userMessage.split('.');
        const formattedDate = `${year}-${month}-${day}`;

        const { error: profileInsertError } = await supabase.from('user_profiles').insert([{
          session_id: chatId,
          birthdate: formattedDate,
          birthtime: "07:00",
          city: "Москва",
        }]);

        if (profileInsertError) {
          console.error('Ошибка при сохранении профиля:', profileInsertError);
          await bot.sendMessage(chatId, '⚠️ Ошибка при сохранении ваших данных. Попробуйте ещё раз.');
          return;
        }
        
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
        const reply = `Здравствуйте! Я — София, эксперт по астрологии. Для составления прогноза мне нужна ваша дата рождения в формате ДД.ММ.ГГГГ`;
        await bot.sendMessage(chatId, reply);
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error('❌ Общая ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ Произошла непредвиденная ошибка. Попробуйте позже.');
    res.status(500).end();
  }
};
