// Artist aliases used by lyric queries and scoring, without rewriting the displayed song.
const aliases = [
    ['ヨルシカ', ['夜鹿', 'Yorushika']],
    ['米津玄師', ['米津玄师', 'Kenshi Yonezu', 'Yonezu Kenshi']],
    ['あいみょん', ['Aimyon', '爱缪', '愛繆']],
    ['宇多田ヒカル', ['Hikaru Utada', 'Utada Hikaru', '宇多田光']],
    ['ずっと真夜中でいいのに。', ['ずっと真夜中でいいのに', 'ずとまよ', 'ZUTOMAYO']],
    ['YOASOBI', []],
    ['Aimer', []],
    ['Ado', []],
    ['Eve', []],
] as const;

const replacements = aliases.map(([name, names]) => ({
    name,
    pattern: new RegExp([name, ...names].sort((a, b) => b.length - a.length).map(alias => {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        // Do not turn a word containing an English stage name into an artist credit.
        return /^[a-z]/iu.test(alias) ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped;
    }).join('|'), 'giu'),
}));
const knownArtists = new Set<string>(aliases.map(([name]) => name));

export const canonicalLyricArtist = (value: string): string => (
    replacements.reduce((text, { name, pattern }) => text.replace(pattern, name), value.normalize('NFKC')).trim()
);

/** Known credits disambiguate title/artist order; unrecognized names are never guessed. */
export const isKnownLyricArtist = (value: string): boolean => (
    knownArtists.has(canonicalLyricArtist(value))
);
