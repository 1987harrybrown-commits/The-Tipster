const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = 'https://eyhlzzaaxrwisrtwyoyh.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGx6emFheHJ3aXNydHd5b3loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNzkyNzcsImV4cCI6MjA4ODk1NTI3N30.iqIk52att2Lv2o6m70Ht1LVWVgqbmLwptDqTxDq12AI';

const db = createClient(SUPABASE_URL, SUPABASE_ANON);

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
function fmtDate(d) { return new Date(d).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }); }
function fmtTime(d) { return new Date(d).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/London' }); }

module.exports = async (req, res) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const tom   = new Date(today); tom.setDate(tom.getDate()+2);

  const [{ data: tips }, { data: stats }] = await Promise.all([
    db.from('tips').select('*')
      .gte('event_time', today.toISOString())
      .lte('event_time', tom.toISOString())
      .eq('status','pending')
      .order('confidence', { ascending: false })
      .limit(20),
    db.from('stats_cache').select('*').eq('id',1).single()
  ]);

  const todayStr = fmtDate(new Date());
  const freeTips = (tips || []).slice(0, 3);
  const winRate  = stats?.win_rate || 0;
  const totalWon = stats?.total_won || 0;
  const totalLost= stats?.total_lost || 0;

  const tipCards = freeTips.map(t => `
    <article class="tip-card" itemscope itemtype="https://schema.org/Event">
      <div class="tip-sport">${SPORT_ICONS[t.sport]||'🏅'} ${esc(t.sport)} · ${esc(t.league)}</div>
      <h3 itemprop="name">${esc(t.home_team)} vs ${esc(t.away_team)}</h3>
      <div class="tip-meta">
        <span class="tip-pick">📌 ${esc(t.selection)}</span>
        <span class="tip-odds">Odds: <strong>${fmtOdds(t.odds)}</strong></span>
        <span class="tip-time">🕐 ${fmtTime(t.event_time)} UK</span>
      </div>
      <div class="tip-conf">Confidence: ${Number(t.confidence)||0}%
        <div class="conf-bar"><div class="conf-fill" style="width:${Number(t.confidence)||0}%"></div></div>
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
    "description":`${esc(t.sport)} tip at odds ${fmtOdds(t.odds)} with ${Number(t.confidence)||0}% confidence`
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
.page-sub{font-size:15px;color:#4a5a70;margin-bottom:32px;}
.stats-bar{display:flex;gap:24px;flex-wrap:wrap;background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:16px 20px;margin-bottom:32px;}
.stat{text-align:center;}
.stat-label{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#4a5a70;margin-bottom:4px;}
.stat-val{font-size:22px;font-weight:800;font-family:monospace;}
.stat-val.green{color:#18e07a;}
.stat-val.gold{color:#f0b429;}
.section-label{font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#18e07a;margin-bottom:16px;margin-top:40px;}
h2{font-size:22px;font-weight:800;margin-bottom:20px;}
.tips-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:40px;}
.tip-card{background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:18px;border-top:3px solid #18e07a;}
.tip-sport{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#4a5a70;margin-bottom:8px;}
.tip-card h3{font-size:15px;font-weight:800;margin-bottom:12px;}
.tip-meta{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;}
.tip-pick{font-size:13px;color:#dde6f0;}
.tip-odds{font-size:13px;color:#4a5a70;}
.tip-odds strong{color:#f0b429;font-family:monospace;}
.tip-time{font-size:12px;color:#4a5a70;}
.tip-conf{font-size:12px;color:#4a5a70;margin-top:8px;}
.conf-bar{height:3px;background:#1c2535;border-radius:2px;margin-top:5px;}
.conf-fill{height:100%;background:#18e07a;border-radius:2px;}
.locked-card{background:#0f141c;border:1px solid rgba(240,180,41,0.2);border-radius:8px;padding:18px;border-top:3px solid #f0b429;text-align:center;}
.locked-card h3{font-size:14px;color:#4a5a70;margin-bottom:10px;}
.locked-card a{display:inline-block;background:#f0b429;color:#07090d;padding:8px 20px;border-radius:5px;text-decoration:none;font-weight:700;font-size:13px;}
.content-block{background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:24px;margin-bottom:20px;}
.content-block h2{font-size:18px;font-weight:800;margin-bottom:12px;}
.content-block p{font-size:14px;color:#4a5a70;line-height:1.8;margin-bottom:10px;}
.content-block p:last-child{margin-bottom:0;}
.breadcrumb{font-size:12px;color:#4a5a70;margin-bottom:24px;}
.breadcrumb a{color:#4a5a70;text-decoration:none;}
.breadcrumb a:hover{color:#18e07a;}
footer{background:#0c0f15;border-top:1px solid #1c2535;padding:24px;text-align:center;font-size:12px;color:#4a5a70;}
footer a{color:#4a5a70;text-decoration:none;margin:0 8px;}
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
    ${tipCards || '<p style="color:#4a5a70">Tips loading — check back shortly.</p>'}
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
  <p style="margin-bottom:10px">© 2026 The Tipster · Free sports betting tips updated every 15 minutes · 18+ only · Please gamble responsibly</p>
  <div>
    <a href="/">Home</a>
    <a href="/results">Track Record</a>
    <a href="/football-tips.html">Football Tips</a>
    <a href="/nhl-tips.html">NHL Tips</a>
    <a href="/nba-tips.html">NBA Tips</a>
    <a href="/terms.html">Terms</a>
    <a href="/responsible-gambling.html">Responsible Gambling</a>
  </div>
</footer>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
  res.status(200).send(html);
};
