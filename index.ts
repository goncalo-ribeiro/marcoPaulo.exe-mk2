import fs from 'fs';
import {EventEmitter} from 'events';
const eventEmitter = new EventEmitter();

import  {ChatInputCommandInteraction, ChannelType, REST, SlashCommandBuilder, Routes, Client, Interaction, GuildMember, Channel, TextChannel, EmbedBuilder } from 'discord.js';
import {
	AudioPlayerStatus,
	AudioResource,
	entersState,
	joinVoiceChannel,
	VoiceConnectionStatus,
    StreamType, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnection
} from '@discordjs/voice';
import {YTVideos} from './types';
import {validateURL, getURLVideoID, getBasicInfo} from 'ytdl-core';
import { exec as ytdl } from 'youtube-dl-exec';
import { disconnect } from 'process';

let token, nvideaID : string | undefined, tarasManiasID : string | undefined ;
try {
    const auth = require('../auth.json');
    token = auth.token;
    nvideaID = auth.nvideaID;
    tarasManiasID = auth.tarasManiasID;
} catch (error) {
    token = process.env.token;
    nvideaID = process.env.nvideaID;
    tarasManiasID = process.env.tarasManiasID;
}

const player = createAudioPlayer();
setupAudioPlayer();
let connection: VoiceConnection | undefined;
let queuedVideos: YTVideos[] = [];

const client = new Client({ intents: ['GuildVoiceStates', 'GuildMessages', 'Guilds'] });

client.login(token);

client.on('ready', async function (evt) {
    console.log('Ready!');

    // registerSlashCommands(client.user?.id, nvideaID, token);
})

client.on('voiceStateUpdate', (oldState, newState) =>{
    console.log('voiceStateUpdate')

    const botID = '760202834364334151';
    const serverID = nvideaID
    if (!serverID) {
        return
    }
    const botVoiceChannel = client.guilds.cache.get(serverID)?.voiceStates.cache.get(botID)?.channel;
    if(!botVoiceChannel){
        return
    }
    console.log(botVoiceChannel?.members.size);
    if(botVoiceChannel?.members.size === 1){
        connection?.destroy()
    }
    
    //someone DC'd
    // if (oldState.channelId && !newState.channelId){
    // }
} )

eventEmitter.on('new video', () => {
    console.log('new video event', queuedVideos[queuedVideos.length-1]?.url)

    connection = getVoiceConnection(queuedVideos[0].guildId);
    if(!connection){
        console.log('no previous connection creating new connection')
        const channel = queuedVideos[0].voiceChannel;
        connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });
        playNextVideo(connection)
    }
});

process.on('exit', () => {
    if(connection){
        connection.destroy()
    }
})

function setupAudioPlayer(){
    player.on(AudioPlayerStatus.Playing, () => {
        console.log('playing video');
        
        const channel: Channel | undefined = client.channels.cache.get(queuedVideos[0].textChannelId)!;
        if(!channel) return;
        if (!((channel): channel is TextChannel => channel.type === ChannelType.GuildText)(channel)) return;

        channel?.send('Now playing: ' + queuedVideos[0].url  + ' (requested by: **' + queuedVideos[0].requestedBy + '**)')
    })

    player.on(AudioPlayerStatus.Idle, () => {
        console.log('audio player idle')
        let connection: VoiceConnection | undefined = getVoiceConnection(queuedVideos[0].guildId);
        if(!connection) return;

        queuedVideos.shift();
        if(queuedVideos.length > 0){
            playNextVideo(connection)
        }
    });
}

async function addURLToQueue(interaction : ChatInputCommandInteraction){
    // console.log(interaction)
    const guildId = interaction.guildId;
    if(!guildId) return ('Please use the command in a server.')
    const inputUrl : string | null = interaction.options.getString('url');

    // let regexResult = 0;
    // const youtubeRegex = /^((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?$/
    // regexResult = url.match(youtubeRegex)
    //console.log(regexResult)

    if(!inputUrl) return ('Please type a valid youtube URL /caburro!')
    const validUrl = validateURL(inputUrl)

    if(!validUrl)
        return 'Please type a valid youtube URL /caburro!'

    const videoId = getURLVideoID(inputUrl);
    const url = 'https://www.youtube.com/watch?v=' + videoId;
    let title = url;
    try {
        const info = await getBasicInfo(url);
        console.log(info.player_response.videoDetails.title)
        title = info.player_response.videoDetails.title;
    } catch (error) {
        console.log(error)
        return 'There was an error retrieving the data from this video.'
    }

    const guildMember = interaction.member;
    if(!guildMember || !(guildMember instanceof GuildMember)) return ('User isn\'t a part of any server.')
    
    const voiceChannel = guildMember.voice.channel
    if(!voiceChannel) return 'You must be on a voice channel to add a video to the queue  /caburro!';

    queuedVideos.push({url: url, title: title, textChannelId: interaction.channelId, voiceChannel: voiceChannel, guildId: guildId, requestedBy: interaction.member?.user.username!})
    eventEmitter.emit('new video');

    const numberOfQueuedVideos = (queuedVideos.length - 1)
    const auxString = (numberOfQueuedVideos === 1)  ? (numberOfQueuedVideos + ' video') : (numberOfQueuedVideos + ' videos')
    return ('Video added to queue: **' + title + '** (' + auxString +' ahead)')
}

