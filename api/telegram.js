const { OpenAI } = require('openai');
const TelegramBot = require('node-telegram-bot-api');
const { supabase } = require('../lib/supabase');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const OPENAI_KEY = process.env.OPENAI_KEY || '';

const systemPrompt = `Ты - Тарини, эксперт по ведической астрологии (Джйотиш) и эзотерике. Ответь на вопросы глубоко, мягко, с лёгким вдохновением. Избегай сухих или формальных ответов.
Используй предоставленные данные пользователя (дату рождения, время и место) и выбранную тему для точного прогноза. Следуй принципам ведической астрологии, учитывай расположение планет, дома и знаки зодиака.`;

module.exports = async (req, res) => {
  // Быстрый выход для не-POST запросов
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  // Защита от отсутствующих данных
  const message = req.body?.message;
  if (!message || !message.text || message.text.startsWith('/')) {
    res.status(200).end();
    return;
  }

  const chatId = (message.chat?.id || '').toString();
  const userMessage = message.text.trim();

  // Инициализация клиентов (как в оригинале)
  const openai = new OpenAI({ apiKey: OPENAI_KEY });
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

  try {
    // Сохраняем сообщение пользователя (без изменений)
    await supabase.from('messages').insert([{
      session_id: chatId,
      role: 'user',
      content: userMessage,
    }]);

    // Проверка профиля (как в оригинале)
    const { data: existingProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('session_id', chatId)
      .single();

    if (profileError) console.error('Ошибка Supabase (профиль):', profileError);

    // Загрузка истории (как в оригинале)
    const { data: history = [], error: historyError } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', chatId)
      .order('timestamp', { ascending: true });

    if (historyError) console.error('Ошибка Supabase (история):', historyError);

    // Логика определения состояния (без изменений)
    const lastBotMessage = [...history].reverse().find(m => m.role === 'bot')?.content || '';
    const isAskingTopic = lastBotMessage.startsWith('Здравствуйте! Я — София, эксперт по астрологии. На какую тему');
    const isAskingData = lastBotMessage.includes('Теперь укажите');

    // Оригинальная логика обработки (добавлены try-catch для каждого блока)
    if (!existingProfile) {
      if (!isAskingTopic && !isAskingData) {
        try {
          const reply = `Здравствуйте! Я - Тарини, эксперт по астрологии. На какую тему вы хотите получить прогноз?
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
        } catch (err) {
          console.error('Ошибка при отправке темы:', err);
        }
      }
      else if (isAskingTopic && ['1', '2', '3', '4', '5'].includes(userMessage)) {
        try {
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
        } catch (err) {
          console.error('Ошибка при запросе данных:', err);
        }
      }
      else if (isAskingData) {
        try {
          const birthdateMatch = userMessage.match(/\d{2}\.\d{2}\.\d{4}/);
          if (birthdateMatch) {
            const birthdate = birthdateMatch[0];
            const [day, month, year] = birthdate.split('.');
            const formattedDate = `${year}-${month}-${day}`;

            let birthtime = "12:00"; // значение по умолчанию, если время не указано
            const timeMatch = userMessage.match(/(\d{1,2})(?::(\d{2}))?(?:\s*(утра|вечера|часов|часа)?)?/);
            if (timeMatch) {
              let hours = parseInt(timeMatch[1]);
              const minutes = timeMatch[2] ? timeMatch[2] : "00";
              if (timeMatch[3]?.includes('вечера') && hours < 12) hours += 12;
              if (timeMatch[3]?.includes('утра') && hours === 12) hours = 0; // полночь
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
              m.role === 'user' && m.content.match(/^[1-5]$/)
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

            const prompt = `Ты — эксперт по ведической астрологии (Джйотиш) и эзотерике. Создай глубокий астрологический прогноз для человека на тему "${topicName}". Используй следующие данные:

1. Дата рождения: ${birthdate}
2. Время рождения: ${birthtime}
3. Место рождения: ${city}

Проанализируй:
- Положение Луны в знаке и доме, и как это влияет на эмоциональное состояние и взаимодействие с окружающими
- Положение Венеры и Марса, и как это связано с любовными отношениями, страстью и активностью
- Положение Солнца в натальной карте, его влияние на карьеру, личный статус и общественное признание
- Положение Юпитера и Сатурна, их влияние на личные финансы, работу и долгосрочные цели
- Аспекты между планетами, которые создают конфликты или гармонию в выбранной теме
- Текущие транзиты и как они влияют на указанную тему, а также на личные цели человека

Ответь с глубоким анализом, который включает:
1. Позитивные моменты, которые могут помочь в достижении успеха в этой области.
2. Потенциальные трудности и вызовы, которые могут возникнуть в будущем.
3. Практические рекомендации, которые могут помочь преодолеть трудности или улучшить текущую ситуацию.
4. Специальные советы по развитию личных качеств и духовной практики для улучшения текущего положения.

Помни, что каждый прогноз должен быть уникальным и адаптированным к индивидуальной ситуации. Ответ должен быть мягким, с лёгким вдохновением, чтобы помочь пользователю почувствовать уверенность в будущем.`;

            const response = await openai.chat.completions.create({
              model: 'gpt-3.5-turbo',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
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
        } catch (err) {
          console.error('Ошибка при генерации прогноза:', err);
          await bot.sendMessage(chatId, '🔮 Не удалось создать прогноз. Попробуйте уточнить данные.');
        }
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error('Глобальная ошибка:', err);
    try {
      await bot.sendMessage(chatId, '⚠️ Произошла ошибка. Попробуйте позже.');
    } catch (botErr) {
      console.error('Ошибка отправки сообщения об ошибке:', botErr);
    }
    res.status(200).end();
  }
};
