// Player sources configuration with Hindi / Dual-Audio multi-server support
// Maps TMDB IDs to working embed and streaming providers

const PLAYER_SOURCES = [
  {
    id: 'pvrplay_direct',
    name: '', // hidden server name as requested
    audio: 'Multi-Audio (Hindi, English, Regional)',
    movieUrl: (id, title, imdbId) => `/player/stream/movie/${id || imdbId}`,
    tvUrl: (id, season = 1, episode = 1, title, imdbId) => `/player/stream/series/${id || imdbId}?season=${season}&episode=${episode}`,
    note: 'Server 2: PvrPlay Clean Multi-Audio Stream Gateway'
  },
  {
    id: 'pvrplay_raw',
    name: '',
    audio: 'Multi-Audio (Hindi, English, Regional)',
    movieUrl: (id, title, imdbId) => `https://dbhnmkjasgbvsdkjbskkvnskjbfckldsnckjbckjnxkjcsknxjvkjxnvcxknvku.pvrplay.fun/watch/movie/${id || imdbId}`,
    tvUrl: (id, season = 1, episode = 1, title, imdbId) => `https://dbhnmkjasgbvsdkjbskkvnskjbfckldsnckjbckjnxkjcsknxjvkjxnvcxknvku.pvrplay.fun/watch/tv/${id || imdbId}/${season}/${episode}`,
    note: 'Server 2: PvrPlay Direct Mirror'
  },
  {
    id: 'reelsdownload',
    name: '',
    audio: 'Multi-Audio (Hindi, Tamil, Telugu, English)',
    movieUrl: (id, title, imdbId) => `https://embed.reelsdownload.online/player/${id || imdbId}?key=k_bf0ab0853bce46e3d90b256b&close=1`,
    tvUrl: (id, season = 1, episode = 1, title, imdbId) => `https://embed.reelsdownload.online/player/${id || imdbId}/${season}/${episode}?key=k_bf0ab0853bce46e3d90b256b&close=1`,
    note: 'Direct multi-audio streaming engine backup'
  },
  {
    id: 'vidlink',
    name: 'Server 3: VidLink Pro (Ad-Free / Fast 4K CDN - Recommended)',
    audio: 'English / Original',
    movieUrl: (id, title, imdbId) => `https://vidlink.pro/movie/${id || imdbId}?primaryColor=e50914`,
    tvUrl: (id, season = 1, episode = 1, title, imdbId) => `https://vidlink.pro/tv/${id || imdbId}/${season}/${episode}?primaryColor=e50914`,
    note: 'Premium ad-free fast streaming with clean Netflix-style player'
  },
  {
    id: 'vsembed',
    name: 'Server 3: VsEmbed (Dedicated Hindi Audio)',
    audio: 'Hindi Audio',
    movieUrl: (id, title, imdbId) => `https://vsembed.su/embed/movie/${id || imdbId}?autoplay=1&ds_lang=hi`,
    tvUrl: (id, season = 1, episode = 1, title, imdbId) => `https://vsembed.su/embed/tv/${id || imdbId}/${season}/${episode}?autoplay=1&ds_lang=hi`,
    note: 'Fast primary server with Hindi audio and multiple subtitles'
  },
  {
    id: 'autoembed',
    name: 'Server 4: AutoEmbed (Fast CDN - Multi-Mirror)',
    audio: 'English & Multi-Subs',
    movieUrl: (id, title, imdbId) => (imdbId && String(imdbId).startsWith('tt')) ? `https://autoembed.me/movie/imdb/${imdbId}` : `https://autoembed.me/movie/tmdb/${id}`,
    tvUrl: (id, season = 1, episode = 1, title, imdbId) => (imdbId && String(imdbId).startsWith('tt')) ? `https://autoembed.me/tv/imdb/${imdbId}/${season}/${episode}` : `https://autoembed.me/tv/tmdb/${id}/${season}/${episode}`,
    note: 'Ultra-fast direct multi-CDN stream with instant buffering'
  },
  {
    id: 'vidfast',
    name: 'Server 5: VidFast (Multi-Audio & Dubs)',
    audio: 'Multi-Audio (Hindi / Dubs)',
    movieUrl: (id, title, imdbId) => `https://vidfast.vc/movie/${id || imdbId}?autoPlay=true&poster=true&title=true&pip=hide&theme=e50914&sub=hi`,
    tvUrl: (id, season = 1, episode = 1, title, imdbId) => `https://vidfast.vc/tv/${id || imdbId}/${season}/${episode}?autoPlay=true&poster=true&title=true&pip=hide&theme=e50914&sub=hi`,
    note: 'Multi-audio tracks with Hindi, English & regional dubs'
  },
  {
    id: 'vidsrc_to',
    name: 'Server 6: VidSrc Pro (HD / Dual Audio)',
    audio: 'Dual Audio (Hindi / Eng)',
    movieUrl: (id, title, imdbId) => `https://vidsrc.to/embed/movie/${imdbId || id}`,
    tvUrl: (id, season = 1, episode = 1, title, imdbId) => `https://vidsrc.to/embed/tv/${imdbId || id}/${season}/${episode}`,
    note: 'Popular high-speed mirror with multi-language audio'
  },
  {
    id: 'vidnest',
    name: 'Server 6: VidNest (Clean / Fast)',
    audio: 'English / Clean',
    movieUrl: (id) => `https://vidnest.fun/movie/${id}`,
    tvUrl: (id, season = 1, episode = 1) => `https://vidnest.fun/tv/${id}/${season}/${episode}`,
    note: 'Ad-light fast streaming player mirror'
  },
  {
    id: '2embed',
    name: 'Server 7: 2Embed (HD Stream)',
    audio: 'Multi-Language',
    movieUrl: (id, title, imdbId) => `https://2embed.cc/embed/${imdbId || id}`,
    tvUrl: (id, season = 1, episode = 1, title, imdbId) => `https://2embed.cc/embedtv/${imdbId || id}&s=${season}&e=${episode}`,
    note: 'Reliable multi-language streaming provider'
  },
  {
    id: 'multiembed',
    name: 'Server 8: MultiEmbed (Aggregator)',
    audio: 'Multi-Source',
    movieUrl: (id, title, imdbId) => `https://multiembed.mov/?tmdb=1&id=${id || imdbId}`,
    tvUrl: (id, season = 1, episode = 1, title, imdbId) => `https://multiembed.mov/?tmdb=1&id=${id || imdbId}&s=${season}&e=${episode}`,
    note: 'Global multi-source streaming mirror'
  },
  {
    id: 'peachify',
    name: 'Server 9: Peachify (HD / Fast)',
    audio: 'English HD',
    movieUrl: (id) => `https://peachify.top/embed/movie/${id}`,
    tvUrl: (id, season = 1, episode = 1) => `https://peachify.top/embed/tv/${id}/${season}/${episode}`,
    note: 'Fast HD player'
  },
  {
    id: 'moviesmela',
    name: 'Server 10: MoviesMela (Direct / Download)',
    audio: 'Hindi & Dual Audio',
    movieUrl: (id, title) => `https://www.moviesmela.com/?s=${encodeURIComponent(title || id)}`,
    tvUrl: (id, season = 1, episode = 1, title) => `https://www.moviesmela.com/?s=${encodeURIComponent(title || id)}`,
    note: 'Bollywood & Dual Audio direct portal & download links'
  }
];

function getPlayerSources(title, episode = null) {
  if (!title || (!title.tmdb_id && !title.imdb_id)) return [];
  const tmdbId = title.tmdb_id || title.imdb_id;
  const imdbId = title.imdb_id || (String(title.tmdb_id).startsWith('tt') ? title.tmdb_id : null);
  const isSeries = title.kind === 'series';
  const seasonNum = episode?.season_number || 1;
  const episodeNum = episode?.episode_number || 1;
  const titleName = title.title || '';

  return PLAYER_SOURCES.map(src => ({
    id: src.id,
    name: src.name,
    note: src.note,
    audio: src.audio || 'Default Audio',
    url: isSeries ? src.tvUrl(tmdbId, seasonNum, episodeNum, titleName, imdbId) : src.movieUrl(tmdbId, titleName, imdbId)
  }));
}

module.exports = { PLAYER_SOURCES, getPlayerSources };
