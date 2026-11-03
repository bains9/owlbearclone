// Tabletop's window on the party's character sheets (table.parhome.ca: tokens' cards, HP bars,
// initiative and attack rolls; see src/worker/characters.ts and src/shared/characters.ts).
//
// A Google Apps Script web app, run as its owner (the GM), that reads only the spreadsheets in
// one Drive folder, each a copy of the group's Player's Handbook character sheet, and answers with
// what Tabletop shows: name, player, race and classes, HP, AC, initiative, spell points,
// attacks, the spells on the Spells tab, and a Samurai's ki (the pool for their level, from the
// sheet's level table, and their ki abilities). Numbers are found by their labels on the Character
// tab ("Current HP", "Combat AC"...), and spells under the Spells tab's heading row, not by cell,
// so the sheet's layout can change.
//
// What it changes (doPost), only on a sheet in the folder and never a cell the sheet works out
// with a formula: a character's Current spell points, when they cast a spell in Tabletop (never
// below 0), or back up after a rest; a prayed spell's Cast; and their Current HP after a combat
// rest taken in Tabletop (version 10 on), up only as far as fatigue goes. Tabletop sends a key with each change: the first time,
// the script keeps it (script property TABLE_KEY), and from then on takes changes with that key
// only. To let a different Tabletop make changes, delete TABLE_KEY.
//
// Set up (once):
//   1. Put the character sheets in one Drive folder (moving a sheet keeps its links working).
//   2. script.google.com › New project; paste this file in place of the starter code; save.
//   3. Project Settings (the gear) › Script properties › Add: FOLDER_ID = the folder's id (the
//      last part of the folder's address in Drive).
//   4. Deploy › New deployment › type Web app: Execute as Me; Who has access: Anyone. Authorise it
//      when asked (Google calls it unverified: it's your own script).
//   5. Copy the web app's address (…/exec) into Tabletop: Room settings › Character sheets.
// A new character: make a copy of a sheet in that folder; Tabletop finds it within a minute or two.

// This script's version: Tabletop tells the GM when a newer one is out (shared/characters.ts SCRIPT_VERSION).
const VERSION = 10;

function doGet() {
  const folderId = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  if (!folderId) return reply({ error: 'FOLDER_ID is not set in the script’s properties.' });
  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (err) {
    return reply({ error: 'The FOLDER_ID in the script’s properties isn’t a folder it can open.' });
  }
  const characters = [];
  const unread = [];
  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (files.hasNext()) {
    const file = files.next();
    if (file.isTrashed()) continue;
    try {
      const c = card(SpreadsheetApp.openById(file.getId()));
      if (c) characters.push(c);
    } catch (err) {
      // One that can't be read just now: Tabletop keeps its last reading of it.
      unread.push(file.getId());
    }
  }
  return reply({ version: VERSION, characters: characters, unread: unread });
}

/** One character's card from their sheet's Character tab, or null if it isn't a character sheet. */
function card(ss) {
  const sheet = ss.getSheetByName('Character');
  if (!sheet) return null;
  const v = sheet.getRange('A1:H160').getDisplayValues();
  // The value beside a label: column B for those in column A, G for those in F (0-based col).
  const at = function (col, label) {
    for (let i = 0; i < v.length; i++) if (String(v[i][col]).trim() === label) return String(v[i][col + 1]).trim();
    return '';
  };
  if (!at(0, 'Current HP')) return null;
  // The attacks: the rows under the "Weapon" heading, to the first empty one.
  const attacks = [];
  for (let i = 0; i < v.length; i++) {
    if (String(v[i][0]).trim() !== 'Weapon') continue;
    for (let j = i + 1; j < v.length && String(v[j][0]).trim(); j++) {
      const r = v[j];
      attacks.push({ weapon: r[0], damage: r[1], range: r[2], toHit: r[6], bonus: r[7] });
    }
    break;
  }
  return {
    id: ss.getId(),
    name: String(v[0][0]).trim() || ss.getName(),
    summary: String(v[0][7]).trim(),
    player: at(0, 'Player'),
    race: at(0, 'Race'),
    culture: at(0, 'Culture (humans)'),
    cls: at(0, 'Class'),
    subclass: at(0, 'Subclass / path'),
    cls2: at(0, 'Second class (optional)'),
    subclass2: at(0, 'Second subclass / path'),
    hp: at(0, 'Current HP'),
    maxHp: at(0, 'Maximum HP'),
    init: at(0, 'Initiative bonus'),
    sp: at(0, 'Current spell points'),
    maxSp: at(0, 'Maximum spell points'),
    ac: at(5, 'Combat AC'),
    acShield: at(5, 'AC with shield'),
    // A rogue's Sneak Attack rank, from the skills: how many d6 a sneak attack adds (one fewer at range).
    sneakRank: at(0, 'Sneak Attack'),
    // Their STR damage bonus, for a bow matched to their strength (the sheet adds it to melee weapons).
    strBonus: at(5, 'Melee damage'),
    attacks: attacks,
    spells: spellsOf(ss),
    prayedToday: prayedOf(v),
    ki: kiOf(ss, [[at(0, 'Class'), at(0, 'Level · XP')], [at(0, 'Second class (optional)'), at(0, 'Second class level · XP')]]),
    rest: restOf(v, at),
    // Their combat rest's dice as the sheet works them out ("d3 + d2 · F-level 4"), and their body
    // points, which a combat rest never gives back (version 10 on).
    combatRest: at(5, 'Combat rest (after a fight)'),
    bodyPoints: at(0, 'Body points'),
    magicRest: magicRestOf(ss, [at(0, 'Class'), at(0, 'Second class (optional)')]),
  };
}

