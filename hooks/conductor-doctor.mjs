#!/usr/bin/env node
// SessionStart watcher: self-checks the conductor stack and maintains a
// persistent bug report at ~/.claude/conductor-report.md. Silent while
// healthy. On a failing check it upserts an OPEN entry (keyed by check id)
// and emits a reminder; when a previously-OPEN check passes again, the SAME
// entry is written back to RESOLVED - entries are updated in place, never
// duplicated. Plugin root comes from argv[2] (${CLAUDE_PLUGIN_ROOT}).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const ROOT = process.argv[2] || join(homedir(), '.claude');
// Optional GitHub mirroring: when a repo is configured (argv[3] or env), each
// NEW failure opens one issue and recovery closes that SAME issue. Best-effort
// only - any gh failure must never break the health check itself.
const ISSUE_REPO = process.argv[3] || process.env.CONDUCTOR_ISSUE_REPO || '';
let ghCalls = 0;
const GH_MAX_CALLS = 3; // keeps the whole run under the hook timeout when many checks flip at once
const gh = (...args) => {
    if (++ghCalls > GH_MAX_CALLS) return null;
    try {
        return execFileSync('gh', args, { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch { return null; }
};
const REPORT = join(homedir(), '.claude', 'conductor-report.md');
let STDIN = {};
try { STDIN = JSON.parse(readFileSync(0, 'utf8')); } catch {}
const fallbackDate = () => new Date().toISOString().slice(0, 10);
const today = () => STDIN.ts || fallbackDate();

const failures = [];
const check = (id, fn, detail) => {
    try {
        if (!fn()) failures.push({ id, detail: typeof detail === 'function' ? detail() : detail });
    } catch (e) {
        const d = typeof detail === 'function' ? detail() : detail;
        failures.push({ id, detail: `${d} (${String(e.message).slice(0, 200)})` });
    }
};

// every script hooks.json registers, derived once so new hooks are covered
// automatically (a hardcoded list silently under-covers as hooks are added)
const ourHookScripts = () => {
    try {
        const hj = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
        return Object.values(hj.hooks || {}).flat().flatMap(g => g.hooks || [])
            .map(h => (h.command || '').match(/([\w.-]+\.(?:mjs|js|cjs|sh|py))/)?.[1])
            .filter(Boolean);
    } catch { return []; }
};

// 1. hooks.json parses and every referenced script exists
check('hooks-json', () => {
    const hj = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
    const cmds = Object.values(hj.hooks || {}).flat()
        .flatMap(g => g.hooks || []).map(h => h.command || '');
    return cmds.every(c => {
        const m = c.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+)/);
        return !m || existsSync(join(ROOT, m[1]));
    });
}, 'hooks.json missing, unparseable, or references a missing script');

// 2. every skill has a SKILL.md with frontmatter (derived from the skills
// dir, so new bundled skills are covered automatically)
check('skills', () => {
    const dir = join(ROOT, 'skills');
    if (!existsSync(dir)) return false;
    for (const s of readdirSync(dir)) {
        const p = join(dir, s, 'SKILL.md');
        if (!existsSync(p)) return false;
        if (!readFileSync(p, 'utf8').startsWith('---')) return false;
    }
    return true;
}, 'a bundled SKILL.md is missing or lost its frontmatter');

// 3. session index db, if present, has a valid SQLite header
check('session-index', () => {
    const db = join(homedir(), '.claude', 'session-index.db');
    if (!existsSync(db)) return true;
    if (statSync(db).size === 0) return false;
    const buf = readFileSync(db).subarray(0, 15).toString();
    return buf === 'SQLite format 3';
}, 'session-index.db exists but is empty or corrupted (delete it to force a rebuild)');

// 4. no double registration: when running as an installed plugin, the same
// hook scripts must not also be wired directly in settings.json (each hook
// would fire twice per event)
check('double-install', () => {
    if (!process.env.CLAUDE_PLUGIN_ROOT) return true;
    const settings = join(homedir(), '.claude', 'settings.json');
    if (!existsSync(settings)) return true;
    const cmds = Object.values(JSON.parse(readFileSync(settings, 'utf8')).hooks || {}).flat()
        .flatMap(g => g.hooks || []).map(h => h.command || '');
    const ours = ourHookScripts();
    const pluginPrefix = resolve(process.env.CLAUDE_PLUGIN_ROOT) + sep;
    return !cmds.some(c => ours.some(s => c.includes(s)) && !c.includes(pluginPrefix));
}, 'conductor hooks are registered BOTH via the plugin and directly in ~/.claude/settings.json - they fire twice per event; remove the settings.json entries (plugin is canonical)');

// 5. skill shadowing: a personal ~/.claude/skills/<name> that duplicates a
// bundled plugin skill loads BOTH descriptions into every session and makes
// invocation ambiguous. A copy that declares its divergence (contains
// "diverge" near the top) is treated as a deliberate overlay and allowed.
check('skill-shadow', () => {
    const bundled = join(ROOT, 'skills');
    if (!existsSync(bundled)) return true;
    const overlays = [join(homedir(), '.claude', 'skills')];
    if (STDIN.cwd) overlays.push(join(STDIN.cwd, '.claude', 'skills'));
    for (const dir of overlays) {
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(bundled)) {
            const shadow = join(dir, name, 'SKILL.md');
            if (!existsSync(shadow)) continue;
            if (!/diverge/i.test(readFileSync(shadow, 'utf8').slice(0, 2000))) return false;
        }
    }
    return true;
}, 'a personal (~/.claude/skills) or project (.claude/skills) copy shadows a bundled plugin skill without declaring divergence - both load every session; delete the copy or add a "diverges from the plugin copy" note to its SKILL.md');

