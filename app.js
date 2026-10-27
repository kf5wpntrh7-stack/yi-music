(() => {
  'use strict';

  const STORAGE_KEY = 'yi-music-library-v1';
  const VOLUME_KEY = 'yi-music-volume-v1';
  const PLAYBACK_KEY = 'yi-music-playback-v1';
  const COMPACT_KEY = 'yi-music-compact-v1';
  const VIEW_MODE_KEY = 'yi-music-view-mode-v1';
  const PRIMARY_PLAYLIST_ID = 'mb3-537';
  const PAGE_SIZE = 80;
  const $ = (id) => document.getElementById(id);
  const els = {
    workspace: $('workspace'), viewModeButton: $('viewModeButton'), lyricsButton: $('lyricsButton'), lyricsPanel: $('lyricsPanel'), lyricsTitle: $('lyricsTitle'), lyricsStatus: $('lyricsStatus'), lyricsCandidates: $('lyricsCandidates'), lyricsText: $('lyricsText'), lyricsRetryButton: $('lyricsRetryButton'), lyricsCloseButton: $('lyricsCloseButton'), playerCard: $('playerCard'), videoCard: $('videoCard'), playerPlaceholder: $('artworkPlaceholder'), currentArtwork: $('currentArtwork'), nowTitle: $('nowTitle'), nowPlaylist: $('nowPlaylist'),
    progressBar: $('progressBar'), currentTime: $('currentTime'), durationTime: $('durationTime'),
    playButton: $('playButton'), previousButton: $('previousButton'), nextButton: $('nextButton'),
    shuffleButton: $('shuffleButton'), repeatButton: $('repeatButton'), blackScreenButton: $('blackScreenButton'),
    muteButton: $('muteButton'), volumeIcon: $('volumeIcon'), volumeSlider: $('volumeSlider'), volumeValue: $('volumeValue'),
    playlistSelect: $('playlistSelect'), addToPlaylistSelect: $('addToPlaylistSelect'), songCount: $('songCount'),
    searchInput: $('searchInput'), songList: $('songList'), organizeButton: $('organizeButton'),
    organizeBar: $('organizeBar'), renamePlaylistButton: $('renamePlaylistButton'), deletePlaylistButton: $('deletePlaylistButton'),
    addSongButton: $('addSongButton'), newPlaylistButton: $('newPlaylistButton'), settingsButton: $('settingsButton'),
    addSongDialog: $('addSongDialog'), addSongForm: $('addSongForm'), songUrlInput: $('songUrlInput'),
    songTitleInput: $('songTitleInput'), addSongError: $('addSongError'), playlistDialog: $('playlistDialog'),
    playlistForm: $('playlistForm'), playlistDialogTitle: $('playlistDialogTitle'), playlistNameInput: $('playlistNameInput'),
    playlistSubmitButton: $('playlistSubmitButton'), moveSongDialog: $('moveSongDialog'), moveSongForm: $('moveSongForm'),
    moveSongTitle: $('moveSongTitle'), moveToPlaylistSelect: $('moveToPlaylistSelect'), settingsDialog: $('settingsDialog'),
    replaceSongDialog: $('replaceSongDialog'), replaceSongForm: $('replaceSongForm'), replaceOriginalTitle: $('replaceOriginalTitle'),
    searchYoutubeLink: $('searchYoutubeLink'), replacementUrlInput: $('replacementUrlInput'), replacementTitleInput: $('replacementTitleInput'),
    replaceSongError: $('replaceSongError'), skipUnavailableButton: $('skipUnavailableButton'),
    exportButton: $('exportButton'), importButton: $('importButton'), restoreMb3Button: $('restoreMb3Button'),
    importFileInput: $('importFileInput'), miniPlayer: $('miniPlayer'), miniThumb: $('miniThumb'),
    miniInfo: $('miniInfo'), miniTitle: $('miniTitle'), miniPlaylist: $('miniPlaylist'), miniPlayButton: $('miniPlayButton'),
    miniNextButton: $('miniNextButton'), blackScreen: $('blackScreen'), exitBlackScreen: $('exitBlackScreen'),
    compactPlayerButton: $('compactPlayerButton'), compactRestoreButton: $('compactRestoreButton'), compactBlackScreenButton: $('compactBlackScreenButton'),
    blackTitle: $('blackTitle'), toast: $('toast')
  };

  let state = loadState();
  let playbackPrefs = loadPlaybackPrefs();
  let player = null;
  let playerReady = false;
  let isPlaying = false;
  let currentSong = null;
  let playbackPlaylistId = playbackPrefs.playlistId || state.activePlaylistId;
  let organizeMode = false;
  let playlistDialogMode = 'create';
  let movingSongId = null;
  let replaceTarget = null;
  let shuffle = Boolean(playbackPrefs.shuffle);
  let repeatMode = ['off', 'all', 'one'].includes(playbackPrefs.repeatMode) ? playbackPrefs.repeatMode : 'off';
  let visibleSongLimit = PAGE_SIZE;
  let lastPositionSave = 0;
  let compactMode = localStorage.getItem(COMPACT_KEY) === '1';
  let viewMode = localStorage.getItem(VIEW_MODE_KEY) === 'mv' ? 'mv' : 'radio';
  let wasPlayingBeforeHidden = false;
  let pendingAutoplay = false;
  const storedVolume = localStorage.getItem(VOLUME_KEY);
  let volume = storedVolume === null ? 80 : Math.min(100, Math.max(0, Number(storedVolume) || 0));
  let previousVolume = volume || 80;
  let wakeLock = null;
  let toastTimer = null;
  let lyricsSearchToken = 0;
  let lyricsSearchCache = new Map();
  let lyricsSearchResults = [];
  let lyricsLines = [];
  let lyricsActiveIndex = -1;

  function makeDefaultPlaylists() {
    const imported = Array.isArray(window.MB3_PLAYLISTS) ? window.MB3_PLAYLISTS : [];
    return imported.map((playlist, index) => ({
      id: playlist.id,
      sourceId: playlist.sourceId,
      name: playlist.name === 'cnady crush bgm' ? 'Candy Crush BGM' : playlist.name,
      createdAt: Date.now() + index,
      songs: Array.isArray(playlist.songs) ? playlist.songs.map((song) => ({ ...song })) : []
    }));
  }

  function loadPlaybackPrefs() {
    try { return JSON.parse(localStorage.getItem(PLAYBACK_KEY)) || {}; } catch (_) { return {}; }
  }

  function savePlaybackPrefs(position) {
    playbackPrefs = {
      playlistId: playbackPlaylistId,
      songId: currentSong?.id || null,
      position: Number.isFinite(position) ? Math.max(0, position) : (playbackPrefs.position || 0),
      shuffle,
      repeatMode
    };
    try { localStorage.setItem(PLAYBACK_KEY, JSON.stringify(playbackPrefs)); } catch (_) {}
  }

  function loadState() {
    const originals = makeDefaultPlaylists();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.playlists) && saved.playlists.length) {
        const deletedOriginalSongIds = new Set(Array.isArray(saved.deletedOriginalSongIds) ? saved.deletedOriginalSongIds : []);
        const savedById = new Map(saved.playlists.map((playlist) => [playlist.id, playlist]));
        const originalIds = new Set(originals.map((playlist) => playlist.id));
        const mergedOriginals = originals.map((original) => {
          const existing = savedById.get(original.id);
          if (!existing) return { ...original, songs: [...original.songs].reverse() };
          if (original.id === PRIMARY_PLAYLIST_ID && existing.name === 'MB3・537') existing.name = '537';
          if (existing.name === 'cnady crush bgm') existing.name = 'Candy Crush BGM';
          const originalVideos = new Set(original.songs.map((song) => song.videoId));
          const retainedSongs = existing.songs.filter((song) => original.id !== PRIMARY_PLAYLIST_ID || song.source !== 'MB3' || originalVideos.has(song.videoId));
          const existingSongs = saved.newestFirst === true ? retainedSongs : [...retainedSongs].reverse();
          const knownIds = new Set(existingSongs.map((song) => song.id));
          const knownVideos = new Set(existingSongs.map((song) => song.videoId));
          const missingSongs = original.songs.filter((song) => !deletedOriginalSongIds.has(song.id) && !knownIds.has(song.id) && !knownVideos.has(song.videoId));
          return { ...existing, sourceId: original.sourceId, songs: [...missingSongs.reverse(), ...existingSongs] };
        });
        const customPlaylists = saved.playlists.filter((playlist) => !originalIds.has(playlist.id));
        const playlists = [...mergedOriginals, ...customPlaylists];
        const activeExists = playlists.some((playlist) => playlist.id === saved.activePlaylistId);
        const migrated = { version: 3, playlists, activePlaylistId: activeExists ? saved.activePlaylistId : PRIMARY_PLAYLIST_ID, deletedOriginalSongIds: [...deletedOriginalSongIds], newestFirst: true };
        if (saved.newestFirst !== true) customPlaylists.forEach((playlist) => playlist.songs.reverse());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (_) {}
    return { version: 3, playlists: originals.map((playlist) => ({ ...playlist, songs: playlist.songs.reverse() })), activePlaylistId: PRIMARY_PLAYLIST_ID, deletedOriginalSongIds: [], newestFirst: true };
  }

  function markOriginalSongRemoved(song) {
    if (!song?.id || !makeDefaultPlaylists().some((p) => p.songs.some((item) => item.id === song.id))) return;
    const removed = new Set(state.deletedOriginalSongIds || []);
    removed.add(song.id);
    state.deletedOriginalSongIds = [...removed];
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      showToast('儲存空間不足，請先下載備份');
    }
  }

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function activePlaylist() {
    return state.playlists.find((p) => p.id === state.activePlaylistId) || state.playlists[0];
  }

  function playbackPlaylist() {
    return state.playlists.find((p) => p.id === playbackPlaylistId) || activePlaylist();
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function thumbnail(videoId, quality = 'mqdefault') {
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${quality}.jpg`;
  }

  function extractVideoId(input) {
    const raw = String(input || '').trim();
    if (/^[\w-]{11}$/.test(raw)) return raw;
    try {
      const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      if (url.hostname.includes('youtu.be')) return url.pathname.split('/').filter(Boolean)[0]?.slice(0, 11) || null;
      if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2]?.slice(0, 11) || null;
      return url.searchParams.get('v')?.slice(0, 11) || null;
    } catch (_) {
      const match = raw.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
      return match ? match[1] : null;
    }
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function applyVolume(nextVolume) {
    volume = Math.min(100, Math.max(0, Math.round(Number(nextVolume) || 0)));
    if (volume > 0) previousVolume = volume;
    els.volumeSlider.value = String(volume);
    els.volumeValue.value = `${volume}%`;
    els.volumeValue.textContent = `${volume}%`;
    els.volumeIcon.textContent = volume === 0 ? '🔇' : volume < 50 ? '🔉' : '🔊';
    els.muteButton.setAttribute('aria-label', volume === 0 ? '取消靜音' : '靜音');
    try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch (_) {}
    if (!playerReady) return;
    try {
      player.setVolume(volume);
      if (volume === 0) player.mute();
      else player.unMute();
    } catch (_) {}
  }

  function renderPlaylistSelectors() {
    const options = state.playlists.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    els.playlistSelect.innerHTML = options;
    els.playlistSelect.value = state.activePlaylistId;
    els.addToPlaylistSelect.innerHTML = options;
    els.addToPlaylistSelect.value = state.activePlaylistId;
  }

  function renderSongList() {
    const playlist = activePlaylist();
    const query = els.searchInput.value.trim().toLocaleLowerCase();
    const matchingSongs = playlist.songs.filter((song) => !query || song.title.toLocaleLowerCase().includes(query));
    const songs = matchingSongs.slice(0, visibleSongLimit);
    els.songCount.textContent = query ? `${matchingSongs.length}／${playlist.songs.length} 首` : `${playlist.songs.length} 首`;
    els.deletePlaylistButton.hidden = state.playlists.length <= 1;

    if (!songs.length) {
      els.songList.innerHTML = `<div class="empty-state"><div><b>${query ? '找不到這首歌' : '這個歌單還是空的'}</b><span>${query ? '換個關鍵字試試看' : '加入一首 YouTube 歌曲開始播放'}</span>${query ? '' : '<button class="secondary-button" data-empty-add type="button">加入歌曲</button>'}</div></div>`;
      return;
    }

    els.songList.innerHTML = songs.map((song) => {
      const index = playlist.songs.findIndex((item) => item.id === song.id);
      const currentClass = currentSong?.id === song.id ? ' is-current' : '';
      const tools = organizeMode ? `<div class="row-tools">
        <button type="button" data-action="up" data-id="${escapeHtml(song.id)}" aria-label="向上移">↑</button>
        <button type="button" data-action="down" data-id="${escapeHtml(song.id)}" aria-label="向下移">↓</button>
        <button type="button" data-action="replace" data-id="${escapeHtml(song.id)}" aria-label="替換來源">換</button>
        <button type="button" data-action="position" data-id="${escapeHtml(song.id)}" aria-label="移到指定位置">序</button>
        <button class="move-song" type="button" data-action="move" data-id="${escapeHtml(song.id)}">移動</button>
        <button class="delete-song" type="button" data-action="delete" data-id="${escapeHtml(song.id)}" aria-label="刪除">刪</button>
      </div>` : `<button class="row-play" type="button" data-action="play" data-id="${escapeHtml(song.id)}" aria-label="播放">▶</button>`;
      return `<article class="song-row${currentClass}" data-song-id="${escapeHtml(song.id)}">
        <button class="song-main" type="button" data-action="play" data-id="${escapeHtml(song.id)}">
          <img src="${thumbnail(song.videoId)}" alt="" loading="lazy">
          <span class="song-copy"><span class="song-title">${escapeHtml(song.title)}</span><span class="song-meta"><span class="song-index">${playlist.songs.length - index}</span>・${formatTime(song.duration)}</span></span>
        </button>${tools}</article>`;
    }).join('') + (matchingSongs.length > songs.length ? `<button class="load-more" type="button" data-load-more>再顯示 ${Math.min(PAGE_SIZE, matchingSongs.length - songs.length)} 首</button>` : '');
  }

  function renderAll() {
    renderPlaylistSelectors();
    renderSongList();
    updateNowPlaying();
  }

  function updateNowPlaying() {
    const playlist = playbackPlaylist();
    const title = currentSong?.title || '尚未選擇歌曲';
    els.nowTitle.textContent = title;
    els.nowPlaylist.textContent = playlist?.name || activePlaylist().name;
    els.blackTitle.textContent = title;
    els.playButton.textContent = isPlaying ? '❚❚' : '▶';
    els.miniPlayButton.textContent = isPlaying ? '❚❚' : '▶';
    els.playerPlaceholder.hidden = Boolean(currentSong);
    els.currentArtwork.hidden = !currentSong;
    els.miniPlayer.hidden = !currentSong || compactMode;
    if (currentSong) {
      if (els.currentArtwork.dataset.videoId !== currentSong.videoId) {
        els.currentArtwork.dataset.videoId = currentSong.videoId;
        els.currentArtwork.src = thumbnail(currentSong.videoId, 'hqdefault');
      }
      els.currentArtwork.alt = `${currentSong.title} 封面`;
      els.miniThumb.src = thumbnail(currentSong.videoId);
      els.miniTitle.textContent = currentSong.title;
      els.miniPlaylist.textContent = playlist?.name || '';
      updateMediaSession();
    }
  }

  function applyViewMode(mode, { scroll = false } = {}) {
    viewMode = mode === 'mv' ? 'mv' : 'radio';
    const isMvMode = viewMode === 'mv';
    els.workspace.classList.toggle('is-mv-mode', isMvMode);
    els.workspace.classList.toggle('is-radio-mode', !isMvMode);
    els.viewModeButton.textContent = isMvMode ? '♪ 切換電台模式' : '▶ 顯示 MV';
    els.viewModeButton.setAttribute('aria-pressed', String(isMvMode));
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch (_) {}
    if (scroll) {
      (isMvMode ? els.videoCard : els.playerCard).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }


  function setLyricsPanelOpen(open) {
    const shouldOpen = Boolean(open);
    els.lyricsPanel.hidden = !shouldOpen;
    els.lyricsButton.setAttribute('aria-expanded', String(shouldOpen));
    els.lyricsButton.textContent = shouldOpen ? '♫ 收起歌詞' : '♫ 搜尋歌詞';
    if (!shouldOpen) {
      lyricsSearchToken += 1;
      return;
    }
    if (currentSong) {
      searchLyrics();
    } else {
      els.lyricsTitle.textContent = '尚未選擇歌曲';
      els.lyricsStatus.textContent = '請先播放或選擇一首歌曲，再搜尋歌詞。';
      els.lyricsCandidates.hidden = true;
      els.lyricsText.hidden = true;
    }
  }

  function cleanLyricsQuery(value) {
    return String(value || '')
      .replace(/\[[^\]]*(?:official|m\/v|\bmv\b|music video|lyrics?|中字|歌詞|가사|뮤직비디오|4k|1080p)[^\]]*\]/gi, ' ')
      .replace(/\([^)]*(?:official|m\/v|\bmv\b|music video|lyrics?|中字|歌詞|가사|뮤직비디오|4k|1080p)[^)]*\)/gi, ' ')
      .replace(/\b(?:official\s+(?:music\s+)?video|official\s+audio|music\s+video|lyrics?\s+video|lyric\s+video|color.?coded\s+lyrics|visualizer|performance\s+video)\b/gi, ' ')
      .replace(/(?:中字|韓中歌詞|中韓歌詞|繁中歌詞|簡中歌詞|中文歌詞|韓文歌詞|歌詞版|뮤직비디오|가사|日本語字幕)/gi, ' ')
      .replace(/\b(?:1080p|720p|4k|8k|hd)\b/gi, ' ')
      .replace(/\s*[-|–—]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeLyricsText(value) {
    return String(value || '').normalize('NFKD').toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  function getLyricsSearchStrategies() {
    const titles = [currentSong?.title || ''];
    try {
      if (playerReady && playerVideoId() === currentSong?.videoId) {
        const videoTitle = player.getVideoData?.().title || '';
        if (videoTitle && videoTitle !== currentSong?.title) titles.push(videoTitle);
      }
    } catch (_) {}

    const strategies = [];
    const seen = new Set();
    const add = (params, scoringTitle, artistHint = '') => {
      const cleanParams = Object.fromEntries(Object.entries(params).filter(([, value]) => String(value || '').trim()));
      if (!Object.keys(cleanParams).length) return;
      const key = JSON.stringify(cleanParams);
      if (seen.has(key)) return;
      seen.add(key);
      strategies.push({ params: cleanParams, scoringTitle: scoringTitle || '', artistHint: artistHint || '' });
    };

    titles.forEach((rawTitle) => {
      const cleaned = cleanLyricsQuery(rawTitle);
      if (!cleaned) return;

      let artist = '';
      let track = '';
      const quoted = cleaned.match(/^(.*?)\s*[「『《〈](.+?)[」』》〉]/);
      if (quoted) {
        artist = quoted[1].trim();
        track = quoted[2].trim();
      } else {
        const separated = cleaned.split(/\s+(?:-|–|—|\|)\s+/).map((part) => part.trim()).filter(Boolean);
        if (separated.length >= 2) {
          artist = separated[0];
          track = separated.length > 2 ? separated[1] : separated.slice(1).join(' ');
        } else {
          const compactSeparated = cleaned.split(/\s*[-–—|]\s*/).map((part) => part.trim()).filter(Boolean);
          if (compactSeparated.length >= 3) {
            artist = compactSeparated[compactSeparated.length - 2];
            track = compactSeparated[compactSeparated.length - 1];
          } else if (compactSeparated.length === 2) {
            artist = compactSeparated[0];
            track = compactSeparated[1];
          }
        }
      }

      const trackVariants = [];
      const addTrack = (value) => {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim();
        if (normalized && !trackVariants.includes(normalized)) trackVariants.push(normalized);
      };
      addTrack(track);
      addTrack(track.replace(/\s*[\(\（][^\)\）]*[\)\）]/g, ' ').replace(/\s+/g, ' ').trim());
      const bracketTrack = track.match(/[\(\（]([^\)\）]+)[\)\）]/);
      if (bracketTrack && !/\b(?:feat|ft|official|remaster|version|live|acoustic)\b/i.test(bracketTrack[1])) {
        addTrack(bracketTrack[1]);
      }

      if (track && artist) {
        trackVariants.slice(0, 3).forEach((trackVariant) => {
          add({ track_name: trackVariant, artist_name: artist }, trackVariant, artist);
        });
      }
      trackVariants.slice(0, 3).forEach((trackVariant) => {
        add({ track_name: trackVariant }, trackVariant, artist);
        add({ q: trackVariant }, trackVariant, artist);
      });
      add({ q: cleaned }, track || cleaned, artist);
    });

    return strategies.slice(0, 8);
  }

  function hasLyricsText(value) {
    const text = String(value || '').trim();
    return Boolean(text) && text.toLowerCase() !== 'null';
  }

  function scoreLyricsCandidate(result, query, duration, artistHint = '') {
    const normalizedQuery = normalizeLyricsText(query);
    const track = normalizeLyricsText(result.trackName);
    const artist = normalizeLyricsText(result.artistName);
    const normalizedArtistHint = normalizeLyricsText(artistHint);
    if (!track || !normalizedQuery) return 0;
    let score = 0;
    if (track === normalizedQuery) score += 100;
    else if (normalizedQuery.includes(track) || track.includes(normalizedQuery)) score += 65;
    const queryTokens = new Set(normalizedQuery.split(' ').filter((token) => token.length > 1));
    const trackTokens = track.split(' ').filter((token) => token.length > 1);
    if (trackTokens.length) {
      const overlap = trackTokens.filter((token) => queryTokens.has(token)).length;
      score += overlap / trackTokens.length * 55;
    }
    if (artist && normalizedArtistHint && (artist === normalizedArtistHint || artist.includes(normalizedArtistHint) || normalizedArtistHint.includes(artist))) score += 25;
    else if (artist && normalizedQuery.includes(artist)) score += 20;
    const candidateDuration = Number(result.duration) || 0;
    if (duration > 0 && candidateDuration > 0) {
      const difference = Math.abs(duration - candidateDuration);
      if (difference <= 5) score += 12;
      else if (difference <= 15) score += 5;
      else if (difference > 60) score -= 10;
    }
    return score;
  }

  function parseSyncedLyrics(value) {
    const lines = [];
    String(value || '').split(/\r?\n/).forEach((line) => {
      const stamps = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      if (!stamps.length) return;
      const lyricText = line.replace(/\[[^\]]+\]/g, '').trim();
      if (!lyricText) return;
      stamps.forEach((stamp) => {
        const fraction = stamp[3] ? Number('0.' + stamp[3]) : 0;
        lines.push({
          time: Number(stamp[1]) * 60 + Number(stamp[2]) + fraction,
          text: lyricText
        });
      });
    });
    return lines.sort((a, b) => a.time - b.time);
  }

  function renderLyricsCandidates(ranked) {
    lyricsSearchResults = ranked.slice(0, 6).map((item) => item.result);
    els.lyricsCandidates.replaceChildren();
    lyricsSearchResults.forEach((result, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lyrics-candidate';
      button.dataset.lyricsIndex = String(index);
      const main = document.createElement('span');
      main.className = 'lyrics-candidate-main';
      const title = document.createElement('strong');
      title.textContent = result.trackName || '未知歌曲';
      const artist = document.createElement('small');
      artist.textContent = [result.artistName, result.albumName].filter(Boolean).join(' · ') || '歌手資料未提供';
      main.append(title, artist);
      const duration = document.createElement('span');
      duration.className = 'lyrics-duration';
      duration.textContent = Number(result.duration) > 0 ? formatTime(result.duration) : '歌詞';
      button.append(main, duration);
      els.lyricsCandidates.appendChild(button);
    });
    els.lyricsCandidates.hidden = lyricsSearchResults.length === 0;
    els.lyricsText.hidden = true;
  }

  function displayLyricsResult(result) {
    lyricsActiveIndex = -1;
    lyricsLines = parseSyncedLyrics(result.syncedLyrics);
    els.lyricsTitle.textContent = [result.trackName, result.artistName].filter(Boolean).join(' — ') || '歌詞';
    els.lyricsCandidates.hidden = true;
    els.lyricsCandidates.replaceChildren();
    els.lyricsText.replaceChildren();
    els.lyricsText.hidden = false;

    if (lyricsLines.length) {
      const fragment = document.createDocumentFragment();
      lyricsLines.forEach((line, index) => {
        const paragraph = document.createElement('p');
        paragraph.className = 'lyrics-line';
        paragraph.dataset.lyricLine = String(index);
        paragraph.textContent = line.text;
        fragment.appendChild(paragraph);
      });
      els.lyricsText.appendChild(fragment);
      els.lyricsStatus.textContent = '找到同步歌詞，會依播放進度嘗試逐行標示。';
      updateSyncedLyrics(getLyricsCurrentTime());
      return;
    }

    lyricsLines = [];
    const plain = String(result.plainLyrics || '').trim();
    if (plain) {
      const pre = document.createElement('pre');
      pre.className = 'lyrics-plain';
      pre.textContent = plain;
      els.lyricsText.appendChild(pre);
      els.lyricsStatus.textContent = '找到歌詞。這首歌目前沒有可用的同步時間資訊。';
    } else {
      els.lyricsText.hidden = true;
      els.lyricsStatus.textContent = '找到歌曲資料，但沒有可顯示的歌詞內容。';
    }
  }

  function getLyricsCurrentTime() {
    try {
      if (playerReady && playerVideoId() === currentSong?.videoId) return Number(player.getCurrentTime?.()) || 0;
    } catch (_) {}
    return 0;
  }

  function updateSyncedLyrics(currentTime) {
    if (els.lyricsPanel.hidden || !lyricsLines.length) return;
    let active = -1;
    for (let index = 0; index < lyricsLines.length; index += 1) {
      if (lyricsLines[index].time <= currentTime + 0.25) active = index;
      else break;
    }
    if (active === lyricsActiveIndex) return;
    const previous = els.lyricsText.querySelector('.lyrics-line.is-active');
    if (previous) previous.classList.remove('is-active');
    lyricsActiveIndex = active;
    if (active < 0) return;
    const next = els.lyricsText.querySelector('[data-lyric-line="' + active + '"]');
    if (next) {
      next.classList.add('is-active');
      next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  async function searchLyrics({ force = false } = {}) {
    const token = ++lyricsSearchToken;
    const songId = currentSong?.id;
    if (!currentSong) {
      els.lyricsTitle.textContent = '尚未選擇歌曲';
      els.lyricsStatus.textContent = '請先播放或選擇一首歌曲，再搜尋歌詞。';
      return;
    }

    const strategies = getLyricsSearchStrategies();
    const duration = getLyricsDuration();
    els.lyricsTitle.textContent = currentSong.title || '目前歌曲';
    els.lyricsStatus.textContent = '正在搜尋歌名與歌手的不同組合…';
    els.lyricsCandidates.hidden = true;
    els.lyricsCandidates.replaceChildren();
    els.lyricsText.hidden = true;
    els.lyricsText.replaceChildren();
    lyricsSearchResults = [];
    lyricsLines = [];
    lyricsActiveIndex = -1;

    let results = [];
    let scoringQuery = strategies[0]?.scoringTitle || currentSong.title;
    let artistHint = strategies[0]?.artistHint || '';
    let lastError = null;
    let successfulRequests = 0;

    for (let index = 0; index < strategies.length; index += 1) {
      if (token !== lyricsSearchToken || currentSong?.id !== songId) return;
      const strategy = strategies[index];
      const cacheKey = JSON.stringify(strategy.params);
      try {
        let items;
        if (!force && lyricsSearchCache.has(cacheKey)) {
          items = lyricsSearchCache.get(cacheKey);
        } else {
          if (index > 0) await new Promise((resolve) => setTimeout(resolve, 250));
          const url = new URL('https://lrclib.net/api/search');
          Object.entries(strategy.params).forEach(([key, value]) => url.searchParams.set(key, value));
          const response = await fetch(url.toString(), {
            headers: { 'X-User-Agent': 'yi-music/1.1 (https://kf5wpntrh7-stack.github.io/yi-music/)' }
          });
          if (!response.ok) {
            const error = new Error(response.status === 429 ? 'rate' : 'http');
            error.status = response.status;
            throw error;
          }
          items = await response.json();
          if (!Array.isArray(items)) items = [];
          lyricsSearchCache.set(cacheKey, items);
        }
        successfulRequests += 1;
        const withLyrics = items.filter((item) => item && (hasLyricsText(item.plainLyrics) || hasLyricsText(item.syncedLyrics)));
        if (withLyrics.length) {
          results = withLyrics;
          scoringQuery = strategy.scoringTitle || currentSong.title;
          artistHint = strategy.artistHint || '';
          break;
        }
      } catch (error) {
        lastError = error;
        if (error?.message === 'rate') break;
      }
    }

    if (token !== lyricsSearchToken || currentSong?.id !== songId) return;
    if (!results.length) {
      if (lastError && successfulRequests === 0) {
        els.lyricsStatus.textContent = lastError.message === 'rate'
          ? '歌詞服務目前請求過多，請稍後再試。'
          : lastError.status
            ? '歌詞服務回應錯誤（HTTP ' + lastError.status + '），請稍後再試。'
            : '無法連線到歌詞服務。請確認網路連線後再試。';
      } else {
        els.lyricsStatus.textContent = '已嘗試 ' + strategies.length + ' 種歌名組合，仍找不到收錄的歌詞。可以試著選擇一首英文歌，或稍後再試。';
      }
      return;
    }

    const unique = new Map();
    results.forEach((result) => {
      const key = [result.trackName, result.artistName, result.duration].join('|');
      if (!unique.has(key)) unique.set(key, result);
    });
    const ranked = [...unique.values()]
      .map((result) => ({ result, score: scoreLyricsCandidate(result, scoringQuery, duration, artistHint) }))
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 1 && ranked[0].score >= 55) {
      displayLyricsResult(ranked[0].result);
    } else if (ranked.length > 1 && ranked[0].score >= 100 && ranked[0].score - ranked[1].score >= 12) {
      displayLyricsResult(ranked[0].result);
    } else {
      els.lyricsStatus.textContent = '找到幾個可能的版本，請選擇正確的歌曲：';
      renderLyricsCandidates(ranked);
    }
  }

  function applyCompactMode(enabled, { scroll = true } = {}) {
    compactMode = Boolean(enabled);
    els.playerCard.classList.toggle('is-compact', compactMode);
    els.videoCard.classList.toggle('is-compact-video', compactMode);
    try { localStorage.setItem(COMPACT_KEY, compactMode ? '1' : '0'); } catch (_) {}
    updateNowPlaying();
    if (!compactMode && scroll) els.playerCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function playerVideoId() {
    if (!playerReady) return '';
    try { return player.getVideoData?.().video_id || ''; } catch (_) { return ''; }
  }

  function loadCurrentSong({ autoplay = true, position = 0 } = {}) {
    if (!playerReady || !currentSong) return;
    const sameVideo = playerVideoId() === currentSong.videoId;
    try {
      if (sameVideo) {
        if (position > 0 && Math.abs((player.getCurrentTime?.() || 0) - position) > 3) player.seekTo(position, true);
        if (autoplay && player.getPlayerState?.() !== 1) player.playVideo();
        return;
      }
      const request = { videoId: currentSong.videoId, startSeconds: Math.max(0, Number(position) || 0) };
      if (autoplay) player.loadVideoById(request);
      else player.cueVideoById(request);
    } catch (_) {}
  }

  function setCurrentSong(song, playlistId, autoplay = true) {
    if (!song) return;
    const isSameSong = currentSong?.id === song.id && playbackPlaylistId === playlistId && (!playerReady || !playerVideoId() || playerVideoId() === song.videoId);
    currentSong = song;
    playbackPlaylistId = playlistId;
    pendingAutoplay = Boolean(autoplay);
    if (!isSameSong) playbackPrefs.position = 0;
    savePlaybackPrefs(isSameSong ? playbackPrefs.position : 0);
    updateNowPlaying();
    if (!isSameSong && !els.lyricsPanel.hidden) searchLyrics();
    renderSongList();
    if (playerReady) loadCurrentSong({ autoplay, position: isSameSong ? (player.getCurrentTime?.() || playbackPrefs.position || 0) : 0 });
  }

  function playSongById(songId) {
    const playlist = activePlaylist();
    const song = playlist.songs.find((item) => item.id === songId);
    if (song) setCurrentSong(song, playlist.id, true);
  }

  function ensureCurrentSong(autoplay = true) {
    if (currentSong) return true;
    const playlist = activePlaylist();
    if (!playlist.songs.length) {
      showToast('先加入一首歌');
      return false;
    }
    setCurrentSong(playlist.songs[0], playlist.id, autoplay);
    return true;
  }

  function togglePlayback() {
    if (!playerReady) {
      showToast('播放器正在準備中');
      return;
    }
    if (!ensureCurrentSong(true)) return;
    const status = player.getPlayerState?.();
    if (status === 1) player.pauseVideo();
    else player.playVideo();
  }

  function nextSong({ automatic = false } = {}) {
    const playlist = playbackPlaylist();
    if (!playlist?.songs.length) return;
    let index = Math.max(0, playlist.songs.findIndex((song) => song.id === currentSong?.id));
    if (shuffle && playlist.songs.length > 1) {
      let next = index;
      while (next === index) next = Math.floor(Math.random() * playlist.songs.length);
      index = next;
    } else if (index < playlist.songs.length - 1) {
      index += 1;
    } else if (repeatMode === 'all' || !automatic) {
      index = 0;
    } else {
      isPlaying = false;
      updateNowPlaying();
      return;
    }
    setCurrentSong(playlist.songs[index], playlist.id, true);
  }

  function previousSong() {
    if (playerReady && (player.getCurrentTime?.() || 0) > 5) {
      player.seekTo(0, true);
      return;
    }
    const playlist = playbackPlaylist();
    if (!playlist?.songs.length) return;
    let index = playlist.songs.findIndex((song) => song.id === currentSong?.id);
    index = index <= 0 ? playlist.songs.length - 1 : index - 1;
    setCurrentSong(playlist.songs[index], playlist.id, true);
  }

  function onPlayerStateChange(event) {
    isPlaying = event.data === 1;
    try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch (_) {}
    updateNowPlaying();
    if (event.data === 0) {
      if (repeatMode === 'one') player.playVideo();
      else nextSong({ automatic: true });
    }
  }

  function onPlayerError() {
    isPlaying = false;
    updateNowPlaying();
    if (currentSong) openReplaceDialog(currentSong.id, playbackPlaylistId, true);
    else showToast('這首影片目前無法播放');
  }

  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('youtubePlayer', {
      width: '100%', height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: () => {
          playerReady = true;
          applyVolume(volume);
          player.getIframe?.()?.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
          if (currentSong) {
            const savedPosition = Number(playbackPrefs.position) || 0;
            loadCurrentSong({ autoplay: pendingAutoplay, position: savedPosition });
          }
        },
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      }
    });
  };

  function loadYouTubeApi() {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  }

  function updateProgress() {
    if (!playerReady || !currentSong) return;
    try {
      const current = player.getCurrentTime() || 0;
      const duration = player.getDuration() || currentSong.duration || 0;
      if (document.activeElement !== els.progressBar) els.progressBar.value = duration ? Math.round(current / duration * 1000) : 0;
      els.currentTime.textContent = formatTime(current);
      els.durationTime.textContent = formatTime(duration);
      updateSyncedLyrics(current);
      if ('mediaSession' in navigator && duration > 0 && current >= 0 && current <= duration) {
        try { navigator.mediaSession.setPositionState({ duration, playbackRate: player.getPlaybackRate?.() || 1, position: current }); } catch (_) {}
      }
      if (Date.now() - lastPositionSave > 5000) { lastPositionSave = Date.now(); savePlaybackPrefs(current); }
    } catch (_) {}
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !currentSong) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title,
        artist: playbackPlaylist()?.name || 'yi Music',
        album: 'yi Music',
        artwork: [
          { src: thumbnail(currentSong.videoId), sizes: '320x180', type: 'image/jpeg' },
          { src: thumbnail(currentSong.videoId, 'hqdefault'), sizes: '480x360', type: 'image/jpeg' }
        ]
      });
    } catch (_) {}
  }

  function setMediaHandlers() {
    if (!('mediaSession' in navigator)) return;
    const handlers = {
      play: () => playerReady && player.playVideo(), pause: () => playerReady && player.pauseVideo(),
      nexttrack: () => nextSong(), previoustrack: previousSong,
      seekbackward: (details) => playerReady && player.seekTo(Math.max(0, (player.getCurrentTime?.() || 0) - (details.seekOffset || 10)), true),
      seekforward: (details) => playerReady && player.seekTo(Math.min(player.getDuration?.() || Infinity, (player.getCurrentTime?.() || 0) + (details.seekOffset || 10)), true),
      seekto: (details) => playerReady && player.seekTo(details.seekTime || 0, true),
      stop: () => { if (playerReady) player.stopVideo(); isPlaying = false; updateNowPlaying(); }
    };
    Object.entries(handlers).forEach(([name, handler]) => { try { navigator.mediaSession.setActionHandler(name, handler); } catch (_) {} });
  }

  async function getVideoTitle(videoId) {
    try {
      const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
      const response = await fetch(url);
      if (response.ok) return (await response.json()).title || '';
    } catch (_) {}
    return '';
  }

  function addSong({ videoId, title, playlistId }) {
    const playlist = state.playlists.find((p) => p.id === playlistId);
    if (!playlist) throw new Error('找不到歌單');
    if (playlist.songs.some((song) => song.videoId === videoId)) throw new Error('這首歌已經在歌單裡');
    const song = { id: uid('song'), videoId, title: title || 'YouTube 歌曲', duration: 0, source: 'YouTube' };
    playlist.songs.unshift(song);
    saveState();
    renderAll();
    return song;
  }

  function createPlaylist(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('請輸入歌單名稱');
    const playlist = { id: uid('playlist'), name: trimmed, createdAt: Date.now(), songs: [] };
    state.playlists.push(playlist);
    state.activePlaylistId = playlist.id;
    saveState();
    renderAll();
    return playlist;
  }

  function moveSongOrder(songId, direction) {
    const playlist = activePlaylist();
    const index = playlist.songs.findIndex((song) => song.id === songId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= playlist.songs.length) return;
    [playlist.songs[index], playlist.songs[target]] = [playlist.songs[target], playlist.songs[index]];
    saveState();
    renderSongList();
    document.querySelector(`[data-song-id="${CSS.escape(songId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function deleteSong(songId) {
    const playlist = activePlaylist();
    const song = playlist.songs.find((item) => item.id === songId);
    if (!song || !confirm(`要從「${playlist.name}」刪除「${song.title}」嗎？`)) return;
    markOriginalSongRemoved(song);
    playlist.songs = playlist.songs.filter((item) => item.id !== songId);
    if (currentSong?.id === songId && playbackPlaylistId === playlist.id) {
      currentSong = null;
      isPlaying = false;
      try { player?.stopVideo(); } catch (_) {}
      savePlaybackPrefs(0);
      updateNowPlaying();
    }
    saveState();
    renderSongList();
    showToast('已從歌單刪除');
  }

  function moveSongToPosition(songId) {
    const playlist = activePlaylist();
    const index = playlist.songs.findIndex((song) => song.id === songId);
    if (index < 0) return;
    const input = prompt(`要把這首歌移到第幾首？\n請輸入 1～${playlist.songs.length}`, String(index + 1));
    if (input === null) return;
    const target = Math.min(playlist.songs.length, Math.max(1, Number.parseInt(input, 10) || 0)) - 1;
    if (target < 0 || target === index) return;
    const [song] = playlist.songs.splice(index, 1);
    playlist.songs.splice(target, 0, song);
    saveState();
    renderSongList();
    document.querySelector(`[data-song-id="${CSS.escape(songId)}"]`)?.scrollIntoView({ block: 'center' });
  }

  function openMoveDialog(songId) {
    const song = activePlaylist().songs.find((item) => item.id === songId);
    const destinations = state.playlists.filter((p) => p.id !== state.activePlaylistId);
    if (!destinations.length) {
      showToast('請先新增另一個歌單');
      return;
    }
    movingSongId = songId;
    els.moveSongTitle.textContent = song?.title || '';
    els.moveToPlaylistSelect.innerHTML = destinations.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    els.moveSongDialog.showModal();
  }

  function openReplaceDialog(songId, playlistId = state.activePlaylistId, fromPlaybackError = false) {
    const playlist = state.playlists.find((p) => p.id === playlistId);
    const song = playlist?.songs.find((item) => item.id === songId);
    if (!song) return;
    replaceTarget = { songId, playlistId, fromPlaybackError };
    els.replaceOriginalTitle.textContent = song.title;
    els.replacementTitleInput.value = song.title;
    els.replacementUrlInput.value = '';
    els.replaceSongError.textContent = '';
    els.searchYoutubeLink.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(song.title)}`;
    els.skipUnavailableButton.hidden = !fromPlaybackError;
    if (!els.replaceSongDialog.open) els.replaceSongDialog.showModal();
  }

  function openPlaylistDialog(mode) {
    playlistDialogMode = mode;
    const playlist = activePlaylist();
    els.playlistDialogTitle.textContent = mode === 'rename' ? '重新命名歌單' : '新增歌單';
    els.playlistSubmitButton.textContent = mode === 'rename' ? '儲存名稱' : '建立歌單';
    els.playlistNameInput.value = mode === 'rename' ? playlist.name : '';
    els.playlistDialog.showModal();
    setTimeout(() => els.playlistNameInput.focus(), 30);
  }

  async function enterBlackScreen() {
    els.blackScreen.hidden = false;
    document.body.style.overflow = 'hidden';
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        showToast('黑屏模式已開啟');
      } else {
        showToast('這台手機不支援保持喚醒，可能仍會自動鎖定');
      }
    } catch (_) {
      showToast('無法保持喚醒，請暫時把自動鎖定設為「永不」');
    }
  }

  async function exitBlackScreen() {
    els.blackScreen.hidden = true;
    document.body.style.overflow = '';
    try { await wakeLock?.release(); } catch (_) {}
    wakeLock = null;
  }

  function exportLibrary() {
    const payload = { app: 'yi Music', exportedAt: new Date().toISOString(), ...state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `yi-music-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('歌單備份已下載');
  }

  function readBackupFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  async function importLibrary(file) {
    try {
      const data = JSON.parse((await readBackupFile(file)).replace(/^\uFEFF/, ''));
      if (!Array.isArray(data.playlists) || !data.playlists.length) throw new Error('format');
      const ids = new Set();
      const valid = data.playlists.every((p) => {
        if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.songs) || ids.has(p.id)) return false;
        ids.add(p.id);
        const songIds = new Set();
        return p.songs.every((s) => {
          if (!s || typeof s.id !== 'string' || songIds.has(s.id) || typeof s.videoId !== 'string' ||
              !/^[\\w-]{11}$/.test(s.videoId) || typeof s.title !== 'string' || !s.title.trim()) return false;
          songIds.add(s.id);
          return true;
        });
      });
      if (!valid) throw new Error('format');
      if (!confirm('匯入備份會取代目前所有歌單，確定繼續嗎？')) return;
      const deleted = new Set(Array.isArray(data.deletedOriginalSongIds) ? data.deletedOriginalSongIds.filter(id => typeof id === 'string') : []);
      for (const original of makeDefaultPlaylists()) {
        const imported = data.playlists.find(p => p.id === original.id);
        if (!imported) continue;
        const importedIds = new Set(imported.songs.map(song => song.id));
        for (const song of original.songs) if (!importedIds.has(song.id)) deleted.add(song.id);
      }
      const nextState = { version: 3, playlists: data.playlists.map((playlist) => ({ ...playlist, songs: data.newestFirst === true ? playlist.songs : [...playlist.songs].reverse() })), activePlaylistId: ids.has(data.activePlaylistId) ? data.activePlaylistId : data.playlists[0].id, deletedOriginalSongIds: [...deleted], newestFirst: true };
      const saved = JSON.stringify(nextState);
      try {
        localStorage.setItem(STORAGE_KEY, saved);
        if (localStorage.getItem(STORAGE_KEY) !== saved) throw new Error('storage');
      } catch (_) {
        showToast('手機儲存空間不足或瀏覽器禁止儲存，請先釋出空間再匯入');
        return;
      }
      if (playerReady) { try { player.stopVideo(); } catch (_) {} }
      isPlaying = false;
      state = nextState;
      playbackPlaylistId = state.activePlaylistId;
      currentSong = null;
      savePlaybackPrefs(0);
      renderAll();
      els.settingsDialog.close();
      showToast('已匯入 ' + state.playlists.length + ' 個歌單');
    } catch (error) {
      showToast(error.message === 'read' ? '無法讀取檔案，請從手機「檔案」App 選擇 JSON 備份' : '這不是有效的 yi Music 備份檔');
    } finally {
      els.importFileInput.value = '';
    }
  }

  function restoreMb3Playlists() {
    const originals = makeDefaultPlaylists();
    let addedPlaylists = 0;
    let addedSongs = 0;
    for (const original of originals) {
      let saved = state.playlists.find((p) => p.id === original.id);
      if (!saved) {
        state.playlists.push(original);
        addedPlaylists += 1;
        addedSongs += original.songs.length;
        continue;
      }
      const ids = new Set(saved.songs.map((song) => song.id));
      const videos = new Set(saved.songs.map((song) => song.videoId));
      const missing = original.songs.filter((song) => !ids.has(song.id) && !videos.has(song.videoId));
      saved.songs.push(...missing);
      addedSongs += missing.length;
    }
    state.deletedOriginalSongIds = [];
    saveState();
    renderAll();
    els.settingsDialog.close();
    showToast(addedPlaylists || addedSongs ? `已補回 ${addedPlaylists} 個歌單、${addedSongs} 首歌曲` : '原始 MB3 歌單已經完整');
  }

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const register = (tool) => { try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch (_) {} };
    register({
      name: 'list_playlists', title: '列出歌單', description: '列出 yi Music 內的歌單名稱、ID 與歌曲數量。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() { return { playlists: state.playlists.map((p) => ({ id: p.id, name: p.name, songCount: p.songs.length })) }; }
    });
    register({
      name: 'create_playlist', title: '建立歌單', description: '在 yi Music 建立一個空白歌單。',
      inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 40 } }, required: ['name'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) { const playlist = createPlaylist(input?.name); return { id: playlist.id, name: playlist.name, songCount: 0 }; }
    });
    register({
      name: 'add_youtube_song', title: '加入 YouTube 歌曲', description: '把一首 YouTube 歌曲加入指定的 yi Music 歌單。',
      inputSchema: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' }, playlistId: { type: 'string' } }, required: ['url', 'title', 'playlistId'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute(input) { const videoId = extractVideoId(input?.url); if (!videoId) throw new Error('無效的 YouTube 網址'); const song = addSong({ videoId, title: String(input.title || '').trim(), playlistId: input.playlistId }); return { id: song.id, videoId: song.videoId, title: song.title, playlistId: input.playlistId }; }
    });
  }

  els.playlistSelect.addEventListener('change', () => {
    state.activePlaylistId = els.playlistSelect.value;
    saveState();
    els.searchInput.value = '';
    visibleSongLimit = PAGE_SIZE;
    renderAll();
  });
  els.searchInput.addEventListener('input', () => { visibleSongLimit = PAGE_SIZE; renderSongList(); });
  els.organizeButton.addEventListener('click', () => {
    organizeMode = !organizeMode;
    els.organizeButton.textContent = organizeMode ? '完成' : '整理';
    els.organizeButton.classList.toggle('active', organizeMode);
    els.organizeBar.hidden = !organizeMode;
    renderSongList();
  });
  els.songList.addEventListener('click', (event) => {
    if (event.target.closest('[data-load-more]')) { visibleSongLimit += PAGE_SIZE; renderSongList(); return; }
    const emptyAdd = event.target.closest('[data-empty-add]');
    if (emptyAdd) return els.addSongButton.click();
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'play') playSongById(id);
    if (action === 'up') moveSongOrder(id, -1);
    if (action === 'down') moveSongOrder(id, 1);
    if (action === 'move') openMoveDialog(id);
    if (action === 'replace') openReplaceDialog(id);
    if (action === 'position') moveSongToPosition(id);
    if (action === 'delete') deleteSong(id);
  });
  els.playButton.addEventListener('click', togglePlayback);
  els.miniPlayButton.addEventListener('click', togglePlayback);
  els.nextButton.addEventListener('click', () => nextSong());
  els.miniNextButton.addEventListener('click', () => nextSong());
  els.previousButton.addEventListener('click', previousSong);
  els.shuffleButton.addEventListener('click', () => { shuffle = !shuffle; savePlaybackPrefs(); els.shuffleButton.classList.toggle('active', shuffle); showToast(shuffle ? '已開啟隨機播放' : '已關閉隨機播放'); });
  els.repeatButton.addEventListener('click', () => {
    repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    els.repeatButton.classList.toggle('active', repeatMode !== 'off');
    els.repeatButton.textContent = repeatMode === 'one' ? '↻¹' : '↻';
    savePlaybackPrefs();
    showToast(repeatMode === 'one' ? '單曲循環' : repeatMode === 'all' ? '歌單循環' : '循環已關閉');
  });
  els.volumeSlider.addEventListener('input', () => applyVolume(els.volumeSlider.value));
  els.muteButton.addEventListener('click', () => applyVolume(volume === 0 ? previousVolume : 0));
  els.progressBar.addEventListener('change', () => {
    if (!playerReady) return;
    const duration = player.getDuration?.() || 0;
    player.seekTo(duration * Number(els.progressBar.value) / 1000, true);
  });
  els.miniInfo.addEventListener('click', () => document.querySelector('.player-card').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  els.blackScreenButton.addEventListener('click', enterBlackScreen);
  els.compactBlackScreenButton.addEventListener('click', enterBlackScreen);
  els.exitBlackScreen.addEventListener('click', exitBlackScreen);
  els.blackScreen.addEventListener('dblclick', exitBlackScreen);
  els.viewModeButton.addEventListener('click', () => applyViewMode(viewMode === 'mv' ? 'radio' : 'mv', { scroll: true }));
  els.lyricsButton.addEventListener('click', () => setLyricsPanelOpen(els.lyricsPanel.hidden));
  els.lyricsRetryButton.addEventListener('click', () => searchLyrics({ force: true }));
  els.lyricsCloseButton.addEventListener('click', () => setLyricsPanelOpen(false));
  els.lyricsCandidates.addEventListener('click', (event) => {
    const button = event.target.closest('[data-lyrics-index]');
    if (!button) return;
    const result = lyricsSearchResults[Number(button.dataset.lyricsIndex)];
    if (result) displayLyricsResult(result);
  });
  els.compactPlayerButton.addEventListener('click', () => applyCompactMode(true));
  els.compactRestoreButton.addEventListener('click', () => applyCompactMode(false));

  els.addSongButton.addEventListener('click', () => { renderPlaylistSelectors(); els.addSongError.textContent = ''; els.addSongForm.reset(); els.addToPlaylistSelect.value = state.activePlaylistId; els.addSongDialog.showModal(); setTimeout(() => els.songUrlInput.focus(), 30); });
  els.addSongForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    els.addSongError.textContent = '';
    const videoId = extractVideoId(els.songUrlInput.value);
    if (!videoId) { els.addSongError.textContent = '請貼上有效的 YouTube 網址或影片 ID'; return; }
    let title = els.songTitleInput.value.trim();
    if (!title) { els.addSongError.textContent = '正在取得歌曲名稱…'; title = await getVideoTitle(videoId); }
    try {
      addSong({ videoId, title: title || 'YouTube 歌曲', playlistId: els.addToPlaylistSelect.value });
      els.addSongDialog.close();
      showToast('歌曲已加入歌單');
    } catch (error) { els.addSongError.textContent = error.message; }
  });

  els.newPlaylistButton.addEventListener('click', () => openPlaylistDialog('create'));
  els.renamePlaylistButton.addEventListener('click', () => openPlaylistDialog('rename'));
  els.playlistForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = els.playlistNameInput.value.trim();
    if (!name) return;
    if (playlistDialogMode === 'rename') { activePlaylist().name = name; saveState(); renderAll(); showToast('歌單名稱已更新'); }
    else { createPlaylist(name); showToast('新歌單已建立'); }
    els.playlistDialog.close();
  });
  els.deletePlaylistButton.addEventListener('click', () => {
    if (state.playlists.length <= 1) return;
    const playlist = activePlaylist();
    if (!confirm(`刪除「${playlist.name}」及其中 ${playlist.songs.length} 首歌曲嗎？`)) return;
    state.playlists = state.playlists.filter((p) => p.id !== playlist.id);
    state.activePlaylistId = state.playlists[0].id;
    if (playbackPlaylistId === playlist.id) {
      playbackPlaylistId = state.activePlaylistId;
      currentSong = null;
      isPlaying = false;
      try { player?.stopVideo(); } catch (_) {}
      savePlaybackPrefs(0);
    }
    saveState(); renderAll(); showToast('歌單已刪除');
  });
  els.moveSongForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const source = activePlaylist();
    const song = source.songs.find((item) => item.id === movingSongId);
    const destination = state.playlists.find((p) => p.id === els.moveToPlaylistSelect.value);
    if (!song || !destination) return;
    if (destination.songs.some((item) => item.videoId === song.videoId)) { showToast('目的歌單已經有這首歌'); return; }
    markOriginalSongRemoved(song);
    source.songs = source.songs.filter((item) => item.id !== song.id);
    destination.songs.push(song);
    saveState(); renderSongList(); els.moveSongDialog.close(); showToast(`已移到「${destination.name}」`);
  });

  els.replaceSongForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!replaceTarget) return;
    els.replaceSongError.textContent = '';
    const videoId = extractVideoId(els.replacementUrlInput.value);
    if (!videoId) { els.replaceSongError.textContent = '請貼上有效的 YouTube 網址或影片 ID'; return; }
    const playlist = state.playlists.find((p) => p.id === replaceTarget.playlistId);
    const song = playlist?.songs.find((item) => item.id === replaceTarget.songId);
    if (!song) { els.replaceSongError.textContent = '找不到原本的歌曲'; return; }
    let title = els.replacementTitleInput.value.trim();
    if (!title) { els.replaceSongError.textContent = '正在取得歌曲名稱…'; title = await getVideoTitle(videoId); }
    song.videoId = videoId;
    song.title = title || song.title;
    song.duration = 0;
    song.source = '替代版本';
    saveState();
    els.replaceSongDialog.close();
    replaceTarget = null;
    if (currentSong?.id === song.id) {
      currentSong = song;
      setCurrentSong(song, playlist.id, true);
    } else {
      renderSongList();
    }
    showToast('已換成新的 YouTube 版本');
  });
  els.skipUnavailableButton.addEventListener('click', () => {
    els.replaceSongDialog.close();
    replaceTarget = null;
    nextSong({ automatic: true });
  });

  els.settingsButton.addEventListener('click', () => els.settingsDialog.showModal());
  els.exportButton.addEventListener('click', exportLibrary);
  els.importFileInput.addEventListener('change', () => { const file = els.importFileInput.files?.[0]; if (file) importLibrary(file); });
  els.restoreMb3Button.addEventListener('click', restoreMb3Playlists);
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      wasPlayingBeforeHidden = Boolean(playerReady && player.getPlayerState?.() === 1);
      if (playerReady) savePlaybackPrefs(player.getCurrentTime?.() || 0);
    }
    if (document.visibilityState === 'visible' && wasPlayingBeforeHidden && playerReady && player.getPlayerState?.() !== 1) {
      try { player.playVideo(); } catch (_) {}
    }
    if (document.visibilityState === 'visible' && !els.blackScreen.hidden && 'wakeLock' in navigator && !wakeLock) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
    }
  });
  window.addEventListener('pagehide', () => { if (playerReady) savePlaybackPrefs(player.getCurrentTime?.() || 0); });

  applyVolume(volume);
  const savedPlaybackPlaylist = state.playlists.find((p) => p.id === playbackPlaylistId);
  currentSong = savedPlaybackPlaylist?.songs.find((song) => song.id === playbackPrefs.songId) || null;
  els.shuffleButton.classList.toggle('active', shuffle);
  els.repeatButton.classList.toggle('active', repeatMode !== 'off');
  els.repeatButton.textContent = repeatMode === 'one' ? '↻¹' : '↻';
  applyViewMode(viewMode, { scroll: false });
  applyCompactMode(compactMode, { scroll: false });
  renderAll();
  loadYouTubeApi();
  setMediaHandlers();
  registerWebMcpTools();
  setInterval(updateProgress, 500);
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
