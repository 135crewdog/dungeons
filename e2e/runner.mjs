// Browser E2E campaign against the vite preview build. See e2e/README.md.
// Every game context has a triple guard so NOTHING can reach the production
// leaderboard: catch-all abort (with tripwire), lb-origin stub, SW blocked.
//
// Requires a prior `npm run build` (this drives the preview build, not dev).
// The Chromium binary defaults to the Claude Code container path; override with
// CHROMIUM_PATH for other environments.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:4173';
const LB_ORIGIN = 'https://dungeons-leaderboard.c10darren-ward.workers.dev';
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHOTS = fileURLToPath(new URL('./.artifacts/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
// The app's current version — asserted in the HUD watermark and the score
// payload — read from package.json so it never goes stale after a bump.
const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

// Spin up `vite preview` and wait until it answers, unless one is already up.
async function startPreview() {
  try {
    await fetch(BASE);
    return null; // someone already serving 4173
  } catch {
    /* not up yet — spawn it */
  }
  const child = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
    { cwd: REPO_ROOT, stdio: 'ignore' },
  );
  process.on('exit', () => child.kill());
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      await fetch(BASE);
      return child;
    } catch {
      /* keep polling */
    }
  }
  child.kill();
  throw new Error('vite preview did not come up on 4173 — did you run `npm run build` first?');
}
const previewChild = await startPreview();

