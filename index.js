/**
 * 🤖 Discord Bot Runner
 * Hospede no Railway (railway.app) para manter seus bots 24/7
 */

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ⚙️ Cole seus dados do Base44 aqui
const API_URL = 'https://api.base44.com/v1';
const APP_ID = 'SEU_APP_ID';
const API_KEY = 'SUA_API_KEY';
const CHECK_INTERVAL_SECONDS = 30;

// 📋 Comandos do bot (adicione mais aqui)
const COMMANDS = {
  ping: {
    name: 'ping', description: 'Verifica se o bot está online',
    execute: async (interaction) => {
      await interaction.reply(`🏓 Pong! ${Math.round(interaction.client.ws.ping)}ms`);
    },
  },
  serverinfo: {
    name: 'serverinfo', description: 'Informações do servidor',
    execute: async (interaction) => {
      const g = interaction.guild;
      await interaction.reply({ embeds: [{
        title: `📊 ${g.name}`,
        fields: [
          { name: 'Membros', value: String(g.memberCount), inline: true },
          { name: 'Canais', value: String(g.channels.cache.size), inline: true },
        ],
        color: 0x7c4dff,
      }]});
    },
  },
  help: {
    name: 'help', description: 'Lista comandos',
    execute: async (interaction) => {
      await interaction.reply({ embeds: [{
        title: '📋 Comandos',
        description: Object.values(COMMANDS).map(c => `/${c.name} — ${c.description}`).join('\n'),
        color: 0x7c4dff,
      }]});
    },
  },
};

// 🔌 API Base44
const headers = { 'Content-Type': 'application/json', 'x-app-id': APP_ID, 'x-api-key': API_KEY };

async function base44Get(entity, filter = {}) {
  const res = await fetch(`${API_URL}/entities/${entity}/list`, {
    method: 'POST', headers, body: JSON.stringify({ filter, limit: 100 }),
  });
  const data = await res.json();
  return data.records || [];
}

async function base44Update(entity, id, data) {
  await fetch(`${API_URL}/entities/${entity}/${id}`, {
    method: 'PUT', headers, body: JSON.stringify(data),
  });
}

// 🤖 Gerenciador de bots
const activeBots = new Map();

async function getActiveBotProfiles() {
  const bots = await base44Get('BotProfile', {});
  const users = await base44Get('UserPlan', {});
  return bots.map(bot => ({
    ...bot,
    plan: (users.find(p => p.user_id === bot.user_id) || {}).plan || 'free',
  }));
}

function shouldBeOnline(bot) {
  if (bot.plan === 'pro' || bot.plan === 'admin') return true;
  if (bot.status !== 'online') return false;
  return new Date(bot.uptime_expires_at || 0) > new Date();
}

async function startBot(botData) {
  if (activeBots.has(botData.id)) return;
  console.log(`🚀 Iniciando: ${botData.bot_name || 'Sem nome'}`);

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

  client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} online!`);
    const enabledCommands = Object.values(COMMANDS).map(cmd =>
      new SlashCommandBuilder().setName(cmd.name).setDescription(cmd.description).toJSON()
    );
    try {
      const rest = new REST({ version: '10' }).setToken(botData.bot_token);
      await rest.put(Routes.applicationCommands(client.user.id), { body: enabledCommands });
      console.log(`📋 Comandos registrados`);
    } catch (err) { console.error('Erro comandos:', err.message); }
    await base44Update('BotProfile', botData.id, { status: 'online', error_message: '' });
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = COMMANDS[interaction.commandName];
    if (cmd) await cmd.execute(interaction).catch(() => {});
  });

  client.on('error', async (err) => {
    await base44Update('BotProfile', botData.id, { status: 'error', error_message: err.message });
  });

  await client.login(botData.bot_token);
  activeBots.set(botData.id, client);
}

async function stopBot(botId) {
  const client = activeBots.get(botId);
  if (!client) return;
  client.destroy();
  activeBots.delete(botId);
  await base44Update('BotProfile', botId, { status: 'offline', error_message: '' });
}

// 🔄 Loop de verificação
async function checkLoop() {
  console.log(`🔍 [${new Date().toLocaleTimeString('pt-BR')}] Verificando...`);
  const bots = await getActiveBotProfiles();
  for (const bot of bots) {
    const online = shouldBeOnline(bot);
    if (online && !activeBots.has(bot.id)) await startBot(bot);
    else if (!online && activeBots.has(bot.id)) await stopBot(bot.id);
  }
  for (const [id] of activeBots) {
    if (!bots.find(b => b.id === id)) await stopBot(id);
  }
  console.log(`📊 Bots ativos: ${activeBots.size}`);
}

console.log('🤖 Discord Bot Runner iniciado!');
checkLoop();
setInterval(checkLoop, CHECK_INTERVAL_SECONDS * 1000);
