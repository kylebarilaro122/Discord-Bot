const { Client, GatewayIntentBits, Partials, PermissionsBitField, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const config = require('/home/container/config');
let keyList = require('/home/container/keylist'); // Load key list
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

const BUYER_ROLE_ID = '1350308568498442312'; // Buyer role ID

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// Convert time string to expiration date
function parseExpirationTime(timeStr) {
  const currentTime = new Date();
  if (timeStr === 'L') return 'L'; // Lifetime, no expiration

  const regex = /(\d+)(hr|day)/;
  const match = timeStr.match(regex);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2];
    if (unit === 'hr') {
      currentTime.setHours(currentTime.getHours() + value);
    } else if (unit === 'day') {
      currentTime.setDate(currentTime.getDate() + value);
    }
    return currentTime;
  }
  return null;
}

// Periodically check for expired keys and remove them
function checkExpiredKeys() {
  const currentTime = new Date();
  keyList.redeemedKeys = keyList.redeemedKeys.filter(entry => {
    if (entry.expiration === 'L') return true;
    return new Date(entry.expiration) > currentTime;
  });
  fs.writeFileSync('./keylist.js', `module.exports = ${JSON.stringify(keyList, null, 2)};`);
}

setInterval(checkExpiredKeys, 3600000); // Check every hour

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Register Slash Command (for /redeem)
const commands = [
  new SlashCommandBuilder().setName('redeem').setDescription('Redeem a key and get the Buyer role')
    .addStringOption(option =>
      option.setName('key')
        .setDescription('The key to redeem')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('duration')
        .setDescription('Duration of the key (e.g., 24hr, L for Lifetime)')
        .setRequired(true)),
  // Add other commands here if needed
]
  .map(command => command.toJSON());

