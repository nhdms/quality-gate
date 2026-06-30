'use strict';

/**
 * Secret scan (T0).
 *
 * Portable, dependency-free secret scanner over the ADDED lines of a PR diff
 * (gitleaks-equivalent for the high-signal cases, with no binary to install on
 * the runner). Any hit fails the gate. Paths can be allowlisted via
 * gate.config.json's `secrets.allow`.
 *
 * Scanning only added (`+`) diff lines avoids flagging pre-existing content and
 * keeps the check scoped to what the PR introduces.
 */

const fs = require('fs');
const { matchesAny } = require('./lib/match');

// High-signal rules. Each entry: { id, re }. Kept conservative to minimise
// false positives on a self-hosted gate that must not cry wolf.
const RULES = [
  { id: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'aws-secret-access-key', re: /\baws_secret_access_key["'\s:=]+[A-Za-z0-9/+]{40}\b/i },
  { id: 'github-pat', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { id: 'github-pat-v2', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { id: 'github-oauth', re: /\bgh[ous]_[A-Za-z0-9]{36}\b/ },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { id: 'stripe-secret-key', re: /\bsk_live_[0-9a-zA-Z]{24,}\b/ },
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  // Generic: an assignment of a secret-ish name to a long quoted literal.
  {
    id: 'generic-assigned-secret',
    re: /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*["'][^"'\s]{16,}["']/i,
  },
];

/**
 * Scan a block of text line-by-line.
 * @param {string} text
 * @returns {Array<{rule:string,line:number,snippet:string}>}
 */
function scanText(text) {
  const findings = [];
  const lines = String(text).split('\n');
  lines.forEach((line, idx) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        findings.push({ rule: rule.id, line: idx + 1, snippet: redact(line) });
      }
    }
  });
  return findings;
}

/** Parse a unified diff and return added lines grouped by target file. */
function parseAddedLines(diffText) {
  const byFile = {};
  let current = null;
  for (const raw of String(diffText).split('\n')) {
    if (raw.startsWith('+++ ')) {
      const m = raw.slice(4).trim();
      current = m === '/dev/null' ? null : m.replace(/^b\//, '');
      if (current && !byFile[current]) byFile[current] = [];
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++') && current) {
      byFile[current].push(raw.slice(1));
    }
  }
  return byFile;
}

/**
 * Scan a parsed diff's added lines, honouring the path allowlist.
 * @param {string} diffText unified diff
 * @param {object} [secretsCfg] config block ({ allow })
 * @returns {Array<{file:string,rule:string,line:number,snippet:string}>}
 */
function scanDiff(diffText, secretsCfg) {
  const allow = (secretsCfg && secretsCfg.allow) || [];
  const byFile = parseAddedLines(diffText);
  const findings = [];
  for (const [file, lines] of Object.entries(byFile)) {
    if (matchesAny(file, allow)) continue;
    for (const f of scanText(lines.join('\n'))) {
      findings.push({ file, rule: f.rule, line: f.line, snippet: f.snippet });
    }
  }
  return findings;
}

function redact(line) {
  const t = line.trim();
  if (t.length <= 12) return t.replace(/.(?=.{2})/g, '*');
  return t.slice(0, 4) + '…' + t.slice(-3) + ` [${t.length} chars]`;
}

module.exports = { scanText, scanDiff, parseAddedLines, RULES };

/* node:coverage disable */
if (require.main === module) {
  // CLI: node check-secrets.js <diff-file|-> [config.json]
  const [, , diffArg, configPath] = process.argv;
  let diffText = '';
  try {
    diffText =
      !diffArg || diffArg === '-'
        ? fs.readFileSync(0, 'utf8')
        : fs.readFileSync(diffArg, 'utf8');
  } catch (err) {
    process.stderr.write(`quality-gate secrets: cannot read diff: ${err.message}\n`);
    process.exit(2);
  }

  let secretsCfg;
  if (configPath) {
    try {
      secretsCfg = JSON.parse(fs.readFileSync(configPath, 'utf8')).secrets;
    } catch (err) {
      process.stderr.write(`quality-gate secrets: cannot read config: ${err.message}\n`);
      process.exit(2);
    }
  }

  const findings = scanDiff(diffText, secretsCfg);
  if (findings.length > 0) {
    process.stderr.write('quality-gate secrets: FAILED — potential secrets in diff:\n');
    for (const f of findings) {
      process.stderr.write(`  ::error file=${f.file}::secret(${f.rule}): ${f.snippet}\n`);
    }
    process.exit(1);
  }
  process.stdout.write('quality-gate secrets: OK (no secrets in added lines).\n');
}
/* node:coverage enable */
