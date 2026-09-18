(function () {
  "use strict";

  let config = { eventDate: "", schedules: [] };
  let albumConfig = [];
  let currentAlbumIndex = 0;
  let schedules = [];
  let now;
  let todayKey;
  let todaySchedule;
  let loading = false;
  let lastPayload = "";
  let lastDate = "";
  let hasLoaded = false;

  const elements = {
    currentDate: document.querySelector("#currentDate"),
    eventDate: document.querySelector("#eventDate"),
    countdownDays: document.querySelector("#countdownDays"),
    countdownProgress: document.querySelector("#countdownProgress"),
    countdownCopy: document.querySelector("#countdownCopy"),
    todaySongs: document.querySelector("#todaySongs"),
    todayStatus: document.querySelector("#todayStatus"),
    todayStatusText: document.querySelector("#todayStatusText"),
    scheduleList: document.querySelector("#scheduleList"),
    ambientToggle: document.querySelector("#ambientToggle"),
    ambientHint: document.querySelector("#ambientHint"),
    albumShowcase: document.querySelector("#albumShowcase"),
    albumCarousel: document.querySelector("#albumCarousel"),
    albumProgress: document.querySelector("#albumProgress"),
    albumTitle: document.querySelector("#albumTitle"),
    albumOpenLink: document.querySelector("#albumOpenLink"),
    toast: document.querySelector("#toast")
  };

  let ambientPlayer = null;
  let suppressAlbumClickUntil = 0;

  elements.todaySongs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-song]");
    if (button) copySongName(button.dataset.copySong);
  });

  elements.ambientToggle.addEventListener("click", toggleAmbient);
  elements.albumShowcase.addEventListener("click", handleAlbumClick);
  elements.albumShowcase.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      changeAlbum(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      changeAlbum(1);
    }
  });

  const albumPointer = {
    id: null,
    startX: 0,
    startY: 0,
    distanceX: 0,
    distanceY: 0,
    isHorizontal: false
  };

  elements.albumCarousel.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    albumPointer.id = event.pointerId;
    albumPointer.startX = event.clientX;
    albumPointer.startY = event.clientY;
    albumPointer.distanceX = 0;
    albumPointer.distanceY = 0;
    albumPointer.isHorizontal = false;
  });

  elements.albumCarousel.addEventListener("pointermove", (event) => {
    if (event.pointerId !== albumPointer.id) return;
    albumPointer.distanceX = event.clientX - albumPointer.startX;
    albumPointer.distanceY = event.clientY - albumPointer.startY;

    if (!albumPointer.isHorizontal
      && Math.abs(albumPointer.distanceX) > 8
      && Math.abs(albumPointer.distanceX) > Math.abs(albumPointer.distanceY)) {
      albumPointer.isHorizontal = true;
      elements.albumCarousel.setPointerCapture?.(event.pointerId);
      elements.albumCarousel.classList.add("is-dragging");
    }

    if (albumPointer.isHorizontal) event.preventDefault();
  }, { passive: false });

  elements.albumCarousel.addEventListener("pointerup", (event) => {
    if (event.pointerId !== albumPointer.id) return;
    const shouldChangeAlbum = albumPointer.isHorizontal && Math.abs(albumPointer.distanceX) > 44;
    if (albumPointer.isHorizontal) suppressAlbumClickUntil = Date.now() + 350;
    if (shouldChangeAlbum) changeAlbum(albumPointer.distanceX > 0 ? -1 : 1);
    resetAlbumPointer(event.pointerId);
  });

  elements.albumCarousel.addEventListener("pointercancel", (event) => {
    if (event.pointerId === albumPointer.id) resetAlbumPointer(event.pointerId);
  });
  elements.albumCarousel.addEventListener("dragstart", (event) => event.preventDefault());

  refresh();
  // 在线页面每分钟获取新配置；重新回到页面时也立即检查。
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener("online", refresh);

  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      let payload;
      let albumPayload;
      if (location.protocol === "file:") {
        payload = document.querySelector("#offlineSongs").textContent;
        albumPayload = document.querySelector("#offlineAlbums").textContent;
      } else {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const stamp = Date.now();
          const [songResponse, albumResponse] = await Promise.all([
            fetch(`./songs.json?v=${stamp}`, { cache: "no-store", signal: controller.signal }),
            fetch(`./albums.json?v=${stamp}`, { cache: "no-store", signal: controller.signal })
          ]);
          if (!songResponse.ok) throw new Error(`歌单请求失败：${songResponse.status}`);
          if (!albumResponse.ok) throw new Error(`专辑请求失败：${albumResponse.status}`);
          [payload, albumPayload] = await Promise.all([songResponse.text(), albumResponse.text()]);
        } finally {
          clearTimeout(timeout);
        }
      }
      const next = JSON.parse(payload);
      const nextAlbums = JSON.parse(albumPayload);
      validateConfig(next);
      validateAlbums(nextAlbums);
      const current = new Date();
      const key = toDateKey(current);
      const combinedPayload = `${payload}\n${albumPayload}`;
      if (combinedPayload !== lastPayload || key !== lastDate) {
        config = next;
        albumConfig = nextAlbums.albums;
        const featuredIndex = albumConfig.findIndex((album) => album.title === nextAlbums.featuredAlbum);
        if (!hasLoaded || currentAlbumIndex >= albumConfig.length) {
          currentAlbumIndex = featuredIndex >= 0 ? featuredIndex : 0;
        }
        schedules = [...config.schedules].sort((a, b) => a.date.localeCompare(b.date));
        now = current;
        todayKey = key;
        todaySchedule = schedules.find((item) => item.date === todayKey);
        renderCurrentDate();
        renderCountdown();
        renderTodaySongs();
        renderSchedule();
        renderAlbumCarousel();
        lastPayload = combinedPayload;
        lastDate = key;
      }
      hasLoaded = true;
      elements.todayStatusText.textContent = todaySchedule ? "今日播放" : "暂无安排";
    } catch (error) {
      // 失败不覆盖已加载的歌单，也不把错误伪装成“暂无安排”。
      elements.todayStatusText.textContent = hasLoaded ? "更新暂不可用" : "加载失败";
      if (!hasLoaded) {
        now = new Date();
        renderCurrentDate();
        elements.todaySongs.innerHTML = '<div class="empty-state"><strong>歌单暂时无法加载</strong><p>请检查网络后刷新页面，稍后也会自动重试。</p></div>';
      }
    } finally {
      loading = false;
    }
  }

  function validateConfig(data) {
    const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && toDateKey(parseLocalDate(value)) === value;
    const validSong = (song) => song && typeof song.title === "string"
      && song.title.trim() && typeof song.message === "string";
    if (!data || !validDate(data.countdownStartDate) || !validDate(data.eventDate)
      || data.countdownStartDate >= data.eventDate || !Array.isArray(data.schedules)) {
      throw new Error("歌单配置格式错误");
    }
    const dates = new Set();
    const bufferTitles = new Set();
    data.schedules.forEach((day) => {
      if (!day || !validDate(day.date) || dates.has(day.date)
        || !Array.isArray(day.songs) || day.songs.length !== 2
        || day.songs.some((song) => !validSong(song)) || !validSong(day.bufferSong)
        || bufferTitles.has(day.bufferSong.title)
        || day.songs.some((song) => song.title === day.bufferSong.title)) {
        throw new Error("每天需要两首主题歌曲和一首不重复的补位歌曲，且日期不能重复");
      }
      dates.add(day.date);
      bufferTitles.add(day.bufferSong.title);
    });
  }

  function validateAlbums(data) {
    if (!data || !Array.isArray(data.albums) || !data.albums.length) {
      throw new Error("专辑配置格式错误");
    }
    const names = new Set();
    data.albums.forEach((album) => {
      if (!album || typeof album.title !== "string" || !album.title.trim()
        || names.has(album.title) || typeof album.image !== "string"
        || !album.image.startsWith("./assets/albums/")
        || typeof album.url !== "string"
        || !/^https:\/\/music\.163\.com\/#\/album\?id=\d+$/.test(album.url)) {
        throw new Error("专辑配置内容错误");
      }
      names.add(album.title);
    });
    if (!names.has(data.featuredAlbum)) throw new Error("默认专辑不存在");
  }

  function handleAlbumClick(event) {
    if (Date.now() < suppressAlbumClickUntil) {
      event.preventDefault();
      return;
    }

    const actionButton = event.target.closest("[data-album-action]");
    if (actionButton) {
      changeAlbum(actionButton.dataset.albumAction === "previous" ? -1 : 1);
      return;
    }

    const albumButton = event.target.closest("[data-album-index]");
    if (!albumButton) return;
    const index = Number(albumButton.dataset.albumIndex);
    if (index === currentAlbumIndex) {
      window.open(albumConfig[index].url, "_blank", "noopener,noreferrer");
    } else {
      currentAlbumIndex = index;
      renderAlbumCarousel();
    }
  }

  function changeAlbum(direction) {
    if (!albumConfig.length) return;
    currentAlbumIndex = (currentAlbumIndex + direction + albumConfig.length) % albumConfig.length;
    renderAlbumCarousel();
  }

  function resetAlbumPointer(pointerId) {
    if (elements.albumCarousel.hasPointerCapture?.(pointerId)) {
      elements.albumCarousel.releasePointerCapture(pointerId);
    }
    albumPointer.id = null;
    albumPointer.distanceX = 0;
    albumPointer.distanceY = 0;
    albumPointer.isHorizontal = false;
    elements.albumCarousel.classList.remove("is-dragging");
  }

  function renderAlbumCarousel() {
    if (!albumConfig.length) return;

    if (elements.albumCarousel.children.length !== albumConfig.length) {
      elements.albumCarousel.innerHTML = albumConfig.map((album, index) => `
        <button class="album-card" type="button" data-album-index="${index}">
          <span class="album-frame">
            <img src="${escapeAttribute(album.image)}" alt="《${escapeAttribute(album.title)}》专辑封面" width="1000" height="1000" draggable="false" />
            <span class="album-sheen" aria-hidden="true"></span>
          </span>
          <span class="album-play" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5V7Z" /></svg>
          </span>
        </button>
      `).join("");
    }

    [...elements.albumCarousel.children].forEach((card, index) => {
      let offset = index - currentAlbumIndex;
      const half = albumConfig.length / 2;
      if (offset > half) offset -= albumConfig.length;
      if (offset < -half) offset += albumConfig.length;
      const visibleOffset = Math.max(-2, Math.min(2, offset));
      const isVisible = Math.abs(offset) <= 2;
      card.className = `album-card album-position-${visibleOffset}`;
      card.classList.toggle("is-hidden", !isVisible);
      card.setAttribute("aria-hidden", String(!isVisible));
      card.tabIndex = isVisible ? 0 : -1;
      card.setAttribute("aria-label", index === currentAlbumIndex
        ? `打开网易云音乐《${albumConfig[index].title}》专辑`
        : `切换到《${albumConfig[index].title}》专辑`);
    });

    const currentAlbum = albumConfig[currentAlbumIndex];
    elements.albumProgress.textContent = `${String(currentAlbumIndex + 1).padStart(2, "0")} / ${String(albumConfig.length).padStart(2, "0")}`;
    elements.albumTitle.textContent = `《${currentAlbum.title}》`;
    elements.albumOpenLink.href = currentAlbum.url;
    elements.albumOpenLink.setAttribute("aria-label", `前往网易云音乐查看《${currentAlbum.title}》`);
  }

  function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseLocalDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function renderCurrentDate() {
    const text = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    }).format(now);
    elements.currentDate.textContent = text.replace(/日(?=星期)/, "日 ");
  }

  function renderCountdown() {
    elements.countdownCopy.textContent = "每一次播放，都离最终舞台更近一步";
    if (!config.eventDate) {
      elements.eventDate.textContent = "日期待定";
      elements.countdownDays.textContent = "—";
      return;
    }

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const eventDate = parseLocalDate(config.eventDate);
    const dayMs = 24 * 60 * 60 * 1000;
    const daysLeft = Math.max(0, Math.ceil((eventDate - today) / dayMs));
    const startDate = parseLocalDate(config.countdownStartDate);
    const totalDays = Math.max(1, Math.ceil((eventDate - startDate) / dayMs));
    const elapsed = Math.max(0, Math.min(totalDays, Math.ceil((today - startDate) / dayMs)));
    const progressPercent = (elapsed / totalDays) * 100;

    elements.eventDate.textContent = formatFullDate(eventDate);
    elements.countdownDays.textContent = String(daysLeft);
    elements.countdownProgress.style.width = `${progressPercent}%`;

    if (today.getTime() === eventDate.getTime()) {
      elements.countdownCopy.textContent = "最终舞台，就在今天";
      elements.countdownProgress.style.width = "100%";
    } else if (today > eventDate) {
      elements.countdownCopy.textContent = "巡演尾场已圆满落幕，感谢一路相伴";
      elements.countdownProgress.style.width = "100%";
    }
  }

  function renderTodaySongs() {
    elements.todayStatus.classList.toggle("is-empty", !todaySchedule);
    if (!todaySchedule || !Array.isArray(todaySchedule.songs) || !todaySchedule.songs.length) {
      const nextSchedule = schedules.find((item) => item.date > todayKey);
      elements.todayStatus.classList.add("is-empty");
      elements.todayStatusText.textContent = "暂无安排";
      elements.todaySongs.innerHTML = `
        <div class="empty-state">
          <strong>今日暂无安排</strong>
          <p>今天先让耳朵休息一下，尾场的音乐仍在路上。</p>
          ${nextSchedule ? `<span>下一次播放 · ${escapeHtml(formatShortDate(parseLocalDate(nextSchedule.date)))}</span>` : ""}
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    getDailyTracks(todaySchedule).forEach(({ song, index, isBuffer }) => {
      const card = document.createElement("article");
      card.className = `today-song-card${isBuffer ? " is-buffer" : ""}`;
      card.innerHTML = `
        <span class="track-number">0${index + 1}</span>
        <div>
          ${isBuffer ? '<span class="song-role">补位歌曲 · 衔接10分钟</span>' : ""}
          <button class="song-name" type="button" data-copy-song="${escapeAttribute(song.title)}" aria-label="复制歌曲《${escapeAttribute(song.title)}》">
            <span>《${escapeHtml(song.title)}》</span>
            <svg class="copy-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 8V5.8C8 4.8 8.8 4 9.8 4h8.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H16M5.8 8h8.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8V9.8C4 8.8 4.8 8 5.8 8Z" />
            </svg>
          </button>
          <p class="song-artist">G.E.M. 邓紫棋</p>
          <p class="song-message">${escapeHtml(song.message)}</p>
          ${renderMusicLinks(song.title, false)}
        </div>
      `;
      fragment.appendChild(card);
    });
    elements.todaySongs.replaceChildren(fragment);

  }

  function renderSchedule() {
    const fragment = document.createDocumentFragment();

    schedules.forEach((schedule) => {
      const date = parseLocalDate(schedule.date);
      const state = schedule.date === todayKey ? "is-today" : schedule.date < todayKey ? "is-past" : "is-future";
      const card = document.createElement("article");
      card.className = `schedule-card ${state}`;
      card.innerHTML = `
        <div class="schedule-date">
          <strong>${escapeHtml(formatShortDate(date))}</strong>
          <span>${escapeHtml(formatWeekday(date))}${state === "is-today" ? " · 今日" : ""}</span>
        </div>
        <div class="schedule-tracks">
          ${getDailyTracks(schedule).map(({ song, index, isBuffer }) => `
            <div class="schedule-track${isBuffer ? " is-buffer" : ""}">
              <small>${isBuffer ? "BUFFER · 10 MIN" : `TRACK 0${index + 1}`}</small>
              <strong title="《${escapeAttribute(song.title)}》">《${escapeHtml(song.title)}》</strong>
              <p>${escapeHtml(song.message)}</p>
              ${renderMusicLinks(song.title, true)}
            </div>
          `).join("")}
        </div>
      `;
      fragment.appendChild(card);
    });

    elements.scheduleList.replaceChildren(fragment);
  }

  function getDailyTracks(schedule) {
    const themeTracks = schedule.songs.map((song, index) => ({ song, index, isBuffer: false }));
    return [...themeTracks, { song: schedule.bufferSong, index: 2, isBuffer: true }];
  }

  function renderMusicLinks(title, compact) {
    const query = encodeURIComponent(`${title} 邓紫棋`);
    const qqUrl = `https://y.qq.com/n/ryqq/search?w=${query}&t=song`;
    const neteaseUrl = `https://music.163.com/#/search/m/?s=${query}&type=1`;
    const compactClass = compact ? " is-compact" : "";

    return `
      <div class="music-links${compactClass}" aria-label="《${escapeAttribute(title)}》播放入口">
        <a class="music-link" data-platform="qq" href="${escapeAttribute(qqUrl)}" target="_blank" rel="noopener noreferrer" aria-label="前往QQ音乐搜索《${escapeAttribute(title)}》">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.1 5.1 14 9.4a.7.7 0 0 1 0 1.2l-6.9 4.3A.7.7 0 0 1 6 14.3V5.7a.7.7 0 0 1 1.1-.6Z" /></svg>
          <span>${compact ? "QQ" : "QQ音乐"}</span>
        </a>
        <a class="music-link" data-platform="netease" href="${escapeAttribute(neteaseUrl)}" target="_blank" rel="noopener noreferrer" aria-label="前往网易云音乐搜索《${escapeAttribute(title)}》">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.1 5.1 14 9.4a.7.7 0 0 1 0 1.2l-6.9 4.3A.7.7 0 0 1 6 14.3V5.7a.7.7 0 0 1 1.1-.6Z" /></svg>
          <span>${compact ? "网易" : "网易云"}</span>
        </a>
      </div>
    `;
  }

  function formatFullDate(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function formatShortDate(date) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function formatWeekday(date) {
    return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  async function toggleAmbient() {
    if (ambientPlayer) {
      stopAmbient();
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      showToast("当前浏览器暂不支持网页氛围音乐");
      return;
    }

    try {
      const context = new AudioContextClass();
      await context.resume();

      const master = context.createGain();
      const filter = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const delay = context.createDelay(1.5);
      const feedback = context.createGain();
      const delayLevel = context.createGain();

      master.gain.setValueAtTime(0, context.currentTime);
      master.gain.linearRampToValueAtTime(0.58, context.currentTime + 1.2);
      filter.type = "lowpass";
      filter.frequency.value = 1450;
      filter.Q.value = 0.6;
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.012;
      compressor.release.value = 0.38;
      delay.delayTime.value = 0.34;
      feedback.gain.value = 0.18;
      delayLevel.gain.value = 0.22;

      master.connect(filter);
      filter.connect(compressor);
      filter.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(delayLevel);
      delayLevel.connect(compressor);
      compressor.connect(context.destination);

      const voices = ["sine", "triangle", "sine"].map((type, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = type;
        gain.gain.value = index === 1 ? 0.06 : 0.052;
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start();
        return oscillator;
      });

      const chords = [
        [110, 130.81, 164.81],
        [87.31, 110, 130.81],
        [65.41, 82.41, 98],
        [98, 123.47, 146.83]
      ];
      let chordIndex = 0;

      const setChord = () => {
        const at = context.currentTime + 0.04;
        chords[chordIndex].forEach((frequency, index) => {
          voices[index].frequency.cancelScheduledValues(at);
          voices[index].frequency.setTargetAtTime(frequency, at, 0.36);
        });
        chordIndex = (chordIndex + 1) % chords.length;
      };

      const playShimmer = () => {
        if (context.state === "closed") return;
        const chord = chords[(chordIndex + chords.length - 1) % chords.length];
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = context.currentTime;
        oscillator.type = "sine";
        oscillator.frequency.value = chord[Math.floor(Math.random() * chord.length)] * 4;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.032, at + 0.035);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.35);
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start(at);
        oscillator.stop(at + 1.4);
      };

      setChord();
      ambientPlayer = {
        context,
        master,
        voices,
        chordTimer: window.setInterval(setChord, 4200),
        shimmerTimer: window.setInterval(playShimmer, 1050)
      };
      setAmbientUi(true);
      showToast("舞台氛围已开启");
    } catch (error) {
      ambientPlayer = null;
      setAmbientUi(false);
      showToast("音乐没有成功开启，请再试一次");
    }
  }

  function stopAmbient() {
    const player = ambientPlayer;
    if (!player) return;
    ambientPlayer = null;
    window.clearInterval(player.chordTimer);
    window.clearInterval(player.shimmerTimer);
    const at = player.context.currentTime;
    player.master.gain.cancelScheduledValues(at);
    player.master.gain.setValueAtTime(player.master.gain.value, at);
    player.master.gain.linearRampToValueAtTime(0, at + 0.45);
    setAmbientUi(false);
    showToast("舞台氛围已关闭");
    window.setTimeout(() => {
      player.voices.forEach((voice) => {
        try { voice.stop(); } catch (_) { /* 已停止 */ }
      });
      player.context.close();
    }, 520);
  }

  function setAmbientUi(isPlaying) {
    elements.ambientToggle.setAttribute("aria-pressed", String(isPlaying));
    elements.ambientToggle.setAttribute("aria-label", isPlaying ? "关闭舞台氛围音乐" : "开启舞台氛围音乐");
    elements.ambientHint.textContent = isPlaying ? "播放中 · 点击关闭" : "点击开启 · 非原曲";
    document.body.classList.toggle("sound-on", isPlaying);
  }

  async function copySongName(title) {
    const text = `《${title}》`;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch (_) {
        copied = false;
      } finally {
        textArea.remove();
      }
      if (!copied) {
        showToast("复制未成功，请选中歌名手动复制");
        return;
      }
    }
    showToast(`${text} 已复制`);
  }

  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 1800);
  }
})();
