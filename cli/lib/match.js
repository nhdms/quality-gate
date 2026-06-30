'use strict';

/**
 * Minimal, dependency-free path matcher shared by the T0 checks.
 *
 * A pattern matches a path if ANY of these hold:
 *   - exact string equality
 *   - the pattern ends with '/' and is a path prefix (directory match)
 *   - the pattern contains a glob char ('*' or '?') and the glob matches
 *   - the pattern (no glob, no trailing slash) is a leading path prefix,
 *     so 'dist' matches 'dist/app.js' and '.omc' matches '.omc/x'
 *
 * Globs support '*' (any run except '/'), '**' (any run incl '/'), and '?'.
 * Matching is case-sensitive and always against POSIX-style ('/') paths.
 */

function normalize(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$');
}

function matches(filePath, pattern) {
  const p = normalize(filePath);
  const pat = normalize(pattern);
  if (!pat) return false;
  if (p === pat) return true;

  if (pat.includes('*') || pat.includes('?')) {
    return globToRegExp(pat).test(p);
  }

  // Directory / prefix match: 'dist' or 'dist/' both match 'dist/app.js'.
  const prefix = pat.endsWith('/') ? pat : pat + '/';
  return p.startsWith(prefix);
}

/** @returns {boolean} true if `filePath` matches at least one pattern. */
function matchesAny(filePath, patterns) {
  return (patterns || []).some((pat) => matches(filePath, pat));
}

module.exports = { matches, matchesAny, normalize, globToRegExp };
