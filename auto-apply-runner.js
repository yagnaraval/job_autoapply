/**
 * Job AutoApply — Playwright runner for the Wellfound application workflow.
 * It opens Chrome with a persistent local session and injects the Wellfound
 * application script into the jobs page.
 *
 * Usage:
 *   node auto-apply-runner.js wellfound login  Open Chrome to sign in manually.
 *   node auto-apply-runner.js wellfound        Dry run; forms are filled, not submitted.
 *   node auto-apply-runner.js wellfound --live Submit applications (use only after review).
 *
 * Maintainer: yraval
 * GitHub: https://github.com/yagnaraval
 */
const path = require('path');
const fs = require('fs');
const { CV, geminiKey } = require('./config'); // personal data from .env, injected into the console scripts
// Use the installed Playwright browser integration when available.
let chromium;
try {
  const { addExtra } = require('playwright-extra');
  chromium = addExtra(require('playwright-core').chromium);
  chromium.use(require('puppeteer-extra-plugin-stealth')());
} catch (e) {
  ({ chromium } = require('playwright-core'));
}

// Navigation can trigger asynchronous browser rejections; log them so the run can be diagnosed.
process.on('unhandledRejection', (e) => console.log(`[${new Date().toLocaleString()}] unhandledRejection (ignored): ${String(e && e.message || e).split('\n')[0]}`));
process.on('uncaughtException', (e) => console.log(`[${new Date().toLocaleString()}] uncaughtException (ignored): ${String(e && e.message || e).split('\n')[0]}`));

const SITE_ARG = process.argv[2];
const LOGIN_MODE = process.argv.includes('login');
const LIVE = process.argv.includes('--live');

const SITES = {
  wellfound: {
    script: 'wellfound-auto-apply.js',
    profile: '.wellfound-chrome-profile',
    searches: ['https://wellfound.com/jobs'],
    loginUrl: 'https://wellfound.com/login',
    injectOn: (url) => /wellfound\.com/.test(url),
    submittedRe: /application sent|DRY_RUN — would click/i,
    storeKey: null,
    dailyCap: 50,
  },
};

const site = SITES[SITE_ARG];
if (!site) {
  console.log('Usage: node auto-apply-runner.js wellfound [login|--live]');
  process.exit(1);
}

