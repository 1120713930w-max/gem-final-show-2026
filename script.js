(function () {
  "use strict";

  let config = { eventDate: "", schedules: [] };
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
    toast: document.querySelector("#toast")
  };

  let ambientPlayer = null;

  elements.todaySongs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-song]");
    if (button) copySongName(button.dataset.copySong);
  });

  elements.ambientToggle.addEventListener("click", toggleAmbient);

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
      if (location.protocol === "file:") {
        payload = document.querySelector("#offlineSongs").textContent;
      } else {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(`./songs.json?v=${Date.now()}`, {
            cache: "no-store", signal: controller.signal
          });
          if (!response.ok) throw new Error(`歌单请求失败：${response.status}`);
          payload = await response.text();
        } finally {
          clearTimeout(timeout);
        }
      }
      const next = JSON.parse(payload);
      validateConfig(next);
      const current = new Date();
      const key = toDateKey(current);
      if (payload !== lastPayload || key !== lastDate) {
        config = next;
        schedules = [...config.schedules].sort((a, b) => a.date.localeCompare(b.date));
        now = current;
        todayKey = key;
        todaySchedule = schedules.find((item) => item.date === todayKey);
        renderCurrentDate();
        renderCountdown();
        renderTodaySongs();
        renderSchedule();
        lastPayload = payload;
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
    if (!data || !validDate(data.eventDate) || !Array.isArray(data.schedules)) {
      throw new Error("歌单配置格式错误");
    }
    const dates = new Set();
    data.schedules.forEach((day) => {
      if (!day || !validDate(day.date) || dates.has(day.date)
        || !Array.isArray(day.songs) || day.songs.length !== 2
        || day.songs.some((song) => !song || typeof song.title !== "string"
          || !song.title.trim() || typeof song.message !== "string")) {
        throw new Error("每天需要两个歌曲条目，且日期不能重复");
      }
      dates.add(day.date);
    });
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
    const startDate = schedules.length ? parseLocalDate(schedules[0].date) : today;
    const totalDays = Math.max(1, Math.ceil((eventDate - startDate) / dayMs));
    const elapsed = Math.max(0, Math.min(totalDays, Math.ceil((today - startDate) / dayMs)));

    elements.eventDate.textContent = formatFullDate(eventDate);
    elements.countdownDays.textContent = String(daysLeft);
    elements.countdownProgress.style.width = `${Math.max(5, (elapsed / totalDays) * 100)}%`;

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
    todaySchedule.songs.forEach((song, index) => {
      const card = document.createElement("article");
      card.className = "today-song-card";
      card.innerHTML = `
        <span class="track-number">0${index + 1}</span>
        <div>
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
          ${schedule.songs.map((song, index) => `
            <div class="schedule-track">
              <small>TRACK 0${index + 1}</small>
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
      master.gain.linearRampToValueAtTime(0.16, context.currentTime + 1.2);
      filter.type = "lowpass";
      filter.frequency.value = 1150;
      filter.Q.value = 0.6;
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
        gain.gain.value = index === 1 ? 0.045 : 0.035;
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
        gain.gain.exponentialRampToValueAtTime(0.022, at + 0.035);
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
