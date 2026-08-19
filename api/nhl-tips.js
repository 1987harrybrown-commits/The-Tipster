const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL  = 'https://eyhlzzaaxrwisrtwyoyh.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGx6emFheHJ3aXNydHd5b3loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNzkyNzcsImV4cCI6MjA4ODk1NTI3N30.iqIk52att2Lv2o6m70Ht1LVWVgqbmLwptDqTxDq12AI';
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// Start of the current UK day, as a real instant.
//
// Vercel runs in UTC, so `new Date(); d.setHours(0,0,0,0)` anchors to UTC
// midnight — which is 01:00 UK during BST. Between 00:00 and 01:00 UK the
// window therefore still covered the previous day, so these pages queried
// yesterday's tips and advertised yesterday's date in the title, the H1 and
// the structured data.
function ukDayStart(now = new Date()) {
  // The calendar date as London sees it, e.g. "2026-08-18".
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  // Take UTC midnight of that date, then subtract whatever offset London was
  // on at that instant. Reading the offset from the guess (rather than assuming
  // GMT or BST) keeps this correct across both transitions.
  const guess = new Date(ymd + 'T00:00:00Z');
  const hourInLondon = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', hour12: false,
  }).format(guess)) % 24;

  return new Date(guess.getTime() - hourInLondon * 3600000);
}


