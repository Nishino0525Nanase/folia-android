import { useEffect, useRef, useState } from 'react';
import type { LyricProviderSource, SongResult } from '../../../types';
import { useLyricMatchSources } from '../../../hooks/useLyricMatchSources';
import { searchLyricsByMatchSource, type LyricMatchSearchTarget } from '../../../utils/lyrics/lyricMatchSources';
import { LYRIC_SOURCES } from '../../../utils/lyrics/lyricSources';
import type { LyricMatchSource } from '../../../utils/lyrics/matchResult';
import { buildLyricSearchQuery } from '../../../utils/lyrics/searchQuery';

// src/components/modal/lyric-match/useLyricMatchSearch.ts
// The search of the lyric match window: the source it is on, the text in the search box, the
// results and the chosen one. A kind of song says what the song is called and, if it wants,
// which result is chosen when a search answers.

/** What the song being matched is called: the first search text is made of it, and results are scored against it. */
export type LyricMatchSongInfo = LyricMatchSearchTarget & { album: string };

export interface LyricMatchSearchOptions {
    /** The result chosen when a search answers. Without it none is: the person chooses. */
    pickResult?: (results: SongResult[]) => SongResult | null;
    /**
     * True: on another source the search box goes back to the song's own text. Otherwise the text
     * the person typed is searched on the new source too.
     */
    resetsQueryOnSourceChange?: boolean;
}

// The source the window is on, with the sources it offers: it opens on the first one. An account
// can be signed out under the open window: its tab goes, and the window is then on the first
// source that is left.
const useLyricMatchSourceChoice = (): [LyricProviderSource, (source: LyricProviderSource) => void, LyricProviderSource[]] => {
    const offered = useLyricMatchSources();
    const [chosen, setChosen] = useState<LyricProviderSource>(LYRIC_SOURCES[0].id);
    return [offered.includes(chosen) ? chosen : offered[0], setChosen, offered];
};

export const useLyricMatchSearch = (
    song: unknown,
    songInfo: LyricMatchSongInfo,
    { pickResult, resetsQueryOnSourceChange }: LyricMatchSearchOptions = {},
) => {
    const [source, chooseSource, sources] = useLyricMatchSourceChoice();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SongResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchFailed, setSearchFailed] = useState(false);
    const [selectedResult, setSelectedResult] = useState<SongResult | null>(null);
    const requestIdRef = useRef(0);
    const searchedSourceRef = useRef(source);
    const latestIdentityRef = useRef({ song, source });
    latestIdentityRef.current = { song, source };
    const [resultContext, setResultContext] = useState<{ song: unknown; source: LyricProviderSource } | null>(null);
    const hasCurrentResults = resultContext?.song === song && resultContext?.source === source;
    const visibleResults = hasCurrentResults ? results : [];
    const visibleSelection = hasCurrentResults ? selectedResult : null;
    const latestSelectionRef = useRef({ results: visibleResults, selectedResult: visibleSelection, isSearching });
    latestSelectionRef.current = { results: visibleResults, selectedResult: visibleSelection, isSearching };

    // A removed account, source switch or closed window invalidates any late search answer.
    useEffect(() => () => { requestIdRef.current += 1; }, []);

    const setSource = (next: LyricProviderSource) => {
        if (next === source) return;
        requestIdRef.current += 1;
        latestIdentityRef.current = { song, source: next };
        latestSelectionRef.current = { results: [], selectedResult: null, isSearching: true };
        setResults([]);
        setSelectedResult(null);
        setResultContext(null);
        setSearchFailed(false);
        chooseSource(next);
    };

    const songQuery = buildLyricSearchQuery(songInfo.title, songInfo.artist, songInfo.album);

    // Every source is searched by the text in the box. An answer that a later search has overtaken
    // is dropped. `anew`: the song or the tab changed, so what
    // the search before found is not this one's and goes even when there is nothing to search.
    const runSearch = async (typed: string, activeSource: LyricMatchSource, anew = false) => {
        const text = typed.trim();
        if (!text) {
            if (anew) {
                requestIdRef.current += 1;
                setIsSearching(false);
                setResults([]);
                setSelectedResult(null);
                setSearchFailed(false);
            }
            return;
        }

        const requestId = ++requestIdRef.current;
        const targetSong = song;
        const isCurrent = () => requestId === requestIdRef.current
            && latestIdentityRef.current.song === targetSong
            && latestIdentityRef.current.source === activeSource;
        setIsSearching(true);
        setSearchFailed(false);
        setResults([]);
        setSelectedResult(null);
        setResultContext({ song: targetSong, source: activeSource });

        try {
            const found = await searchLyricsByMatchSource(activeSource, text, songInfo);
            if (!isCurrent()) return;

            setResults(found);
            setSelectedResult(pickResult?.(found) ?? null);
        } catch (error) {
            if (isCurrent()) {
                setSearchFailed(true);
                console.error('[LyricMatch] Search failed:', error);
            }
        } finally {
            if (isCurrent()) {
                setIsSearching(false);
            }
        }
    };

    // A song starts from its own search text.
    useEffect(() => {
        setQuery(songQuery);
        void runSearch(songQuery, source, true);
    }, [song]);

    useEffect(() => {
        if (searchedSourceRef.current === source) return;
        searchedSourceRef.current = source;
        if (resetsQueryOnSourceChange) {
            setQuery(songQuery);
            void runSearch(songQuery, source, true);
        } else {
            void runSearch(query, source, true);
        }
    }, [source]);

    return {
        songInfo,
        source,
        setSource,
        sources,
        query,
        setQuery,
        results: visibleResults,
        isSearching,
        searchFailed: hasCurrentResults && searchFailed,
        selectedResult: visibleSelection,
        setSelectedResult: (result: SongResult | null) => {
            if (result === null) {
                setSelectedResult(null);
            } else if (latestIdentityRef.current.song === song && latestIdentityRef.current.source === source
                && latestSelectionRef.current.results.includes(result) && !latestSelectionRef.current.isSearching) {
                setSelectedResult(result);
            }
        },
        /** A save must still refer to the result chosen for this song and this lyric source. */
        isSelectionCurrent: (result: SongResult, expectedSource: LyricProviderSource) => (
            latestIdentityRef.current.song === song
            && latestIdentityRef.current.source === expectedSource
            && latestSelectionRef.current.selectedResult === result
            && latestSelectionRef.current.results.includes(result)
            && !latestSelectionRef.current.isSearching
        ),
        /** Searches the text in the box on the source the window is on. */
        submit: () => runSearch(query, source),
    };
};

export type LyricMatchSearch = ReturnType<typeof useLyricMatchSearch>;
