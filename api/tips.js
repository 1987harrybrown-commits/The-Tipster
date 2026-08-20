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


// Escape anything interpolated into the HTML below. None of these fields is
// meant to contain markup — they are team names, leagues and selections that
// originate from an upstream feed — so a stray < or & should render, not parse.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


const SPORT_ICONS = { Football: '⚽', Basketball: '🏀', 'Ice Hockey': '🏒' };

function fmtOdds(o) { return parseFloat(o).toFixed(2); }
function fmtDate(d) { return new Date(d).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Europe/London' }); }
function fmtTime(d) { return new Date(d).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/London' }); }

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
  const tom   = new Date(today); tom.setDate(tom.getDate()+2);

  const [r_tips, r_stats] = await Promise.all([
    db.from('tips').select('*')
      .gte('event_time', today.toISOString())
      .lte('event_time', tom.toISOString())
      .eq('status','pending')
      .order('confidence', { ascending: false })
      .limit(20),
    db.from('stats_cache').select('*').eq('id',1).single()
  ]);
  // Both reads are fatal. selectAllRows throws on failure; the direct
  // queries report theirs on the result object, and stats_cache uses
  // .single(), which errors when the row is missing. Publishing a page
  // that quietly drops either one means publishing numbers that do not
  // describe the record — a 0% win rate reads as a real result.
  if (r_tips.error) throw new Error('tips read failed: ' + r_tips.error.message);
  if (r_stats.error) throw new Error('stats read failed: ' + r_stats.error.message);
  const tips = r_tips.data, stats = r_stats.data;

  const todayStr = fmtDate(new Date());
  // The engine tags exactly FREE_TIPS_PER_DAY tips a day with is_free, and
  // index.html gates on that flag. These pages instead took the top N by
  // confidence over their own window — and the sport pages take the top N
  // *within one sport* — so the two sets could disagree and a pick the engine
  // marked Pro could have its selection and price published here. The
  // confidence is locked on these cards, but the pick itself is the paywalled
  // thing.
  //
  // Prefer the flag. Fall back to the old behaviour only while the is_free
  // column is unmigrated, which is still the case in production, so this is
  // inert until that migration runs.
  const freeOf = (rows, n) => {
    const list = rows || [];
    return list.some(t => t.is_free != null)
      ? list.filter(t => t.is_free === true).slice(0, n)
      : list.slice(0, n);
  };
  const freeTips = freeOf(tips, 3);
  const winRate  = stats?.win_rate || 0;
  const totalWon = stats?.total_won || 0;
  const totalLost= stats?.total_lost || 0;

  const tipCards = freeTips.map(t => `
    <article class="tip-card" itemscope itemtype="https://schema.org/Event">
      <div class="tip-sport">${SPORT_ICONS[t.sport]||'🏅'} ${esc(t.sport)} · ${esc(t.league)}</div>
      <h3 itemprop="name">${esc(t.home_team)} vs ${esc(t.away_team)}</h3>
      <div class="tip-meta">
        <span class="tip-pick">📌 ${esc(t.selection)}</span>
        <span class="tip-odds">Odds: <strong>${fmtOdds(advisedPrice(t))}</strong></span>
        <span class="tip-time">🕐 ${fmtKickoff(t.event_time, today)} UK</span>
      </div>
      <div class="tip-conf">Confidence · <strong>Pro only 🔒</strong>
        <div class="conf-bar"><div class="conf-fill conf-locked"></div></div>
      </div>
    </article>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free Betting Tips Today — ${todayStr} | The Tipster</title>
<meta name="description" content="Free football tips, NHL tips and NBA tips for ${todayStr}. Data-driven predictions with ${winRate}% win rate. Updated every 15 minutes from 40+ bookmakers.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://www.thetipsteredge.com/tips">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta property="og:title" content="Free Betting Tips Today — ${todayStr}">
<meta property="og:description" content="Today's free sports betting tips. ${winRate}% verified win rate. Football, NHL, NBA.">
<meta property="og:url" content="https://www.thetipsteredge.com/tips">
<meta property="og:type" content="website">
<meta property="og:site_name" content="The Tipster Edge">
<meta property="og:locale" content="en_GB">
<meta property="og:image" content="https://www.thetipsteredge.com/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Tipster Edge — data-driven sports betting tips">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Free Betting Tips Today — ${todayStr} | The Tipster">
<meta name="twitter:description" content="Free football tips, NHL tips and NBA tips for ${todayStr}. Data-driven predictions with ${winRate}% win rate. Updated every 15 minutes from 40+ bookmakers.">
<meta name="twitter:image" content="https://www.thetipsteredge.com/og-image.jpg">
<meta name="twitter:site" content="@TheTipsterApp">
<script type="application/ld+json">${JSON.stringify({
  "@context":"https://schema.org",
  "@type":"ItemList",
  "name":`Free Betting Tips — ${todayStr}`,
  "description":"Data-driven sports betting tips updated every 15 minutes",
  "url":"https://www.thetipsteredge.com/tips",
  "numberOfItems": freeTips.length,
  "itemListElement": freeTips.map((t,i) => ({
    "@type":"ListItem",
    "position": i+1,
    "name":`${esc(t.home_team)} vs ${esc(t.away_team)} — ${esc(t.selection)}`,
    "description":`${esc(t.sport)} tip: ${esc(t.selection)} at odds ${fmtOdds(advisedPrice(t))}`
  }))
})}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#07090d;color:#dde6f0;font-family:system-ui,-apple-system,sans-serif;line-height:1.6;}
nav{background:#0c0f15;border-bottom:1px solid #1c2535;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;}
.logo{font-size:20px;font-weight:800;color:#dde6f0;text-decoration:none;}
.logo em{color:#18e07a;font-style:normal;}
.nav-cta{background:#18e07a;color:#07090d;padding:8px 18px;border-radius:5px;text-decoration:none;font-weight:700;font-size:13px;}
.wrap{max-width:900px;margin:0 auto;padding:48px 24px 80px;}
.page-label{font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#18e07a;margin-bottom:10px;}
h1{font-size:clamp(24px,5vw,40px);font-weight:800;line-height:1.15;margin-bottom:8px;}
.page-sub{font-size:15px;color:#6c83a3;margin-bottom:32px;}
.stats-bar{display:flex;gap:24px;flex-wrap:wrap;background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:16px 20px;margin-bottom:32px;}
.stat{text-align:center;}
.stat-label{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#6c83a3;margin-bottom:4px;}
.stat-val{font-size:22px;font-weight:800;font-family:monospace;}
.stat-val.green{color:#18e07a;}
.stat-val.gold{color:#f0b429;}
.section-label{font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#18e07a;margin-bottom:16px;margin-top:40px;}
h2{font-size:22px;font-weight:800;margin-bottom:20px;}
.tips-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:40px;}
.tip-card{background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:18px;border-top:3px solid #18e07a;}
.tip-sport{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#6c83a3;margin-bottom:8px;}
.tip-card h3{font-size:15px;font-weight:800;margin-bottom:12px;}
.tip-meta{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;}
.tip-pick{font-size:13px;color:#dde6f0;}
.tip-odds{font-size:13px;color:#6c83a3;}
.tip-odds strong{color:#f0b429;font-family:monospace;}
.tip-time{font-size:12px;color:#6c83a3;}
.tip-conf{font-size:12px;color:#6c83a3;margin-top:8px;}
.conf-bar{height:3px;background:#1c2535;border-radius:2px;margin-top:5px;}
.conf-locked{width:100%;background:repeating-linear-gradient(90deg,#2a3444 0 6px,transparent 6px 12px);}
.conf-fill{height:100%;background:#18e07a;border-radius:2px;}
.locked-card{background:#0f141c;border:1px solid rgba(240,180,41,0.2);border-radius:8px;padding:18px;border-top:3px solid #f0b429;text-align:center;}
.locked-card h3{font-size:14px;color:#6c83a3;margin-bottom:10px;}
.locked-card a{display:inline-block;background:#f0b429;color:#07090d;padding:8px 20px;border-radius:5px;text-decoration:none;font-weight:700;font-size:13px;}
.content-block{background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:24px;margin-bottom:20px;}
.content-block h2{font-size:18px;font-weight:800;margin-bottom:12px;}
.content-block p{font-size:14px;color:#6c83a3;line-height:1.8;margin-bottom:10px;}
.content-block p:last-child{margin-bottom:0;}
.breadcrumb{font-size:12px;color:#6c83a3;margin-bottom:24px;}
.breadcrumb a{color:#6c83a3;text-decoration:none;}
.breadcrumb a:hover{color:#18e07a;}
footer{background:#0c0f15;border-top:1px solid #1c2535;padding:24px;text-align:center;font-size:12px;color:#6c83a3;}
footer a{color:#6c83a3;text-decoration:none;margin:0 8px;}
@media(max-width:600px){.stats-bar{gap:14px;}.stat-val{font-size:18px;}}
</style>
</head>
<body>
<nav>
  <a class="logo" href="/">The <em>Tipster</em></a>
  <a class="nav-cta" href="/">View Live Tips →</a>
</nav>
<div class="wrap">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="/">Home</a> › Free Betting Tips Today
  </nav>
  <div class="page-label">Updated Every 15 Minutes</div>
  <h1>Free Betting Tips — ${todayStr}</h1>
  <p class="page-sub">Data-driven sports predictions across football, NBA basketball and NHL ice hockey. Every tip verified and tracked.</p>

  <div class="stats-bar">
    <div class="stat"><div class="stat-label">Win Rate</div><div class="stat-val green">${winRate}%</div></div>
    <div class="stat"><div class="stat-label">Tips Won</div><div class="stat-val green">${totalWon}</div></div>
    <div class="stat"><div class="stat-label">Tips Lost</div><div class="stat-val" style="color:#ff3d5a">${totalLost}</div></div>
    <div class="stat"><div class="stat-label">Updates</div><div class="stat-val gold">15 min</div></div>
  </div>

  <div class="section-label">Today's Free Tips</div>
  <h2>Top Selections — ${todayStr}</h2>
  <div class="tips-grid">
    ${tipCards || '<p style="color:#6c83a3">Tips loading — check back shortly.</p>'}
    <div class="locked-card">
      <h3>🔒 Pro members get 15+ tips daily across all sports</h3>
      <a href="/">Unlock Full Card →</a>
    </div>
  </div>

  <div class="content-block">
    <h2>How Our Free Football Tips Work</h2>
    <p>The Tipster uses a Dixon-Coles Poisson model combined with live odds data from over 40 UK bookmakers to identify value bets across Premier League, La Liga, Bundesliga, Serie A, Ligue 1 and Champions League fixtures. Our model calculates the true probability of each outcome and compares it against bookmaker-implied probability to find genuine edge.</p>
    <p>Every tip is published with a confidence rating and value edge percentage. Tips are only published when the model identifies a positive expected value — meaning the true probability of winning exceeds what the bookmaker's odds imply.</p>
    <p>All results are logged automatically when fixtures complete. Nothing is deleted, edited or excluded. The win rate you see reflects every single settled tip in our database.</p>
  </div>

  <div class="content-block">
    <h2>Free NHL Ice Hockey Tips Today</h2>
    <p>NHL ice hockey is one of the most inefficient major betting markets, offering consistent value opportunities for data-driven models. Our Poisson-based prediction engine analyses team form, home ice advantage, goaltending matchups and recent 5-on-5 performance metrics to identify mispriced lines across all NHL games.</p>
    <p>Free NHL tips are published daily throughout the regular season and playoffs, updated every 15 minutes as odds move.</p>
  </div>

  <div class="content-block">
    <h2>Free NBA Basketball Tips Today</h2>
    <p>NBA basketball offers daily betting opportunities across a long season. Our model incorporates pace metrics, offensive and defensive efficiency ratings, rest days, travel schedules and recent form to calculate win probabilities that consistently outperform market-implied odds.</p>
    <p>Free NBA tips are available every game day throughout the regular season and playoffs.</p>
  </div>

  <div class="content-block">
    <h2>What Is Value Betting?</h2>
    <p>Value betting means placing bets only when the true probability of an outcome is higher than what the bookmaker's odds imply. For example, if our model calculates a 60% chance of a team winning, but the bookmaker's odds imply only a 50% chance, there is a +10% value edge on that selection.</p>
    <p>Consistently backing value selections is how professional bettors build a long-term profitable record. Our verified track record — with every result published and nothing excluded — demonstrates the power of this approach across thousands of settled tips.</p>
  </div>
</div>

<footer>
  <p style="margin-bottom:10px">© 2026 The Tipster · Free sports betting tips updated every 15 minutes · 18+ only · Please gamble responsibly &bull; <a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer">BeGambleAware.org</a> &bull; National Gambling Helpline <a href="tel:08088020133">0808 8020 133</a></p>
  <div>
    <a href="/">Home</a>
    <a href="/results">Track Record</a>
    <a href="/football-tips-today">Football Tips</a>
    <a href="/nhl-tips-today">NHL Tips</a>
    <a href="/nba-tips-today">NBA Tips</a>
    <a href="/terms.html">Terms</a>
    <a href="/responsible-gambling.html">Responsible Gambling</a>
  </div>
</footer>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
  res.status(200).send(html);
  } catch (err) {
    sendUnavailable(res, err);
  }
};