const rest = new REST({ version: '9' }).setToken(config.token);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');

    // Register commands for the specific guild
    await rest.put(
      Routes.applicationGuildCommands(config.applicationId, config.guildId),
      { body: commands }
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'redeem') {
    const key = interaction.options.getString('key');
    const timeStr = interaction.options.getString('duration');

    if (!key || !timeStr) {
      return interaction.reply('❌ Usage: /redeem <key> <duration>. Example: `/redeem abc123 24hr` or `/redeem abc123 L`');
    }

    // Check if key has already been redeemed
    const existing = keyList.redeemedKeys.find(entry => entry.key === key);
    if (existing) {
      return interaction.reply('❌ This key has already been redeemed.');
    }

    const expirationTime = parseExpirationTime(timeStr);
    if (!expirationTime) {
      return interaction.reply('❌ Invalid time format. Use something like `24hr`, `7day`, or `L` for Lifetime.');
    }

    // Add to key list
    keyList.redeemedKeys.push({
      user: interaction.user.id,
      key: key,
      expiration: expirationTime
    });

    // Save to file
    fs.writeFileSync('./keylist.js', `module.exports = ${JSON.stringify(keyList, null, 2)};`);

    try {
      // Assign the Buyer role
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.roles.add(BUYER_ROLE_ID);
      interaction.reply(`✅ **Key redeemed!** You've been given the Buyer role.\n🕒 Expires: ${timeStr === 'L' ? 'Lifetime' : expirationTime.toLocaleString()}`);
    } catch (error) {
      console.error(error);
      interaction.reply('❌ Key redeemed but failed to assign Buyer role.');
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const { content, channel, member, guild } = message;
  const args = content.split(' ');

  // Nuke Command
  if (args[0] === '.nuke') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply('❌ You do not have permission to nuke channels.');
    }

    const channelId = args[1];
    const channelToNuke = message.guild.channels.cache.get(channelId);

    if (!channelToNuke) return message.reply('❌ Channel not found.');
    if (channelToNuke.type !== 0) return message.reply('❌ Only text channels can be nuked.');

    try {
      const clone = await channelToNuke.clone({
        name: channelToNuke.name,
        topic: channelToNuke.topic,
        nsfw: channelToNuke.nsfw,
        parent: channelToNuke.parent,
        rateLimitPerUser: channelToNuke.rateLimitPerUser,
        permissionOverwrites: channelToNuke.permissionOverwrites.cache.map(overwrite => ({
          id: overwrite.id,
          allow: overwrite.allow.toArray(),
          deny: overwrite.deny.toArray()
        }))
      });

      await clone.setPosition(channelToNuke.position);
      await channelToNuke.delete();

      message.channel.send(`💥 Nuked and recreated <#${clone.id}>`);
    } catch (err) {
      console.error(err);
      message.reply('❌ Failed to nuke the channel.');
    }
  }

  if (args[0] === '.keylist') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return channel.send('❌ You need Administrator permissions.');
    }

    if (keyList.redeemedKeys.length === 0) {
      return channel.send('❌ No keys have been redeemed yet.');
    }

    let keyListMessage = '🗝 **Redeemed Keys List**:\n';
    keyList.redeemedKeys.forEach(entry => {
      const expiration = entry.expiration === 'L' ? 'Lifetime' : new Date(entry.expiration).toLocaleString();
      keyListMessage += `**User:** <@${entry.user}> | **Key:** ${entry.key} | **Expires:** ${expiration}\n`;
    });

    channel.send(keyListMessage);
  }

  if (content.startsWith('.help')) {
    channel.send(
      `**🛠 Bot Commands:**
      🔒 **.lock** - Locks the channel (Admins only).
      🔓 **.unlock** - Unlocks the channel (Admins only).
      🎁 **.give <user_id> <key> <time>** - Gives a user a key (Admins only).
      🔑 **/redeem <key> <duration>** - Redeems a key and assigns the Buyer role.
      🗑 **.take <user_id> <key>** - Removes a key from a user (Admins only).
      🔑 **.keylist** - Lists all redeemed keys.
      ⏳ **.timeout <user_id> <duration>** - Mutes a user (1-60 minutes).
      🚪 **.kick <user_id> <reason (optional)>** - Kicks a user from the server.
      🔨 **.ban <user_id> <reason (optional)>** - Bans a user from the server.
      ❌ **.unban <user_id>** - Unbans a user from the server.
      ⏳ **.untimeout <user_id>** - Removes a timeout from a user.
      ❓ **.help** - Shows this message.
      👤 **.userid <pinged_user>** - Displays the user's ID that you pinged
      📥 **.download** - sends paid exec download link in dms`
    );
    return;
  }
// Redeem Command
if (content.startsWith('/redeem')) {
  const args = content.split(' ');
  const key = args[1];
  const timeStr = args[2];

  if (!key || !timeStr) {
    return message.channel.send('❌ Usage: /redeem <key> <duration>. Example: `/redeem abc123 24hr` or `/redeem abc123 L`');
  }

  // Check if key has already been redeemed
  const existing = keyList.redeemedKeys.find(entry => entry.key === key);
  if (existing) {
    return message.channel.send('❌ This key has already been redeemed.');
  }

  const expirationTime = parseExpirationTime(timeStr);
  if (!expirationTime) {
    return message.channel.send('❌ Invalid time format. Use something like `24hr`, `7day`, or `L` for Lifetime.');
  }

  // Add to key list
  keyList.redeemedKeys.push({
    user: message.member.id,
    key: key,
    expiration: expirationTime
  });

  // Save to file
  fs.writeFileSync('./keylist.js', `module.exports = ${JSON.stringify(keyList, null, 2)};`);

  try {
    await message.member.roles.add(BUYER_ROLE_ID);
    message.channel.send(`✅ **Key redeemed!** You've been given the Buyer role.\n🕒 Expires: ${timeStr === 'L' ? 'Lifetime' : expirationTime.toLocaleString()}`);
  } catch (error) {
    console.error(error);
    message.channel.send('❌ Key redeemed but failed to assign Buyer role.');
  }
}



  if (args[0] === '.userid') {
    const mentionedUser = message.mentions.users.first();

    if (!mentionedUser) {
      return channel.send('❌ You need to mention a user to get their user ID.');
    }

    channel.send(`:response: **${mentionedUser.tag}**'s User ID: **${mentionedUser.id}**`);
  }

  // Lock/Unlock channel Command
  if (args[0] === '.lock' || args[0] === '.unlock') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return channel.send('❌ You need Administrator permissions.');
    }

    const lockState = args[0] === '.lock';
    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: !lockState });
      channel.send(lockState ? 'Channel Locked' : 'Channel Unlocked');
    } catch (error) {
      console.error(error);
      channel.send(`❌ Error ${lockState ? 'locking' : 'unlocking'} the channel.`);
    }
  }