// The daily cap is tracked locally across runs and resets on the next calendar day.
const DAILY_CAP = site.dailyCap || 50;
const STATE_FILE = path.join(__dirname, `apply-state-${SITE_ARG}.json`);
const todayKey = new Date().toDateString();
let dayState = { date: todayKey, count: 0 };
try { const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8').replace(/^﻿/, '')); if (s.date === todayKey) dayState = s; } catch (e) {}
const bumpDayCount = () => { dayState.count++; try { fs.writeFileSync(STATE_FILE, JSON.stringify(dayState)); } catch (e) {} };
const TARGET = DAILY_CAP - dayState.count;
const MAX_RUNTIME_MS = 100 * 60 * 1000;
const IDLE_ROTATE_MS = 4 * 60 * 1000;

const log = (msg) => console.log(`[${new Date().toLocaleString()}] [${SITE_ARG}] ${msg}`);

// ======== CSV log of every submitted application (created once, appended forever) ========
const CSV_FILE = path.join(__dirname, 'applications.csv');
const SKILLS = ['JavaScript', 'TypeScript', 'Python', 'Java', 'React', 'Next.js', 'React Native', 'Node.js',
  'Express', 'FastAPI', 'MongoDB', 'PostgreSQL', 'Redis', 'GraphQL', 'WebSockets', 'Docker', 'Kubernetes',
  'GCP', 'AWS', 'CI/CD', 'LangChain', 'LangGraph', 'RAG', 'LLM', 'GenAI', 'Machine Learning', 'MCP', 'Pinecone', 'FAISS'];
const matchSkills = (t) => { const l = t.toLowerCase(); return SKILLS.filter((s) => l.includes(s.toLowerCase())).join('; '); };
const csvRow = (vals) => vals.map((v) => '"' + String(v || '').replace(/"/g, '""').replace(/\s+/g, ' ').trim() + '"').join(',') + '\n';
function logApplication(job) {
  // one-time migration: archive a CSV written before the Job Link column existed
  if (fs.existsSync(CSV_FILE) && !fs.readFileSync(CSV_FILE, 'utf8').split('\n')[0].includes('Job Link')) {
    fs.renameSync(CSV_FILE, path.join(__dirname, 'applications-old.csv'));
  }
  if (!fs.existsSync(CSV_FILE)) {
    // ﻿ BOM so Excel renders ₹/– correctly
    fs.writeFileSync(CSV_FILE, '﻿' + csvRow(['Date', 'Site', 'Role', 'Company', 'CTC/Salary', 'Skills', 'Job Link', 'Job Description']));
  }
  fs.appendFileSync(CSV_FILE, csvRow([new Date().toLocaleString(), SITE_ARG, job.title, job.company, job.salary, job.skills, job.link, job.jd]));
}

// Patch the console script: our DRY_RUN flag, our per-run target, and a busy-guard
// so a second injection while one is still running becomes a no-op.
function buildInjection() {
  const raw = fs
    .readFileSync(path.join(__dirname, site.script), 'utf8')
    .replace(/DRY_RUN: true/, `DRY_RUN: ${!LIVE}`)
    .replace(/MAX_APPLICATIONS: \d+/, `MAX_APPLICATIONS: ${TARGET}`);
  // the console script reads its personal data from window.__APPLY_CONFIG (from .env),
  // so no PII lives in the injected script itself
  return `(async () => {
    if (window.__aaBusy) return; window.__aaBusy = true;
    window.__APPLY_CONFIG = ${JSON.stringify({ CV, geminiKey })};
    try { await ${raw}
    } finally { window.__aaBusy = false; }
  })()`;
}

(async () => {
  if (!LOGIN_MODE && TARGET <= 0) {
    log(`Daily cap of ${DAILY_CAP} applications already reached (${dayState.count} today) — exiting.`);
    return;
  }
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, site.profile), {
    channel: 'chrome',
    headless: false, // A visible browser is required for manual sign-in and review.
    viewport: { width: 1280, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-backgrounding-occluded-windows', // keep timers full-speed while off-screen
      '--disable-renderer-backgrounding',
      '--disable-popup-blocking',
      ...(LOGIN_MODE ? [] : ['--window-position=-32000,-32000']),
    ],
  });
  const mainPage = ctx.pages()[0] || (await ctx.newPage());

  if (LOGIN_MODE) {
    await mainPage.goto(site.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    log('Chrome is open — log in to the site, then CLOSE the browser window. The session is saved automatically.');
    await new Promise((res) => ctx.on('close', res));
    log('Login window closed. Session saved. Now test with: node auto-apply-runner.js ' + SITE_ARG);
    return;
  }

  log(`Starting. mode=${LIVE ? 'LIVE' : 'DRY RUN'} target=${TARGET} applications, max ${MAX_RUNTIME_MS / 60000} min`);
  const injection = buildInjection();
  const deadline = Date.now() + MAX_RUNTIME_MS;
  let submitted = 0;
  let lastActivity = Date.now();
  let searchIdx = 0;
  let pendingJob = null; // details of the job currently being applied to, for the CSV

  const isBusy = (p) => p.evaluate('!!window.__aaBusy').catch(() => false);

  function wire(page) {
    page.on('console', (msg) => {
      const text = msg.text();
      if (!/auto-apply/.test(text)) return;
      lastActivity = Date.now();
      const clean = text.replace(/%c\[auto-apply\]\s*\S*/, '').trim();
      log('  ' + clean.slice(0, 160));

      // snapshot the wizard whenever it can't proceed, so the blocking field is visible
      if (/no Continue\/Submit button found|no Send button found/.test(clean)) {
        page.screenshot({ path: path.join(__dirname, `blocked-step-${SITE_ARG}.png`) }).catch(() => {});
      }

      // Wellfound job-start messages are used to collect details for the CSV log.
      const m = clean.match(/▶ (?:Applying|Opening): (.+)/);
      if (m) {
        const [main, link, cardSalary] = m[1].split(' | ');
        const atParts = main.split(' @ ');
        const company = atParts.length > 1 ? atParts.pop() : ''; // company is after the LAST ' @ ' — titles may contain '@'
        const title = atParts.join(' @ ');
        pendingJob = { title: title.trim(), company: (company || '').replace(/^\?$/, '').trim(), link: (link || '').trim(), salary: (cardSalary || '').trim(), skills: '', jd: '' };
        // scrape details once the job pane/description has rendered
        setTimeout(() => {
          page.evaluate(() => {
            const q = (s) => document.querySelector(s)?.textContent?.trim() || '';
            return {
              company: (document.body.innerText.match(/Apply to (.{2,60})/) || [])[1]?.trim() ||
                q('[data-testid="inlineHeader-companyName"]') || q('[data-company-name]') || q('a[href^="/company/"]'),
              salary: q('#salaryInfoAndJobType') || q('[data-testid*="salary" i]') ||
                (document.body.innerText.match(/(?:₹|\$)\s?[\d,.]+(?:\s?-\s?(?:₹|\$)?[\d,.]+)?[^\n]{0,30}/) || [''])[0],
              jd: (q('#jobDescriptionText') || q('[class*="jobDescription" i]') || q('[class*="description" i]')).slice(0, 1200),
            };
          }).then((d) => {
            if (!d || !pendingJob) return;
            pendingJob.company = pendingJob.company || d.company;
            pendingJob.salary = pendingJob.salary || d.salary;
            pendingJob.jd = d.jd;
            pendingJob.skills = matchSkills(pendingJob.title + ' ' + d.jd);
          }).catch(() => {});
        }, 2000); // Allow the Wellfound job pane to render before scraping details.
      }

      if (site.submittedRe.test(text)) {
        submitted++;
        log(`==> ${submitted}/${TARGET} this run (${dayState.count + 1}/${DAILY_CAP} today)`);
        if (LIVE) { // dry runs don't pollute the CSV or the daily count
          bumpDayCount();
          try { logApplication(pendingJob || { title: 'unknown' }); } catch (e) { log('CSV write failed: ' + e.message); }
        }
        pendingJob = null;
      }
    });
    page.on('load', async () => {
      if (!site.injectOn(page.url())) return;
      lastActivity = Date.now();
      // daily reset of the console script's submit counter (persists in localStorage)
      if (site.storeKey) {
        await page.evaluate(([key, today]) => {
          try {
            const s = JSON.parse(localStorage.getItem(key) || '{}');
            if (s.day !== today) {
              s.day = today; s.submitted = 0; s.applied = 0; s.seen = (s.seen || []).slice(-2000);
              localStorage.setItem(key, JSON.stringify(s));
            }
          } catch (e) {}
        }, [site.storeKey, new Date().toDateString()]).catch(() => {});
      }
      await page.evaluate(injection).catch(() => {}); // navigation mid-run is normal
    });
  }

  ctx.pages().forEach(wire);
  ctx.on('page', wire);

  await mainPage.goto(site.searches[0], { waitUntil: 'domcontentloaded', timeout: 60000 });
  // not logged in? every flow needs a session — bail with a clear message
  await mainPage.waitForTimeout(8000);
  const bodyText = await mainPage.evaluate('document.body.innerText.slice(0, 3000)').catch(() => '');
  if (/sign in|log in to continue|create an account|verify you are human/i.test(bodyText) && !/sign out/i.test(bodyText)) {
    log('WARNING: page looks logged-out or bot-checked. If runs keep finding 0 jobs, run: node auto-apply-runner.js ' + SITE_ARG + ' login');
  }
  await mainPage.evaluate(injection).catch(() => {});

  // Supervisor: re-inject the search tab when idle, close finished form tabs,
  // rotate searches on inactivity, stop on target/time.
  while (submitted < TARGET && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 45000));

    const pages = ctx.pages();
    let anyBusy = false;
    for (const p of pages) {
      if (await isBusy(p)) anyBusy = true;
      // finished smartapply/form tabs: close them so tabs don't pile up
      if (p !== mainPage && /smartapply|\/apply/.test(p.url()) && !(await isBusy(p))) {
        await p.close().catch(() => {});
      }
      // live mode: after submit the form tab returns to search — close that duplicate search tab
      if (p !== mainPage && site.injectOn(p.url()) && !/smartapply|\/apply/.test(p.url()) && !(await isBusy(p))) {
        await p.close().catch(() => {});
      }
    }

    if (!anyBusy) {
      if (Date.now() - lastActivity > IDLE_ROTATE_MS) {
        searchIdx++;
        if (searchIdx >= site.searches.length) { log('All searches exhausted for today.'); break; }
        log(`Rotating to next search: ${site.searches[searchIdx]}`);
        await mainPage.goto(site.searches[searchIdx], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      } else {
        await mainPage.evaluate(injection).catch(() => {}); // continue with next job on this page
      }
    }
  }

  log(`Finished: ${submitted}/${TARGET} applications ${LIVE ? 'submitted' : 'simulated (dry run)'}.`);
  await ctx.close();
})().catch((e) => { log('FATAL: ' + e.message.split('\n')[0]); process.exit(1); });
