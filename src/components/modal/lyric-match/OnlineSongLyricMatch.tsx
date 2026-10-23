import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import { getProviderSongMetadata } from '../../../services/onlineMusic/songMetadata';
import { omni } from '../../../services/onlineMusic/omni';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { getMatchResultAlbumName, getMatchResultArtists, getMatchResultCoverUrl } from '../../../utils/lyrics/matchResult';
import { formatSongName } from '../../../utils/songNameFormatter';
import { LyricMatchWindow } from './LyricMatchWindow';
import { pickOnlineResult, saveOnlineLyricMatch } from './onlineSongMatch';
import { useLyricMatchSearch } from './useLyricMatchSearch';

// src/components/modal/lyric-match/OnlineSongLyricMatch.tsx
// The lyric match window for a song of an online platform: only the lyrics are matched.

interface OnlineSongLyricMatchProps {
    song: SongResult;
    onClose: () => void;
    onMatch: () => void | Promise<void>;
    isDaylight: boolean;
}

const OnlineSongLyricMatch: React.FC<OnlineSongLyricMatchProps> = ({ song, onClose, onMatch, isDaylight }) => {
    const { t } = useTranslation();
    const metadata = getProviderSongMetadata(song);

    const songInfo = useMemo(() => omni.getLyricMatchTarget(song), [song]);

    const search = useLyricMatchSearch(song, songInfo, { pickResult: pickOnlineResult });
    const { source, selectedResult } = search;
    const mountedRef = useRef(true);
    const savingRef = useRef(false);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    // A delayed fetch may only commit while this exact song/source/selection is still open.
    const save = async (result: SongResult) => {
        if (savingRef.current || !search.isSelectionCurrent(result, source)) return;
        savingRef.current = true;
        const shouldCommit = () => mountedRef.current && search.isSelectionCurrent(result, source);
        try {
            const saved = await saveOnlineLyricMatch(song, source, result, shouldCommit);
            if (!shouldCommit()) return;
            if (!saved) {
                setStatusMessage({ type: 'error', text: t('localMusic.noLyricsAvailable') });
                return;
            }
            await onMatch();
        } catch (error) {
            console.error('Online lyric match failed', error);
            if (shouldCommit()) setStatusMessage({ type: 'error', text: t('localMusic.matchFailed') });
        } finally {
            savingRef.current = false;
        }
    };

    return (
        <LyricMatchWindow
            search={search}
            isDaylight={isDaylight}
            onClose={onClose}
            songLine={song.name}
            preview={selectedResult ? {
                coverUrl: getMatchResultCoverUrl(selectedResult, source),
                title: formatSongName(selectedResult),
                artist: getMatchResultArtists(selectedResult),
                album: getMatchResultAlbumName(selectedResult),
            } : {
                coverUrl: metadata.coverUrl,
                title: song.name,
                artist: songInfo.artist,
                album: songInfo.album,
            }}
            savingLabel={t('localMusic.matching')}
            onSave={save}
            // The three below are how this window was before the three windows became one.
            overAllLayers
            keepsHotkeys
            closesOnBackdropClick
        />
    );
};

export default OnlineSongLyricMatch;