/**
 * Whether one of a character's classes may rest magical damage instead (version 10 on): its
 * Combat rest on the Ref Classes tab gives spellcasters the choice (the handbook's p90: with at
 * least half the damage magical, d3 + d(highest spell level) instead of their usual one).
 */
function magicRestOf(ss, classes) {
  const ref = ss.getSheetByName('Ref Classes');
  if (!ref) return false;
  const rows = ref.getRange('A1:Z40').getDisplayValues();
  const col = rows[0].map(function (h) { return String(h).trim(); }).indexOf('Combat rest');
  if (col < 0) return false;
  return classes.some(function (cls) {
    const name = String(cls || '').trim();
    if (!name) return false;
    for (let i = 1; i < rows.length; i++) if (String(rows[i][0]).trim() === name) return /magical/i.test(String(rows[i][col]));
    return false;
  });
}

/**
 * What the sheet says was prayed for (or memorized) today and cast (version 9 on): the rows under
 * "Spell (prayed for or memorized)" in PRAYED FOR TODAY, to the first blank one, those with any
 * prayed: [{ spell, prayed, cast }]. Null for a sheet without the list.
 */
function prayedOf(v) {
  for (let i = 0; i < v.length; i++) {
    if (String(v[i][0]).trim() !== 'Spell (prayed for or memorized)') continue;
    const out = [];
    for (let j = i + 1; j < v.length && String(v[j][0]).trim(); j++) {
      const prayed = Number(String(v[j][1]).trim()) || 0;
      const cast = Number(String(v[j][2]).trim()) || 0;
      if (prayed > 0) out.push({ spell: String(v[j][0]).trim(), prayed: prayed, cast: cast });
    }
    return out;
  }
  return null;
}

/**
 * One more cast of a prayed spell, ticked on the sheet (version 9 on): its PRAYED FOR TODAY row's
 * Cast, matched by name (any "(R)" or "(1)" aside). Never past what was prayed, never over a formula.
 */
function castOn(sheet, spell) {
  const v = sheet.getRange('A1:D160').getDisplayValues();
  const key = function (s) { return String(s).trim().replace(/\s*\((R|\d+)\)\s*$/i, '').toLowerCase(); };
  let head = -1;
  for (let i = 0; i < v.length; i++) if (String(v[i][0]).trim() === 'Spell (prayed for or memorized)') { head = i; break; }
  if (head < 0) return { error: 'Their sheet has no Prayed for today list.' };
  for (let j = head + 1; j < v.length && String(v[j][0]).trim(); j++) {
    if (key(v[j][0]) !== key(spell)) continue;
    const prayed = Number(String(v[j][1]).trim()) || 0;
    const cast = Number(String(v[j][2]).trim()) || 0;
    if (cast >= prayed) return { error: 'None of ' + String(v[j][0]).trim() + ' left today (' + cast + ' of ' + prayed + ' cast).', prayed: prayed, cast: cast };
    const cell = sheet.getRange(j + 1, 3);
    if (cell.getFormula()) return { error: 'Their sheet works out Cast itself, so it isn’t changed.' };
    cell.setValue(cast + 1);
    return { prayed: prayed, cast: cast + 1 };
  }
  return { error: spell + ' isn’t prayed for on their sheet today.' };
}

