import fs from 'fs';
import {EventEmitter} from 'events';
const eventEmitter = new EventEmitter();

import  {ChatInputCommandInteraction, ChannelType, REST, SlashCommandBuilder, Routes, Client, Interaction, GuildMember, Channel, TextChannel } from 'discord.js';
import {
	AudioPlayerStatus,
	AudioResource,
	entersState,
	joinVoiceChannel,
	VoiceConnectionStatus,
    StreamType, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnection
} from '@discordjs/voice';
import {YTVideos} from './types';
const player = createAudioPlayer();
setupAudioPlayer();
import {validateURL} from 'ytdl-core';
import { exec as ytdl } from 'youtube-dl-exec';

const { token, nvideaID, tarasManiasID } = require('../auth.json');

let queuedVideos: YTVideos[] = [];

const client = new Client({ intents: ['GuildVoiceStates', 'GuildMessages', 'Guilds'] });

client.login(token);

client.on('ready', async function (evt) {
    console.log('Ready!');

    // const subprocess = ytdl('https://www.youtube.com/watch?v=4s7uc_j1Sm0', {
    //     format: 'bestaudio',
    //     // format: 'bestaudio[ext=webm+acodec=opus+asr=48000]/bestaudio',
    //    // dumpSingleJson: true
    // })


    // if (!subprocess.stdout) {
    //     console.log('no process.stdout')
    //     return;
    // }
    // subprocess.stdout.pipe(fs.createWriteStream('stdout.txt'))
    // if (!subprocess.stderr) {
    //     console.log('no process.stdout')
    //     return;
    // }
    // subprocess.stderr.pipe(fs.createWriteStream('stderr.txt'))

    // registerSlashCommands(client.user?.id, nvideaID, token);
})

eventEmitter.on('new video', () => {
    console.log('new video event', queuedVideos[queuedVideos.length-1]?.url)
    VoiceConnectionStatus.Ready

    let connection = getVoiceConnection(queuedVideos[0].guildId);
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

function setupAudioPlayer(){
    player.on(AudioPlayerStatus.Playing, () => {
        console.log('playing video');
        // let info = ytdl.getBasicInfo(queuedVideos[0].url).then(() => {
        //     console.log(info)
        // })
        
        const channel: Channel | undefined = client.channels.cache.get(queuedVideos[0].textChannelId)!;
        if(!channel) return;
        if (!((channel): channel is TextChannel => channel.type === ChannelType.GuildText)(channel)) return;

        channel?.send('Now playing: ' + queuedVideos[0].url)
    })

    player.on(AudioPlayerStatus.Idle, () => {
        console.log('audio player idle')
        let connection: VoiceConnection | undefined = getVoiceConnection(queuedVideos[0].guildId);
        if(!connection) return;

        queuedVideos.shift();
        if(queuedVideos.length > 0)
            playNextVideo(connection)
        else
            connection.destroy()
    });
}

async function addURLToQueue(interaction : ChatInputCommandInteraction){
    // console.log(interaction)
    const guildId = interaction.guildId;
    if(!guildId) return ('Please use the command in a server.')
    const url : string | null = interaction.options.getString('url');

    
    // let regexResult = 0;
    // const youtubeRegex = /^((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?$/
    // regexResult = url.match(youtubeRegex)
    //console.log(regexResult)
    if(!url) return ('Please type a valid youtube URL /caburro!')
    const validUrl = validateURL(url)

    if(!validUrl)
        return 'Please type a valid youtube URL /caburro!'

    
    const guildMember = interaction.member;
    if(!guildMember || !(guildMember instanceof GuildMember)) return ('User isn\'t a part of any server.')
    
    const voiceChannel = guildMember.voice.channel
    
    // let voiceChannel = client.guilds.cache.get(guildId).voiceStates.cache.get(memberId)?.channel;
    // console.log(voiceChannel, voiceChannel2)
    if(!voiceChannel) return 'You must be on a voice channel to add a video to the queue.';

    queuedVideos.push({url: url, textChannelId: interaction.channelId, voiceChannel: voiceChannel, guildId: guildId})
    eventEmitter.emit('new video');
    // console.log(queuedVideos);
    const auxString = (queuedVideos.length - 1)
    return ('Video added to queue (videos ahead: ' + auxString +'): ' + url)
}

function playNextVideo (connection: VoiceConnection){
    let start = Date.now();
    console.log(Date.now() - start + ': starting next video...')
    const process = ytdl(
        queuedVideos[0].url,
        {
            output: '-',
            // quiet: true,
            format: 'bestaudio',
            verbose: true,
            // limitRate: '1M',
        }
        ,{ stdio: ['ignore', 'pipe', 'ignore'] },
    );
    console.log(Date.now() - start + ': video loaded.')
    if (!process.stdout) {
        console.log('no process.stdout')
        return;
    }
    // process.stdout.pipe(fs.createWriteStream('stdout.txt'))
    // if (!process.stderr) {
    //     console.log('no process.stdout')
    //     return;
    // }
    // process.stderr.pipe(fs.createWriteStream('stderr.txt'))

    console.log(Date.now() - start + ': creating stream...')
    const stream = process.stdout;
    // createAudioResource(probe.stream, { metadata: this, inputType: probe.type })
    console.log(Date.now() - start + ': creating audio resource...')
    const audioResource = createAudioResource(stream);
    console.log(Date.now() - start + ': playing audio resource')
    player.play(audioResource);
    console.log(Date.now() - start + ': subscribing player')
    connection.subscribe(player);
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
		await interaction.reply('wip');
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
        queuedVideos.splice(1);
        player.stop()
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