import fs from 'fs';
import {EventEmitter} from 'events';
const eventEmitter = new EventEmitter();

import  {ActionRowBuilder, ChatInputCommandInteraction, ChannelType, REST, SlashCommandBuilder, Routes, Client, Interaction, GuildMember, Channel, TextChannel, EmbedBuilder, ButtonBuilder, ButtonStyle, AnyComponentBuilder, InteractionReplyOptions, APIActionRowComponent, APIMessageActionRowComponent, ButtonInteraction } from 'discord.js';
import {
    AudioPlayer,
	AudioPlayerStatus,
	AudioResource,
	entersState,
	joinVoiceChannel,
	VoiceConnectionStatus,
    StreamType, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnection, demuxProbe,
} from '@discordjs/voice';
import {YTVideos, AddYoutubeVideoResponse, YoutubeURLPlaylistInfo} from './types';
import {validateURL, getURLVideoID, getBasicInfo} from 'ytdl-core';
import { exec as ytdl } from 'youtube-dl-exec';
import {PlaylistMetadataResult, search} from 'yt-search'

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

let player : AudioPlayer;
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
        disconnect()
    }
    
    //someone DC'd
    // if (oldState.channelId && !newState.channelId){
    // }
} )

eventEmitter.on('new video', async () => {
    console.log('new video event', queuedVideos[queuedVideos.length-1]?.url)

    connection = getVoiceConnection(queuedVideos[0].guildId);
    if(!connection){
        console.log('no previous connection creating new connection')
        setupAudioPlayer();
        const channel = queuedVideos[0].voiceChannel;
        connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });
        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
            connection.subscribe(player);
        } catch (error) {
            console.log(error)
            disconnect()
            throw error;
        }
        console.log('play next video (on new video (new connection))')
        playNextVideo()
    }
    else{
        if(player.state.status === AudioPlayerStatus.Idle){
            console.log('play next video (on new video (AudioPlayerStatus.Idle))')
            playNextVideo()
        }
    }
});

process.on('exit', () => {
    if(connection){
        disconnect()
    }
})

function setupAudioPlayer(){
    player = createAudioPlayer()
    player.on(AudioPlayerStatus.Playing, () => {
        console.log('playing video');
        printQueue();
        
        const channel: Channel | undefined = client.channels.cache.get(queuedVideos[0].textChannelId)!;
        if(!channel) return;
        if (!((channel): channel is TextChannel => channel.type === ChannelType.GuildText)(channel)) return;

        channel?.send('Now playing: ' + queuedVideos[0].url  + ' (requested by: **' + queuedVideos[0].requestedBy + '**)')
    })

    player.on(AudioPlayerStatus.Idle, () => {
        console.log('audio player idle')
        
        queuedVideos.shift();
        if(queuedVideos.length > 0){
            console.log('play next video (on audio player Idle)')
            playNextVideo()
        }
    });
}

async function addURLToQueue(interaction : ChatInputCommandInteraction | ButtonInteraction) : Promise<AddYoutubeVideoResponse>{
    // console.log(interaction)
    const guildId = interaction.guildId;
    let response : AddYoutubeVideoResponse = {videoSearch: false, message: '', searchVideoList: null}
    if(!guildId) {
        response.message = 'Please use the command in a server.'
        return response;
    }

    const guildMember = interaction.member;
    if(!guildMember || !(guildMember instanceof GuildMember)){
        response.message = 'User isn\'t a part of any server.';
        return response;
    } 
    
    const voiceChannel = guildMember.voice.channel
    if(!voiceChannel) {
        response.message = 'You must be on a voice channel to add a video to the queue  /caburro!';
        return response;
    }

    const inputUrl : string | null = (interaction.isChatInputCommand()) ? interaction.options.getString('url') : interaction.customId;

    // let regexResult = 0;
    // const youtubeRegex = /^((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?$/
    // regexResult = url.match(youtubeRegex)
    //console.log(regexResult)

    if(!inputUrl) {
        response.message = 'Please type a valid youtube URL /caburro!'
        return response;
    }
    
    const validUrl = validateURL(inputUrl)
    if(!validUrl){
        const youtubeURLPlaylistInfo = checkIfUrlHasPlaylist(inputUrl)

        //not a playlist, as such will search for using the user input as a query term
        if(!youtubeURLPlaylistInfo.hasPlaylist || !youtubeURLPlaylistInfo.playlistId){
            const results = await search( inputUrl )
            response.searchVideoList = results.videos.slice(0,5);
            if(response.searchVideoList.length === 0){
                response.message = `No videos were found using the term: "${inputUrl}"`;
                return response;
            }
            response.videoSearch = true
            response.message = 'Please select a video from the ones available below:'
            return response;
        }

        //is playlist, will add all the playlist videos to the queue
        else{
            let list : PlaylistMetadataResult;
            try {
                list = await search( { listId: youtubeURLPlaylistInfo.playlistId } )
            } catch (error) {
                console.log(error)
                response.message = 'Invalid Playlist /caburro'
                return response
            }

            console.log( 'playlist title: ' + list.title )
            for (let i = 0; i < list.videos.length; i++) {
                const video = list.videos[i];
                const url = 'https://www.youtube.com/watch?v=' + video.videoId;
                queuedVideos.push({url: url, title: video.title, textChannelId: interaction.channelId, voiceChannel: voiceChannel, guildId: guildId, requestedBy: interaction.member?.user.username!})
            }
            if(list.videos.length > 0){
                eventEmitter.emit('new video');
            }
            response.message = 'Playlist added to queue (' + list.title + ' - **'+ list.videos.length +' videos added**).'
            return response;
        }

    }

    const videoId = getURLVideoID(inputUrl);
    const url = 'https://www.youtube.com/watch?v=' + videoId;
    let title = url;
    try {
        const info = await getBasicInfo(url);
        console.log(info.player_response.videoDetails.title)
        title = info.player_response.videoDetails.title;
    } catch (error) {
        console.log(error)
        response.message = 'There was an error retrieving the data from this video.'
        return response;
    }

    queuedVideos.push({url: url, title: title, textChannelId: interaction.channelId, voiceChannel: voiceChannel, guildId: guildId, requestedBy: interaction.member?.user.username!})
    eventEmitter.emit('new video');

    const numberOfQueuedVideos = (queuedVideos.length - 1)
    const auxString = (numberOfQueuedVideos === 1)  ? (numberOfQueuedVideos + ' video') : (numberOfQueuedVideos + ' videos')
    
    response.message = 'Video added to queue: **' + title + '** (' + auxString +' ahead)'
    return response;
}