/**
 * A combat rest taken in Tabletop (version 10 on): `gain` (the roll of its dice) added to Current
 * HP, up to what fatigue can give back: body points already lost stay lost (the handbook's
 * "Regaining lost hit points"). Never down, never over a formula. Answers { hp, was }.
 */
function healOn(sheet, gain) {
  const v = sheet.getRange('A1:B160').getDisplayValues();
  let row = 0, most = NaN, body = NaN;
  for (let i = 0; i < v.length; i++) {
    const label = String(v[i][0]).trim();
    if (label === 'Current HP' && !row) row = i + 1;
    if (label === 'Maximum HP') most = Number(v[i][1]);
    if (label === 'Body points') body = Number(v[i][1]);
  }
  if (!row) return { error: 'Their sheet has no Current HP.' };
  if (!Number.isFinite(most) || most < 1) return { error: 'Their sheet has no Maximum HP.' };
  const cell = sheet.getRange(row, 2);
  if (cell.getFormula()) return { error: 'Their sheet works out Current HP itself, so it isn’t changed.' };
  const now = Number(cell.getValue());
  if (cell.getValue() === '' || !Number.isFinite(now)) return { error: 'Their sheet’s Current HP is empty: pick it there first.' };
  const top = Number.isFinite(body) && body >= 0 && body <= most ? Math.min(now, body) + (most - body) : most;
  const next = Math.max(now, Math.min(now + gain, top));
  if (next !== now) cell.setValue(next);
  return { hp: next, was: now };
}

/**
 * How a caster's spell points come back (the handbook's spell point recuperation), or null for
 * someone without spell points: the level of the class with spell-point dice (the "Spell points"
 * row under PROGRESSION), their CON bonus, and the bonus of that class's spell stat (WIS for
 * clerics and their kind, INT for mages), as the ATTRIBUTES rows have them.
 */
function restOf(v, at) {
  let dice1 = '', dice2 = '';
  for (let i = 0; i < v.length; i++) {
    if (String(v[i][5]).trim() !== 'Spell points') continue;
    dice1 = String(v[i][6]).trim();
    dice2 = String(v[i][7]).trim();
    break;
  }
  const which = dice1 ? 1 : dice2 ? 2 : 0;
  if (!which) return null;
  const cls = which === 1 ? at(0, 'Class') : at(0, 'Second class (optional)');
  const level = Number(which === 1 ? at(0, 'Level · XP') : at(0, 'Second class level · XP'));
  const bonusOf = function (attr) {
    for (let i = 0; i < v.length; i++) if (String(v[i][0]).trim() === attr) return Number(String(v[i][2]).replace('+', '').trim());
    return NaN;
  };
  const divine = /cleric|shaman|druid|priest|paladin/i.test(cls);
  const con = bonusOf('CON');
  const primary = bonusOf(divine ? 'WIS' : 'INT');
  if (!(level > 0) || isNaN(con) || isNaN(primary)) return null;
  return { level: level, con: con, primary: primary };
}

/**
 * A character's ki, or null: the pool for their level of a class whose levels give ki (the "KI n"
 * in Ref Levels' Extra columns, as for the Samurai), and the ki abilities they have (the Features
 * tab's Active rows from a "ki" source with a "Cost: n ki" summary).
 */
function kiOf(ss, classes) {
  const ref = ss.getSheetByName('Ref Levels');
  if (!ref) return null;
  const rows = ref.getRange('A1:K400').getDisplayValues();
  let max = 0;
  classes.forEach(function (c) {
    if (!c[0] || !c[1]) return;
    const key = String(c[0]).trim() + '|' + String(c[1]).trim();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() !== key) continue;
      const m = /KI (\d+)/.exec(String(rows[i][10]));
      if (m) max = Math.max(max, Number(m[1]));
      break;
    }
  });
  if (!max) return null;
  const abilities = [];
  const features = ss.getSheetByName('Features');
  if (features) {
    const v = features.getRange('A1:E200').getDisplayValues();
    for (let i = 0; i < v.length; i++) {
      const r = v[i];
      if (!/ki/i.test(String(r[2])) || String(r[3]).trim() !== 'Active') continue;
      const cost = /Cost:\s*(\d+)\s*ki/i.exec(String(r[4]));
      if (cost) abilities.push({ name: String(r[1]).trim(), cost: Number(cost[1]), note: String(r[4]).trim().slice(0, 300) });
    }
  }
  return { max: max, abilities: abilities };
}

