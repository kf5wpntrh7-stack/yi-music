(() => {
  'use strict';

  const STORAGE_KEY = 'yi-music-library-v1';
  const VOLUME_KEY = 'yi-music-volume-v1';
  const PRIMARY_PLAYLIST_ID = 'mb3-537';
  const $ = (id) => document.getElementById(id);
  const els = {
    playerPlaceholder: $('playerPlaceholder'), nowTitle: $('nowTitle'), nowPlaylist: $('nowPlaylist'),
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
    blackTitle: $('blackTitle'), toast: $('toast')
  };

  let state = loadState();
  let player = null;
  let playerReady = false;
  let isPlaying = false;
  let currentSong = null;
  let playbackPlaylistId = state.activePlaylistId;
  let organizeMode = false;
  let playlistDialogMode = 'create';
  let movingSongId = null;
  let replaceTarget = null;
  let shuffle = false;
  let repeatMode = 'off';
  const storedVolume = localStorage.getItem(VOLUME_KEY);
  let volume = storedVolume === null ? 80 : Math.min(100, Math.max(0, Number(storedVolume) || 0));
  let previousVolume = volume || 80;
  let wakeLock = null;
  let toastTimer = null;

  function makeDefaultPlaylists() {
    const imported = Array.isArray(window.MB3_PLAYLISTS) ? window.MB3_PLAYLISTS : [];
    return imported.map((playlist, index) => ({
      id: playlist.id,
      sourceId: playlist.sourceId,
      name: playlist.name,
      createdAt: Date.now() + index,
      songs: Array.isArray(playlist.songs) ? playlist.songs.map((song) => ({ ...song })) : []
    }));
  }

  function loadState() {
    const originals = makeDefaultPlaylists();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.playlists) && saved.playlists.length) {
        const savedById = new Map(saved.playlists.map((playlist) => [playlist.id, playlist]));
        const originalIds = new Set(originals.map((playlist) => playlist.id));
        const mergedOriginals = originals.map((original) => {
          const existing = savedById.get(original.id);
          if (!existing) return original;
          if (original.id === PRIMARY_PLAYLIST_ID && existing.name === 'MB3・537') existing.name = '537';
          const knownIds = new Set(existing.songs.map((song) => song.id));
          const knownVideos = new Set(existing.songs.map((song) => song.videoId));
          const missingSongs = original.songs.filter((song) => !knownIds.has(song.id) && !knownVideos.has(song.videoId));
          return { ...existing, sourceId: original.sourceId, songs: [...existing.songs, ...missingSongs] };
        });
        const customPlaylists = saved.playlists.filter((playlist) => !originalIds.has(playlist.id));
        const playlists = [...mergedOriginals, ...customPlaylists];
        const activeExists = playlists.some((playlist) => playlist.id === saved.activePlaylistId);
        const migrated = { version: 2, playlists, activePlaylistId: activeExists ? saved.activePlaylistId : PRIMARY_PLAYLIST_ID };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (_) {}
    return { version: 2, playlists: originals, activePlaylistId: PRIMARY_PLAYLIST_ID };
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
    const songs = playlist.songs.filter((song) => !query || song.title.toLocaleLowerCase().includes(query));
    els.songCount.textContent = query ? `${songs.length}／${playlist.songs.length} 首` : `${playlist.songs.length} 首`;
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
        <button class="move-song" type="button" data-action="move" data-id="${escapeHtml(song.id)}">移動</button>
        <button class="delete-song" type="button" data-action="delete" data-id="${escapeHtml(song.id)}" aria-label="刪除">刪</button>
      </div>` : `<button class="row-play" type="button" data-action="play" data-id="${escapeHtml(song.id)}" aria-label="播放">▶</button>`;
      return `<article class="song-row${currentClass}" data-song-id="${escapeHtml(song.id)}">
        <button class="song-main" type="button" data-action="play" data-id="${escapeHtml(song.id)}">
          <img src="${thumbnail(song.videoId)}" alt="" loading="lazy">
          <span class="song-copy"><span class="song-title">${escapeHtml(song.title)}</span><span class="song-meta"><span class="song-index">${index + 1}</span>・${formatTime(song.duration)}</span></span>
        </button>${tools}</article>`;
    }).join('');
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
    els.miniPlayer.hidden = !currentSong;
    if (currentSong) {
      els.miniThumb.src = thumbnail(currentSong.videoId);
      els.miniTitle.textContent = currentSong.title;
      els.miniPlaylist.textContent = playlist?.name || '';
      updateMediaSession();
    }
  }

  function setCurrentSong(song, playlistId, autoplay = true) {
    if (!song) return;
    currentSong = song;
    playbackPlaylistId = playlistId;
    updateNowPlaying();
    renderSongList();
    if (playerReady) {
      if (autoplay) player.loadVideoById(song.videoId);
      else player.cueVideoById(song.videoId);
    }
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
      width: '100%', height: '100%', videoId: currentSong?.videoId || '',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: () => { playerReady = true; applyVolume(volume); if (currentSong) player.cueVideoById(currentSong.videoId); },
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
    const handlers = { play: () => playerReady && player.playVideo(), pause: () => playerReady && player.pauseVideo(), nexttrack: () => nextSong(), previoustrack: previousSong };
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
    playlist.songs.push(song);
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
    playlist.songs = playlist.songs.filter((item) => item.id !== songId);
    saveState();
    renderSongList();
    showToast('已從歌單刪除');
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

  async function importLibrary(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.playlists) || !data.playlists.length) throw new Error();
      const valid = data.playlists.every((p) => p.id && p.name && Array.isArray(p.songs) && p.songs.every((s) => s.id && s.videoId && s.title));
      if (!valid) throw new Error();
      if (!confirm('匯入備份會取代目前所有歌單，確定繼續嗎？')) return;
      state = { version: 1, playlists: data.playlists, activePlaylistId: data.playlists.some((p) => p.id === data.activePlaylistId) ? data.activePlaylistId : data.playlists[0].id };
      playbackPlaylistId = state.activePlaylistId;
      currentSong = null;
      saveState();
      renderAll();
      els.settingsDialog.close();
      showToast('歌單備份已匯入');
    } catch (_) {
      showToast('這不是有效的 yi Music 備份檔');
    } finally {
      els.importFileInput.value = '';
    }
  }

  function restoreMb3Playlists() {
    const freshPlaylists = makeDefaultPlaylists().map((playlist) => {
      if (!state.playlists.some((saved) => saved.id === playlist.id)) return playlist;
      return { ...playlist, id: uid('mb3'), name: `${playlist.name}（原始）` };
    });
    state.playlists.push(...freshPlaylists);
    state.activePlaylistId = freshPlaylists[0]?.id || state.activePlaylistId;
    saveState();
    renderAll();
    els.settingsDialog.close();
    const songCount = freshPlaylists.reduce((total, playlist) => total + playlist.songs.length, 0);
    showToast(`已加入 5 個 MB3 歌單，共 ${songCount} 首`);
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
    renderAll();
  });
  els.searchInput.addEventListener('input', renderSongList);
  els.organizeButton.addEventListener('click', () => {
    organizeMode = !organizeMode;
    els.organizeButton.textContent = organizeMode ? '完成' : '整理';
    els.organizeButton.classList.toggle('active', organizeMode);
    els.organizeBar.hidden = !organizeMode;
    renderSongList();
  });
  els.songList.addEventListener('click', (event) => {
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
    if (action === 'delete') deleteSong(id);
  });
  els.playButton.addEventListener('click', togglePlayback);
  els.miniPlayButton.addEventListener('click', togglePlayback);
  els.nextButton.addEventListener('click', () => nextSong());
  els.miniNextButton.addEventListener('click', () => nextSong());
  els.previousButton.addEventListener('click', previousSong);
  els.shuffleButton.addEventListener('click', () => { shuffle = !shuffle; els.shuffleButton.classList.toggle('active', shuffle); showToast(shuffle ? '已開啟隨機播放' : '已關閉隨機播放'); });
  els.repeatButton.addEventListener('click', () => {
    repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    els.repeatButton.classList.toggle('active', repeatMode !== 'off');
    els.repeatButton.textContent = repeatMode === 'one' ? '↻¹' : '↻';
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
  els.exitBlackScreen.addEventListener('click', exitBlackScreen);
  els.blackScreen.addEventListener('dblclick', exitBlackScreen);

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
    saveState(); renderAll(); showToast('歌單已刪除');
  });
  els.moveSongForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const source = activePlaylist();
    const song = source.songs.find((item) => item.id === movingSongId);
    const destination = state.playlists.find((p) => p.id === els.moveToPlaylistSelect.value);
    if (!song || !destination) return;
    if (destination.songs.some((item) => item.videoId === song.videoId)) { showToast('目的歌單已經有這首歌'); return; }
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
  els.importButton.addEventListener('click', () => els.importFileInput.click());
  els.importFileInput.addEventListener('change', () => { const file = els.importFileInput.files?.[0]; if (file) importLibrary(file); });
  els.restoreMb3Button.addEventListener('click', restoreMb3Playlists);
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !els.blackScreen.hidden && 'wakeLock' in navigator && !wakeLock) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
    }
  });

  applyVolume(volume);
  renderAll();
  loadYouTubeApi();
  setMediaHandlers();
  registerWebMcpTools();
  setInterval(updateProgress, 500);
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
