/**
 * 🤖 Discord Bot Runner
 * Hospede no Railway (railway.app) para manter seus bots 24/7
 */

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// ⚙️ Configurações do Base44 (Lê do Railway se existirem)
const API_URL = 'https://api.base44.com/v1';
const APP_ID = process.env.APP_ID || 'SEU_APP_ID';
const API_KEY = process.env.API_KEY || 'SUA_API_KEY';
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

// Cabeçalhos de autenticação oficiais do Base44
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`, // Autenticação padrão Base44 /v1
  'x-app-id': APP_ID                    // Identificador do seu aplicativo
};

async function base44Get(entity) {
  try {
    // URL oficial do Base44 para listar registros de uma entidade
    const url = `${API_URL}/entities/${entity}`;
    
    const res = await fetch(url, {
      method: 'GET',
      headers: headers
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`⚠️ Erro na resposta do Base44 (Status ${res.status}):`);
      console.error(errorText.substring(0, 300));
      return [];
    }

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      // Extrai os registros lidando com os diferentes formatos de retorno (array puro, records, etc)
      return Array.isArray(data) ? data : (data.records || data.items || data.data || []);
    } catch (jsonErr) {
      console.error(`⚠️ O Base44 retornou um conteúdo que não é JSON válido:`);
      console.error(text.substring(0, 300));
      return [];
    }
  } catch (err) {
    console.error(`⚠️ Erro ao conectar com o Base44 (${entity}):`, err.message);
    return [];
  }
}

async function base44Update(entity, id, data) { 
  try {
    // URL oficial para atualizar um registro de entidade por ID
    const url = `${API_URL}/entities/${entity}/${id}`;
    
    const res = await fetch(url, {
      method: 'PATCH', // O Base44 utiliza PATCH para atualizações parciais
      headers: headers,
      body: JSON.stringify(data),
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`⚠️ Erro ao atualizar ${entity} (Status ${res.status}):`, errorText.substring(0, 200));
    }
  } catch (err) {
    console.error(`⚠️ Erro de rede ao tentar atualizar ${entity}:`, err.message);
  }
}

// 🤖 Gerenciador de bots
const activeBots = new Map();

async function getActiveBotProfiles() {
  const bots = await base44Get('BotProfile');
  const users = await base44Get('UserPlan');
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

  try {
    await client.login(botData.bot_token);
    activeBots.set(botData.id, client);
  } catch (loginErr) {
    console.error(`⚠️ Erro ao tentar logar o bot "${botData.bot_name}":`, loginErr.message);
    await base44Update('BotProfile', botData.id, { status: 'error', error_message: 'Token inválido ou erro de login' });
  }
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
  try {
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
  } catch (loopErr) {
    console.error("⚠️ Erro durante a execução do loop de verificação:", loopErr.message);
  }
}

console.log('🤖 Discord Bot Runner iniciado!');
checkLoop();
setInterval(checkLoop, CHECK_INTERVAL_SECONDS * 1000);
