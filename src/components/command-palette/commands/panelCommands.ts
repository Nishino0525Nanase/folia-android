import { ListMusic, Sparkles } from 'lucide-react';
import type { CommandPaletteCommand } from '../types';
import { createPanelCommand, defineCommand } from '../commandFactories';
import { LOCAL_MUSIC_COMMAND_PLATFORMS } from '../../../platform/runtime';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';

// src/components/command-palette/commands/panelCommands.ts
// Commands in the `panel` group: opening the unified side panel on a given tab.

export const panelCommands: CommandPaletteCommand[] = [
    createPanelCommand('cover', 'Panel: cover', 'Open the cover panel tab', ['cover panel', '封面'], undefined, { executeShortcut: 'c' }),
    createPanelCommand('controls', 'Panel: controls', 'Open the controls panel tab', ['controls panel', '控制']),
    createPanelCommand('queue', 'Panel: queue', 'Open the queue panel tab', ['queue panel', '队列'], ListMusic),
    createPanelCommand('account', 'Panel: quality', 'Open the quality panel tab', ['quality panel', 'audio quality', 'account panel', '音质', '账号', '账户']),
    createPanelCommand('local', 'Panel: local', 'Open the local panel tab', ['local panel', '本地面板'], undefined, {}, [...LOCAL_MUSIC_COMMAND_PLATFORMS]),
    createPanelCommand('navi', 'Panel: Navidrome', 'Open the Navidrome panel tab', ['panel navi', 'navi panel', 'navidrome 面板', '服务器面板']),
    createPanelCommand('onlineLyrics', 'Panel: lyrics', 'Open the online lyrics panel tab', ['lyrics panel', '歌词面板']),
    // Opening the controls leaves the model download and audio recognition as an explicit choice.
    defineCommand({ ...createPanelCommand('onlineLyrics', 'Align lyrics to audio', 'Review local recognition and lyric alignment',
        ['speech recognition', 'subtitle timing', '识别人声', '歌词校准', '自动字幕']), id: 'align-lyrics-to-audio',
        isAvailable: context => import.meta.env.FOLIA_LOCAL_ALIGNMENT !== false
            && Boolean(context?.shared.currentSong && getPlaybackSourceRef(context.shared.currentSong).kind === 'online') }),
    createPanelCommand('aiDirector', 'Panel: AI director', 'Open the AI lyric animation director tab', ['ai director', 'ai 导演', '动画导演'], Sparkles),
];