// Download Command
if (args[0] === '.download') {
  if (!member.roles.cache.has(BUYER_ROLE_ID)) {
    return channel.send('❌ You need the **Buyer** role to access the download link.');
  }

  try {
    // Send the download link in a DM to the user
    await member.send('Here is your download link: https://cdn.discordapp.com/attachments/1357908647635718235/1357922490340606113/Bootstrapper.zip?ex=67f1f75e&is=67f0a5de&hm=f4159f002f9d7686ee1029a11d1945f8a5a68cc70ac7eef9e6fcea56d75d2944&');
    channel.send('The Download Link Has Been Sent To Your DMS.');
  } catch (error) {
    console.error(error);
    channel.send('❌ I couldn\'t send you a private message. Make sure your DMs are open.');
  }
}


  // Purge Messages Command
  if (args[0] === '.purge') {
    if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return channel.send('❌ You need **Manage Messages** permission.');
    }

    const amount = parseInt(args[1]);
    if (isNaN(amount) || amount < 1 || amount > 100) {
      return channel.send(' Specify a number between **1 and 100**.');
    }

    try {
      const messages = await channel.messages.fetch({ limit: amount });
      const filteredMessages = messages.filter(msg => (Date.now() - msg.createdTimestamp) < 1209600000);

      if (filteredMessages.size === 0) {
        return channel.send(' No messages found to delete.');
      }

      await channel.bulkDelete(filteredMessages, true);
      channel.send(`Purged  **${filteredMessages.size}** messages.`).then(msg => {
        setTimeout(() => msg.delete().catch(() => {}), 5000);
      });
    } catch (error) {
      console.error(error);
      channel.send(' Error purging messages.');
    }
  }

  // Timeout Command
  if (args[0] === '.timeout') {
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return channel.send('❌ You need Timeout permissions.');
    }

    const userId = args[1];
    const duration = args[2];
    const reason = args.slice(3).join(' ') || 'No reason provided';

    if (!userId || !duration) {
      return channel.send('❌ Usage: .timeout <user_id> <duration> <reason (optional)>');
    }

    const durationRegex = /^(\d+)(m|minutes?)$/;
    const match = duration.match(durationRegex);

    if (!match) {
      return channel.send('❌ Invalid format. Use 10m for 10 minutes.');
    }

    const minutes = parseInt(match[1]);
    if (minutes < 1 || minutes > 60) {
      return channel.send('❌ Duration must be between 1 and 60 minutes.');
    }

    try {
      const targetUser = await guild.members.fetch(userId);
      await targetUser.timeout(minutes * 60 * 1000, reason);
      channel.send(`⏳ **<@${userId}> has been timed out for ${minutes} minutes.**`);
    } catch (error) {
      console.error(error);
      channel.send('❌ Error timing out user.');
    }
  }

  // Give Key Command
  if (args[0] === '.give') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return channel.send('❌ You need Administrator permissions.');
    }

    const userId = args[1];
    const givenKey = args[2];
    const timeStr = args[3];

    if (!userId || !givenKey || !timeStr) {
      return channel.send('❌ Usage: .give <user_id> <key> <time>');
    }

    const expirationTime = parseExpirationTime(timeStr);
    if (!expirationTime) {
      return channel.send('❌ Invalid time format. Use "24hr", "12hr", or "L" for Lifetime.');
    }

    keyList.redeemedKeys.push({ user: userId, key: givenKey, expiration: expirationTime });
    fs.writeFileSync('./keylist.js', `module.exports = ${JSON.stringify(keyList, null, 2)};`);

    channel.channel(`✅ **Key given!** User: <@${userId}> | Key: **${givenKey}** | Expires: ${timeStr}`);
  }

  // Take Key Command
  if (args[0] === '.take') {
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return channel.send('❌ You need Administrator permissions.');
    }

    const userId = args[1];
    const keyToRemove = args[2];

    if (!userId || !keyToRemove) {
      return channel.send('❌ Usage: .take <user_id> <key>');
    }

    keyList.redeemedKeys = keyList.redeemedKeys.filter(entry => !(entry.user === userId && entry.key === keyToRemove));
    fs.writeFileSync('./keylist.js', `module.exports = ${JSON.stringify(keyList, null, 2)};`);

    channel.send(`✅ **Key removed for <@${userId}>** | Key: **${keyToRemove}**`);
  }

  // Kick Command
  if (args[0] === '.kick') {
    if (!member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return channel.send('❌ You need **Kick Members** permission.');
    }

    const userId = args[1];
    const reason = args.slice(2).join(' ') || 'No reason provided';

    try {
      const targetUser = await guild.members.fetch(userId);
      await targetUser.kick(reason);
      channel.send(`🚪 **<@${userId}> has been kicked.** Reason: ${reason}`);
    } catch (error) {
      console.error(error);
      channel.send('❌ Error kicking user.');
    }
  }

  // Ban Command
  if (args[0] === '.ban') {
    if (!member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return channel.send('❌ You need **Ban Members** permission.');
    }

    const userId = args[1];
    const reason = args.slice(2).join(' ') || 'No reason provided';

    try {
      await guild.members.ban(userId, { reason });
      channel.send(`🔨 **<@${userId}> has been banned.** Reason: ${reason}`);
    } catch (error) {
      console.error(error);
      channel.send('❌ Error banning user.');
    }
  }

  // Unban Command
  if (args[0] === '.unban') {
    if (!member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return channel.send('❌ You need **Ban Members** permission.');
    }

    const userId = args[1];

    try {
      await guild.members.unban(userId);
      channel.send(`❌ **<@${userId}> has been unbanned.**`);
    } catch (error) {
      console.error(error);
      channel.send('❌ Error unbanning user.');
    }
  }

  // Untimeout Command
  if (args[0] === '.untimeout') {
    if (!member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return channel.send('❌ You need Timeout permissions.');
    }
    // Redeem Command
    if (content.startsWith('/redeem')) {
      const args = content.split(' ');
      const key = args[1];
      const timeStr = args[2];
      const expirationTime = parseExpirationTime(timeStr);

      if (!key || !expirationTime) {
        return channel.send('❌ Invalid key or time format.');
      }

      keyList.redeemedKeys.push({ user: member.id, key, expiration: expirationTime });
      fs.writeFileSync('./keylist.js', `module.exports = ${JSON.stringify(keyList, null, 2)};`);

      try {
        await member.roles.add(BUYER_ROLE_ID);
        channel.send(`Key Redeemed You Have Been Granted The Buyer Role.`);
      } catch (error) {
        console.error(error);
        channel.send('❌ Error giving the Buyer role.');
      }
    }

    

    const userId = args[1];

    try {
      const targetUser = await guild.members.fetch(userId);
      await targetUser.timeout(null);
      channel.send(`**<@${userId}> timeout has been removed.**`);
    } catch (error) {
      console.error(error);
      channel.send('❌ Error removing timeout from user.');
    }
  }
});

          

client.login(config.token);