// 6. node runtime sanity for the hook scripts
check('node-runtime', () => parseInt(process.versions.node, 10) >= 18,
    'node < 18 cannot run the conductor hooks');

// 7. LaunchAgent automation jobs are logging cleanly: no command-not-found/
// missing-file/error lines in recent logs, and no scheduled job has gone
// silent for 48h while still installed.
//
// The prefix->plist map is user-specific (LaunchAgent labels are namespaced
// per machine), so it's supplied externally rather than hardcoded:
//   - CONDUCTOR_AUTOMATION_JOBS="prefix=plist,prefix=plist" env var, or
//   - ~/.claude/conductor-jobs.json ({"prefix": "plist", ...})
// With neither configured, the plist-staleness check is skipped and this
// falls back to scanning whatever *.log prefixes exist for the error pattern.
const loadAutomationJobs = () => {
    if (process.env.CONDUCTOR_AUTOMATION_JOBS) {
        return Object.fromEntries(
            process.env.CONDUCTOR_AUTOMATION_JOBS.split(',')
                .map(pair => pair.split('=').map(s => s.trim()))
                .filter(([prefix, plist]) => prefix && plist)
        );
    }
    try {
        return JSON.parse(readFileSync(join(homedir(), '.claude', 'conductor-jobs.json'), 'utf8'));
    } catch { return null; }
};

check('automation-logs', () => {
    const logDir = join(homedir(), '.claude', 'automation', 'logs');
    if (!existsSync(logDir)) return true;
    const files = readdirSync(logDir).filter(f => f.endsWith('.log'));
    const badPattern = /command not found|no such file or directory|error:/i;
    const jobs = loadAutomationJobs();
    const agentsDir = join(homedir(), 'Library', 'LaunchAgents');
    const prefixes = jobs ? Object.keys(jobs) : [...new Set(files.map(f => f.replace(/-[^-]*\.log$/, '')))];
    for (const prefix of prefixes) {
        const jobConfig = jobs?.[prefix];
        const plist = typeof jobConfig === 'object' ? jobConfig?.plist : jobConfig;
        const staleHours = typeof jobConfig === 'object' ? (jobConfig?.staleHours ?? 48) : 48;
        if (plist && !existsSync(join(agentsDir, plist))) continue;
        const matches = files.filter(f => f.startsWith(`${prefix}-`));
        if (matches.length === 0) continue;
        // only the newest log per job counts: a failed run followed by a clean one is healthy
        const newest = matches
            .map(f => ({ f, m: statSync(join(logDir, f)).mtimeMs }))
            .sort((a, b) => b.m - a.m)[0];
        if (plist && Date.now() - newest.m > staleHours * 60 * 60 * 1000) return false;
        // dated log files accumulate runs; only the last run block decides health
        const content = readFileSync(join(logDir, newest.f), 'utf8');
        const lastStart = content.lastIndexOf('started');
        const lastRun = lastStart === -1 ? content : content.slice(lastStart);
        // an explicit exit marker beats pattern-grep: job logs may QUOTE error
        // strings while analyzing them (e.g. self-heal), which is not a failure
        const exitMarker = lastRun.match(/\(exit (\d+)\)\s*=*\s*$/);
        if (exitMarker) {
            if (exitMarker[1] !== '0') return false;
            continue;
        }
        if (badPattern.test(lastRun)) return false;
    }
    return true;
}, 'an automation job log shows an error (command-not-found / missing file / "error:") or a scheduled job has gone silent for 48h+ - check ~/.claude/automation/logs/');

