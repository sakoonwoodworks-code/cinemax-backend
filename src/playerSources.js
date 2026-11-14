// Player sources configuration with Hindi / Dual-Audio multi-server support
// Maps TMDB IDs to working embed and streaming providers

const PLAYER_SOURCES = [
  {
    id: 'vidfast',
    name: 'Server 1: VidFast (Hindi / Dual Audio)',
    movieUrl: (tmdbId) => `https://vidfast.vc/movie/${tmdbId}?autoPlay=true&poster=true&title=true&pip=hide&theme=e50914&sub=hi`,
    tvUrl: (tmdbId, season = 1, episode = 1) => `https://vidfast.vc/tv/${tmdbId}/${season}/${episode}?autoPlay=true&poster=true&title=true&pip=hide&theme=e50914&sub=hi`,
    note: 'Multi-audio tracks with Hindi, English & fast HD streams'
  },
  {
    id: 'vsembed',
    name: 'Server 2: VsEmbed (Hindi Audio)',
    movieUrl: (tmdbId) => `https://vsembed.su/embed/movie/${tmdbId}?autoplay=1&ds_lang=hi`,
    tvUrl: (tmdbId, season = 1, episode = 1) => `https://vsembed.su/embed/tv/${tmdbId}/${season}/${episode}?autoplay=1&ds_lang=hi`,
    note: 'Fast primary server with Hindi audio and multiple subtitles'
  },
  {
    id: 'vidnest',
    name: 'Server 3: VidNest (Clean / Fast)',
    movieUrl: (tmdbId) => `https://vidnest.fun/movie/${tmdbId}`,
    tvUrl: (tmdbId, season = 1, episode = 1) => `https://vidnest.fun/tv/${tmdbId}/${season}/${episode}`,
    note: 'Ad-light fast streaming player mirror'
  },
  {
    id: 'autoembed',
    name: 'Server 4: AutoEmbed (Multi-Source)',
    movieUrl: (tmdbId) => `https://autoembed.co/movie/tmdb/${tmdbId}`,
    tvUrl: (tmdbId, season = 1, episode = 1) => `https://autoembed.co/tv/tmdb/${tmdbId}/${season}/${episode}`,
    note: 'Auto-aggregates high speed streaming mirrors'
  },
  {
    id: '2embed',
    name: 'Server 5: 2Embed (HD Stream)',
    movieUrl: (tmdbId) => `https://2embed.cc/embed/${tmdbId}`,
    tvUrl: (tmdbId, season = 1, episode = 1) => `https://2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`,
    note: 'Reliable multi-language streaming provider'
  },
  {
    id: 'vidsrc_to',
    name: 'Server 6: VidSrc Pro (Dual Audio)',
    movieUrl: (tmdbId) => `https://vidsrc.to/embed/movie/${tmdbId}`,
    tvUrl: (tmdbId, season = 1, episode = 1) => `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`,
    note: 'Popular streaming mirror with dual-audio support'
  },
  {
    id: 'multiembed',
    name: 'Server 7: MultiEmbed (Aggregator)',
    movieUrl: (tmdbId) => `https://multiembed.mov/?tmdb=1&id=${tmdbId}`,
    tvUrl: (tmdbId, season = 1, episode = 1) => `https://multiembed.mov/?tmdb=1&id=${tmdbId}&s=${season}&e=${episode}`,
    note: 'Global multi-source streaming mirror'
  },
  {
    id: 'peachify',
    name: 'Server 8: Peachify (HD / Fast)',
    movieUrl: (tmdbId) => `https://peachify.top/embed/movie/${tmdbId}`,
    tvUrl: (tmdbId, season = 1, episode = 1) => `https://peachify.top/embed/tv/${tmdbId}/${season}/${episode}`,
    note: 'Fast HD player'
  },
  {
    id: 'moviesmela',
    name: 'Server 9: MoviesMela (Direct / Download)',
    movieUrl: (tmdbId, title) => `https://www.moviesmela.com/?s=${encodeURIComponent(title || tmdbId)}`,
    tvUrl: (tmdbId, season = 1, episode = 1, title) => `https://www.moviesmela.com/?s=${encodeURIComponent(title || tmdbId)}`,
    note: 'Bollywood & Dual Audio direct portal & download links'
  }
];

function getPlayerSources(title, episode = null) {
  if (!title || !title.tmdb_id) return [];
  const tmdbId = title.tmdb_id;
  const isSeries = title.kind === 'series';
  const seasonNum = episode?.season_number || 1;
  const episodeNum = episode?.episode_number || 1;
  const titleName = title.title || '';

  return PLAYER_SOURCES.map(src => ({
    id: src.id,
    name: src.name,
    note: src.note,
    url: isSeries ? src.tvUrl(tmdbId, seasonNum, episodeNum, titleName) : src.movieUrl(tmdbId, titleName)
  }));
}

module.exports = { PLAYER_SOURCES, getPlayerSources };
