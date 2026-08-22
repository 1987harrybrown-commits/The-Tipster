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

// Structured data, serialised for a <script> block. Same helper as the four tip
// pages: script content is raw text, so an HTML entity is not decoded there and
// esc() would corrupt the values — while what actually breaks out of the block
// is a literal "</script>" inside a string, which JSON.stringify does not
// escape. Nothing interpolated below comes from the feed today, but the next
// field added to it might.
function jsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}


function fmt(n,d=2){return(n>=0?'+':'')+parseFloat(n).toFixed(d);}
function fmtDate(d){return new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'});}

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
  // Three different needs, three different reads.
  //
  // The daily table below is labelled "last 30 days" but was built from a
  // single .limit(100) query ordered by recency. At the ~15 tips a day the
  // engine publishes, 30 days is roughly 450 rows, so the table silently
  // covered only the most recent stretch of the month and presented it as the
  // whole month. The window now drives its own paginated read.
  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate()-30);

  const [r_recent, r_window, r_stats] = await Promise.all([
    db.from('results_history').select('*').order('settled_at',{ascending:false}).limit(30),
    selectAllRows('results_history','result,profit_loss,stake,tier,settled_at',
                  q => q.gte('settled_at', thirtyAgo.toISOString())),
    db.from('stats_cache').select('*').eq('id',1).single()
  ]);
  // Both reads are fatal. selectAllRows throws on failure; the direct
  // queries report theirs on the result object, and stats_cache uses
  // .single(), which errors when the row is missing. Publishing a page
  // that quietly drops either one means publishing numbers that do not
  // describe the record — a 0% win rate reads as a real result.
  if (r_recent.error) throw new Error('recent results read failed: ' + r_recent.error.message);
  if (r_stats.error) throw new Error('stats_cache read failed: ' + r_stats.error.message);
  const recent = r_recent.data, window30 = r_window.data, stats = r_stats.data;

  // Staked bets only, so win rate and P/L describe the same population.
  // Short-price "insight" picks carry stake 0 and were never advised as bets:
  // they counted towards win rate but contributed nothing to profit.
  const staked = r => r.tier !== 'insight' && parseFloat(r.stake ?? 1) > 0;
  const rows      = (recent || []).filter(staked);
  const windowRows = (window30 || []).filter(staked);

  // The headline figures must describe the whole ledger, because the title,
  // the meta description and the structured data all assert them next to the
  // claim that every advised single is published win or lose. They used to
  // fall back to counting the rows fetched for the recent-results list, which
  // would have stated a win rate over 100 tips while making that claim.
  // stats_cache is the only source computed over the full ledger, so a missing
  // or non-numeric field is fatal rather than quietly substituted.
  //
  // Note these were read with `||`, so a legitimate 0 — a genuinely 0% win
  // rate, or a net P/L of exactly zero — also fell through to the fallback.
  const num = (v, label) => {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) throw new Error('stats_cache.' + label + ' is missing or not numeric');
    return n;
  };
  const winRate   = num(stats?.win_rate,   'win_rate');
  const pl        = num(stats?.total_pl,   'total_pl');
  const roi       = num(stats?.roi,        'roi');
  const totalWon  = num(stats?.total_won,  'total_won');
  const totalLost = num(stats?.total_lost, 'total_lost');
  // Nothing settled yet is not a 0% win rate and not 0.00u of profit made —
  // it is an absence of a record. The title, the three descriptions and the
  // structured data all built sentences out of those zeros.
  const settled = totalWon + totalLost;
  const titleRate = settled > 0 ? ' — ' + winRate + '% Win Rate' : '';
  const recordPhrase = settled > 0
    ? `${totalWon} winners from ${settled} settled tips. ${winRate}% win rate. ${fmt(pl)}u profit.`
    : 'No tips have settled yet.';

  // Last 30 days by day
  const byDay = {};
  windowRows.forEach(r=>{
    const day = r.settled_at?.slice(0,10) || new Date(r.settled_at).toISOString().slice(0,10);
    if(!byDay[day]) byDay[day]={won:0,lost:0,pl:0};
    if(r.result==='WON') byDay[day].won++;
    if(r.result==='LOST') byDay[day].lost++;
    byDay[day].pl += parseFloat(r.profit_loss||0);
  });

  const dayRows = Object.entries(byDay).sort((a,b)=>b[0].localeCompare(a[0])).map(([day,d])=>`
    <tr>
      <td>${fmtDate(day)}</td>
      <td>${d.won+d.lost}</td>
      <td style="color:#18e07a">${d.won}</td>
      <td style="color:#ff3d5a">${d.lost}</td>
      <td style="color:#18e07a">${d.won+d.lost>0?((d.won/(d.won+d.lost))*100).toFixed(0)+'%':'—'}</td>
      <td style="color:${d.pl>=0?'#18e07a':'#ff3d5a'};font-family:monospace">${fmt(d.pl)}u</td>
    </tr>`).join('');

  const recentRows = rows.slice(0,30).map(r=>`
    <tr>
      <td>${fmtDate(r.settled_at)}</td>
      <td>${esc(r.sport||'')}</td>
      <td>${esc(r.event||'')}</td>
      <td>${esc(r.selection||'')}</td>
      <td style="color:#f0b429;font-family:monospace">${parseFloat(r.odds||0).toFixed(2)}</td>
      <td><span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700;font-family:monospace;background:${r.result==='WON'?'rgba(24,224,122,0.1)':r.result==='VOID'?'rgba(108,131,163,0.15)':'rgba(255,61,90,0.1)'};color:${r.result==='WON'?'#18e07a':r.result==='VOID'?'#738cae':'#ff3d5a'}">${esc(r.result)}</span></td>
      <td style="color:${parseFloat(r.profit_loss||0)>=0?'#18e07a':'#ff3d5a'};font-family:monospace">${fmt(parseFloat(r.profit_loss||0))}u</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Verified Betting Tips Track Record${titleRate} | The Tipster</title>
<meta name="description" content="Fully transparent verified betting tips track record. ${recordPhrase} Every advised single published, win or lose.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://www.thetipsteredge.com/results">
<meta property="og:type" content="website">
<meta property="og:title" content="Verified Betting Tips Track Record${titleRate} | The Tipster">
<meta property="og:description" content="Fully transparent verified betting tips track record. ${recordPhrase} Every advised single published, win or lose.">
<meta property="og:url" content="https://www.thetipsteredge.com/results">
<meta property="og:site_name" content="The Tipster Edge">
<meta property="og:locale" content="en_GB">
<meta property="og:image" content="https://www.thetipsteredge.com/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Tipster Edge — data-driven sports betting tips">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Verified Betting Tips Track Record${titleRate} | The Tipster">
<meta name="twitter:description" content="Fully transparent verified betting tips track record. ${recordPhrase} Every advised single published, win or lose.">
<meta name="twitter:image" content="https://www.thetipsteredge.com/og-image.jpg">
<meta name="twitter:site" content="@TheTipsterApp">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<script type="application/ld+json">${jsonLd({
  "@context":"https://schema.org",
  "@type":"Dataset",
  "name":"The Tipster — Verified Betting Tips Track Record",
  "description":`Complete betting tips results history. ${recordPhrase}`,
  "url":"https://www.thetipsteredge.com/results",
  "publisher":{"@type":"Organization","name":"The Tipster","url":"https://www.thetipsteredge.com"}
})}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#07090d;color:#dde6f0;font-family:system-ui,-apple-system,sans-serif;line-height:1.6;}
nav{background:#0c0f15;border-bottom:1px solid #1c2535;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;}
.logo{font-size:20px;font-weight:800;color:#dde6f0;text-decoration:none;}
.logo em{color:#18e07a;font-style:normal;}
.nav-cta{background:#18e07a;color:#07090d;padding:8px 18px;border-radius:5px;text-decoration:none;font-weight:700;font-size:13px;}
.wrap{max-width:1000px;margin:0 auto;padding:48px 24px 80px;}
.page-label{font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#18e07a;margin-bottom:10px;}
h1{font-size:clamp(22px,5vw,38px);font-weight:800;line-height:1.15;margin-bottom:8px;}
.page-sub{font-size:15px;color:#6c83a3;margin-bottom:32px;}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:1px;background:#1c2535;border-radius:8px;overflow:hidden;margin-bottom:32px;}
.kpi{background:#0f141c;padding:18px 16px;}
.kpi-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#6c83a3;margin-bottom:8px;font-family:monospace;}
.kpi-val{font-size:26px;font-weight:800;font-family:monospace;line-height:1;}
.green{color:#18e07a;} .red{color:#ff3d5a;} .gold{color:#f0b429;} .white{color:#dde6f0;}
h2{font-size:20px;font-weight:800;margin:36px 0 16px;}
.tbl-wrap{overflow-x:auto;margin-bottom:32px;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{text-align:left;padding:10px 12px;background:#0c0f15;color:#6c83a3;border-bottom:1px solid #1c2535;font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:1px;}
td{padding:10px 12px;border-bottom:1px solid #1c2535;color:#8a9bb0;}
tr:hover td{background:#0f141c;}
.content-block{background:#0f141c;border:1px solid #1c2535;border-radius:8px;padding:24px;margin-bottom:20px;}
.content-block h2{font-size:18px;margin-top:0;}
.content-block p{font-size:14px;color:#6c83a3;line-height:1.8;margin-bottom:10px;}
.breadcrumb{font-size:12px;color:#6c83a3;margin-bottom:24px;}
.breadcrumb a{color:#6c83a3;text-decoration:none;}
footer{background:#0c0f15;border-top:1px solid #1c2535;padding:24px;text-align:center;font-size:12px;color:#6c83a3;}
footer a{color:#6c83a3;text-decoration:none;margin:0 8px;}
</style>
</head>
<body>
<nav>
  <a class="logo" href="/">The <em>Tipster</em></a>
  <a class="nav-cta" href="/">View Today's Tips →</a>
</nav>
<div class="wrap">
  <nav class="breadcrumb"><a href="/">Home</a> › Verified Track Record</nav>
  <div class="page-label">Every Advised Single, Win Or Lose</div>
  <h1>Verified Betting Tips Track Record</h1>
  <p class="page-sub">Every tip logged from the moment it's published. Results recorded automatically. Nothing deleted, edited or cherry-picked.</p>

  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Win Rate</div><div class="kpi-val ${settled > 0 ? 'green' : 'white'}">${settled > 0 ? winRate + '%' : '&mdash;'}</div></div>
    <div class="kpi"><div class="kpi-label">Tips Won</div><div class="kpi-val green">${totalWon}</div></div>
    <div class="kpi"><div class="kpi-label">Tips Lost</div><div class="kpi-val red">${totalLost}</div></div>
    <div class="kpi"><div class="kpi-label">Total Tips</div><div class="kpi-val white">${totalWon+totalLost}</div></div>
    <div class="kpi"><div class="kpi-label">Net Profit</div><div class="kpi-val ${settled===0?'white':(pl>=0?'green':'red')}">${settled>0?fmt(pl)+'u':'&mdash;'}</div></div>
    <div class="kpi"><div class="kpi-label">ROI</div><div class="kpi-val ${settled > 0 ? 'gold' : 'white'}">${settled > 0 ? fmt(roi,1) + '%' : '&mdash;'}</div></div>
  </div>

  <h2>Daily Results — Last 30 Days</h2>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th>Date</th><th>Tips</th><th>Won</th><th>Lost</th><th>Win Rate</th><th>P&amp;L</th></tr></thead>
      <tbody>${dayRows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:#6c83a3">No tips have settled in the last 30 days.</td></tr>'}</tbody>
    </table>
  </div>

  <h2>Recent Results</h2>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th>Date</th><th>Sport</th><th>Match</th><th>Selection</th><th>Odds</th><th>Result</th><th>P&amp;L</th></tr></thead>
      <tbody>${recentRows || '<tr><td colspan="7" style="text-align:center;padding:24px;color:#6c83a3">No results yet</td></tr>'}</tbody>
    </table>
  </div>

  <div class="content-block">
    <h2>How Results Are Tracked</h2>
    <p>Every tip published on The Tipster is assigned a unique reference and timestamped the moment it goes live. When the fixture completes, our engine automatically fetches the final score from the Odds API and records the result. No manual intervention — no opportunity to exclude losses.</p>
    <p>The win rate, P&L and ROI figures on this page are calculated directly from this database. Every advised single is included, win or lose — nothing is removed for looking bad.</p>
    <p>Accumulators are not part of these figures. The Saturday accumulator is emailed rather than recorded, so it has no outcome here — the numbers on this page describe single bets only.</p>
    <p>Two things are deliberately not counted, and it is worth being precise about them. Short-price selections published for information carry no stake and are not bets, so they appear on the card marked as insight only and are excluded from both figures — there is no return to compute on a stake of zero, and counting them towards the win rate while leaving them out of the ROI would describe two different sets of tips. Voided bets are counted as placed and returned: they affect neither the win rate nor the P&L.</p>
    <p>Stake recommendations use fractional Kelly sizing (0.25 Kelly) based on the confidence and edge of each tip. This approach maximises long-term growth while managing risk — stakes range from 1u to 3u depending on model conviction.</p>
  </div>

  <div class="content-block">
    <h2>What Do the Stats Mean?</h2>
    <p><strong style="color:#dde6f0">Win Rate</strong> — the percentage of settled tips that were correct predictions. Our all-time win rate across football, NHL and NBA is shown above.</p>
    <p><strong style="color:#dde6f0">P&L (Profit & Loss)</strong> — measured in units (u). 1 unit = your base stake. A positive P&L means our tips have returned more than staked over this period.</p>
    <p><strong style="color:#dde6f0">ROI (Return on Investment)</strong> — total profit divided by total amount staked, expressed as a percentage. A positive ROI demonstrates long-term profitability.</p>
    <p><strong style="color:#dde6f0">Value Edge</strong> — the gap between our model's probability and the bookmaker's implied probability. Only tips with a positive edge are published.</p>
  </div>
</div>
<footer>
  <p style="margin-bottom:10px">© 2026 The Tipster · Verified betting tips track record · 18+ only · Tips are for informational purposes only · Past performance does not guarantee future results · Please gamble responsibly &bull; <a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer">BeGambleAware.org</a> &bull; National Gambling Helpline <a href="tel:08088020133">0808 8020 133</a></p>
  <div>
    <a href="/">Home</a><a href="/tips">Today's Tips</a><a href="/football-tips-today">Football</a>
    <a href="/nhl-tips-today">NHL</a><a href="/nba-tips-today">NBA</a>
    <a href="/terms.html">Terms</a><a href="/responsible-gambling.html">Responsible Gambling</a>
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
