// Where Table keeps its backups: a folder in your Google Drive (GM start page › Backups).
//
// 1. In Google Drive, make a folder for the backups. Its id is the last part of its address.
// 2. At script.google.com, make a new project (in that same Google account) and paste this in.
// 3. Project Settings › Script properties: add FOLDER_ID, that folder's id.
// 4. Deploy › New deployment › Web app: Execute as Me, Who has access Anyone. Allow it to use your
//    Drive when Google asks.
// 5. Copy the web app's address (it ends /exec) into Backups on Table's start page.
//
// Table sends a key with every request: the script keeps the first one it's sent (TABLE_KEY) and
// answers only that Table. It works only inside FOLDER_ID's folder, in three folders of its own:
//   nights     one list per backup: the rooms and every file as they were that night (plain JSON)
//   snapshots  each room's contents, and the table's (calendar, notes and so on), gzipped JSON
//   files      each picture and map, named by its checksum: kept once, however many nights have it
//
// It can only list, add and read: it never changes or deletes a file, so nothing Table does can lose a backup.
// Delete old ones by hand if you ever want the room: anything in nights is safe to delete; what's
// in snapshots and files may be used by other nights.

var VERSION = 1;
var KINDS = { nights: true, snapshots: true, files: true };
var NAME = /^[A-Za-z0-9._-]{1,120}$/;

function doPost(e) {
  var p = {};
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return answer({ error: "That wasn't Table asking." });
  }
  try {
    return answer(handle(p));
  } catch (err) {
    return answer({ error: String((err && err.message) || err) });
  }
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
  if (!folderId) return { error: "Set the script property FOLDER_ID to your backup folder's id." };
  var root = DriveApp.getFolderById(folderId);
  if (p.list) {
    return { version: VERSION, nights: names(root, "nights"), snapshots: names(root, "snapshots"), files: names(root, "files") };
  }
  if (!KINDS[p.kind] || typeof p.name !== "string" || !NAME.test(p.name) || p.name.charAt(0) === ".") return { error: "That isn't a backup's name." };
  var folder = kindFolder(root, p.kind);
  var existing = folder.getFilesByName(p.name);
  if (typeof p.data === "string") {
    // Add only: what's there stays. A name is its contents (a checksum, or a night's time), so this
    // is Table sending it again, not knowing it arrived; it's told what's there, to compare.
    if (existing.hasNext()) {
      var there = existing.next().getBlob().getBytes();
      return { name: p.name, bytes: there.length, md5: md5(there), kept: true };
    }
    var bytes = Utilities.base64Decode(p.data);
    var sum = md5(bytes);
    // Checked before it's kept, since it's never changed after.
    if ((typeof p.bytes === "number" && p.bytes !== bytes.length) || (p.md5 && p.md5 !== sum)) return { error: "That arrived damaged, so it wasn't kept." };
    folder.createFile(Utilities.newBlob(bytes, typeof p.mime === "string" && p.mime ? p.mime : "application/octet-stream", p.name));
    return { name: p.name, bytes: bytes.length, md5: sum };
  }
  if (p.read) {
    if (!existing.hasNext()) return { error: "That isn't in the backups." };
    return { name: p.name, data: Utilities.base64Encode(existing.next().getBlob().getBytes()) };
  }
  return { error: "Table didn't ask for anything." };
}

function names(root, kind) {
  var out = [];
  var it = kindFolder(root, kind).getFiles();
  while (it.hasNext()) out.push(it.next().getName());
  return out;
}

function kindFolder(root, kind) {
  var it = root.getFoldersByName(kind);
  return it.hasNext() ? it.next() : root.createFolder(kind);
}

function md5(bytes) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes);
  var out = "";
  for (var i = 0; i < digest.length; i++) {
    var b = digest[i] < 0 ? digest[i] + 256 : digest[i];
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

function answer(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
