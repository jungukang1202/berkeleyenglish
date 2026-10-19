/* YouTube 플레이어를 <video>처럼 쓸 수 있게 감싼 도우미 (video.html · 관리자 편집기에서 사용)
 *   const m = await YTMedia.create(containerEl, videoId);
 *   m.currentTime = 12.3; m.play(); m.pause(); m.playbackRate = 0.75; m.paused; m.duration
 *   m.addEventListener('playing' | 'waiting' | 'pause' | 'ended' | 'error', fn)
 * YouTube 정책상 플레이어는 화면에 보여야 해요(숨기지 않고 작게 줄이는 것만 가능).
 */
(function (root) {
  let apiPromise = null;
  function loadApi() {
    if (root.YT && root.YT.Player) return Promise.resolve(root.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const prev = root.onYouTubeIframeAPIReady;
      root.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (e) {} resolve(root.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('YouTube 플레이어를 불러오지 못했어요. 인터넷 연결을 확인해주세요.'));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('YouTube 플레이어 응답이 없어요.')), 20000);
    });
    return apiPromise;
  }

  class YTMedia {
    constructor() { this._ls = {}; this._state = -1; this._seekTo = null; this._seekAt = 0; this._rate = 1; this.isYouTube = true; }
    static async create(container, videoId, opts = {}) {
      const YT = await loadApi();
      const m = new YTMedia();
      const host = document.createElement('div');
      container.innerHTML = '';
      container.appendChild(host);
      await new Promise((resolve, reject) => {
        m.player = new YT.Player(host, {
          videoId, width: '100%', height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: opts.controls === false ? 0 : 1, start: Math.floor(opts.start || 0), cc_load_policy: 0, iv_load_policy: 3 },
          events: {
            onReady: () => resolve(),
            onStateChange: e => m._onState(e.data),
            onError: e => { m._emit('error', e.data); reject(new Error('YouTube 오류 ' + e.data + (e.data === 101 || e.data === 150 ? ' (퍼가기가 허용되지 않은 영상)' : ''))); },
          },
        });
        setTimeout(() => reject(new Error('YouTube 플레이어 응답이 없어요.')), 20000);
      });
      m.iframe = container.querySelector('iframe');
      return m;
    }
    _onState(s) {
      this._state = s;
      if (s === 1) { if (this._seekTo != null) setTimeout(() => { this._playedSinceSeek = true; }, 120); this._emit('playing'); }
      else if (s === 3) this._emit('waiting');
      else if (s === 2) this._emit('pause');
      else if (s === 0) this._emit('ended');
    }
    _emit(type, d) { (this._ls[type] || []).forEach(fn => { try { fn({ type, data: d }); } catch (e) { console.error(e); } }); }
    addEventListener(type, fn) { (this._ls[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this._ls[type] = (this._ls[type] || []).filter(f => f !== fn); }

    get currentTime() {
      const real = this.player && this.player.getCurrentTime ? this.player.getCurrentTime() || 0 : 0;
      // 이동 직후에는 YouTube가 잠깐 예전 시간을 알려줘서, 실제로 옮겨질 때까지 목표 시간을 대신 돌려줍니다.
      if (this._seekTo != null) {
        // 실제로 옮겨졌거나(목표 근처), 이동 후 재생이 시작됐거나, 1초가 지나면 진짜 시간을 씁니다.
        if (Math.abs(real - this._seekTo) < 0.5 || this._playedSinceSeek || performance.now() - this._seekAt > 1000) this._seekTo = null;
        else return this._seekTo;
      }
      return real;
    }
    set currentTime(t) { this._seekTo = t; this._seekAt = performance.now(); this._playedSinceSeek = false; this.player.seekTo(t, true); }
    get duration() { return this.player && this.player.getDuration ? this.player.getDuration() : 0; }
    get paused() { return !(this._state === 1 || this._state === 3); }
    get playbackRate() { return this._rate; }
    set playbackRate(r) { this._rate = r; try { this.player.setPlaybackRate(r); } catch (e) {} }
    get readyState() { return 4; }
    play() {
      this.player.playVideo();
      // 휴대폰은 처음 한 번은 영상을 직접 눌러야 재생되는 경우가 있어요.
      return new Promise((res, rej) => setTimeout(() => (this._state === 1 || this._state === 3 ? res() : rej(new Error('not_started'))), 1800));
    }
    // YouTube는 멈춤 명령 후 0.2~0.3초 더 재생된 뒤에야 '멈춤' 상태를 알려줘요 → 명령을 보낸 즉시 멈춘 것으로 처리
    pause() { this._state = 2; try { this.player.pauseVideo(); } catch (e) {} }
    getTitle() { try { return (this.player.getVideoData() || {}).title || ''; } catch (e) { return ''; } }
    destroy() { try { this.player.destroy(); } catch (e) {} }
  }
  root.YTMedia = YTMedia;
})(window);
