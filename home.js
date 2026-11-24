/* =============================================================
 * home.js —— 主菜单与区块切换（UI 层）
 *
 * 主菜单是盖在编辑器上的全屏层：编辑器在下面照常初始化，
 * 所以 3D 画布一打开就是正确尺寸，切进编辑器不用重建场景。
 *
 * 这个文件在 app3d.js 之前加载，作用是先把 window 上的键盘监听
 * 注册好 —— 菜单打开时把按键拦下来，别让编辑器的快捷键
 * （1–0 刷地形、WASD 平移、Ctrl+Z 撤销……）在菜单背后生效。
 *
 * 线上对战和军械库已经接上了：
 *   线上对战走 window.Online.open()，军械库走 window.Armory.open()。
 *   百科还没接；以后给它加 data-module，在 activate() 里加一个分支即可。
 * ============================================================= */
(function () {
  'use strict';

  const menu = document.getElementById('menu');
  if (!menu) return;

  const items = Array.prototype.slice.call(menu.querySelectorAll('.menu-item'));
  const editorShell = [
    document.querySelector('.topbar'),
    document.querySelector('main'),
  ].filter(Boolean);

  const TITLE_MENU = '兵棋 · 线上战术桌';
  const TITLE_EDITOR = '地图编辑器 · 兵棋';

  let menuOpen = true;
  let lastMenuFocus = null;
  let toastTimer = 0;

  /* ---------------- 编辑器外壳的可用性 ---------------- */
  function setEditorInert(on) {
    editorShell.forEach(function (el) {
      if (on) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });
  }

  /* ---------------- 主菜单里的轻提示 ---------------- */
  function toast(msg) {
    const el = document.getElementById('menu-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  /* ---------------- 本地草稿摘要 ---------------- */
  function refreshLocalDraft() {
    const el = document.getElementById('menu-local');
    if (!el) return;
    let raw = null;
    try {
      raw = window.MapIO && window.MapIO.readLocal ? window.MapIO.readLocal() : null;
    } catch (e) { /* 隐私模式等，忽略 */ }
    if (raw && raw.cols && raw.rows) {
      el.textContent = '本地草稿 ' + raw.cols + ' × ' + raw.rows + ' · ' +
        (raw.mode === 'contest' ? '争夺战' : '攻防战');
    } else {
      el.textContent = '本地草稿：暂无';
    }
  }

  /* ---------------- 显示主菜单 ---------------- */
  function show(options) {
    if (menuOpen && !(options && options.force)) return;
    menuOpen = true;

    // 收起编辑器里的帮助浮层，免得回到编辑器时还开着
    const help = document.getElementById('help');
    if (help) help.classList.add('hidden');
    if (window.BQ && window.BQ.showHover) window.BQ.showHover(0, 0, false);
    if (window.BQ && window.BQ.state) window.BQ.state.hover = -1;

    menu.classList.remove('hidden');
    menu.setAttribute('aria-hidden', 'false');
    document.body.classList.add('menu-open');
    setEditorInert(true);
    document.title = TITLE_MENU;
    refreshLocalDraft();

    requestAnimationFrame(function () {
      const target = lastMenuFocus && document.contains(lastMenuFocus) ? lastMenuFocus : menu;
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    });
  }

  /* ---------------- 进入地图编辑器 ---------------- */
  function enterEditor() {
    lastMenuFocus = document.activeElement && document.activeElement.classList &&
      document.activeElement.classList.contains('menu-item') ? document.activeElement : null;

    menuOpen = false;
    menu.classList.add('hidden');
    menu.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('menu-open');
    setEditorInert(false);
    document.title = TITLE_EDITOR;

    // 菜单盖着的时候窗口尺寸可能变过，让编辑器重新量一次画布
    window.dispatchEvent(new Event('resize'));
    if (window.BQ && window.BQ.render) window.BQ.render();

    const btn = document.getElementById('btn-home');
    if (btn) {
      try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
    }
  }

  function activate(item) {
    if (!item) return;
    const mod = item.getAttribute('data-module');
    if (mod === 'tutorial' && window.Online && window.Online.openTutorial) { window.Online.openTutorial(); return; }
    if (mod === 'editor') { enterEditor(); return; }
    if (mod === 'online' && window.Online) { window.Online.open(); return; }
    if (mod === 'armory' && window.Armory) { window.Armory.open(); return; }
    if (mod === 'codex' && window.Codex) { window.Codex.open(); return; }

    const name = item.getAttribute('data-name') || '这个区块';
    toast('「' + name + '」还在施工中，先来拼张地图？');
  }

  /* ---------------- 鼠标 ---------------- */
  menu.addEventListener('click', function (e) {
    const item = e.target.closest ? e.target.closest('.menu-item') : null;
    if (item && menu.contains(item)) activate(item);
  });

  const homeBtn = document.getElementById('btn-home');
  if (homeBtn) homeBtn.addEventListener('click', function () { show(); });

  /* ---------------- 键盘 ----------------
   * 菜单打开时：↑↓ / ←→ 换焦点，数字 0–4 直达，Enter 进入；
   * 然后把事件截住，防止穿透给编辑器的全局快捷键。
   * 编辑器里：Esc 回主菜单。 */
  function focusItem(i) {
    if (!items.length) return;
    const n = ((i % items.length) + items.length) % items.length;
    try { items[n].focus({ preventScroll: true }); } catch (e) { items[n].focus(); }
  }

  function focusedIndex() {
    return items.indexOf(document.activeElement);
  }

  window.addEventListener('keydown', function (e) {
    // 教程窗口是 UI 静态层：打开时挡住菜单快捷键，Esc 交给教程关闭。
    const tutorialScreen = document.getElementById('tutorial-screen');
    if (tutorialScreen && !tutorialScreen.classList.contains('hidden')) {
      if (e.key === 'Escape' && window.Online && window.Online.closeTutorial) {
        e.preventDefault();
        window.Online.closeTutorial();
      }
      e.stopImmediatePropagation();
      return;
    }

    // 线上对战开着时，按键交给它自己处理；这里只兜住焦点跑到页面上时的情况，
    // 别让编辑器的 1–0 / WASD 在联机界面背后生效。
    if (document.body.classList.contains('online-open') ||
        (window.Online && window.Online.isOpen && window.Online.isOpen())) {
      e.stopImmediatePropagation();
      return;
    }

    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const i = focusedIndex();
        focusItem(i < 0 ? 0 : i + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const i = focusedIndex();
        focusItem(i <= 0 ? items.length - 1 : i - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusItem(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        focusItem(items.length - 1);
      } else if (/^[0-4]$/.test(e.key)) {
        e.preventDefault();
        const target = menu.querySelector('.menu-item[data-shortcut="' + e.key + '"]');
        if (target) target.click();
      }
      e.stopImmediatePropagation();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      show({ force: true });
    }
  });

  window.addEventListener('keyup', function (e) {
    if (document.body.classList.contains('online-open') ||
        (window.Online && window.Online.isOpen && window.Online.isOpen())) {
      e.stopImmediatePropagation();
      return;
    }
    if (menuOpen) e.stopImmediatePropagation();
  });

  /* ---------------- 教程窗口的模态行为 ----------------
   * 窗口结构在 index.html，开关在 online.js；这里只负责菜单 inert / 焦点。 */
  const tutorialScreen = document.getElementById('tutorial-screen');
  if (tutorialScreen) {
    let tutorialWasOpen = !tutorialScreen.classList.contains('hidden');
    const syncTutorialModal = function () {
      const isOpen = !tutorialScreen.classList.contains('hidden');
      if (isOpen === tutorialWasOpen) return;
      tutorialWasOpen = isOpen;
      if (isOpen) {
        menu.setAttribute('inert', '');
        try { tutorialScreen.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        return;
      }
      // 从教程关卡直接进对战时，online 会接管菜单 inert，这里不要抢回来。
      if (window.Online && window.Online.isOpen && window.Online.isOpen()) return;
      menu.removeAttribute('inert');
      const btn = menu.querySelector('.menu-item[data-module="tutorial"]');
      if (btn) {
        try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
      }
    };
    if (window.MutationObserver) {
      new MutationObserver(syncTutorialModal).observe(tutorialScreen, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    syncTutorialModal();
  }

  /* ---------------- 初始状态 ---------------- */
  menu.setAttribute('aria-hidden', 'false');
  document.body.classList.add('menu-open');
  setEditorInert(true);
  refreshLocalDraft();
  requestAnimationFrame(function () {
    try { menu.focus({ preventScroll: true }); } catch (e) { menu.focus(); }
  });

  window.Home = {
    show: show,
    enterEditor: enterEditor,
    isMenuOpen: function () { return menuOpen; },
  };
})();
