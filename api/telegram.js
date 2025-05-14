const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY;

const systemPrompt = `Ты — София, эксперт по астрологии и эзотерике. Ответь на вопросы глубоко, мягко, с лёгким вдохновением. Избегай сухих или формальных ответов. Используй предоставленные данные пользователя (дату рождения, время и место) и выбранную тему для точного прогноза. Прогноз основан только на ведической (джйотиш) астрологии.`;

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
    await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'user',
      content: userMessage,
    }]);

    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', chatId)
      .order('timestamp', { ascending: true });

    const lastBotMessage = history?.slice().reverse().find(m => m.role === 'bot')?.content || '';
    const isAskingTopic = lastBotMessage.includes('на какую тему вы хотите получить прогноз');
    const isAskingData = lastBotMessage.includes('предоставьте мне следующие данные');

    if (!existingProfile) {
      if (!isAskingTopic && !isAskingData) {
        const reply = `Здравствуйте! Я — София, эксперт по астрологии. На какую тему вы хотите получить прогноз?
        1. Семья и отношения
        2. Здоровье
        3. Финансы
        4. Карьера
        5. Личностный рост`;
        
        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: reply,
        }]);
        await bot.sendMessage(chatId, reply);
      } 
      else if (isAskingTopic && userMessage.match(/1|2|3|4|5/)) {
        const reply = `Отлично! Теперь укажите:
        1. Дата рождения (ДД.ММ.ГГГГ)
        2. Время рождения (если известно)
        3. Место рождения`;

        await supabase.from('messages').insert([{
          session_id: chatId,
          role: 'bot',
          content: reply,
        }]);
        await bot.sendMessage(chatId, reply);
      }
      else if (isAskingData) {
        const birthdateMatch = userMessage.match(/\d{2}\.\d{2}\.\d{4}/);
        if (birthdateMatch) {
          const birthdate = birthdateMatch[0];
          const [day, month, year] = birthdate.split('.');
          const formattedDate = `${year}-${month}-${day}`;

          let birthtime = "12:00";
          const timeMatch = userMessage.match(/(\d{1,2})(?::(\d{2}))?(?:\s*(утра|вечера|часов|часа)?)?/);
          if (timeMatch) {
            let hours = parseInt(timeMatch[1]);
            const minutes = timeMatch[2] ? timeMatch[2] : "00";
            if (timeMatch[3]?.includes('вечера') && hours < 12) hours += 12;
            birthtime = `${hours.toString().padStart(2, '0')}:${minutes}`;
          }

          let city = "Москва";
          const cityMatch = userMessage.match(/место[:\s]*([^\d]+)/i) || 
                            userMessage.match(/город[:\s]*([^\d]+)/i);
          if (cityMatch) city = cityMatch[1].trim();

          await supabase.from('user_profiles').upsert([{
            session_id: chatId,
            birthdate: formattedDate,
            birthtime,
            city
          }]);

          const topicMessage = history.find(m => 
            m.role === 'user' && m.content.match(/1|2|3|4|5/)
          );
          const selectedTopic = topicMessage?.content.trim() || '1';

          const topicMap = {
            '1': 'Семья и отношения',
            '2': 'Здоровье',
            '3': 'Финансы',
            '4': 'Карьера',
            '5': 'Личностный рост'
          };
          const topicName = topicMap[selectedTopic] || selectedTopic;

          // 🎯 Новый prompt
          const userPrompt = `
Данные пользователя:

- Дата рождения: ${birthdate}
- Время рождения: ${birthtime}
- Город рождения: ${city}
- Тема прогноза: ${topicName}

Ты — профессиональный астролог, практикующий ведическую (джйотиш) астрологию. 
Используй сидерический зодиак (Лахири) и систему домов «Whole Sign». 

Построй натальную карту пользователя (определи лагну, накшатру Луны, дома планет и т.д.). 
Оцени текущие даши и транзиты (гочары). Сделай персонализированный астрологический прогноз 
на тему "${topicName}", основанный на этих расчетах.

Избегай общих фраз. Говори с теплотой, но точно. Пиши как опытный живой астролог.
`;

          const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ]
          });

          const prediction = response.choices[0].message.content;
          
          await supabase.from('messages').insert([{
            session_id: chatId,
            role: 'bot',
            content: prediction,
          }]);
          await bot.sendMessage(chatId, prediction);
        }
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error('Ошибка:', err);
    await bot.sendMessage(chatId, '⚠️ Произошла ошибка. Попробуйте позже.');
    res.status(200).end();
  }
};
