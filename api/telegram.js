const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const systemPrompt = `Ты — София, эксперт по астрологии и эзотерике...`; // Ваш промпт

// Функция точного извлечения данных
const extractUserData = (text) => {
  const dateMatch = text.match(/\b\d{2}\.\d{2}\.\d{4}\b/);
  if (!dateMatch) return null;

  // Жёсткое требование к формату времени: ЧЧ:ММ или ЧЧ часов
  const timeMatch = text.match(/(\d{1,2}):(\d{2})|(\d{1,2})\s*(?:часов?|час)/);
  let hours = 12, minutes = '00'; // Значения по умолчанию

  if (timeMatch) {
    if (timeMatch[1]) { // Формат ЧЧ:ММ
      hours = parseInt(timeMatch[1]);
      minutes = timeMatch[2];
    } else { // Формат "ЧЧ часов"
      hours = parseInt(timeMatch[3]);
    }
    
    // Корректировка PM времени
    if (/вечера|ночи|pm/i.test(text) && hours < 12) hours += 12;
    hours = Math.min(23, Math.max(0, hours)); // Ограничение 0-23
  }

  // Город - последнее слово, не являющееся частью даты/времени
  const excluded = ['около', 'примерно', 'утра', 'вечера', 'часов', 'час'];
  const city = text.split(/\s+/)
    .filter(w => !w.match(/^\d/) && !excluded.includes(w.toLowerCase()))
    .pop() || 'Москва';

  return {
    birthdate: dateMatch[0],
    birthtime: `${hours.toString().padStart(2, '0')}:${minutes}`,
    city
  };
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { message } = req.body;
  if (!message?.text || message.text.startsWith('/')) return res.status(200).end();

  const chatId = message.chat.id.toString();
  const userMessage = message.text.trim();
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

  try {
    // 1. Сохраняем сообщение
    await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'user',
      content: userMessage
    }]);

    // 2. Проверяем профиль
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    // 3. Если профиль полный - обрабатываем тему
    if (profile?.birthdate && profile?.birthtime && profile?.city) {
      if (/^[1-5]$/.test(userMessage)) {
        const topicMap = {
          '1': 'Семья и отношения',
          '2': 'Здоровье',
          '3': 'Финансы',
          '4': 'Карьера',
          '5': 'Личностный рост'
        };
        
        const prompt = `Прогноз по теме "${topicMap[userMessage]}" для ${profile.birthdate} ${profile.birthtime} ${profile.city}`;
        const gptResponse = await new OpenAI({apiKey: OPENAI_KEY}).chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ]
        });

        const reply = gptResponse.choices[0].message.content;
        await bot.sendMessage(chatId, reply);
        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: reply
        }]);
        return res.status(200).end();
      }
      
      // Запрос темы, если не выбрана
      await bot.sendMessage(chatId, `Выберите тему:\n1. Семья\n2. Здоровье\n3. Финансы\n4. Карьера\n5. Личностный рост`);
      return res.status(200).end();
    }

    // 4. Если данных нет - запрашиваем
    if (!extractUserData(userMessage)) {
      await bot.sendMessage(chatId, 'Укажите дату (ДД.ММ.ГГГГ), точное время (ЧЧ:ММ) и город');
      return res.status(200).end();
    }

    // 5. Сохраняем данные
    const { birthdate, birthtime, city } = extractUserData(userMessage);
    const [d, m, y] = birthdate.split('.');
    
    await supabase.from('user_profiles').upsert([{
      session_id: chatId,
      birthdate: `${y}-${m}-${d}`,
      birthtime,
      city
    }], { onConflict: ['session_id'] });

    await bot.sendMessage(chatId, 'Данные сохранены! Выберите тему прогноза (1-5)');
    return res.status(200).end();

  } catch (err) {
    console.error(err);
    await bot.sendMessage(chatId, 'Ошибка обработки запроса');
    return res.status(200).end();
  }
};