// ── settings surface shared by checks 8-10 ──
// Every settings file that can wire hooks/permissions/skill overrides into this
// session. Project files come from $CLAUDE_PROJECT_DIR (or the session cwd).
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || STDIN.cwd || '';
const readSettings = () => {
    const files = [join(homedir(), '.claude', 'settings.json'), join(homedir(), '.claude', 'settings.local.json')];
    try {
        const dir = join(PROJECT_DIR, '.claude');
        if (PROJECT_DIR) for (const f of readdirSync(dir)) if (/^settings.*\.json$/.test(f)) files.push(join(dir, f));
    } catch {}
    return files.filter(existsSync).map(file => {
        try { return { file, json: JSON.parse(readFileSync(file, 'utf8')) }; } catch { return { file, json: {} }; }
    });
};

// a hook command's script path, with the vars a hook command may legally use
// expanded. Returns null when this session cannot resolve the path (unknown
// var, or a project var with no project dir) - unresolvable is not a failure.
const resolveHookScript = (token) => {
    let p = token.replace(/^["']|["']$/g, '')
        .replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT/g, process.env.CLAUDE_PLUGIN_ROOT || ROOT)
        .replace(/\$\{CLAUDE_PROJECT_DIR:-[^}]*\}|\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR/g, PROJECT_DIR)
        .replace(/^~(?=\/)/, homedir());
    if (!p || p.includes('$')) return null;
    return p;
};
const hookScriptRefs = () => {
    const refs = [];
    for (const { file, json } of readSettings()) {
        const cmds = Object.values(json.hooks || {}).flat().flatMap(g => g.hooks || []).map(h => h.command || '');
        for (const cmd of cmds) {
            // strip quoted arguments (osascript -e '...', bash -c "...") - script paths are never quoted strings
            const bare = cmd.replace(/'[^']*'|"[^"]*"/g, ' ');
            for (const token of bare.split(/\s+/)) {
                if (!/\.(mjs|js|cjs|sh|py)$/.test(token)) continue;
                if (!/[\/$]/.test(token) && !/^[\w.-]+\.(mjs|js|cjs|sh|py)$/.test(token)) continue;
                const path = resolveHookScript(token);
                if (path) refs.push({ file, token, path });
            }
        }
    }
    return refs;
};

// 8. every hook command in the settings files points at an absolute path that
// exists - a relative path resolves against whatever cwd the session happens
// to start in, and a missing file fails silently on every event.
const badHookRefs = [];
check('hook-refs', () => {
    for (const { file, token, path } of hookScriptRefs()) {
        if (!path.startsWith('/')) badHookRefs.push(`${token} (relative, in ${file})`);
        else if (!existsSync(path)) badHookRefs.push(`${path} (missing, in ${file})`);
    }
    return badHookRefs.length === 0;
}, () => `settings hook commands reference scripts that are relative or missing: ${badHookRefs.slice(0, 5).join('; ')}` +
    ' - use an absolute path (or ${CLAUDE_PLUGIN_ROOT}/...) and confirm the file exists');

// 9. a hook that invokes a skill turned "off" in skillOverrides: the override
// stops the model from loading it, the hook keeps firing it.
const offSkillHits = [];
check('off-skill-hook', () => {
    const off = new Set();
    for (const { json } of readSettings()) {
        for (const [name, state] of Object.entries(json.skillOverrides || {})) if (state === 'off') off.add(name);
    }
    if (!off.size) return true;
    for (const { path } of hookScriptRefs().slice(0, 60)) {
        if (!existsSync(path)) continue;
        let text = '';
        try { text = readFileSync(path, 'utf8').slice(0, 200000); } catch { continue; }
        for (const name of off) if (text.includes(name)) offSkillHits.push(`${path} -> ${name}`);
    }
    return offSkillHits.length === 0;
}, () => `a hook script invokes a skill disabled in skillOverrides: ${offSkillHits.slice(0, 5).join('; ')}` +
    ' - re-enable the skill or drop the hook, one of the two is dead weight');

