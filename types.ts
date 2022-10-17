import { ActionRowBuilder, AnyComponentBuilder, APIActionRowComponent, APIMessageActionRowComponent, EmbedBuilder, MessageActionRowComponentBuilder, MessageActionRowComponentData, VoiceBasedChannel } from "discord.js";
import { VideoSearchResult } from "yt-search";

export interface YTVideos {
	url: string;
	title: string;
    textChannelId: string;
    guildId: string;
    voiceChannel: VoiceBasedChannel,
	requestedBy: string,
	// onStart: () => void;
	// onFinish: () => void;
	// onError: (error: Error) => void;
}

export interface AddYoutubeVideoResponse {
	videoSearch: boolean;
	message: string;
	searchVideoList: VideoSearchResult[] | null;
}