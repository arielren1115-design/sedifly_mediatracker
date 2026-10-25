// In-memory stand-ins for the Google services, loaded around the real built bundle.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runBuild } from '../../scripts/build.js';
import { REQUIRED_PROPERTIES } from '../../src/core/properties.js';

export function fakeSheet(name) {
  const rows = [];
  const s = {
    name, frozen: 0, rows, formats: {},
    getName: () => name,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    getLastRow: () => rows.length,
    getMaxRows: () => 1000,
    getFrozenRows: () => s.frozen,
    setFrozenRows: (n) => { s.frozen = n; },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
      setValues: (vals) => { vals.forEach((v, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; v.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; }); }); return { setFontWeight() {} }; },
      setDataValidation: () => {},
      setNumberFormat: (f) => { s.formats[c] = f; },
    }),
  };
  return s;
}

export const goodProps = () => ({
  ...Object.fromEntries(REQUIRED_PROPERTIES.map((k) => [k, 'x'])),
  MODE: 'PROD', ANTHROPIC_API_KEY: 'PLACEHOLDER', CONFIDENCE_THRESHOLD: '0.70', BATCH_MAX_MESSAGES: '10', RUN_TIME_BUDGET_MS: '270000', BACKFILL_CAPTURE_LIMIT: '1500',
  TEAM_SENDER_ALLOWLIST: '@sedifly.com',
});

export function makeEnv(props) {
  const sheets = {};
  const labels = []; // {id, name}
  const triggers = [];
  const mailbox = []; // {id, labelIds:Set, raw}
  const store = { ...props };
  const mail = []; // {to, subject, body} sent with MailApp
  const state = { locked: false, tz: {}, dataFormat: 'bytes', sleeps: [], fetches: [], fetchQueue: [] }; // Gmail body data: 'bytes' (signed byte arrays, as Apps Script returns) or 'string'
  const ssFor = (id) => {
    sheets[id] = sheets[id] || { Sheet1: fakeSheet('Sheet1') };
    const map = sheets[id];
    return {
      getSheetByName: (n) => map[n] || null,
      insertSheet: (n) => (map[n] = fakeSheet(n)),
      getSheets: () => Object.values(map),
      deleteSheet: (sh) => { delete map[sh.name]; },
      getSpreadsheetTimeZone: () => state.tz[id] || 'America/Los_Angeles',
      setSpreadsheetTimeZone: (tz) => { state.tz[id] = tz; },
    };
  };
  const sandbox = {
    console: { log() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => ({ ...store }),
      getProperty: (k) => store[k] ?? null,
      setProperty: (k, v) => { store[k] = v; },
    }) },
    LockService: { getScriptLock: () => ({
      waitLock() {}, releaseLock() { state.locked = false; },
      tryLock: () => { if (state.locked) return false; state.locked = true; return true; },
    }) },
    Utilities: {
      sleep: (ms) => { state.sleeps.push(ms); },
      formatDate: (d, _tz, _fmt) => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10),
      getUuid: () => `uuid-${Math.random().toString(16).slice(2)}`,
      // Strict like Apps Script: wrong alphabet or missing padding throws.
      base64Decode: (d) => {
        if (typeof d !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(d) || d.length % 4) throw new Error('Could not decode string.');
        return Buffer.from(d, 'base64');
      },
      base64DecodeWebSafe: (d) => {
        if (typeof d !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(d) || d.length % 4) throw new Error('Could not decode string.');
        return Buffer.from(d, 'base64url');
      },
      newBlob: (bytes) => ({ getDataAsString: (cs) => new TextDecoder(cs || 'utf-8').decode(Uint8Array.from(bytes, (b) => b & 255)) }),
    },
    SpreadsheetApp: { openById: ssFor, newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } }) },
    Gmail: { Users: {
      Labels: {
        list: () => ({ labels: labels.map((l) => ({ ...l })) }),
        create: (l) => { labels.push({ id: `L_${l.name}`, name: l.name }); },
      },
      Messages: {
        list: (_me, opts) => ({ messages: mailbox.filter((m) => opts.labelIds.every((l) => m.labelIds.has(l))).slice(0, opts.maxResults).map((m) => ({ id: m.id })) }),
        get: (_me, id) => {
          const raw = mailbox.find((m) => m.id === id).raw;
          if (state.dataFormat === 'string') return raw;
          const convert = (part) => ({ ...part, body: part.body && part.body.data ? { ...part.body, data: Array.from(Buffer.from(part.body.data, 'base64url'), (b) => (b > 127 ? b - 256 : b)) } : part.body, parts: part.parts && part.parts.map(convert) });
          return { ...raw, payload: convert(raw.payload) };
        },
        modify: (body, _me, id) => {
          const m = mailbox.find((x) => x.id === id);
          for (const l of body.removeLabelIds || []) m.labelIds.delete(l);
          for (const l of body.addLabelIds || []) m.labelIds.add(l);
        },
      },
    } },
    MailApp: { sendEmail: (m) => { if (state.mailFails) throw new Error('mail quota'); mail.push({ ...m }); } },
    UrlFetchApp: {
      fetch: (url, options) => {
        state.fetches.push({ url, options });
        const next = state.fetchQueue.shift();
        if (!next) throw new Error('no fake response queued');
        if (next instanceof Error) throw next;
        return { getResponseCode: () => next.status, getContentText: () => next.body };
      },
    },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: (h) => { const t = { getHandlerFunction: () => h }; return { timeBased: () => ({ everyMinutes() { return this; }, everyHours() { return this; }, everyDays() { return this; }, atHour() { return this; }, create: () => { triggers.push(t); } }) }; },
    },
  };
  return { sandbox, sheets, labels, triggers, store, mailbox, state, mail };
}

/** Builds the bundle and runs it inside the env's sandbox. Returns the sandbox. */
export async function load(env) {
  const dist = await runBuild();
  vm.createContext(env.sandbox);
  vm.runInContext(`${readFileSync(path.join(dist, 'Code.js'), 'utf8')}\n${readFileSync(path.join(dist, 'Entrypoints.js'), 'utf8')}`, env.sandbox);
  return env.sandbox;
}
