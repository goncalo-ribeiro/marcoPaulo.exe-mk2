import fs from 'fs';
import {EventEmitter} from 'events';
const eventEmitter = new EventEmitter();

import  {ActionRowBuilder, ChatInputCommandInteraction, ChannelType, REST, SlashCommandBuilder, Routes, Client, GuildMember, Channel, TextChannel, EmbedBuilder, ButtonBuilder, ButtonStyle, InteractionReplyOptions, ButtonInteraction, VoiceBasedChannel } from 'discord.js';
import {
    AudioPlayer,
	AudioPlayerStatus,
	entersState,
	joinVoiceChannel,
	VoiceConnectionStatus,
    StreamType, createAudioPlayer, createAudioResource, getVoiceConnection, VoiceConnection, demuxProbe,
} from '@discordjs/voice';
import {YTVideo, AddYoutubeVideoResponse, YoutubeURLPlaylistInfo, ShuffleResponse} from './types';
import {validateURL, getURLVideoID, getBasicInfo} from 'ytdl-core';
import { exec as ytdl } from 'youtube-dl-exec';
import {PlaylistMetadataResult, search} from 'yt-search'

let token : string | undefined, nvideaID : string | undefined, tarasManiasID : string | undefined, gandiniFunClubID : string | undefined;
try {
    const auth = require('../auth.json');
    token = auth.token;
    nvideaID = auth.nvideaID;
    tarasManiasID = auth.tarasManiasID;
    gandiniFunClubID = auth.gandiniFunClubID;
} catch (error) {
    token = process.env.token;
    nvideaID = process.env.nvideaID;
    tarasManiasID = process.env.tarasManiasID;
    gandiniFunClubID = process.env.gandiniFunClubID;
}

let player : AudioPlayer;
let connection: VoiceConnection | undefined;
let queuedVideos: YTVideo[] = [];

const client = new Client({ intents: ['GuildVoiceStates', 'GuildMessages', 'Guilds'] });

client.login(token);

client.on('ready', async function (evt) {
    console.log('Ready!');

    // registerSlashCommands(client.user?.id, nvideaID!, token!);
    // registerSlashCommands(client.user?.id, tarasManiasID!, token!);
    // registerSlashCommands(client.user?.id, gandiniFunClubID!, token!);
})

