#!/usr/bin/env node
/**
 * Fetch and parse pi-share (shittycodingagent.ai) session exports.
 * 
 * Usage:
 *   node fetch-session.mjs <url-or-gist-id> [--header] [--entries] [--system] [--tools] [--no-cache]
 * 
 * Options:
 *   (no flag)   Output full session data JSON
 *   --header    Output just the session header
 *   --entries   Output entries as JSON lines (one per line)
 *   --system    Output the system prompt
 *   --tools     Output tool definitions
 *   --no-cache  Bypass cache and fetch fresh
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CACHE_DIR = join(tmpdir(), 'pi-share-cache');

const args = process.argv.slice(2);
const input = args.find(a => !a.startsWith('--'));
const flags = new Set(args.filter(a => a.startsWith('--')));

if (!input) {
  console.error('Usage: node fetch-session.mjs <url-or-gist-id> [--header|--entries|--system|--tools]');
  process.exit(1);
}

// Cache functions
function getCachePath(gistId) {
  return join(CACHE_DIR, `${gistId}.json`);
}

function readCache(gistId) {
  const path = getCachePath(gistId);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }
  return null;
}

function writeCache(gistId, data) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(getCachePath(gistId), JSON.stringify(data));
}

// Extract gist ID from URL or use directly
function extractGistId(input) {
  // Handle full URLs like https://shittycodingagent.ai/session/?<id>
  const urlMatch = input.match(/[?&]([a-f0-9]{32})/i);
  if (urlMatch) return urlMatch[1];
  
  // Handle direct gist ID
  if (/^[a-f0-9]{32}$/i.test(input)) return input;
  
  // Handle gist.github.com URLs
  const gistMatch = input.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/i);
  if (gistMatch) return gistMatch[1];
  
  throw new Error(`Cannot extract gist ID from: ${input}`);
}

// Fetch session HTML from gist
async function fetchSessionHtml(gistId) {
  const gistRes = await fetch(`https://api.github.com/gists/${gistId}`);
  if (!gistRes.ok) {
    if (gistRes.status === 404) throw new Error('Session not found (gist deleted or invalid ID)');
    throw new Error(`GitHub API error: ${gistRes.status}`);
  }
  
  const gist = await gistRes.json();
  const file = gist.files?.['session.html'];
  if (!file) {
    const available = Object.keys(gist.files || {}).join(', ') || 'none';
    throw new Error(`No session.html in gist. Available: ${available}`);
  }
  
  // Fetch raw content if truncated
  if (file.truncated && file.raw_url) {
    const rawRes = await fetch(file.raw_url);
    if (!rawRes.ok) throw new Error('Failed to fetch raw content');
    return rawRes.text();
  }
  
  return file.content;
}

// Extract base64 session data from HTML
function extractSessionData(html) {
  // New format: <script id="session-data" type="application/json">BASE64</script>
  const match = html.match(/<script[^>]*id="session-data"[^>]*>([^<]+)<\/script>/);
  if (match) {
    const base64 = match[1].trim();
    const json = Buffer.from(base64, 'base64').toString('utf-8');
    return JSON.parse(json);
  }
  
  throw new Error('No session data found in HTML. This may be an older export format without embedded data.');
}

// Main
async function main() {
  try {
    const gistId = extractGistId(input);
    
    // Check cache first (unless --no-cache)
    let data = null;
    if (!flags.has('--no-cache')) {
      data = readCache(gistId);
    }
    
    if (!data) {
      const html = await fetchSessionHtml(gistId);
      data = extractSessionData(html);
      writeCache(gistId, data);
    }
    
    if (flags.has('--header')) {
      console.log(JSON.stringify(data.header));
    } else if (flags.has('--entries')) {
      // Output as JSON lines - one entry per line
      for (const entry of data.entries) {
        console.log(JSON.stringify(entry));
      }
    } else if (flags.has('--system')) {
      console.log(data.systemPrompt || '');
    } else if (flags.has('--tools')) {
      console.log(JSON.stringify(data.tools || []));
    } else {
      // Default: full session data
      console.log(JSON.stringify(data));
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