// PostgREST caps every response at 1000 rows, so an unbounded select over
// results_history silently truncates and every figure derived from it is wrong
// once the ledger passes that. Returns { data } to match the shape the callers
// already destructure.
async function selectAllRows(table, columns, applyFilters) {
  const PAGE = 1000;
  let out = [], from = 0;
  for (;;) {
    let q = db.from(table).select(columns).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (applyFilters) q = applyFilters(q);
    const { data, error } = await q;
    // Partial pages are worse than no answer: every published figure is
    // derived from this, so a truncated ledger silently understates the
    // record. Fail loudly and let the handler return 503.
    if (error) throw new Error('selectAllRows(' + table + ') failed at offset ' + from + ': ' + error.message);
    if (!data || !data.length) break;
    out = out.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { data: out };
}


// Escape anything interpolated into the HTML below. None of these fields is
// meant to contain markup — they are team names, leagues and selections that
// originate from an upstream feed — so a stray < or & should render, not parse.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(d){return new Date(d).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/London'});}
function fmtTime(d){return new Date(d).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/London'});}

// The price we advised at publication — the same number the ledger settles at.
// Mirrors advisedPrice() in the engine. Showing t.odds here meant these pages
// quoted the current live price while results were settled at the advised one,
// so the public price and the published ROI described different bets. Legacy
// rows predating advised_odds fall back to odds.
function advisedPrice(t) { return parseFloat(t && t.advised_odds != null ? t.advised_odds : t && t.odds); }

// These pages query today AND tomorrow, but their title and H1 say "Today".
// A bare clock time therefore presented a tomorrow fixture as one of today's,
// so anything outside the current UK day is labelled.
function fmtKickoff(eventTime, dayStart) {
  const t = fmtTime(eventTime);
  const ms = new Date(eventTime).getTime() - dayStart.getTime();
  if (ms < 0) return t;
  if (ms < 24 * 3600000) return t;
  if (ms < 48 * 3600000) return 'Tomorrow ' + t;
  return new Date(eventTime).toLocaleDateString('en-GB',
    { weekday: 'short', timeZone: 'Europe/London' }) + ' ' + t;
}


// A failed read must never be dressed up as real data. Returning 200 with
// zeros publishes a 0% win rate, and the s-maxage header then lets the CDN
// serve that for the next 15-30 minutes. A 503 with no-store is retried
// instead, and is noindex so a transient failure cannot be indexed.
function sendUnavailable(res, err) {
  console.error('handler failed:', (err && err.message) || err);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Retry-After', '60');
  res.status(503).send('<!DOCTYPE html><html lang="en-GB"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<meta name="robots" content="noindex">'
    + '<title>Temporarily unavailable | The Tipster</title></head>'
    + '<body style="background:#07090d;color:#dde6f0;font-family:system-ui,-apple-system,sans-serif;'
    + 'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center">'
    + '<div style="padding:24px"><h1 style="font-size:20px;font-weight:800;margin:0 0 8px">Temporarily unavailable</h1>'
    + '<p style="color:#6c83a3;font-size:14px;margin:0 0 16px">We could not load the latest data. Please try again shortly.</p>'
    + '<a href="/" style="color:#18e07a;font-size:14px;text-decoration:none">Back to The Tipster</a>'
    + '</div></body></html>');
}

module.exports = async (req, res) => {
  // Body intentionally not re-indented: these handlers are mostly one large
  // HTML template literal, and re-indenting would rewrite its contents.
  try {
  const today = ukDayStart();
  const tom = new Date(today); tom.setDate(tom.getDate()+2);
  const todayStr = fmtDate(new Date());

  const [r_tips, r_history] = await Promise.all([
    db.from('tips').select('*').eq('sport','Ice Hockey').eq('status','pending')
      .gte('event_time', today.toISOString()).lte('event_time', tom.toISOString())
      .order('confidence',{ascending:false}).limit(10),
    selectAllRows('results_history','result,profit_loss,stake,tier', q => q.eq('sport','Ice Hockey'))
  ]);
  // Both reads are fatal. selectAllRows throws on failure; the direct
  // queries report theirs on the result object, and stats_cache uses
  // .single(), which errors when the row is missing. Publishing a page
  // that quietly drops either one means publishing numbers that do not
  // describe the record — a 0% win rate reads as a real result.
  if (r_tips.error) throw new Error('tips read failed: ' + r_tips.error.message);
  if (r_history.error) throw new Error('history read failed: ' + r_history.error.message);
  const tips = r_tips.data, history = r_history.data;

  // Staked bets only, so win rate and P/L describe the same population.
  // Short-price "insight" picks carry stake 0 and were never advised as bets:
  // they counted towards win rate but contributed nothing to profit.
  const staked = r => r.tier !== 'insight' && parseFloat(r.stake ?? 1) > 0;
  const h = (history||[]).filter(staked);
  const won = h.filter(r=>r.result==='WON').length;
  const total = h.filter(r=>r.result==='WON'||r.result==='LOST').length;
  const winRate = total>0?((won/total)*100).toFixed(1):0;
  const pl = h.reduce((s,r)=>s+parseFloat(r.profit_loss||0),0);
  const freeTips = (tips||[]).slice(0,3);

  const tipCards = freeTips.map(t=>`
    <article class="tip-card">
      <div class="tip-league">🏒 ${esc(t.league)}</div>
      <h3>${esc(t.home_team)} vs ${esc(t.away_team)}</h3>
      <div class="tip-row"><span>📌 ${esc(t.selection)}</span><span style="color:#f0b429;font-family:monospace;font-weight:700">${advisedPrice(t).toFixed(2)}</span></div>
      <div class="tip-row"><span style="color:#6c83a3">🕐 ${fmtKickoff(t.event_time, today)} UK</span><span style="color:#6c83a3">Conf: <strong>Pro 🔒</strong></span></div>
    </article>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free NHL Ice Hockey Tips Today — ${todayStr} | The Tipster</title>
<meta name="description" content="Free NHL ice hockey betting tips for ${todayStr}. Data-driven predictions with ${winRate}% win rate. Poisson model analysis across all NHL games. Updated every 15 minutes.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://www.thetipsteredge.com/nhl-tips-today">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#07090d;color:#dde6f0;font-family:system-ui,-apple-system,sans-serif;line-height:1.6;}
nav{background:#0c0f15;border-bottom:1px solid #1c2535;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;}
.logo{font-size:20px;font-weight:800;color:#dde6f0;text-decoration:none;} .logo em{color:#18e07a;font-style:normal;}
.nav-cta{background:#18e07a;color:#07090d;padding:8px 18px;border-radius:5px;text-decoration:none;font-weight:700;font-size:13px;}
.wrap{max-width:900px;margin:0 auto;padding:48px 24px 80px;}
.label{font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#18e07a;margin-bottom:10px;}
h1{font-size:clamp(22px,5vw,38px);font-weight:800;margin-bottom:8px;}
h2{font-size:20px;font-weight:800;margin:32px 0 16px;}
.sub{font-size:15px;color:#6c83a3;margin-bottom:32px;}
.stats{display:flex;gap:20px;flex-wrap:wrap;background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:16px 20px;margin-bottom:32px;}
.stat .sl{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#6c83a3;} .stat .sv{font-size:22px;font-weight:800;font-family:monospace;}
.tips-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-bottom:32px;}
.tip-card{background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:16px;border-top:3px solid #18e07a;}
.tip-league{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#6c83a3;margin-bottom:6px;}
.tip-card h3{font-size:14px;font-weight:800;margin-bottom:10px;}
.tip-row{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;}
.locked{background:#0f141c;border:1px solid rgba(240,180,41,0.2);border-radius:8px;padding:20px;text-align:center;border-top:3px solid #f0b429;}
.locked p{font-size:13px;color:#6c83a3;margin-bottom:12px;}
.locked a{display:inline-block;background:#f0b429;color:#07090d;padding:8px 20px;border-radius:5px;text-decoration:none;font-weight:700;font-size:13px;}
.block{background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:24px;margin-bottom:16px;}
.block h2{font-size:18px;font-weight:800;margin-bottom:12px;margin-top:0;}
.block p{font-size:14px;color:#6c83a3;line-height:1.8;margin-bottom:10px;}
.breadcrumb{font-size:12px;color:#6c83a3;margin-bottom:24px;}
.breadcrumb a{color:#6c83a3;text-decoration:none;}
footer{background:#0c0f15;border-top:1px solid #1c2535;padding:24px;text-align:center;font-size:12px;color:#6c83a3;}
footer a{color:#6c83a3;text-decoration:none;margin:0 8px;}
</style>
</head>
<body>
<nav><a class="logo" href="/">The <em>Tipster</em></a><a class="nav-cta" href="/">View All Tips →</a></nav>
<div class="wrap">
  <nav class="breadcrumb"><a href="/">Home</a> › <a href="/tips">Betting Tips</a> › NHL Ice Hockey Tips</nav>
  <div class="label">NHL Primary Market</div>
  <h1>Free NHL Ice Hockey Tips — ${todayStr}</h1>
  <p class="sub">Poisson-model NHL predictions covering all regular season and playoff games. Ice hockey is our primary market — the most inefficient major betting league.</p>
  <div class="stats">
    <div class="stat"><div class="sl">NHL Win Rate</div><div class="sv" style="color:#18e07a">${winRate}%</div></div>
    <div class="stat"><div class="sl">Tips Won</div><div class="sv" style="color:#18e07a">${won}</div></div>
    <div class="stat"><div class="sl">Total Tips</div><div class="sv" style="color:#dde6f0">${total}</div></div>
    <div class="stat"><div class="sl">Net P&L</div><div class="sv" style="color:${pl>=0?'#18e07a':'#ff3d5a'};font-family:monospace">${pl>=0?'+':''}${pl.toFixed(1)}u</div></div>
  </div>
  <div class="label">Today's NHL Picks</div>
  <h2>Free NHL Tips — ${todayStr}</h2>
  <div class="tips-grid">
    ${tipCards||'<p style="color:#6c83a3;grid-column:1/-1">No NHL tips right now — check back later today.</p>'}
    <div class="locked"><p>🔒 Pro members get the full NHL card with value edge % and stake recommendations</p><a href="/">Unlock Pro →</a></div>
  </div>
  <div class="block">
    <h2>Why NHL is Our Primary Market</h2>
    <p>NHL ice hockey offers the best value betting opportunities of any major professional sport. Bookmakers systematically misprice NHL lines due to lower market liquidity compared to football or basketball, creating consistent opportunities for data-driven models to find edge.</p>
    <p>Our Poisson goals model is specifically calibrated for NHL hockey, incorporating 5-on-5 Corsi and Fenwick metrics, goaltending save percentages, power play efficiency, home ice advantage, back-to-back game fatigue, and travel schedule factors.</p>
  </div>
  <div class="block">
    <h2>NHL Betting Tips Model</h2>
    <p>For each NHL game, our model calculates the expected goals for each team based on their season-long offensive and defensive performance metrics relative to league averages. These expected goals feed into a bivariate Poisson distribution to generate win, loss and overtime probabilities.</p>
    <p>We compare these probabilities against the best available odds from 40+ UK-licensed bookmakers. Tips are only published when we identify a value edge of 8% or more — meaning our model gives significantly better odds than the bookmaker implies.</p>
  </div>
  <div class="block">
    <h2>NHL Regular Season vs Playoffs</h2>
    <p>Our NHL coverage runs throughout the regular season (October to April) and the Stanley Cup Playoffs (April to June). Playoff hockey has different statistical dynamics — teams are more evenly matched and series history becomes more relevant — and our model adjusts accordingly.</p>
  </div>
</div>
<footer>
  <p style="margin-bottom:10px">© 2026 The Tipster · Free NHL betting tips · 18+ only · Please gamble responsibly</p>
  <div><a href="/">Home</a><a href="/tips">All Tips</a><a href="/results">Track Record</a><a href="/football-tips-today">Football Tips</a><a href="/nba-tips-today">NBA Tips</a><a href="/responsible-gambling.html">Responsible Gambling</a></div>
</footer>
</body>
</html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=1800');
  res.status(200).send(html);
  } catch (err) {
    sendUnavailable(res, err);
  }
};
