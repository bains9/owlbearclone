// Tabletop's window on the party's character sheets (table.parhome.ca: tokens' cards, HP bars,
// initiative and attack rolls; see src/worker/characters.ts and src/shared/characters.ts).
//
// A Google Apps Script web app, run as its owner (the GM), that reads only the spreadsheets in
// one Drive folder, each a copy of the group's Player's Handbook character sheet, and answers with
// what Tabletop shows: name, player, race and classes, HP, AC, initiative, spell points and
// attacks. It changes nothing in the sheets. Numbers are found by their labels on the Character
// tab ("Current HP", "Combat AC"...), not by cell, so the sheet's layout can change.
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
    attacks: attacks,
  };
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