/**
 * The spells on the Spells tab, under its heading row ("Spell (your classes' list)"): each one's
 * name, level, spell points, how it's had (Free, Pray, Memorize...) and notes. What's been prayed
 * for today is chosen in Tabletop, not read from here.
 */
function spellsOf(ss) {
  const sheet = ss.getSheetByName('Spells');
  if (!sheet) return [];
  const v = sheet.getRange('A1:K400').getDisplayValues();
  let i = 0;
  while (i < v.length && String(v[i][0]).trim().indexOf('Spell (') !== 0) i++;
  const spells = [];
  for (let j = i + 1; j < v.length; j++) {
    const r = v[j];
    const name = String(r[0]).trim();
    if (!name) continue;
    spells.push({ name: name, level: r[1], sp: r[2], prayer: r[3], note: r[10] });
  }
  return spells;
}

/**
 * Spends a character's spell points on a spell cast in Tabletop: POST {key, id, spend}; or, for a
 * new day, puts them back to their Maximum spell points: POST {key, id, rest: true}. Answers with
 * their spell points now, or why not (and then changes nothing). Also ticks a prayed spell's Cast
 * (POST {key, id, cast}) and adds a combat rest's roll to Current HP (POST {key, id, heal}).
 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ error: 'That isn’t a change Tabletop sends.' });
  }
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('TABLE_KEY');
  if (!key && typeof body.key === 'string' && body.key.length >= 32) {
    props.setProperty('TABLE_KEY', body.key);
    key = body.key;
  }
  if (!key || body.key !== key) return reply({ error: 'Tabletop’s key doesn’t match the one the script keeps (TABLE_KEY in its properties).' });
  const rest = body.rest === true;
  const spend = Number(body.spend);
  // A prayed spell cast (version 9 on): its Cast ticked on the sheet.
  const castSpell = typeof body.cast === 'string' && body.cast.trim() && body.cast.length <= 80 ? body.cast.trim() : '';
  // A combat rest (version 10 on): the HP its roll gives back.
  const heal = Number(body.heal);
  const healing = body.heal !== undefined;
  if (healing && (!Number.isInteger(heal) || heal < 1 || heal > 100)) return reply({ error: 'That isn’t a number of hit points.' });
  if (!rest && !castSpell && !healing && (!Number.isInteger(spend) || spend < 1 || spend > 100)) return reply({ error: 'That isn’t a number of spell points.' });
  let file;
  try {
    file = DriveApp.getFileById(String(body.id));
  } catch (err) {
    return reply({ error: 'That sheet can’t be opened.' });
  }
  let inFolder = false;
  const parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === props.getProperty('FOLDER_ID')) inFolder = true;
  if (!inFolder || file.isTrashed()) return reply({ error: 'That sheet isn’t in the character sheets’ folder.' });
  // One change at a time, so two casts at once both come off.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(file.getId()).getSheetByName('Character');
    if (!sheet) return reply({ error: 'That isn’t a character sheet.' });
    if (castSpell) return reply(castOn(sheet, castSpell));
    if (healing) return reply(healOn(sheet, heal));
    const v = sheet.getRange('A1:B160').getDisplayValues();
    let row = 0;
    let most = NaN;
    for (let i = 0; i < v.length; i++) {
      const label = String(v[i][0]).trim();
      if (label === 'Current spell points' && !row) row = i + 1;
      if (label === 'Maximum spell points') most = Number(v[i][1]);
    }
    if (!row) return reply({ error: 'Their sheet has no Current spell points.' });
    const cell = sheet.getRange(row, 2);
    if (cell.getFormula()) return reply({ error: 'Their sheet works out Current spell points itself, so it isn’t changed.' });
    const now = Number(cell.getValue()) || 0;
    if (rest) {
      if (!Number.isFinite(most) || most < 0) return reply({ error: 'Their sheet has no Maximum spell points.' });
      // With a gain (version 8 on): that many back, up to the maximum. Without: back to the maximum.
      const gain = Number(body.gain);
      const next = Number.isInteger(gain) && gain > 0 ? Math.min(most, now + gain) : most;
      if (now !== next) cell.setValue(next);
      return reply({ sp: next });
    }
    if (spend > now) return reply({ error: 'Not enough spell points.', sp: now });
    cell.setValue(now - spend);
    return reply({ sp: now - spend });
  } finally {
    lock.releaseLock();
  }
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
