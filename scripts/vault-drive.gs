// Table's link to the GM's Obsidian vault in Google Drive (Campaign notes › Google Drive).
//
// 1. At script.google.com, make a new project (in the Google account whose Drive has the vault)
//    and paste this in.
// 2. Project Settings › Script properties: add FOLDER_ID, the vault folder's id (the last part of
//    its address in Drive).
// 3. Deploy › New deployment › Web app: Execute as Me, Who has access Anyone. Allow it to read
//    your Drive when Google asks.
// 4. Copy the web app's address (it ends /exec) into Campaign notes in Table.
//
// It only reads. Table sends a key with every request: the script keeps the first one it's sent
// (TABLE_KEY) and answers only that Table. It hands over only notes (.md) and pictures inside the
// vault folder, found by their path in it, and never Obsidian's own folders (those starting ".").

var VERSION = 1;

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
  if (!folderId) return { error: "Set the script property FOLDER_ID to your vault folder's id." };
  var root = DriveApp.getFolderById(folderId);
  if (p.list) return list(root);
  if (p.notes) {
    var notes = [];
    for (var i = 0; i < p.notes.length && i < 100; i++) {
      var f = find(root, p.notes[i], /\.md$/i);
      if (f) notes.push({ path: p.notes[i], body: f.getBlob().getDataAsString("UTF-8") });
    }
    return { notes: notes };
  }
  if (p.file) {
    var pic = find(root, p.file, /\.(png|jpe?g|gif|webp)$/i);
    if (!pic) return { error: "That picture isn't in the vault." };
    return { path: p.file, data: Utilities.base64Encode(pic.getBlob().getBytes()) };
  }
  return { error: "Table didn't ask for anything." };
}

/** Every note and picture in the vault, with when each last changed. */
function list(root) {
  var notes = [];
  var files = [];
  walk(root, "", notes, files);
  return { version: VERSION, notes: notes, files: files };
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
    if (s.getName().charAt(0) === ".") continue;
    walk(s, prefix + s.getName() + "/", notes, files);
  }
}

/** A file by its path inside the vault folder, of the kind asked for; null if there's none. */
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
