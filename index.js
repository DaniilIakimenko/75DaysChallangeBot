const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const cron = require('node-cron');
const { setTimeout } = require('timers/promises');
const fetch = require('node-fetch');
const net = require('net');

// Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN || '8166894974:AAF1smiSyx8G5R5_NUcZC39vtb4J4wMYYtQ';
const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN || 'seven5dayschallangebot.onrender.com';
const MAX_RETRIES = 5;
const INITIAL_DELAY = 10000; // Увеличено до 10 секунд для большей надежности

// Инициализация бота
const bot = new Telegraf(BOT_TOKEN);

// Подключение к MongoDB с улучшенными настройками
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

// Health check endpoint
bot.use(async (ctx, next) => {
  if (ctx.webhookReply && ctx.update.url === '/health') {
    try {
      await ctx.reply('✅ Bot is healthy');
      return;
    } catch (e) {
      console.error('Health check error:', e);
    }
  }
  return next();
});

// Команда /start
bot.start(async (ctx) => {
  await ctx.reply('Привет! Это бот для 75-дневного челленджа. Как тебя зовут?');
});

// Обработка имени
bot.on('text', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    const name = ctx.message.text;
    const newUser = new User({ telegramId: ctx.from.id, name });
    await newUser.save();
    await ctx.reply(`Отлично, ${name}! Теперь введи свой возраст.`);
  } else if (!user.age) {
    const age = parseInt(ctx.message.text);
    if (isNaN(age)) {
      await ctx.reply('Пожалуйста, введи возраст в виде числа.');
    } else {
      user.age = age;
      await user.save();
      await ctx.reply(`Возраст сохранен! Теперь введи свой вес (в кг).`);
    }
  } else if (!user.weight) {
    const weight = parseFloat(ctx.message.text);
    if (isNaN(weight)) {
      await ctx.reply('Пожалуйста, введи вес в виде числа.');
    } else {
      user.weight = weight;
      await user.save();
      await ctx.reply('Вес сохранен! Челлендж готов к старту.');
    }
  }
});

// Обработка ответов
bot.action('woke_up_yes', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  user.dailyCheckins.push({ date: new Date(), wokeUpOnTime: true });
  await user.save();
  ctx.reply('Отлично! Сколько страниц ты прочитал?');
});

// Обработка фото
bot.on('photo', async (ctx) => {
  const photoId = ctx.message.photo[0].file_id;
  const user = await User.findOne({ telegramId: ctx.from.id });
  user.dailyCheckins[user.dailyCheckins.length - 1].photoProof = photoId;
  await user.save();
  ctx.reply('Фото сохранено! Молодец!');
});

// Еженедельный отчет
cron.schedule('0 12 * * 1', async () => {
  const users = await User.find({});
  users.forEach(user => {
    const progress = `Твой прогресс за неделю:\n` +
      `Дней выполнено: ${user.dailyCheckins.filter(c => c.wokeUpOnTime).length}/7\n` +
      `Страниц прочитано: ${user.dailyCheckins.reduce((sum, c) => sum + (c.pagesRead || 0), 0)}`;
    bot.telegram.sendMessage(user.telegramId, progress);
  });
});

// Улучшенная функция установки webhook
async function setupWebhook(retryCount = 0) {
  try {
    console.log(`🔄 Attempt ${retryCount + 1}: Setting webhook...`);
    
    const currentWebhook = await bot.telegram.getWebhookInfo();
    if (currentWebhook.url === `https://${WEBHOOK_DOMAIN}/webhook`) {
      console.log('✅ Webhook already set correctly');
      return true;
    }

    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await setTimeout(1000);
    
    await bot.telegram.setWebhook(`https://${WEBHOOK_DOMAIN}/webhook`, {
      max_connections: 40,
      allowed_updates: ['message', 'callback_query']
    });
    
    console.log('✅ Webhook successfully set');
    return true;
  } catch (error) {
    if (retryCount >= MAX_RETRIES - 1) {
      console.error('❌ Max retries reached for webhook setup');
      throw error;
    }

    const delay = error.response?.parameters?.retry_after 
      ? error.response.parameters.retry_after * 1000 
      : INITIAL_DELAY * (retryCount + 1) + Math.random() * 1000;
    
    console.log(`⏳ Retry after ${delay}ms (Reason: ${error.description || error.message})`);
    await setTimeout(delay);
    return setupWebhook(retryCount + 1);
  }
}

// Функция проверки и освобождения порта
async function ensurePortIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${port} is in use, waiting to free it...`);
        setTimeout(resolve, 2000); // Даем время старому процессу завершиться
      }
    });
    server.once('listening', () => {
      server.close();
      resolve();
    });
    server.listen(port);
  });
}

// Функция запуска сервера
async function startServer(retryCount = 0) {
  try {
    if (process.env.NODE_ENV === 'production') {
      await setupWebhook();
      
      // Убеждаемся, что порт свободен
      await ensurePortIsFree(PORT);

      // Запускаем webhook сервер
      await bot.launch({
        webhook: {
          domain: WEBHOOK_DOMAIN,
          port: PORT,
          hookPath: '/webhook',
          tlsOptions: null
        }
      });
      
      console.log(`🚀 Bot running in webhook mode on port ${PORT}`);
      console.log(`🌐 Webhook URL: https://${WEBHOOK_DOMAIN}/webhook`);
      
      // Keep-alive для Render
      setInterval(async () => {
        try {
          await fetch(`https://${WEBHOOK_DOMAIN}/health`);
        } catch (e) {
          console.log('Keep-alive ping failed (normal for free tier)');
        }
      }, 4 * 60 * 1000);
    } else {
      await bot.launch();
      console.log('🔍 Bot running in polling mode');
    }
    
    console.log('🤖 Bot is fully operational');
  } catch (error) {
    if (error.code === 429 && retryCount < MAX_RETRIES) {
      const delay = error.response?.parameters?.retry_after 
        ? error.response.parameters.retry_after * 1000 
        : INITIAL_DELAY * (retryCount + 1) + Math.random() * 1000;
      
      console.log(`⏳ Bot launch failed with 429, retrying after ${delay}ms`);
      await bot.stop(); // Останавливаем бота перед повторной попыткой
      await setTimeout(delay);
      return startServer(retryCount + 1);
    } else if (error.code === 'EADDRINUSE' && retryCount < MAX_RETRIES) {
      console.log(`⏳ Port ${PORT} is in use, retrying after delay...`);
      await bot.stop(); // Останавливаем бота
      await setTimeout(INITIAL_DELAY * (retryCount + 1));
      return startServer(retryCount + 1);
    }
    
    console.error('💥 Failed to start bot:', error);
    process.exit(1);
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
  setupShutdownHandlers();
  await startServer();
})();