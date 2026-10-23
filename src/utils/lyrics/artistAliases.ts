// Artist aliases used by lyric queries and scoring, without rewriting the displayed song.
export const canonicalLyricArtist = (value: string): string => (
    value.normalize('NFKC').replace(/夜鹿|ヨルシカ|\bYorushika\b/giu, 'ヨルシカ').trim()
);
