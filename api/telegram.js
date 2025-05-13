const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

// 1. Утилиты для работы с данными ---
const parseUserData = (text) => {
  const dateMatch = text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (!dateMatch) return null;

  // Жёсткий парсинг времени (только ЧЧ:ММ или ЧЧ часов)
  const timeMatch = text.match(/(\d{1,2}):(\d{2})|(\d{1,2})\s*(?:часов?|час)/i);
  let [hours, minutes] = [12, '00']; // Значения по умолчанию

  if (timeMatch) {
    hours = parseInt(timeMatch[1] || timeMatch[3]);
    minutes = timeMatch[2] || '00';
    
    // Коррекция PM времени
    if ((text.toLowerCase().includes('вечера') || text.toLowerCase().includes('ночи')) && hours < 12) {
      hours += 12;
    }
    hours = Math.min(23, Math.max(0, hours));
  }

  // Извлечение города (более надежный метод)
  const city = text.replace(/\b\d{2}\.\d{2}\.\d{4}\b|\d{1,2}(?::\d{2})?|\b(?:утра|вечера|ночи|часов?|час)\b/gi, '')
    .trim()
    .split(/\s+/)
    .pop() || 'Москва';

  return {
    birthdate: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`, // Формат YYYY-MM-DD
    birthtime: `${hours.toString().padStart(2, '0')}:${minutes}`,
    city: city.replace(/[^а-яё\s-]/gi, '') // Очистка от лишних символов
  };
};

// 2. Сервисные функции для Supabase ---
const saveMessage = async (session_id, role, content) => {
  const { error } = await supabase
    .from('messages')
    .insert([{ session_id, role, content }]);
  if (error) console.error('Ошибка сохранения сообщения:', error);
  return !error;
};

const saveUserProfile = async (session_id, data) => {
  const { error } = await supabase
    .from('user_profiles')
    .upsert({ ...data, session_id }, { onConflict: 'session_id' });
  if (error) console.error('Ошибка сохранения профиля:', error);
  return !error;
};

// 3. Основной обработчик ---
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { message } = req.body;
  if (!message?.text || message.text.startsWith('/')) return res.status(200).end();

  const chatId = message.chat.id.toString();
  const userText = message.text.trim();
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

  try {
    // Всегда сохраняем входящее сообщение
    await saveMessage(chatId, 'user', userText);

    // Проверяем существующий профиль
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    // Если профиль полный - обработка темы
    if (profile?.birthdate && profile?.birthtime && profile?.city) {
      if (/^[1-5]$/.test(userText)) {
        const topic = ['Семья', 'Здоровье', 'Финансы', 'Карьера', 'Развитие'][parseInt(userText)-1];
        const prompt = `Астропрогноз по теме "${topic}" для ${profile.birthdate} ${profile.birthtime} ${profile.city}`;
        
        const gptResponse = await new OpenAI({apiKey: OPENAI_KEY}).chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7
        });

        const reply = gptResponse.choices[0].message.content;
        await bot.sendMessage(chatId, reply);
        await saveMessage(chatId, 'bot', reply); // Гарантированное сохранение
        return res.status(200).end();
      }

      // Запрос темы, если не выбрана
      const themeMessage = "Выберите тему:\n1. Семья\n2. Здоровье\n3. Финансы\n4. Карьера\n5. Развитие";
      await bot.sendMessage(chatId, themeMessage);
      await saveMessage(chatId, 'bot', themeMessage);
      return res.status(200).end();
    }

    // Обработка данных пользователя
    const userData = parseUserData(userText);
    if (!userData) {
      const requestDataMsg = "Укажите дату (ДД.ММ.ГГГГ), точное время (ЧЧ:ММ) и город, например:\n18.12.1990 14:30 Москва";
      await bot.sendMessage(chatId, requestDataMsg);
      await saveMessage(chatId, 'bot', requestDataMsg);
      return res.status(200).end();
    }

    // Сохранение профиля и подтверждение
    await saveUserProfile(chatId, userData);
    const successMsg = `Данные сохранены! ${userData.birthdate} ${userData.birthtime} ${userData.city}. Выберите тему (1-5)`;
    await bot.sendMessage(chatId, successMsg);
    await saveMessage(chatId, 'bot', successMsg);
    
  } catch (err) {
    console.error('❌ Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ Ошибка обработки запроса');
    await saveMessage(chatId, 'bot', '⚠️ Ошибка обработки запроса');
  }
  
  return res.status(200).end();
};
