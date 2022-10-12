import { VoiceBasedChannel } from "discord.js";

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
