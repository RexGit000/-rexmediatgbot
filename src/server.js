require('dotenv').config();
const express  = require('express');
const connectDB    = require('./db');
const Admin        = require('./models/Admin');
const Settings     = require('./models/Settings');
const adminCache   = require('./cache');
const botState     = require('./services/botState');
const { syncMediaPool } = require('./services/syncService');
const { seedAdmins } = require('./seed');

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const PORT = Number(process.env.port || process.env.PORT || 3000);

// ── Process-level safety nets ─────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

let pingCount = 0;
let lastPingAt = null;

app.get('/ping', (req, res) => {
  pingCount += 1;
  lastPingAt = new Date();
  res.set('Cache-Control', 'no-store');
  res.status(200).send('hello world');
});

app.get('/', (_req, res) => res.redirect('/stats'));

app.get('/stats', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const mem = process.memoryUsage();
  res.status(200).json({
    ok: true,
    now: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    pingCount,
    lastPingAt: lastPingAt ? lastPingAt.toISOString() : null,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
    },
  });
});

// Express error middleware
app.use((err, _req, res, _next) => {
  console.error('[express error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));

// ── Boot ──────────────────────────────────────────────────────────────────────

let bot = null;

async function boot() {
  try {
    await connectDB();

    await seedAdmins();

    // Load admin cache into memory
    const admins = await Admin.find().lean();
    adminCache.set(admins);
    console.log(`Admin cache loaded: ${admins.length} admin(s)`);

    // Load bot on/off state (default true if never set)
    const savedBotState = await Settings.get('botEnabled');
    botState.set(savedBotState !== false);
    console.log(`Bot state: ${botState.get() ? 'enabled' : 'disabled'}`);

    bot = require('./bot');

    // Verify token + get bot identity (plain API call, works before launch)
    const me = await bot.telegram.getMe();
    console.log(`Bot connected: @${me.username} (ID: ${me.id})`);

    // Register bot command menu (the "/" list users see in Telegram)
    await bot.telegram.setMyCommands([
      { command: 'start',  description: '🏠 Welcome & referral rewards'  },
      { command: 'invite', description: '🔗 Get your referral link'       },
      { command: 'stats',  description: '📊 Your stats & tier progress'   },
    ]);
    console.log('Bot commands registered.');

    // Media pool sync — run once on boot, then every 30 minutes
    syncMediaPool(bot).catch((err) => console.error('[sync] Boot run failed:', err));
    setInterval(() => {
      syncMediaPool(bot).catch((err) => console.error('[sync] Periodic run failed:', err));
    }, SYNC_INTERVAL_MS);

    // Graceful shutdown
    process.once('SIGINT',  () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

    // Start long-polling — promise never resolves (infinite loop), so don't await
    bot.launch().catch((err) => {
      if (err?.message !== 'Aborted') console.error('[bot]', err);
    });
  } catch (err) {
    console.error('[boot error]', err.message);
  }
}

boot();