client.on('voiceStateUpdate', (oldState, newState) =>{
    console.log('voiceStateUpdate')
    const botID = '760202834364334151';
    const serverID = nvideaID
    
    //someone DC'd
    if (oldState.channelId && !newState.channelId){
        if(newState.id === botID){  //bot dc'd
            console.log('bot disconnected')
            destroyConnection()
            return
        }
    }

    if (!(nvideaID && gandiniFunClubID)) {        //check if update happened on the nvidea server
        return
    }
    const nvideaVoiceChannel = client.guilds.cache.get(nvideaID)?.voiceStates.cache.get(botID)?.channel;
    const gandiniFunClubVoiceChannel = client.guilds.cache.get(gandiniFunClubID)?.voiceStates.cache.get(botID)?.channel;
    let botVoiceChannel = (nvideaVoiceChannel ? nvideaVoiceChannel : gandiniFunClubVoiceChannel)
    //console.log(botVoiceChannel)
    if(!botVoiceChannel){   //check if update happened on the same voice channel
        return
    }
    console.log('voice channel size: ' + botVoiceChannel?.members.size);
    if(botVoiceChannel?.members.size === 1){    //disconnect if left alone
        connection?.disconnect()
        // disconnect()
        return
    }
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
            connection?.disconnect()
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
        connection?.disconnect()
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
    let response : AddYoutubeVideoResponse = {videoSearch: false, message: '', searchVideoList: null, next: false}
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

    const inputUrl : string | null = (interaction.isChatInputCommand()) ? interaction.options.getString('url') : interaction.customId.split(" ")[0];
    const inputNext : boolean | null =  (interaction.isChatInputCommand()) ? interaction.options.getBoolean('next') : (interaction.customId.split(" ")[1] === 'true');
    response.next = (inputNext) ? true : false;
    console.log('parameter "next": ', response.next)

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

        //not a playlist, as such will search for videos using the user input as a query term
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
                console.log('error retrieving playlist info!')
                response.message = 'Invalid Playlist /caburro'
                console.log(response)
                return response
            }

            console.log( 'playlist title: ' + list.title )
            if(response.next){   //adding to the top of the queue
                for(let i = list.videos.length - 1; i >= 0; i--){
                    const video = list.videos[i];
                    const url = 'https://www.youtube.com/watch?v=' + video.videoId;
                    // queuedVideos.unshift({url: url, title: video.title, textChannelId: interaction.channelId, voiceChannel: voiceChannel, guildId: guildId, requestedBy: interaction.member?.user.username!})
                    queuedVideos.splice(1, 0, {url: url, title: video.title, textChannelId: interaction.channelId, voiceChannel: voiceChannel, guildId: guildId, requestedBy: interaction.member?.user.username!})
                }
            }else{  //adding to the bottom of the queue
                for (let i = 0; i < list.videos.length; i++) {
                    const video = list.videos[i];
                    const url = 'https://www.youtube.com/watch?v=' + video.videoId;
                    queuedVideos.push({url: url, title: video.title, textChannelId: interaction.channelId, voiceChannel: voiceChannel, guildId: guildId, requestedBy: interaction.member?.user.username!})
                }
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

    const newVideo : YTVideo = {url: url, title: title, textChannelId: interaction.channelId, voiceChannel: voiceChannel, guildId: guildId, requestedBy: interaction.member?.user.username!}
    if(!response.next) {queuedVideos.push(newVideo)}
    else {queuedVideos.splice(1, 0, newVideo)}
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

function destroyConnection(){
    console.log('destroying connection...')
    player?.stop()
    player?.removeAllListeners();
    queuedVideos = [];
    connection?.destroy()
}

async function showQueue (offset : number = 0) : Promise<InteractionReplyOptions>{
    console.log('offset: ', offset)
    const auxQueue = queuedVideos.slice(1)
    //empty queue
    if(!auxQueue.length){
        return {content: 'There are no videos queued.', components: [], embeds: []};
    }
    //offset passed queue length
    if (offset >= auxQueue.length) {
        offset = auxQueue.length - 9
        // return {content: 'There are no videos queued past this point.', components: [], embeds: []};
    }

    //not empty queue
    let embedDescription = ''
    let buttonArray: ButtonBuilder[] = [];

    //check previous queue button
    if (offset > 0) {
        const newOffset : number = (offset < 10) ? 0 : offset - 10
        buttonArray.push(new ButtonBuilder().setCustomId(newOffset + "").setLabel('Previous page').setStyle(ButtonStyle.Primary))
    }

    for (let i = offset; i < auxQueue.length && i <= (offset + 10); i++) {
        if(i === offset + 10){
            buttonArray.push(new ButtonBuilder().setCustomId((offset + 10) + "").setLabel('Next page').setStyle(ButtonStyle.Primary))
        }else{
            const video = auxQueue[i];
            // console.log(queuedVideos)
            embedDescription += (`${i + 1} - **${video.title}** (requested by **${video.requestedBy}**)\n`)
        }
    }
    const embed = new EmbedBuilder().setColor(0x0099FF).setTitle('Video Queue (' + auxQueue.length + ' videos in total)').setDescription(embedDescription);

    if (buttonArray.length) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttonArray)
        return {embeds: [embed], components: [row]}
    }
    return {embeds: [embed]}
}

function shuffleQueue() : ShuffleResponse {
    if (queuedVideos.length > 0){
        shuffle(queuedVideos)
        return{shuffled: true, reply: 'The queue was shuffled 👍 Showing the first ten videos:'}
    }
    return{shuffled: false, reply: 'There are no videos queued 😳'}
}

