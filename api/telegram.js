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

  try {
    // Сохраняем сообщение пользователя в Supabase
    await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'user',
      content: userMessage,
    }]);

    // Проверяем наличие уже сохранённого профиля
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    // Если профиль существует и содержит все данные
    if (existingProfile?.birthdate && existingProfile?.birthtime && existingProfile?.city) {
      // Проверяем, выбрал ли пользователь тему (1-5)
      if (/^[1-5]$/.test(userMessage)) {
        const topics = {
          '1': 'Семья и отношения',
          '2': 'Здоровье',
          '3': 'Финансовое положение',
          '4': 'Карьера и работа',
          '5': 'Личностный рост'
        };
        
        const topic = topics[userMessage];
        const predictionPrompt = `Составь подробный астрологический прогноз по теме "${topic}" для человека, родившегося ${existingProfile.birthdate} в ${existingProfile.birthtime} в городе ${existingProfile.city}. Учитывай текущие астрологические аспекты.`;

        // Генерация прогноза через OpenAI
        const response = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: predictionPrompt }
          ]
        });
        
        const aiPrediction = response.choices[0].message.content.trim();
        
        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: aiPrediction,
        }]);

        await bot.sendMessage(chatId, aiPrediction);
        return res.status(200).end();
      } else {
        // Запрашиваем тему, если она не выбрана
        const reply = `Ваши данные уже сохранены! Пожалуйста, выберите тему прогноза:
1. Семья и отношения
2. Здоровье
3. Финансовое положение
4. Карьера и работа
5. Личностный рост`;

        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: reply,
        }]);

        await bot.sendMessage(chatId, reply);
        return res.status(200).end();
      }
    }

    // Если профиля нет или данные неполные
    if (!userMessage.match(/\d{2}\.\d{2}\.\d{4}/)) {
      // Запрашиваем данные, если их нет в сообщении
      const reply = `Здравствуйте! Я — София, эксперт по астрологии и эзотерике. Для составления прогноза мне нужны:
1. Дата рождения (ДД.ММ.ГГГГ)
2. Время рождения (если известно)
3. Место рождения

Пример: "18.12.1970 7:00 Москва" или "18.12.1970 около 7 утра Санкт-Петербург"`;

      await supabase.from('messages').insert([{
        session_id: chatId,
        role: 'bot',
        content: reply,
      }]);

      await bot.sendMessage(chatId, reply);
      return res.status(200).end();
    }

    // Обработка данных пользователя
    const extractData = (text) => {
      // Извлекаем дату
      const dateMatch = text.match(/(\d{2}\.\d{2}\.\d{4})/);
      if (!dateMatch) return null;
      
      const birthdate = dateMatch[0];
      
      // Извлекаем время (форматы: 7:00, 7 утра, около 7, примерно в 7)
      const timeMatch = text.match(/(около|примерно)?\s*(\d{1,2})(?:\s*(?:часов?|утра|вечера|:|\s)?(\d{2})?/i);
      let birthtime = '12:00'; // По умолчанию
      
      if (timeMatch) {
        let hours = parseInt(timeMatch[2]);
        const minutes = timeMatch[3] ? timeMatch[3] : '00';
        
        // Обработка "утра/вечера"
        if (text.toLowerCase().includes('вечера') && hours < 12) hours += 12;
        
        birthtime = `${hours.toString().padStart(2, '0')}:${minutes}`;
      }
      
      // Извлекаем город (последнее слово, если это не время)
      const cityMatch = text.split(/\s+/)
        .filter(word => !word.match(/^\d/))
        .filter(word => !['около', 'примерно', 'утра', 'вечера'].includes(word.toLowerCase()))
        .pop();
      
      const city = cityMatch || 'Москва'; // По умолчанию
      
      return { birthdate, birthtime, city };
    };

    const { birthdate, birthtime, city } = extractData(userMessage);
    
    // Преобразуем дату в формат YYYY-MM-DD
    const [day, month, year] = birthdate.split('.');
    const formattedDate = `${year}-${month}-${day}`;

    // Сохраняем профиль
    const { error: insertError } = await supabase
      .from('user_profiles')
      .upsert([{
        session_id: chatId,
        birthdate: formattedDate,
        birthtime,
        city,
      }], { onConflict: ['session_id'] });

    if (insertError) {
      console.error('Ошибка при сохранении профиля:', insertError);
      await bot.sendMessage(chatId, 'Произошла ошибка при сохранении ваших данных. Пожалуйста, попробуйте ещё раз.');
      return res.status(200).end();
    }

    // Запрашиваем тему прогноза
    const reply = `Спасибо! Ваши данные сохранены. Выберите тему прогноза:
1. Семья и отношения
2. Здоровье
3. Финансовое положение
4. Карьера и работа
5. Личностный рост`;

    await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'bot',
      content: reply,
    }]);

    await bot.sendMessage(chatId, reply);
    res.status(200).end();
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ София временно недоступна. Попробуйте позже.');
    res.status(200).end();
  }
};