// 10. boundary actions (opening/merging PRs, posting messages, filing issues)
// pre-approved in permissions.allow: they cross a human gate, so they belong
// in permissions.ask.
const boundaryAllows = [];
check('boundary-allowlist', () => {
    const BOUNDARY = /create_pull_request|merge_pull_request|_post_message|send_message|_create_issue|reply_to_thread/;
    for (const { file, json } of readSettings()) {
        for (const rule of json.permissions?.allow || []) if (BOUNDARY.test(rule)) boundaryAllows.push(`${rule} (${file})`);
    }
    return boundaryAllows.length === 0;
}, () => `boundary actions are pre-approved in permissions.allow: ${boundaryAllows.slice(0, 5).join('; ')}` +
    ' - move them to permissions.ask so a human still gates each post/PR/issue');

// 11. launchd health: a KeepAlive job that keeps exiting non-zero is in a
// restart loop, and a log growing past 5 MB right now is the same loop writing.
const launchdBad = [];
check('launchd-health', () => {
    const agents = join(homedir(), 'Library', 'LaunchAgents');
    let plists = [];
    try { plists = readdirSync(agents).filter(f => f.endsWith('.plist')).slice(0, 200); } catch { return true; }
    let listing = '';
    try {
        listing = execFileSync('launchctl', ['list'], { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch {}
    const plistText = (f) => { try { return readFileSync(join(agents, f), 'utf8'); } catch { return ''; } };
    for (const line of listing.split('\n').slice(1)) {
        const [, status, label] = line.split('\t');
        if (!label || !status || status === '0' || status === '-') continue;
        if (!plists.includes(`${label}.plist`)) continue;
        if (/KeepAlive/.test(plistText(`${label}.plist`))) launchdBad.push(`${label} exit ${status} with KeepAlive`);
    }
    const tenMin = Date.now() - 10 * 60 * 1000;
    for (const f of plists) {
        for (const m of plistText(f).matchAll(/Standard(?:Out|Error)Path<\/key>\s*<string>([^<]+)<\/string>/g)) {
            try {
                const st = statSync(m[1]);
                if (st.size > 5 * 1024 * 1024 && st.mtimeMs > tenMin) {
                    launchdBad.push(`${m[1]} is ${Math.round(st.size / 1048576)} MB and still being written`);
                }
            } catch {}
        }
    }
    return launchdBad.length === 0;
}, () => `launchd jobs look unhealthy: ${launchdBad.slice(0, 5).join('; ')}` +
    ' - a KeepAlive job exiting non-zero restarts forever; fix the job or unload it, and truncate/rotate the log');

// 12. a SKILL.md pasted into a CLAUDE.md: the skill body then loads on EVERY
// session (CLAUDE.md is always-on) as well as on invocation.
const dupSkills = [];
check('claudemd-dup-skill', () => {
    const mds = [join(homedir(), '.claude', 'CLAUDE.md')];
    if (PROJECT_DIR) mds.push(join(PROJECT_DIR, 'CLAUDE.md'));
    const skillFiles = [];
    for (const dir of [join(ROOT, 'skills'), join(homedir(), '.claude', 'skills')]) {
        try {
            for (const name of readdirSync(dir)) {
                const p = join(dir, name, 'SKILL.md');
                if (existsSync(p) && skillFiles.length < 150) skillFiles.push(p);
            }
        } catch {}
    }
    for (const md of mds) {
        if (!existsSync(md)) continue;
        let mdLines;
        try { mdLines = new Set(readFileSync(md, 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 25)); } catch { continue; }
        if (!mdLines.size) continue;
        for (const sf of skillFiles) {
            let lines = [];
            try { lines = readFileSync(sf, 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 25); } catch { continue; }
            if (lines.length < 10) continue;
            const hit = lines.filter(l => mdLines.has(l)).length;
            const pct = Math.round((hit / lines.length) * 100);
            if (pct > 30) dupSkills.push(`${pct}% of ${sf} is inlined in ${md}`);
        }
    }
    return dupSkills.length === 0;
}, () => `a skill body is duplicated into an always-loaded CLAUDE.md: ${dupSkills.slice(0, 5).join('; ')}` +
    ' - keep the skill and leave a one-line pointer in CLAUDE.md, or delete the skill');

// 13. installed plugin cache is behind the local clone: the session is running
// an older copy than the repo being edited.
let cacheStale = '';
check('plugin-cache-stale', () => {
    const repo = process.env.CONDUCTOR_REPO_DIR || '/Users/shubhamparashar/repo/claude-conductor';
    const manifest = join(repo, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifest)) return true;
    const { name, version } = JSON.parse(readFileSync(manifest, 'utf8'));
    const cacheRoot = join(homedir(), '.claude', 'plugins', 'cache');
    if (!name || !version || !existsSync(cacheRoot)) return true;
    for (const market of readdirSync(cacheRoot)) {
        const dir = join(cacheRoot, market, name);
        if (!existsSync(dir)) continue;
        const newest = readdirSync(dir)
            .map(v => ({ v, m: statSync(join(dir, v)).mtimeMs }))
            .sort((a, b) => b.m - a.m)[0];
        if (newest && newest.v !== version) cacheStale = `${market}/${name} cache is ${newest.v}, local clone is ${version}`;
    }
    return !cacheStale;
}, () => `${cacheStale} - run \`claude plugin marketplace update\` (then reinstall) so sessions load the current version`);

// ── report write-back ──
const date = today();
let body = '';
try { body = readFileSync(REPORT, 'utf8'); } catch {}
const entries = new Map();
for (const block of body.split(/^## /m).slice(1)) {
    const m = block.match(/^\[(OPEN|RESOLVED)\] (\S+)\n?([\s\S]*)/);
    if (m) entries.set(m[2], { status: m[1], text: m[3].trim() });
}

const failedIds = new Set(failures.map(f => f.id));
let changed = false;
for (const f of failures) {
    const prev = entries.get(f.id);
    if (prev?.status === 'OPEN' && prev.text.includes(f.detail)) {
        entries.set(f.id, { status: 'OPEN', text: prev.text.replace(/last-seen: \S+/, `last-seen: ${date}`) });
    } else {
        const first = prev?.text.match(/first-seen: (\S+)/)?.[1] || date;
        let text = `${f.detail}\nfirst-seen: ${first} · last-seen: ${date}`;
        if (ISSUE_REPO) {
            const url = gh('issue', 'create', '--repo', ISSUE_REPO,
                '--title', `[conductor-doctor] ${f.id} check failing`,
                '--body', `Automated health-check failure.\n\n**Check:** ${f.id}\n**Detail:** ${f.detail}\n**First seen:** ${first}\n\nThis issue is managed by the conductor-doctor watcher: it will be closed automatically when the check passes again. The self-heal automation may comment with fix attempts.`);
            const num = url?.match(/\/issues\/(\d+)/)?.[1];
            if (num) text += `\nissue: #${num}`;
        }
        entries.set(f.id, { status: 'OPEN', text });
    }
    changed = true;
}
for (const [id, e] of entries) {
    if (e.status === 'OPEN' && !failedIds.has(id)) {
        const num = e.text.match(/issue: #(\d+)/)?.[1];
        if (num && ISSUE_REPO) {
            gh('issue', 'close', num, '--repo', ISSUE_REPO,
                '--comment', `Health check \`${id}\` passing again as of ${date} - closed automatically by conductor-doctor.`);
        }
        entries.set(id, { status: 'RESOLVED', text: `${e.text}\nresolved: ${date}` });
        changed = true;
    }
}

if (changed) {
    const out = ['# conductor watcher report', '',
        ...[...entries].map(([id, e]) => `## [${e.status}] ${id}\n${e.text}\n`)].join('\n');
    try { writeFileSync(REPORT, out); } catch {}
}

if (failures.length > 0) {
    console.log(
        `<conductor-doctor>Conductor self-check FAILED: ${failures.map(f => f.id).join(', ')}. ` +
        `Details written to ${REPORT} (entries update in place; they flip to RESOLVED automatically once fixed). ` +
        'Investigate when convenient - the rest of the plugin may be degraded until then.</conductor-doctor>'
    );
}