client.on('interactionCreate', async interaction => {
    console.log('new interaction!')
    //console.log(interaction)

    // In case a video is searched and selected though the embed buttons
    if (interaction.isButton()){
        const queueOffset = Number(interaction.customId)

        if(isNaN(queueOffset)){     //interaction.customId = youtube video ID search result
            addURLToQueue(interaction).then( (resposta) => {
                if(!resposta.videoSearch){
                    interaction.update({ content: resposta.message, components: [], embeds: [] });
                }
            });
        }else{                      //interaction.customId = showQueue offset 
            showQueue(queueOffset).then((reply) => {
                interaction.update({embeds: reply.embeds, components: reply.components, content: reply.content})
            })
            
        }
        return;
    } 

	if (!interaction.isChatInputCommand()) return;

	const { commandName } = interaction;
    console.log(commandName)

	if (commandName === 'play') {
        await interaction.deferReply();
        addURLToQueue(interaction).then( async (resposta) => {
            //console.log('resposta', resposta)
            if(!resposta.videoSearch){
                console.log('no video search')
                await interaction.editReply(resposta.message);
                console.log('end')
                return
            }else{
                const videoSearchInteractionReply = videoSearchInteractionBuilder(resposta)
                if(!videoSearchInteractionReply){
                    await interaction.editReply('There was an error processing the video search (input term: ' + interaction.options.getString('url') + ')');
                    return
                }
                await interaction.editReply(videoSearchInteractionReply)
                return
            }
        })
        return;
	} else if (commandName === 'queue') {
        const inputStart = interaction.options.getNumber('start')
        const start = inputStart ? (inputStart - 1) : 0
		showQueue(start).then( (reply) => {
            interaction.reply(reply);
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
        // disconnect()
        connection?.disconnect()
        interaction.reply('Disconnecting... 👋');
        return;
    }else if (commandName === 'shuffle') {
        await interaction.deferReply();
        await interaction.editReply('Shuffling current queue...');
        const shuffleResponse = shuffleQueue()
        await interaction.editReply(shuffleResponse.reply);
        if(shuffleResponse.shuffled){
            showQueue(0).then( async (reply) => {
                await interaction.followUp(reply);
                // interaction.reply(reply);
            })
        }
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
        buttonArray.push(new ButtonBuilder().setCustomId(searchResult.url + ' ' + response.next).setLabel(''+ (i+1)).setStyle(ButtonStyle.Primary))
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
        new SlashCommandBuilder().setName('play').setDescription('Type a youtube URL (or search term) to play its audio on your current voice channel').
        addStringOption(option =>
            option.setName('url').setDescription('The Youtube URL (or search term) whose audio will play').setRequired(true)).
        addBooleanOption(option =>
            option.setName('next').setDescription('Add this video/playlist to the top of the queue (default: false)').setRequired(false)),
        new SlashCommandBuilder().setName('queue').setDescription('Check queued videos')
        .addNumberOption(option =>
            option.setName('start').setDescription('The starting postion from which the queue will be printed').setRequired(false)),
        new SlashCommandBuilder().setName('clear').setDescription('Clear').
        addSubcommand(subcommand =>
            subcommand.setName('queue').setDescription('Clear the current video queue')),
        new SlashCommandBuilder().setName('pause').setDescription('Pause current video'),
        new SlashCommandBuilder().setName('resume').setDescription('Resume current video'),
        new SlashCommandBuilder().setName('skip').setDescription('Skip current video'),
        new SlashCommandBuilder().setName('disconnect').setDescription('Disconnect Bot, clear queue'),
        new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle current queue')
    ]

    .map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
        // .then((data) => console.log(`Successfully registered ${data.length} application commands.`))
        .then((data) => console.log(`Successfully registered application commands.`))
        .catch(console.error);
}

function shuffle<T>(array: T[]) {
    let currentIndex = array.length,  randomIndex;
  
    // While there remain elements to shuffle.
    while (currentIndex != 0) {
  
      // Pick a remaining element.
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex--;
  
      // And swap it with the current element.
      [array[currentIndex], array[randomIndex]] = [
        array[randomIndex], array[currentIndex]];
    }
  
    return array;
  }