async function playNextVideo (){
    console.log('playing next video')
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

    try {
        const probe = await demuxProbe(stream)

        const audioResource = createAudioResource(probe.stream, { inputType: probe.type });
        
        player.play(audioResource);
    
    } catch (error) {
        console.log(error)
        // connection.destroy();
        throw error;
    }
}

function disconnect(){
    console.log('disconnecting...')
    player.stop()
    player.removeAllListeners();
    queuedVideos = [];
    connection?.destroy()
}

async function showQueue (){
    const auxQueue = queuedVideos.slice(1)
    if(!auxQueue.length){
        return 'There are no videos queued.'
    }
    let returnString = ''
    for (let i = 0; i < auxQueue.length && i <= 10; i++) {
        if(i === 10){
            returnString += "..."
        }else{
            const video = auxQueue[i];
            // console.log(queuedVideos)
            returnString += (`${i + 1} - **${video.title}** (requested by **${video.requestedBy}**)\n`)
        }
    }
    return returnString
}

client.on('interactionCreate', async interaction => {
    console.log('new interaction!')
    // console.log(interaction)

    // In case a video is searched and selected though the embed buttons
    if (interaction.isButton()){
        addURLToQueue(interaction).then( (resposta) => {
            if(!resposta.videoSearch){
                interaction.update({ content: resposta.message, components: [], embeds: [] });
            }
        });
        return;
    } 

	if (!interaction.isChatInputCommand()) return;

	const { commandName } = interaction;
    const interactionUserId = interaction.member?.user.id;

	if (commandName === 'play') {
        addURLToQueue(interaction).then( (resposta) => {
            // console.log('resposta', resposta)
            if(!resposta.videoSearch){
                interaction.reply(resposta.message);
                return
            }else{
                const videoSearchInteractionReply = videoSearchInteractionBuilder(resposta)
                if(!videoSearchInteractionReply){
                    interaction.reply('There was an error processing the video search (input term: ' + interaction.options.getString('url') + ')');
                    return
                }
                interaction.reply(videoSearchInteractionReply)
                return
            }
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
        disconnect()
        interaction.reply('Disconnecting... 👋');
        return;
    }

});

function videoSearchInteractionBuilder(response: AddYoutubeVideoResponse) : InteractionReplyOptions | null {
// : YoutubeSearchResponse | null{
    const embedTitle : string = response.message;
    let embedDescription : string = '';
    let buttonArray : ButtonBuilder[] = [];
    if(!response.searchVideoList){
        return null
    }
    for (let i = 0; i < response.searchVideoList.length; i++) {
        const searchResult = response.searchVideoList[i];
        embedDescription += `**${i+1}:** ${searchResult.title} **(${searchResult.timestamp})**\n`
        buttonArray.push(new ButtonBuilder().setCustomId(searchResult.url).setLabel(''+ (i+1)).setStyle(ButtonStyle.Primary))
    }
    const embed = new EmbedBuilder().setColor(0x0099FF).setTitle(embedTitle).setDescription(embedDescription)
    let row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttonArray)
    return {ephemeral: false, embeds: [embed]
        , components:[row]
    }
}

function printQueue(){
    console.log('Printing queue:')
    for (let i = 0; i < queuedVideos.length; i++) {
        const queuedVideo = queuedVideos[i];
        console.log(i + ' - ' + queuedVideo.title + ' (' + queuedVideo.textChannelId + ')')
    }
    console.log('End of queue.')
}

function checkIfUrlHasPlaylist(url : string) : YoutubeURLPlaylistInfo {
    let regexResult;
    const youtubeRegex = /^.*(youtu.be\/|list=)([^#\&\?]*).*/
    regexResult = url.match(youtubeRegex)
    if (!regexResult){
        return {hasPlaylist : false};
    }
    return {hasPlaylist: true, playlistId: regexResult[2]};
}

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