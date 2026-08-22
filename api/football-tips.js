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

// A tip we cannot price is not a tip. advisedPrice returns NaN for a row with
// neither advised_odds nor odds, and `.toFixed(2)` on that renders the string
// "NaN" — as the price, on a public page. The engine guards this on write now,
// but these pages also read rows written before it did.
function priced(t) { return Number.isFinite(advisedPrice(t)) && advisedPrice(t) > 1; }

// Structured data, serialised for a <script> block.
//
// The values used to be run through esc() first, which is the wrong escaping
// twice over. Script content is raw text: an HTML entity is not decoded there,
// so a team name containing & reached Google as "&amp;". And esc() was doing a
// security job by accident — what actually breaks out of a <script> block is
// the literal "</script>" in a string value, which JSON.stringify does not
// escape. Escaping "<" as \u003c is the standard answer: it cannot appear in
// the output, and JSON.parse restores the original character.
function jsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

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
  const todayStr = fmtDate(new Date());

  const [r_tips, r_history] = await Promise.all([
    db.from('tips').select('*')
      .eq('sport','Football').eq('status','pending')
      .gte('event_time', today.toISOString())
      .lte('event_time', tom.toISOString())
      .order('confidence',{ascending:false}).limit(10),
    selectAllRows('results_history','result,profit_loss,stake,tier', q => q.eq('sport','Football'))
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
  // What the description tells a search result about the record.
  //
  // With no settled bets winRate is 0, and the sentence then reads as
  // losing every bet rather than having no record yet — which is what a
  // new sport has, or one out of season long enough for its window to
  // empty. NBA and NHL are dark from spring to October. Claim nothing
  // about a rate we do not have.
  const recordPhrase = total > 0
    ? `${winRate}% win rate on football tips.`
    : 'Every selection published and settled in the open.';
  const pl = h.reduce((s,r)=>s+parseFloat(r.profit_loss||0),0);

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
  // Unpriceable rows are dropped before the count is taken, so the cards and
  // the structured data below agree with each other rather than one of them
  // showing NaN.
  const freeTips = freeOf((tips || []).filter(priced), 3);
  // From the cards actually shown, not from the whole day's card. Two reasons:
  // the unfiltered list names the leagues the PRO tips are in, which is a small
  // thing to publish on a free page; and once rls-policies.sql is applied the
  // anon key only receives free tips anyway, so deriving from the full list
  // would quietly change what these pills mean on the day RLS goes on.
  const leagues = [...new Set(freeTips.map(t=>t.league))];

  const tipCards = freeTips.map(t=>`
    <article class="tip-card">
      <div class="tip-league">${esc(t.league)}</div>
      <h3>${esc(t.home_team)} vs ${esc(t.away_team)}</h3>
      <div class="tip-row">
        <span>📌 ${esc(t.selection)}</span>
        <span style="color:#f0b429;font-family:monospace;font-weight:700">${advisedPrice(t).toFixed(2)}</span>
      </div>
      <div class="tip-row">
        <span style="color:#6c83a3">🕐 ${fmtKickoff(t.event_time, today)} UK</span>
        <span style="color:#6c83a3">Conf: <strong>Pro 🔒</strong></span>
      </div>
    </article>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free Football Tips Today — ${todayStr} | The Tipster</title>
<meta name="description" content="Free football tips for ${todayStr}. Premier League, La Liga, Bundesliga, Champions League predictions. ${recordPhrase} Updated every 15 minutes.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://www.thetipsteredge.com/football-tips-today">
<meta property="og:type" content="website">
<meta property="og:title" content="Free Football Tips Today — ${todayStr} | The Tipster">
<meta property="og:description" content="Free football tips for ${todayStr}. Premier League, La Liga, Bundesliga, Champions League predictions. ${recordPhrase} Updated every 15 minutes.">
<meta property="og:url" content="https://www.thetipsteredge.com/football-tips-today">
<meta property="og:site_name" content="The Tipster Edge">
<meta property="og:locale" content="en_GB">
<meta property="og:image" content="https://www.thetipsteredge.com/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Tipster Edge — data-driven sports betting tips">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Free Football Tips Today — ${todayStr} | The Tipster">
<meta name="twitter:description" content="Free football tips for ${todayStr}. Premier League, La Liga, Bundesliga, Champions League predictions. ${recordPhrase} Updated every 15 minutes.">
<meta name="twitter:image" content="https://www.thetipsteredge.com/og-image.jpg">
<meta name="twitter:site" content="@TheTipsterApp">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
${freeTips.length ? `<script type="application/ld+json">${jsonLd({
  "@context":"https://schema.org",
  "@type":"ItemList",
  "name":`Free Football Tips — ${todayStr}`,
  "description":"Data-driven football predictions across Premier League, La Liga, Bundesliga, Champions League",
  "url":"https://www.thetipsteredge.com/football-tips-today",
  "numberOfItems": freeTips.length,
  "itemListElement": freeTips.map((t,i) => ({
    "@type":"ListItem",
    "position": i+1,
    "name":`${t.home_team} vs ${t.away_team} — ${t.selection}`,
    "description":`${t.league} tip at ${advisedPrice(t).toFixed(2)} odds`
  }))
})}</script>` : ''}
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#07090d;color:#dde6f0;font-family:system-ui,-apple-system,sans-serif;line-height:1.6;}
nav{background:#0c0f15;border-bottom:1px solid #1c2535;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;}
.logo{font-size:20px;font-weight:800;color:#dde6f0;text-decoration:none;} .logo em{color:#18e07a;font-style:normal;}
.nav-cta{background:#18e07a;color:#07090d;padding:8px 18px;border-radius:5px;text-decoration:none;font-weight:700;font-size:13px;}
.wrap{max-width:900px;margin:0 auto;padding:48px 24px 80px;}
.label{font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#18e07a;margin-bottom:10px;}
h1{font-size:clamp(22px,5vw,38px);font-weight:800;margin-bottom:8px;}
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
.block h2{font-size:18px;font-weight:800;margin-bottom:12px;}
.block p{font-size:14px;color:#6c83a3;line-height:1.8;margin-bottom:10px;}
.block p:last-child{margin-bottom:0;}
.leagues{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:32px;}
.league-pill{background:#0f141c;border:1px solid #1c2535;border-radius:20px;padding:6px 14px;font-size:12px;color:#6c83a3;}
.breadcrumb{font-size:12px;color:#6c83a3;margin-bottom:24px;}
.breadcrumb a{color:#6c83a3;text-decoration:none;}
h2{font-size:20px;font-weight:800;margin:32px 0 16px;}
footer{background:#0c0f15;border-top:1px solid #1c2535;padding:24px;text-align:center;font-size:12px;color:#6c83a3;}
footer a{color:#6c83a3;text-decoration:none;margin:0 8px;}
</style>
</head>
<body>
<nav>
  <a class="logo" href="/">The <em>Tipster</em></a>
  <a class="nav-cta" href="/">View All Tips →</a>
</nav>
<div class="wrap">
  <nav class="breadcrumb"><a href="/">Home</a> › <a href="/tips">Betting Tips</a> › Football Tips Today</nav>
  <div class="label">Updated Every 15 Minutes</div>
  <h1>Free Football Tips Today — ${todayStr}</h1>
  <p class="sub">Data-driven football predictions across Premier League, La Liga, Bundesliga, Serie A, Ligue 1 and Champions League.</p>

  <div class="stats">
    <div class="stat"><div class="sl">Football Win Rate</div><div class="sv" style="color:#18e07a">${winRate}%</div></div>
    <div class="stat"><div class="sl">Tips Won</div><div class="sv" style="color:#18e07a">${won}</div></div>
    <div class="stat"><div class="sl">Total Tips</div><div class="sv" style="color:#dde6f0">${total}</div></div>
    <div class="stat"><div class="sl">Net P&L</div><div class="sv" style="color:${pl>=0?'#18e07a':'#ff3d5a'};font-family:monospace">${pl>=0?'+':''}${pl.toFixed(1)}u</div></div>
  </div>

  ${leagues.length?`<div class="leagues">${leagues.map(l=>`<span class="league-pill">⚽ ${esc(l)}</span>`).join('')}</div>`:''}

  <div class="label">Today's Picks</div>
  <h2>Free Football Tips — ${todayStr}</h2>
  <div class="tips-grid">
    ${tipCards||'<p style="color:#6c83a3;grid-column:1/-1">No football tips published yet. The card goes up each morning, UK time, when there are fixtures to price.</p>'}
    <div class="locked">
      <p>🔒 Pro members get the full football card — all leagues, all confidence levels, with value edge % on every tip</p>
      <a href="/">Unlock Pro Tips →</a>
    </div>
  </div>

  <div class="block">
    <h2>Premier League Tips Today</h2>
    <p>Our Dixon-Coles Poisson model is optimised for Premier League fixtures, using team season statistics, home/away attack and defence strength ratings, head-to-head records and live odds data from an aggregated odds feed covering UK bookmakers. Where a specific book offers the best price, it is named on the tip.</p>
    <p>Premier League tips are published when our model identifies a value edge of 8% or more above the bookmaker's implied probability. Only selections that pass our strict confidence threshold appear on the platform.</p>
  </div>

  <div class="block">
    <h2>Champions League Tips</h2>
    <p>Champions League football presents some of the best value betting opportunities due to the complexity of cross-league matchups. Our model incorporates group stage form, knockout round history, home and away European records, and squad depth to produce reliable win probabilities for every Champions League fixture.</p>
  </div>

  <div class="block">
    <h2>La Liga, Bundesliga & European Football Tips</h2>
    <p>Beyond the Premier League, we cover La Liga (Spain), Bundesliga (Germany), Serie A (Italy), Ligue 1 (France) and Champions League. Each league has its own calibrated attack/defence strength model built from full season statistics.</p>
    <p>Tips are available for every match in these competitions throughout the season, with odds from the best available UK-licensed bookmaker at time of publication.</p>
  </div>

  <div class="block">
    <h2>How to Use Our Football Tips</h2>
    <p>Each football tip comes with an odds figure (the best price our odds feed had at publication, and the book offering it), a confidence percentage (our model's estimated probability of the selection winning), and a value edge percentage (the gap between our probability and what the odds imply).</p>
    <p>We recommend using stake recommendations — available to Pro members — to size each bet appropriately based on confidence. Never bet more than you can afford to lose, and treat all tips as analysis rather than guaranteed outcomes.</p>
  </div>
</div>
<footer>
  <p style="margin-bottom:10px">© 2026 The Tipster · Free football tips updated every 15 minutes · 18+ only · Please gamble responsibly &bull; <a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer">BeGambleAware.org</a> &bull; National Gambling Helpline <a href="tel:08088020133">0808 8020 133</a></p>
  <div>
    <a href="/">Home</a><a href="/tips">All Tips</a><a href="/results">Track Record</a>
    <a href="/nhl-tips-today">NHL Tips</a><a href="/nba-tips-today">NBA Tips</a>
    <a href="/responsible-gambling.html">Responsible Gambling</a>
  </div>
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
