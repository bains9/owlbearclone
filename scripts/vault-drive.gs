// Table's link to the GM's Obsidian vaults in Google Drive (Campaign notes › Google Drive).
//
// 1. At script.google.com, make a new project (in the Google account whose Drive has the vaults)
//    and paste this in.
// 2. Project Settings › Script properties: add FOLDER_ID, the id (the last part of its address in
//    Drive) of your vault's folder, or of the folder holding all your vaults.
// 3. Deploy › New deployment › Web app: Execute as Me, Who has access Anyone. Allow it to read
//    your Drive when Google asks.
// 4. Copy the web app's address (it ends /exec) into Campaign notes in Table.
//
// It only reads. Table sends a key with every request: the script keeps the first one it's sent
// (TABLE_KEY) and answers only that Table. It hands over only notes (.md) and pictures inside the
// vaults, found by their path in them, and never Obsidian's own folders (those starting ".").
//
// A vault is a folder with Obsidian's .obsidian folder, or notes, at its top. When FOLDER_ID's folder
// is one, that's the vault; otherwise each folder in it is a vault, named by the folder.

var VERSION = 2;

function doGet(e) {
  return answer(handle((e && e.parameter) || {}));
}

function doPost(e) {
  var p = {};
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return answer({ error: "That wasn't Table asking." });
  }
  return answer(handle(p));
}

function handle(p) {
  var props = PropertiesService.getScriptProperties();
  if (!p.key) return { error: "Table didn't send its key." };
  var key = props.getProperty("TABLE_KEY");
  if (!key) {
    props.setProperty("TABLE_KEY", p.key);
    key = p.key;
  }
  if (p.key !== key) return { error: "This script answers another Table. To move it to this one, delete TABLE_KEY in the script's properties." };
  var folderId = props.getProperty("FOLDER_ID");
  if (!folderId) return { error: "Set the script property FOLDER_ID to your vault's folder id (or the folder holding your vaults)." };
  var vaults = vaultsOf(DriveApp.getFolderById(folderId));
  if (p.list) {
    var out = [];
    for (var v = 0; v < vaults.length; v++) {
      var notes = [];
      var files = [];
      walk(vaults[v].folder, "", notes, files);
      out.push({ name: vaults[v].name, notes: notes, files: files });
    }
    return { version: VERSION, vaults: out };
  }
  var root = null;
  for (var i = 0; i < vaults.length; i++) if (vaults[i].name === p.vault) root = vaults[i].folder;
  if (!root) return { error: "That vault isn't in the folder the script reads." };
  if (p.notes) {
    var got = [];
    for (var n = 0; n < p.notes.length && n < 100; n++) {
      var f = find(root, p.notes[n], /\.md$/i);
      if (f) got.push({ path: p.notes[n], body: f.getBlob().getDataAsString("UTF-8") });
    }
    return { notes: got };
  }
  if (p.file) {
    var pic = find(root, p.file, /\.(png|jpe?g|gif|webp)$/i);
    if (!pic) return { error: "That picture isn't in the vault." };
    return { path: p.file, data: Utilities.base64Encode(pic.getBlob().getBytes()) };
  }
  return { error: "Table didn't ask for anything." };
}

/** The vaults in FOLDER_ID's folder: itself, if it's one; else each folder in it. */
function vaultsOf(root) {
  if (isVault(root)) return [{ name: root.getName(), folder: root }];
  var out = [];
  var it = root.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    var name = f.getName();
    if (name.charAt(0) === "." || name.indexOf("|") >= 0) continue;
    out.push({ name: name, folder: f });
  }
  return out;
}

/** Whether a folder is a vault: Obsidian's folder, or notes, at its top. */
function isVault(folder) {
  if (folder.getFoldersByName(".obsidian").hasNext()) return true;
  var it = folder.getFiles();
  while (it.hasNext()) if (/\.md$/i.test(it.next().getName())) return true;
  return false;
}

function walk(folder, prefix, notes, files) {
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    var name = f.getName();
    if (name.charAt(0) === ".") continue;
    var entry = { path: prefix + name, modified: f.getLastUpdated().getTime(), bytes: f.getSize() };
    if (/\.md$/i.test(name)) notes.push(entry);
    else if (/\.(png|jpe?g|gif|webp)$/i.test(name)) files.push(entry);
  }
  var sub = folder.getFolders();
  while (sub.hasNext()) {
    var s = sub.next();
    var sname = s.getName();
    if (sname.charAt(0) === ".") continue;
    walk(s, prefix + sname + "/", notes, files);
  }
}

/** A file by its path inside a vault's folder, of the kind asked for; null if there's none. */
function find(root, path, kind) {
  if (typeof path !== "string" || !kind.test(path)) return null;
  var parts = path.split("/");
  var folder = root;
  for (var i = 0; i < parts.length - 1; i++) {
    if (!parts[i] || parts[i].charAt(0) === "." || parts[i] === "..") return null;
    var next = folder.getFoldersByName(parts[i]);
    if (!next.hasNext()) return null;
    folder = next.next();
  }
  var name = parts[parts.length - 1];
  if (!name || name.charAt(0) === ".") return null;
  var files = folder.getFilesByName(name);
  return files.hasNext() ? files.next() : null;
}

function answer(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