async function playNextVideo (connection: VoiceConnection){
    const process = ytdl(
        queuedVideos[0].url,
        {
            output: '-',
            // quiet: true,
            format: 'ba',
            // audioFormat: 'mp3',
            verbose: true,
            // limitRate: '1M',
        }
        ,{ stdio: ['ignore', 'pipe', 'ignore'] },
    );
    if (!process.stdout) {
        console.log('no process.stdout')
        return;
    }

    const stream = process.stdout;
    const audioResource = createAudioResource(stream);
    player.play(audioResource);
    
    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        connection.subscribe(player);
    } catch (error) {
        connection.destroy();
        throw error;
    }
}

async function showQueue (){
    if(!queuedVideos.length){
        return 'There are no videos queued.'
    }
    let returnString = ''
    for (let i = 0; i < queuedVideos.length && i <= 10; i++) {
        if(i === 10){
            returnString += "..."
        }else{
            const video = queuedVideos[i];
            console.log(queuedVideos)
            returnString += (`${i + 1} - **${video.title}** (requested by **${video.requestedBy}**)\n`)
        }
    }
    return returnString
}

client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) return;

	const { commandName } = interaction;
    const interactionUserId = interaction.member?.user.id;

	if (commandName === 'play') {
        addURLToQueue(interaction).then( (resposta) => {
            console.log('resposta', resposta)
            interaction.reply(resposta);
        })
        return;
	} else if (commandName === 'queue') {
		showQueue().then( (resposta) => {
            console.log('resposta', resposta)

            const embed = new EmbedBuilder().setColor(0x0099FF).setTitle('Video Queue').setDescription(resposta);

            interaction.reply({ephemeral: false, embeds: [embed] });
        })
	} else if (commandName === 'clear') {
        queuedVideos.splice(1);
        interaction.reply('Queue cleared 🚮');
        return;
	} else if (commandName === 'pause') {
        player.pause()
        interaction.reply('Pausing current track... ⏸');
        return;
    } else if (commandName === 'resume') {
        player.unpause()
        interaction.reply('Resuming current track... ▶');
        return;
    }else if (commandName === 'skip') {
        player.stop()
        interaction.reply('Skipping to next track... ⏭');
        return;
    } else if (commandName === 'disconnect') {
        player.stop()
        queuedVideos = [];
        connection?.destroy()
        interaction.reply('Disconnecting... 👋');
        return;
    }

});

function registerSlashCommands(clientId: string | undefined, guildId: string, token: string){
    if(!clientId) {
        console.log('clientId is null, impossible to register application commands');
        return;
    }

    const commands = [
        new SlashCommandBuilder().setName('play').setDescription('Type a youtube URL to play its audio on your current voice channel').
        addStringOption(option =>
            option.setName('url').setDescription('The URL whose audio will play').setRequired(true)),
        new SlashCommandBuilder().setName('queue').setDescription('Check queued videos'),
        new SlashCommandBuilder().setName('clear').setDescription('Clear').
        addSubcommand(subcommand =>
            subcommand.setName('queue').setDescription('Clear the current video queue')),
        new SlashCommandBuilder().setName('pause').setDescription('Pause current video'),
        new SlashCommandBuilder().setName('resume').setDescription('Resume current video'),
        new SlashCommandBuilder().setName('skip').setDescription('Skip current video'),
        new SlashCommandBuilder().setName('disconnect').setDescription('Disconnect Bot, clear queue')
    ]

    .map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
        // .then((data) => console.log(`Successfully registered ${data.length} application commands.`))
        .then((data) => console.log(`Successfully registered application commands.`))
        .catch(console.error);
}