const results = [];
function record(id, pass, details) {
  results.push({ id, pass, details });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} — ${details}`);
}

const LB_ROWS = {
  scores: [
    { initials: 'AAA', floor: 9, turns: 800, version: '0.5.0', created_at: Date.now() - 3 * 864e5 },
    { initials: '<b>', floor: 5, turns: 500, version: '0.5.1', created_at: Date.now() - 3600e3 },
    { initials: 'ZZZ', floor: 2, turns: 100, version: '0.5.1', created_at: Date.now() - 60e3 },
  ],
  now: Date.now(),
};

async function newGameContext(
  browser,
  { allowSW = false, failLb = false, dpr = 1, viewport = { width: 1280, height: 720 } } = {},
) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    serviceWorkers: allowSW ? 'allow' : 'block',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const escaped = [];
  const posts = [];
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    escaped.push(url);
    return route.abort();
  });
  await ctx.route(`${LB_ORIGIN}/**`, (route) => {
    const req = route.request();
    if (failLb) return route.abort();
    if (req.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(LB_ROWS),
      });
    }
    if (req.method() === 'POST') {
      posts.push(JSON.parse(req.postData()));
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.abort();
  });
  return { ctx, escaped, posts };
}

const pageErrors = [];
const consoleLines = [];
async function newGamePage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => consoleLines.push(msg.text()));
  return page;
}

async function gotoSeed(page, seed) {
  await page.goto(`${BASE}/?seed=${seed}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () =>
      window.__game &&
      window.__game.status === 'playing' &&
      !!document.querySelector('#game canvas'),
    null,
    { timeout: 20000 },
  );
}

async function press(page, code, expect) {
  await page.keyboard.press(code);
  if (expect) {
    await page.waitForFunction(
      ([t, f]) => window.__game.turn === t && window.__game.floor === f,
      [expect.t, expect.f],
      { timeout: 15000 },
    );
  }
}

// Mirror of discover.mjs snapshot(), evaluated in the page.
const SNAPSHOT_FN = `(() => {
  const g = window.__game;
  const p = g.entities.byId.get(g.entities.playerId);
  const entities = [...g.entities.byId.values()]
    .map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, hp: e.hp }))
    .sort((a, b) => a.id - b.id);
  const items = g.items.map((i) => ({ id: i.id, type: i.type, x: i.x, y: i.y })).sort((a, b) => a.id - b.id);
  let explored = 0, visible = 0;
  for (let i = 0; i < g.vis.explored.length; i++) { explored += g.vis.explored[i]; visible += g.vis.visible[i]; }
  let mapHash = 0;
  for (let i = 0; i < g.map.tiles.length; i++) mapHash = ((mapHash * 31) + g.map.tiles[i]) >>> 0;
  return {
    turn: g.turn, floor: g.floor, status: g.status,
    player: { x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, strength: p.strength ?? 0, skill: p.skill ?? 0, armor: p.armor ?? 0 },
    entities, items, explored, visible, mapHash,
  };
})()`;
const snapshot = (page) => page.evaluate(SNAPSHOT_FN);

async function clickTile(page, tile) {
  // Camera centers on the player; 32 CSS px per tile at every tested dpr/viewport.
  const [px, py] = await page.evaluate(() => {
    const p = window.__game.entities.byId.get(window.__game.entities.playerId);
    return [p.x, p.y];
  });
  const canvas = await page.$('#game canvas');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2 + (tile.x - px) * 32;
  const cy = box.y + box.height / 2 + (tile.y - py) * 32;
  await page.mouse.click(cx, cy);
}

const browser = await chromium.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader'],
});

// ---------- E12: pixel->tile calibration at 3 display configs ----------
for (const [label, opts, expectTiles] of [
  ['1280x720@1x', { dpr: 1 }, 2],
  ['777x505@1x', { dpr: 1, viewport: { width: 777, height: 505 } }, 2],
  ['1280x720@2x', { dpr: 2 }, 2],
]) {
  const { ctx, escaped } = await newGameContext(browser, opts);
  const page = await newGamePage(ctx);
  await gotoSeed(page, fixtures.move.seed);
  const spawn = fixtures.move.spawn;
  const d = fixtures.move.line;
  const target = { x: spawn.x + d.dx * 2, y: spawn.y + d.dy * 2 };
  await clickTile(page, target);
  try {
    await page.waitForFunction(
      ([tx, ty]) => {
        const p = window.__game.entities.byId.get(window.__game.entities.playerId);
        return p.x === tx && p.y === ty && window.__game.path === null;
      },
      [target.x, target.y],
      { timeout: 10000 },
    );
    record(
      `E12/${label}`,
      escaped.length === 0,
      `click +2 tiles landed exactly; escaped=${escaped.length}`,
    );
  } catch {
    const s = await snapshot(page);
    record(
      `E12/${label}`,
      false,
      `player at ${s.player.x},${s.player.y} expected ${target.x},${target.y}`,
    );
  }
  await ctx.close();
}

// ---------- E1: boot ----------
{
  const { ctx, escaped } = await newGameContext(browser);
  const page = await newGamePage(ctx);
  // The sprite terrain path needs the tilesheet; a 404 silently degrades to
  // ASCII, so assert the asset actually loads.
  let tilesheetStatus = 0;
  page.on('response', (r) => {
    if (r.url().includes('tiles_prison.png')) tilesheetStatus = r.status();
  });
  const c0 = consoleLines.length;
  await gotoSeed(page, fixtures.move.seed);
  const s = await snapshot(page);
  const hud = await page.textContent('#hud');
  const hudVersion = await page.textContent('#hudversion');
  const url = page.url();
  const seedLog = consoleLines.slice(c0).find((l) => l.includes('[dungeons] seed ='));
  const rendererType = await page.evaluate(() => {
    const c = document.querySelector('#game canvas');
    if (!c) return 'none';
    try {
      if (c.getContext('2d')) return 'canvas2d';
    } catch {}
    return 'webgl';
  });
  const bootMatches = JSON.stringify(s) === JSON.stringify(fixtures.move.boot);
  const ok =
    hud.includes('HP') &&
    hud.includes('20/20') &&
    hud.includes('Floor') &&
    hudVersion.includes(VERSION) &&
    url.includes(`seed=${fixtures.move.seed}`) &&
    !!seedLog &&
    bootMatches &&
    tilesheetStatus === 200 &&
    escaped.length === 0;
  record(
    'E1/boot',
    ok,
    `hud="${hud.trim().slice(0, 40)}..." version=${hudVersion.trim()} renderer=${rendererType} seedLog=${!!seedLog} bootParity=${bootMatches} tilesheet=${tilesheetStatus} escaped=${escaped.length}`,
  );
  await page.screenshot({ path: SHOTS + 'boot.png' });
  await ctx.close();
}

// ---------- E2: keyboard movement, wall bump, diagonal, key-repeat ----------
{
  const { ctx } = await newGameContext(browser);
  const page = await newGamePage(ctx);
  await gotoSeed(page, fixtures.move.seed);
  const { spawn, line, wallDir } = fixtures.move;
  const CODE = {
    '0,-1': 'Numpad8',
    '1,-1': 'Numpad9',
    '1,0': 'Numpad6',
    '1,1': 'Numpad3',
    '0,1': 'Numpad2',
    '-1,1': 'Numpad1',
    '-1,0': 'Numpad4',
    '-1,-1': 'Numpad7',
  };
  const lineCode = CODE[`${line.dx},${line.dy}`];
  for (let i = 1; i <= 3; i++) await press(page, lineCode, { t: i, f: 1 });
  let s = await snapshot(page);
  const movedOk = s.player.x === spawn.x + line.dx * 3 && s.player.y === spawn.y + line.dy * 3;
  // wall bump: no turn consumed
  await page.keyboard.press(CODE[`${wallDir.dx},${wallDir.dy}`]);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  s = await snapshot(page);
  const bumpOk = s.turn === 3 && s.player.x === spawn.x + line.dx * 3;
  // key-repeat: synthetic repeat=true keydowns DO move (documents missing guard)
  const backCode = CODE[`${-line.dx},${-line.dy}`];
  await page.evaluate((code) => {
    for (let i = 0; i < 3; i++)
      window.dispatchEvent(new KeyboardEvent('keydown', { code, repeat: true, bubbles: true }));
  }, backCode);
  await page
    .waitForFunction(() => window.__game.turn === 6, null, { timeout: 5000 })
    .catch(() => {});
  s = await snapshot(page);
  const repeatConsumed = s.turn === 6;
  record(
    'E2/keyboard',
    movedOk && bumpOk,
    `3 steps ok=${movedOk} wallBumpNoTurn=${bumpOk} repeatKeydownsConsumed=${repeatConsumed} (guard absent -> expected true)`,
  );
  await ctx.close();
}

// ---------- E3: bump combat parity (fight fixture) ----------
{
  const { ctx } = await newGameContext(browser);
  const page = await newGamePage(ctx);
  await gotoSeed(page, fixtures.fight.seed);
  for (const c of fixtures.fight.cmds) await press(page, c.c, { t: c.t, f: c.f });
  const s = await snapshot(page);
  const parity = JSON.stringify(s) === JSON.stringify(fixtures.fight.after);
  const log = await page.textContent('#msglog');
  const logOk = /You (hit|miss)/.test(log);
  record(
    'E3/combat',
    parity && logOk,
    `state parity=${parity} plainLanguageLog=${logOk} ("${log.trim().split('\n').pop()}")`,
  );
  await ctx.close();
}

// ---------- E4 + E5a: click auto-walk, cadence, key-cancel ----------
{
  const { ctx } = await newGameContext(browser);
  const page = await newGamePage(ctx);
  await gotoSeed(page, fixtures.move.seed);
  const { spawn, line, clickTarget } = fixtures.move;
  const t0 = Date.now();
  await clickTile(page, clickTarget);
  await page.waitForFunction(
    ([tx, ty]) => {
      const p = window.__game.entities.byId.get(window.__game.entities.playerId);
      return p.x === tx && p.y === ty && window.__game.path === null;
    },
    [clickTarget.x, clickTarget.y],
    { timeout: 10000 },
  );
  const elapsed = Date.now() - t0;
  const s = await snapshot(page);
  const cadenceOk = elapsed >= 120 && elapsed <= 900; // 3 steps: first sync + 2x90ms + browser overhead
  record(
    'E4/autowalk',
    s.turn === 3 && cadenceOk,
    `arrived in ${elapsed}ms over 3 turns (cadence ~90ms/step)`,
  );

  // E5a: new command cancels a fresh walk
  await gotoSeed(page, fixtures.move.seed); // reload same seed
  await clickTile(page, clickTarget);
  await page.waitForFunction(() => window.__game.turn >= 1, null, { timeout: 5000 });
  const backCode = {
    '1,0': 'Numpad4',
    '-1,0': 'Numpad6',
    '0,1': 'Numpad8',
    '0,-1': 'Numpad2',
    '1,1': 'Numpad7',
    '-1,-1': 'Numpad3',
    '1,-1': 'Numpad1',
    '-1,1': 'Numpad9',
  }[`${line.dx},${line.dy}`];
  await page.keyboard.press(backCode);
  await page.waitForFunction(() => window.__game.path === null, null, { timeout: 5000 });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300))); // give a would-be stray step time to fire
  const s2 = await snapshot(page);
  const cancelOk = s2.player.x !== clickTarget.x || s2.player.y !== clickTarget.y;
  record(
    'E5a/key-cancel',
    cancelOk,
    `walk cancelled at (${s2.player.x},${s2.player.y}), turn=${s2.turn}, never reached (${clickTarget.x},${clickTarget.y})`,
  );
  await ctx.close();
}

// ---------- E6 + E7 + E11: trip replay — door occlusion, floor persistence, parity ----------
{
  const { ctx, escaped } = await newGameContext(browser);
  const page = await newGamePage(ctx);
  await gotoSeed(page, fixtures.trip.seed);
  const boot = await snapshot(page);
  const hashOk = boot.mapHash === fixtures.trip.floor1MapHash;
  const door = fixtures.trip.doorFix;
  let doorBefore = null,
    doorAfter = null;
  let floor2HudSeen = false;
  for (let i = 0; i < fixtures.trip.cmds.length; i++) {
    if (door && i === door.atCommand - 1) {
      doorBefore = await page.evaluate(
        ([x, y]) => window.__game.vis.visible[y * window.__game.map.width + x] === 1,
        [door.ahead.x, door.ahead.y],
      );
      await page.screenshot({ path: SHOTS + 'door-before.png' });
    }
    const c = fixtures.trip.cmds[i];
    await press(page, c.c, { t: c.t, f: c.f });
    if (door && i === door.atCommand - 1) {
      doorAfter = await page.evaluate(
        ([x, y]) => window.__game.vis.visible[y * window.__game.map.width + x] === 1,
        [door.ahead.x, door.ahead.y],
      );
      await page.screenshot({ path: SHOTS + 'door-after.png' });
    }
    if (!floor2HudSeen && c.f === 2) {
      const hud = await page.textContent('#hud');
      floor2HudSeen =
        (hud.includes('Floor') && /Floor\s*<\/span>?\s*2|Floor[^0-9]*2/.test(hud)) ||
        hud.includes('2');
    }
  }
  const fin = await snapshot(page);
  const parity = JSON.stringify(fin) === JSON.stringify(fixtures.trip.final);
  record(
    'E7/door-occlusion',
    doorBefore === false && doorAfter === true,
    `beyond-door tile visible before=${doorBefore} after=${doorAfter}`,
  );
  record(
    'E6/floor-persistence',
    parity && hashOk && fin.floor === 1 && fin.mapHash === fixtures.trip.floor1MapHash,
    `returned to floor 1 with identical tiles (hash ${fin.mapHash}); floor2 HUD seen=${floor2HudSeen}`,
  );
  record(
    'E11/parity',
    parity && escaped.length === 0,
    `188-command replay deep-equals the headless engine prediction: ${parity}; escaped=${escaped.length}`,
  );
  if (!parity) {
    writeFileSync(
      SHOTS + 'parity-diff.json',
      JSON.stringify({ browser: fin, engine: fixtures.trip.final }, null, 2),
    );
  }
  await ctx.close();
}

// ---------- E8: menu — pause, seed tools, restart lifecycle ----------
{
  const { ctx } = await newGameContext(browser);
  const page = await newGamePage(ctx);
  await gotoSeed(page, fixtures.move.seed);
  await clickTile(page, fixtures.move.clickTarget); // start a walk...
  await page.click('#menubtn'); // ...then open the menu: must cancel the walk
  await page.waitForSelector('#menu.show', { timeout: 5000 });
  const walkCancelled = await page.evaluate(() => window.__game.path === null);
  const turnAtOpen = await page.evaluate(() => window.__game.turn);
  await page.keyboard.press('ArrowRight'); // gated
  await page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
  const gated = (await page.evaluate(() => window.__game.turn)) === turnAtOpen;
  const seedShown = (await page.textContent('#menu .menu-seed-val')).trim();
  const seedMatches = await page.evaluate((s) => String(window.__game.seed) === s, seedShown);
  await page.click('#menu [data-act="copy"]');
  await page
    .waitForFunction(
      () => document.querySelector('#menu [data-act="copy"]').textContent.includes('Copied'),
      null,
      { timeout: 4000 },
    )
    .catch(() => {});
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => '(denied)'));
  const menuVersion = await page.textContent('#menu .menu-version');
  // typing WASD in the seed input must not move the player
  await page.click('#menu .menu-seed-input');
  await page.keyboard.type('wasd');
  const stillGated = (await page.evaluate(() => window.__game.turn)) === turnAtOpen;
  // restart this seed -> identical map, turn 0
  const hash0 = (await snapshot(page)).mapHash;
  await page.fill('#menu .menu-seed-input', '');
  await page.click('#menu [data-act="restart"]');
  await page.waitForFunction(
    () => window.__game.turn === 0 && !document.querySelector('#menu.show'),
    null,
    { timeout: 5000 },
  );
  const hash1 = (await snapshot(page)).mapHash;
  // load a text seed -> numeric FNV hash + URL sync
  await page.keyboard.press('Escape'); // reopen menu
  await page.waitForSelector('#menu.show');
  await page.fill('#menu .menu-seed-input', 'banana');
  await page.click('#menu [data-act="load"]');
  await page.waitForFunction(() => window.__game.turn === 0 && window.__game.seed !== 1, null, {
    timeout: 5000,
  });
  const loaded = await page.evaluate(() => ({ seed: window.__game.seed, url: location.search }));
  const loadOk = typeof loaded.seed === 'number' && loaded.url.includes(`seed=${loaded.seed}`);
  // new run -> different seed again
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu.show');
  await page.click('#menu [data-act="newrun"]');
  await page.waitForFunction((prev) => window.__game.seed !== prev, loaded.seed, { timeout: 5000 });
  const ok = walkCancelled && gated && seedMatches && stillGated && hash0 === hash1 && loadOk;
  record(
    'E8/menu',
    ok,
    `walkCancelOnOpen=${walkCancelled} keysGated=${gated} seedShown=${seedMatches} clipboard="${clip}" typingGuard=${stillGated} restartSameMap=${hash0 === hash1} loadSeed(banana)->${loaded.seed} urlSync=${loadOk} version="${menuVersion.trim()}"`,
  );
  await page.screenshot({ path: SHOTS + 'menu.png' });
  await ctx.close();
}

// ---------- E9: overlay layering, Escape ordering, XSS, offline state ----------
{
  const { ctx } = await newGameContext(browser);
  const page = await newGamePage(ctx);
  await gotoSeed(page, fixtures.move.seed);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu.show');
  await page.click('#menu [data-act="help"]');
  await page.waitForSelector('#help.show');
  const bothOpen = await page.evaluate(
    () =>
      document.querySelector('#menu.show') !== null &&
      document.querySelector('#help.show') !== null,
  );
  await page.keyboard.press('Escape'); // must close ONLY help
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  const helpClosedMenuOpen = await page.evaluate(
    () => !document.querySelector('#help.show') && !!document.querySelector('#menu.show'),
  );
  // leaderboard with stubbed rows (one hostile)
  await page.click('#menu [data-act="board"]');
  await page.waitForSelector('#leaderboard.show');
  await page.waitForSelector('#leaderboard .lb-table', { timeout: 5000 });
  const rows = await page.$$eval('#leaderboard .lb-table tr', (trs) => trs.length - 1);
  const hostileLiteral = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#leaderboard .lb-initials')];
    return (
      cells.some((c) => c.textContent === '<b>') &&
      document.querySelector('#leaderboard .lb-table b') === null
    );
  });
  const turnA = await page.evaluate(() => window.__game.turn);
  await page.keyboard.press('ArrowRight'); // gated under leaderboard
  await page.evaluate(() => new Promise((r) => setTimeout(r, 120)));
  const gatedUnderLb = (await page.evaluate(() => window.__game.turn)) === turnA;
  await page.screenshot({ path: SHOTS + 'leaderboard.png' });
  await page.keyboard.press('Escape'); // closes lb only
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  const lbClosedMenuOpen = await page.evaluate(
    () => !document.querySelector('#leaderboard.show') && !!document.querySelector('#menu.show'),
  );
  await page.keyboard.press('Escape'); // closes menu
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  const menuClosed = await page.evaluate(() => !document.querySelector('#menu.show'));
  record(
    'E9/overlays',
    bothOpen &&
      helpClosedMenuOpen &&
      rows === 3 &&
      hostileLiteral &&
      gatedUnderLb &&
      lbClosedMenuOpen &&
      menuClosed,
    `helpAboveMenu=${bothOpen} escClosesTopOnly=${helpClosedMenuOpen} lbRows=${rows} hostileInitialsRenderedLiterally=${hostileLiteral} gatedUnderLb=${gatedUnderLb} escOrder=${lbClosedMenuOpen},${menuClosed}`,
  );
  await ctx.close();

  // offline/error state: lb fetch aborts
  const { ctx: ctx2 } = await newGameContext(browser, { failLb: true });
  const page2 = await newGamePage(ctx2);
  await gotoSeed(page2, fixtures.move.seed);
  await page2.keyboard.press('Escape');
  await page2.waitForSelector('#menu.show');
  await page2.click('#menu [data-act="board"]');
  // Wait past the transient "Loading…" until the failed fetch resolves to a state.
  await page2.waitForFunction(
    () => {
      const s = document.querySelector('#leaderboard .lb-status');
      return s && s.textContent !== 'Loading…';
    },
    null,
    { timeout: 8000 },
  );
  const statusText = (await page2.textContent('#leaderboard .lb-status')).trim();
  record('E9/lb-error-state', /offline|reach/i.test(statusText), `status="${statusText}"`);
  await ctx2.close();
}

// ---------- E10: death flow, initials, one-submission lock ----------
{
  const { ctx, posts, escaped } = await newGameContext(browser);
  const page = await newGamePage(ctx);
  await gotoSeed(page, fixtures.fight.seed);
  for (const c of fixtures.fight.cmds) await press(page, c.c, { t: c.t, f: c.f });
  // stage: player 1 hp, adjacent enemy unkillable (methodology: staged via the debug handle)
  const staged = await page.evaluate(() => {
    const g = window.__game;
    const p = g.entities.byId.get(g.entities.playerId);
    p.hp = 1;
    let adj = null;
    for (const e of g.entities.byId.values()) {
      if (e.id === g.entities.playerId) continue;
      if (Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) === 1) {
        adj = e;
        break;
      }
    }
    if (!adj) return null;
    adj.hp = 1e9;
    return { dx: adj.x - p.x, dy: adj.y - p.y };
  });
  if (!staged) {
    record('E10/death', false, 'no adjacent enemy after fight replay — staging failed');
  } else {
    const CODE = {
      '0,-1': 'Numpad8',
      '1,-1': 'Numpad9',
      '1,0': 'Numpad6',
      '1,1': 'Numpad3',
      '0,1': 'Numpad2',
      '-1,1': 'Numpad1',
      '-1,0': 'Numpad4',
      '-1,-1': 'Numpad7',
    };
    const bumpCode = CODE[`${staged.dx},${staged.dy}`];
    for (let i = 0; i < 30; i++) {
      const dead = await page.evaluate(() => window.__game.status === 'dead');
      if (dead) break;
      await page.keyboard.press(bumpCode);
      await page
        .waitForFunction(
          (tt) => window.__game.turn > tt || window.__game.status === 'dead',
          (await page.evaluate(() => window.__game.turn)) - 1,
          { timeout: 5000 },
        )
        .catch(() => {});
      await page.evaluate(() => new Promise((r) => setTimeout(r, 40)));
    }
    await page.waitForSelector('#gameover.show', { timeout: 10000 });
    await page.screenshot({ path: SHOTS + 'death.png' });
    // initials sanitize while typing
    await page.fill('#gameover .go-initials-input', '');
    await page.click('#gameover .go-initials-input');
    await page.keyboard.type('abc');
    const initialsVal = await page.inputValue('#gameover .go-initials-input');
    await page.click('#gameover .go-initials button[type="submit"]');
    await page.waitForFunction(
      () => document.querySelector('#gameover .go-status').textContent.length > 0,
      null,
      { timeout: 5000 },
    );
    const statusMsg = (await page.textContent('#gameover .go-status')).trim();
    const lockState = await page.evaluate(() => ({
      input: document.querySelector('#gameover .go-initials-input').disabled,
      btn: document.querySelector('#gameover .go-initials button[type="submit"]').disabled,
    }));
    // second submit attempt must be impossible / produce no new POST
    await page
      .click('#gameover .go-initials button[type="submit"]', { force: true })
      .catch(() => {});
    await page.evaluate(() => new Promise((r) => setTimeout(r, 200)));
    const payload = posts[0] || {};
    const g = await page.evaluate(() => ({
      seed: window.__game.seed,
      turn: window.__game.turn,
      floor: window.__game.floor,
    }));
    const payloadOk =
      posts.length === 1 &&
      payload.initials === 'ABC' &&
      payload.floor === g.floor &&
      payload.seed === String(g.seed) &&
      payload.version === VERSION &&
      typeof payload.turns === 'number';
    // menu must open above the death screen
    await page.keyboard.press('Escape');
    await page.waitForSelector('#menu.show', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
    // restart -> fresh run, new seed
    await page.click('#gameover [data-act="restart"]');
    await page.waitForFunction(
      (prev) => window.__game.status === 'playing' && window.__game.seed !== prev,
      g.seed,
      { timeout: 5000 },
    );
    const after = await page.evaluate(() => ({
      seed: window.__game.seed,
      url: location.search,
      over: !!document.querySelector('#gameover.show'),
    }));
    record(
      'E10/death',
      initialsVal === 'ABC' &&
        payloadOk &&
        lockState.input &&
        lockState.btn &&
        !after.over &&
        after.url.includes(String(after.seed)),
      `initials="${initialsVal}" posts=${posts.length} payload=${JSON.stringify(payload)} status="${statusMsg}" locked=${lockState.input && lockState.btn} restartNewSeed=${after.seed} escaped=${escaped.length}`,
    );
  }
  await ctx.close();
}

// ---------- E13: PWA — SW registration, offline reload ----------
{
  const { ctx, escaped } = await newGameContext(browser, { allowSW: true });
  const page = await newGamePage(ctx);
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__game && !!document.querySelector('#game canvas'),
    null,
    { timeout: 20000 },
  );
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const res = await fetch(link.href);
    return await res.json();
  });
  const swReady = await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => true).catch(() => false),
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__game && !!document.querySelector('#game canvas'),
    null,
    { timeout: 20000 },
  );
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  let offlineBoot = false;
  try {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => window.__game && !!document.querySelector('#game canvas'),
      null,
      { timeout: 20000 },
    );
    offlineBoot = true;
  } catch {
    offlineBoot = false;
  }
  const manifestOk =
    manifest &&
    manifest.name === 'Dungeons' &&
    manifest.display === 'fullscreen' &&
    manifest.icons.length >= 3;
  record(
    'E13/pwa',
    manifestOk && swReady && controlled && offlineBoot,
    `manifest=${manifestOk} swReady=${swReady} controlledAfterReload=${controlled} offlineReloadBoots=${offlineBoot} escaped=${escaped.length}`,
  );
  await ctx.close();
}

await browser.close();
if (previewChild) previewChild.kill();
const failures = results.filter((r) => !r.pass);
console.log(
  `\n==== E2E RESULTS: ${results.length - failures.length}/${results.length} passed ====`,
);
console.log(
  `pageErrors during campaign: ${pageErrors.length}${pageErrors.length ? ' — ' + pageErrors.slice(0, 3).join(' | ') : ''}`,
);
writeFileSync(
  new URL('./.artifacts/results.json', import.meta.url),
  JSON.stringify({ results, pageErrors }, null, 2),
);
process.exit(failures.length === 0 ? 0 : 1);
