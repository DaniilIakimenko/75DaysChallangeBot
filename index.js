const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const cron = require('node-cron');

// Подключение к MongoDB (бесплатно через MongoDB Atlas)
mongoose.connect('mongodb+srv://dayakimenko666:Ye6G5NcPK6yM2M6O@cluster0.qlpkysv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

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
    photoProof: String, // Ссылка на фото
  }],
  currentDay: { type: Number, default: 0 },
});

const User = mongoose.model('User', UserSchema);

// Запуск бота
const bot = new Telegraf('8166894974:AAF1smiSyx8G5R5_NUcZC39vtb4J4wMYYtQ');

// Команда /start
bot.start(async (ctx) => {
  await ctx.reply('Привет! Это бот для 75-дневного челленджа. Как тебя зовут?');
});

// Обработка имени
bot.on('text', async (ctx) => {
  const name = ctx.message.text;
  const newUser = new User({ telegramId: ctx.from.id, name });
  await newUser.save();
  await ctx.reply(`Отлично, ${name}! Теперь введи свой возраст.`);
});

// Напоминания (каждый день в 07:30)
cron.schedule('30 7 * * *', async () => {
  const users = await User.find({});
  users.forEach(user => {
    bot.telegram.sendMessage(
      user.telegramId,
      `День ${user.currentDay + 1}/75. Ты проснулся вовремя?`,
      Markup.inlineKeyboard([
        Markup.button.callback('Да', 'woke_up_yes'),
        Markup.button.callback('Нет', 'woke_up_no'),
      ])
    );
  });
});

// Обработка ответов
bot.action('woke_up_yes', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  user.dailyCheckins.push({ date: new Date(), wokeUpOnTime: true });
  await user.save();
  ctx.reply('Отлично! Сколько страниц ты прочитал?');
});

bot.on('photo', async (ctx) => {
  const photoId = ctx.message.photo[0].file_id;
  const user = await User.findOne({ telegramId: ctx.from.id });
  user.dailyCheckins[user.dailyCheckins.length - 1].photoProof = photoId;
  await user.save();
  ctx.reply('Фото сохранено! Молодец!');
});

cron.schedule('0 12 * * 1', async () => { // Каждый понедельник в 12:00
  const users = await User.find({});
  users.forEach(user => {
    const progress = `Твой прогресс за неделю:\n` +
      `Дней выполнено: ${user.dailyCheckins.filter(c => c.wokeUpOnTime).length}/7\n` +
      `Страниц прочитано: ${user.dailyCheckins.reduce((sum, c) => sum + c.pagesRead, 0)}`;
    bot.telegram.sendMessage(user.telegramId, progress);
  });
});

// Запуск бота
bot.launch();
console.log('Бот запущен!');