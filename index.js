const { Telegraf, Markup, session } = require('telegraf'); // Изменено здесь
const mongoose = require('mongoose');
const cron = require('node-cron');
const { setTimeout } = require('timers/promises');

// Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN || '8166894974:AAF1smiSyx8G5R5_NUcZC39vtb4J4wMYYtQ';
const MAX_RETRIES = 5;
const INITIAL_DELAY = 10000;

// Инициализация бота
const bot = new Telegraf(BOT_TOKEN);

// Подключение к MongoDB
mongoose.connect('mongodb+srv://dayakimenko666:Ye6G5NcPK6yM2M6O@cluster0.qlpkysv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 10000
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Модель пользователя
const UserSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true },
  name: String,
  age: Number,
  weight: Number,
  bodyParams: {
    waist: Number,
    hips: Number,
    arms: Number,
    legs: Number,
  },
  wakeUpTime: { type: String, default: "07:30" },
  dailyCheckins: [{
    date: Date,
    wokeUpOnTime: Boolean,
    pagesRead: Number,
    exercised: Boolean,
    photoProof: String,
  }],
  currentDay: { type: Number, default: 0 },
});

const User = mongoose.model('User', UserSchema);

// Добавляем сессии
bot.use(session()); // Изменено здесь

// Команда /start
bot.start(async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (user) {
    await ctx.reply(
      `Привет снова, ${user.name}! Ты уже зарегистрирован. Что хочешь сделать дальше?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Начать челлендж', 'start_challenge')],
        [Markup.button.callback('Обновить данные', 'update_data')],
        [Markup.button.callback('Посмотреть прогресс', 'show_progress')]
      ])
    );
  } else {
    await ctx.reply('Привет! Это бот для 75-дневного челленджа. Как тебя зовут?');
  }
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  const text = ctx.message.text;

  if (!user) {
    const newUser = new User({ telegramId: ctx.from.id, name: text });
    try {
      await newUser.save();
      await ctx.reply(`Отлично, ${text}! Теперь введи свой возраст.`);
    } catch (error) {
      console.error('Ошибка сохранения пользователя:', error);
      await ctx.reply('Произошла ошибка. Попробуй еще раз с командой /start.');
    }
  } else if (!user.age) {
    const age = parseInt(text);
    if (isNaN(age) || age <= 0) {
      await ctx.reply('Пожалуйста, введи корректный возраст (число больше 0).');
    } else {
      user.age = age;
      await user.save();
      await ctx.reply(`Возраст ${age} сохранен! Теперь введи свой вес (в кг).`);
    }
  } else if (!user.weight) {
    const weight = parseFloat(text);
    if (isNaN(weight) || weight <= 0) {
      await ctx.reply('Пожалуйста, введи корректный вес (число больше 0).');
    } else {
      user.weight = weight;
      await user.save();
      await ctx.reply('Вес сохранен! Ты готов начать челлендж. Используй /start для дальнейших действий.');
    }
  } else if (ctx.session?.waitingFor === 'age') {
    const age = parseInt(text);
    if (isNaN(age) || age <= 0) {
      await ctx.reply('Пожалуйста, введи корректный возраст (число больше 0).');
    } else {
      user.age = age;
      await user.save();
      await ctx.reply(`Возраст обновлен: ${age}`);
      ctx.session.waitingFor = null;
    }
  } else if (ctx.session?.waitingFor === 'weight') {
    const weight = parseFloat(text);
    if (isNaN(weight) || weight <= 0) {
      await ctx.reply('Пожалуйста, введи корректный вес (число больше 0).');
    } else {
      user.weight = weight;
      await user.save();
      await ctx.reply(`Вес обновлен: ${weight} кг`);
      ctx.session.waitingFor = null;
    }
  } else if (ctx.session?.waitingFor === 'pages') {
    const pages = parseInt(text);
    if (isNaN(pages) || pages < 0) {
      await ctx.reply('Пожалуйста, введи корректное количество страниц (число 0 или больше).');
    } else {
      user.dailyCheckins[user.dailyCheckins.length - 1].pagesRead = pages;
      await user.save();
      await ctx.reply(`Сохранено: ${pages} страниц. Ты занимался спортом сегодня?`, Markup.inlineKeyboard([
        [Markup.button.callback('Да', 'exercised_yes')],
        [Markup.button.callback('Нет', 'exercised_no')]
      ]));
      ctx.session.waitingFor = null;
    }
  } else {
    await ctx.reply('Я не понял, что ты хочешь сделать. Используй /start для выбора действий.');
  }
});

// Обработка кнопок
bot.action('start_challenge', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (user.currentDay === 0) {
    user.currentDay = 1;
    await user.save();
    await ctx.reply('Челлендж начался! День 1/75. Следи за ежедневными напоминаниями.');
  } else {
    await ctx.reply(`Ты уже на дне ${user.currentDay}/75. Продолжай в том же духе!`);
  }
  await ctx.answerCbQuery();
});

bot.action('update_data', async (ctx) => {
  await ctx.reply('Что хочешь обновить?', Markup.inlineKeyboard([
    [Markup.button.callback('Возраст', 'update_age')],
    [Markup.button.callback('Вес', 'update_weight')]
  ]));
  await ctx.answerCbQuery();
});

bot.action('show_progress', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  const progress = `Твой прогресс:\n` +
    `Текущий день: ${user.currentDay}/75\n` +
    `Успешных утренних подъемов: ${user.dailyCheckins.filter(c => c.wokeUpOnTime).length}\n` +
    `Прочитано страниц: ${user.dailyCheckins.reduce((sum, c) => sum + (c.pagesRead || 0), 0)}`;
  await ctx.reply(progress);
  await ctx.answerCbQuery();
});

bot.action('update_age', async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.waitingFor = 'age';
  await ctx.reply('Введи новый возраст.');
  await ctx.answerCbQuery();
});

bot.action('update_weight', async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.waitingFor = 'weight';
  await ctx.reply('Введи новый вес (в кг).');
  await ctx.answerCbQuery();
});

// Ежедневные проверки
bot.action('woke_up_yes', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  user.dailyCheckins.push({ date: new Date(), wokeUpOnTime: true });
  await user.save();
  ctx.session = ctx.session || {};
  ctx.session.waitingFor = 'pages';
  await ctx.reply('Отлично! Сколько страниц ты прочитал?');
  await ctx.answerCbQuery();
});

bot.action('woke_up_no', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  user.dailyCheckins.push({ date: new Date(), wokeUpOnTime: false });
  await user.save();
  await ctx.reply('Ничего страшного, завтра получится! Ты занимался спортом сегодня?', Markup.inlineKeyboard([
    [Markup.button.callback('Да', 'exercised_yes')],
    [Markup.button.callback('Нет', 'exercised_no')]
  ]));
  await ctx.answerCbQuery();
});

bot.action('exercised_yes', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  user.dailyCheckins[user.dailyCheckins.length - 1].exercised = true;
  await user.save();
  await ctx.reply('Супер! Отправь фото доказательство (если хочешь).');
  await ctx.answerCbQuery();
});

bot.action('exercised_no', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  user.dailyCheckins[user.dailyCheckins.length - 1].exercised = false;
  await user.save();
  await ctx.reply('Хорошо, завтра наверстаешь! Отправь фото доказательство (если есть).');
  await ctx.answerCbQuery();
});

// Обработка фото
bot.on('photo', async (ctx) => {
  const photoId = ctx.message.photo[0].file_id;
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (user.dailyCheckins.length > 0) {
    user.dailyCheckins[user.dailyCheckins.length - 1].photoProof = photoId;
    await user.save();
    await ctx.reply('Фото сохранено! Молодец!');
  } else {
    await ctx.reply('Сначала начни челлендж или ответь на ежедневный вопрос.');
  }
});

// Ежедневные напоминания
cron.schedule('30 7 * * *', async () => {
  const users = await User.find({ currentDay: { $gt: 0 } }); // Только активные участники
  users.forEach(user => {
    bot.telegram.sendMessage(
      user.telegramId,
      `День ${user.currentDay}/75. Ты проснулся вовремя?`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Да', 'woke_up_yes')],
        [Markup.button.callback('Нет', 'woke_up_no')]
      ])
    );
  });
});

// Еженедельный отчет
cron.schedule('0 12 * * 1', async () => {
  const users = await User.find({ currentDay: { $gt: 0 } });
  users.forEach(user => {
    const progress = `Твой прогресс за неделю:\n` +
      `Дней выполнено: ${user.dailyCheckins.filter(c => c.wokeUpOnTime).length}/7\n` +
      `Прочитано страниц: ${user.dailyCheckins.reduce((sum, c) => sum + (c.pagesRead || 0), 0)}\n` +
      `Дней с тренировками: ${user.dailyCheckins.filter(c => c.exercised).length}`;
    bot.telegram.sendMessage(user.telegramId, progress);
  });
});

// Запуск сервера в polling-режиме
async function startServer(retryCount = 0) {
  try {
    console.log('🌍 Starting in polling mode');
    await bot.launch();
    console.log('🤖 Bot is fully operational in polling mode');
  } catch (error) {
    if (error.code === 429 && retryCount < MAX_RETRIES) {
      const delay = error.response?.parameters?.retry_after 
        ? error.response.parameters.retry_after * 1000 
        : INITIAL_DELAY * (retryCount + 1) + Math.random() * 1000;
      console.log(`⏳ Launch failed (429), retrying after ${delay}ms`);
      await bot.stop();
      await setTimeout(delay);
      return startServer(retryCount + 1);
    }
    console.error('💥 Failed to start bot after max retries:', error);
    throw error;
  }
}

// Обработка завершения работы
function setupShutdownHandlers() {
  process.once('SIGTERM', () => {
    console.log('🛑 SIGTERM received');
    bot.stop();
    process.exit(0);
  });
  process.once('SIGINT', () => {
    console.log('🛑 SIGINT received');
    bot.stop();
    process.exit(0);
  });
}

// Основной запуск
(async () => {
  console.log('🔧 Setting up shutdown handlers');
  setupShutdownHandlers();
  console.log('🚀 Initiating server start');
  try {
    await startServer();
    console.log('✅ Server startup completed successfully');
  } catch (error) {
    console.error('🛑 Server failed to start:', error);
    process.exit(1);
  }
})();