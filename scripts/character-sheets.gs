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
// The one thing it changes: a character's Current spell points, when they cast a spell in
// Tabletop, or back to their Maximum for a new day (doPost). Only that cell, only on a sheet in
// the folder, never below 0, and never when the sheet works it out with a formula. Tabletop sends a key with each change: the first time,
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
  return reply({ characters: characters, unread: unread });
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
    ki: kiOf(ss, [[at(0, 'Class'), at(0, 'Level · XP')], [at(0, 'Second class (optional)'), at(0, 'Second class level · XP')]]),
  };
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
 * their spell points now, or why not (and then changes nothing).
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
  if (!rest && (!Number.isInteger(spend) || spend < 1 || spend > 100)) return reply({ error: 'That isn’t a number of spell points.' });
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
      if (now !== most) cell.setValue(most);
      return reply({ sp: most });
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
