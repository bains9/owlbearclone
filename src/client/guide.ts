// The words of the user guide (/guide). Steps are one action each; **bold** marks a
// label exactly as the app shows it, `code` marks something to type. Written from the
// app's code and checked against it, area by area.

export interface GuideSection {
  id: string;
  title: string;
  audience: "gm" | "player" | "everyone";
  intro: string;
  parts: { title: string; steps: string[]; notes: string[] }[];
}

export const GUIDE: GuideSection[] = [
  {
    "id": "whats-new",
    "title": "What's new",
    "audience": "everyone",
    "intro": "What's changed in Tabletop, newest first. The latest update came out on 4 October 2026. If a Tabletop page shows **Update: Reload** in its top bar, click it to get the newest version.",
    "parts": [
      {
        "title": "Exact seasons from Dungeondraft files (4 October 2026, latest)",
        "steps": [
          "GM: in Dungeondraft, save the map (the .dungeondraft_map file) and export it (**Universal VTT** or PNG).",
          "Bring both files into Tabletop together: drop them on the map, or click **Import Dungeondraft map** in the Build tool's bar and pick both. If they're in different folders, bring one and then the other: the **New scene** window waits for the second.",
          "For a scene you already have: open **Edit scene**, and under **Map** click **Attach…** next to **Dungeondraft data**; or click **Attach its project file** in the season box.",
          "Pick the level if asked, check that the preview lines up (try **Compare**), and click **Attach**."
        ],
        "notes": [
          "A map made in Dungeondraft can now bring its project file along with its picture. With it, seasons know exactly where the snow, grass, water, buildings and trees are, instead of guessing from the picture: on a winter map, Spring, Summer and Autumn melt the snow only where it's painted, leaves come only on the trees you placed and by their kind (pines stay green in autumn), and water, buildings and caves stay exact.",
          "This works on winter maps now; green maps follow in a later update, and their data is kept for then. Without a project file, seasons work as before, guessed from the picture.",
          "Things placed from asset packs stay as drawn, unless you pick **Guess from the picture** under **Asset-pack items** in the season box; paths, ground and roofs from asset packs always do. Bare trees come into leaf on a winter map: **Bare trees** in the season box changes that, and **This map is drawn in** corrects which season the picture shows.",
          "The project file itself is never uploaded: only what seasons need from the one level you pick. Players can't see other levels, secret doors, notes or the file's name.",
          "A project file brought in by itself still tells you it has no picture in it and what to do. See **Exact seasons for Dungeondraft maps** under **Seasons**."
        ]
      },
      {
        "title": "Dungeondraft project files explained (30 September 2026)",
        "steps": [
          "GM: in Dungeondraft, choose **Export** and set the export mode to **Universal VTT**.",
          "Bring the .dd2vtt file it makes into Tabletop: **Import Dungeondraft map**, **New scene**, or drop it on the map."
        ],
        "notes": [
          "Dungeondraft's own project file (its name ends in .dungeondraft_map) has the map's data but no picture, so Tabletop can't make a scene from it alone. Bringing one in by itself now says so, instead of doing nothing. Since 4 October it's useful too: brought in with its export, or attached to a scene, it gives that scene exact seasons (see **Exact seasons from Dungeondraft files** above).",
          "See **Coming from Dungeondraft**."
        ]
      },
      {
        "title": "Pointing on the table display (29 September 2026, later)",
        "steps": [
          "Press **P** (or click **Pointer**) and click a spot on the map, without dragging."
        ],
        "notes": [
          "A click with the pointer now pings: rings pulse there for a few seconds, on everyone's screen and on the table display.",
          "Holding the pointer still keeps it showing instead of fading away, and on the table display it's twice as big, so the table can see what the GM points at.",
          "The pointer also keeps up with the mouse more closely. See **Pointing at things**."
        ]
      },
      {
        "title": "Select, turn and size objects, like Dungeondraft (29 September 2026)",
        "steps": [
          "GM: in **Build the map**, press **X** or pick **Select** (the dashed box with a pointer).",
          "Click an object, or drag a box over several.",
          "Drag them to move them, scroll the mouse wheel to turn them, or press **Delete**."
        ],
        "notes": [
          "**Select** works like Dungeondraft's Select tool: selected objects have a blue outline and the one under the pointer a yellow one. **Shift**+click adds or takes away, a box over empty floor selects several, **Shift**+drag adds a box. Drag to move, the arrow keys nudge a square, the mouse wheel turns 15° a notch (hold **Z** for 5°), a right-click turns 90°, and **Alt**+wheel changes the size. **Delete** removes, **Ctrl+D** duplicates, **Ctrl+C** and **Ctrl+V** copy and paste (into another scene or room too), **Escape** deselects, and **X** again goes back to what you were using.",
          "Turning several objects turns them together, so a table keeps its chairs.",
          "Objects can now be turned in 5° steps and sized from ½ to 3 squares in quarter squares. While you place one in **Objects**, the mouse wheel turns it and **Alt**+wheel sizes it before you click, and the bar has **Size** and **Turn** controls.",
          "In **Objects**, a click now always places a new object, even on top of another; turn, move or delete placed ones in **Select**. **Alt**+click still removes one, and with a mouse you can still drag one to move it.",
          "In **Objects**, and in **Select** with objects selected, the mouse wheel turns objects: zoom with **Ctrl** and the wheel, or pinch. A trackpad still moves the map. If your mouse wheel moves the map instead of turning, or you use a trackpad, hold **Z** while you scroll, or see **Place objects**.",
          "Doors and secret doors can be clicked in **Select**, and **Delete** takes them away.",
          "Pages opened before this update don't show built maps until they're reloaded (**Update: Reload**)."
        ]
      },
      {
        "title": "Seasons in one click (28 September 2026)",
        "steps": [
          "GM: in the top bar, click the season button (a sun behind a cloud, left of the monitor button).",
          "Pick **Spring**, **Summer**, **Autumn** or **Winter**, then how drastic."
        ],
        "notes": [
          "Put a scene in season with one click: Winter snow (**Frost**, **Snow**, **Deep snow**), Autumn leaves (**Turning**, **Autumn**, **Late autumn**), Spring blossom (**Budding**, **Blossom**, **Full bloom**) or Summer (**Lush**, **Dry**, **Drought**). **As drawn** puts the map back.",
          "It works on uploaded maps, Dungeondraft ones included, and on maps you build. Mostly plants, water and open ground change, and in winter things out in the open, like rocks, wells and small roofs, get snow on top: dungeons and rooms stay as drawn, and tokens, drawings and fog never change.",
          "Autumn trees turn a mix of red, orange, yellow and some green, and lose more leaves the stronger it is.",
          "The same buttons are in the scene editor, under **Season**. Everything is in **Seasons: snow, autumn leaves, blossom and drought**.",
          "For everyone: if maps are slow to appear on a device, seasons can be turned off on it, under **Change your name or colour** in **Chat & dice**. A table display always shows the season, even one opened on a computer where they're turned off."
        ]
      },
      {
        "title": "Build like Dungeondraft (27 September 2026, night)",
        "steps": [
          "Pick **Build the map** (**B**). On a computer, the controls for each mode are listed along the bottom of the map."
        ],
        "notes": [
          "The Build tool's modes now follow Dungeondraft's tools: **Building** (rooms), **Walls**, **Doors**, **Terrain** (grass, water and lava, which go under buildings) and **Objects**. **Building a map: floors, walls, doors and objects** now starts with a part for Dungeondraft users.",
          "Dungeondraft habits work: hold Alt to cut out part of a room, right-click to turn the next object, and use Ctrl and the mouse wheel to zoom (with a mouse wheel it used to jump; now it zooms gently). Here Alt also erases terrain (in Dungeondraft you paint over it) and removes walls, doors and objects (in Dungeondraft, the Select tool does that).",
          "With a mouse, walls can be placed by clicking corners, and finished with a double-click, a right-click or **Enter**.",
          "Doors now have styles: **Door**, **Secret** and **Opening** (a gap in the wall). A click finds the nearest wall.",
          "With a mouse, drag an object to move it.",
          "Rooms can be ovals as well as rectangles, and the brush size is picked with buttons from 1 to 5.",
          "Rooms now get walls where they meet grass, water or lava, not only where they meet empty space. A path or bridge painted in stone, wood or dirt before this update now has walls along the terrain beside it: open them with **Walls**, **Remove**, or paint it again with **No wall**.",
          "**Import Dungeondraft map** in the Build tool's bar brings in a Dungeondraft Universal VTT export as a new scene.",
          "Redo is **Ctrl+Y** as well as **Ctrl+Shift+Z**."
        ]
      },
      {
        "title": "Pages tell you when to reload (27 September 2026, later that evening)",
        "steps": [
          "When **Update: Reload** shows in the top bar, click it, or reload the page yourself (F5, or Cmd+R on a Mac)."
        ],
        "notes": [
          "When Tabletop is updated while you have a room open, the page now tells you: a message says \"Tabletop has been updated. Reload this page to get the new version.\" and **Update: Reload** appears in the top bar. Until you reload, that page keeps the old version, without any new tools.",
          "A table display reloads itself when Tabletop is updated, so the screen at the table keeps up without anyone touching it.",
          "Pages opened before this change get the message but not the button. A table display opened before it can't show the message either, so the GM is told to reload it instead.",
          "GM: if a tool you've read about isn't in your toolbar (the hammer for **Build the map**, say), reload first. See **Troubleshooting**."
        ]
      },
      {
        "title": "GM: build your own maps (27 September 2026, evening)",
        "steps": [
          "Click **Scenes** in the top bar.",
          "Click **New scene**.",
          "Choose **Blank grid**.",
          "Click **Create**. The Build tool is picked for you.",
          "In the Build tool's bar, check that **Building**, **Rectangle** (the square) and stone (the first floor) are picked. They are to begin with.",
          "Drag from one corner of a room to the opposite corner. You get a stone room with walls round it.",
          "Pick **Doors**.",
          "Click one of the room's walls. It becomes a door.",
          "When it's ready, click **Show to players** on the \"Only you can see this scene\" banner."
        ],
        "notes": [
          "You can now build a battle map right on the grid with the Build tool: click **Build the map** (the hammer) in the toolbar, or press **B**.",
          "Paint rooms (stone, wood or dirt) in **Building** and grass, water or lava in **Terrain**, with a rectangle or a brush. Rooms get walls by themselves; you can turn that off to patch an uploaded map.",
          "Draw or remove walls along the grid lines. In **Doors**, click a wall to put a door in it, or pick **Secret** first for a secret door: you see a purple **S** on it, and players see an ordinary wall.",
          "Place objects such as tables, beds, chests, stairs, trees and a campfire, from 1×1 to 3×3 squares.",
          "Build on a blank grid, or over an uploaded map to patch it or add rooms. It needs a square grid.",
          "When you build on the scene players are on, they see each change as you make it, unless it's under fog. The bar then says \"Players see this scene as you build.\" To build in secret, cover the scene in fog first, or build on another scene.",
          "Each drag or click is one step for **Undo**. **Clear build** removes everything built on the scene, after asking you. What you build is saved with the scene and included in backups, and deleting the scene deletes it too.",
          "On a phone or tablet, one finger paints floors and draws walls. For doors and objects, tap: a drag moves the map instead.",
          "The full how-to is in **Building a map: floors, walls, doors and objects**."
        ]
      },
      {
        "title": "Also in this update",
        "steps": [],
        "notes": [
          "For players: maps the GM builds show up like any other map, under the fog. On the scene you're on, they appear as the GM builds them. A secret door looks like an ordinary wall.",
          "Blank grids (GM): **Blank grid** in **New scene** now has a **Start covered in fog** tick box, unticked to begin with. **Create** now takes you straight to the Build tool instead of the scene editor, and on a phone the **Scenes** panel closes so you can see the map. See **Adding maps**.",
          "Pages left open from before the update: reload them. An older page can't show built maps. It leaves them out, and a message that starts \"Tabletop has been updated.\" asks you to reload. See **Troubleshooting**.",
          "An out-of-date table display (GM): a table display can't show messages, so when it's the display's page that needs reloading, you get a message that starts \"A table display is running an older version of Tabletop\". Reload the page on the display's screen, or in the TV's browser.",
          "The table display while you build (GM): with **What I'm looking at, while I'm on the live scene** picked, the display now stays where it is while you use the Build tool, so the table doesn't jump around as you zoom in to build. It follows you again when you pick another tool. See **Showing the map on a second screen or a TV**.",
          "The \"Only you can see this scene\" banner (GM): it now sits just below a tool's options bar instead of covering it. On a phone it's still near the bottom of the map. See **Finding your way around a room**.",
          "New keyboard shortcuts (GM): **B** picks **Build the map**. In the Build tool, **[** and **]** make the floor brush smaller or bigger, or turn the next object before you place it. They're in the **Help & shortcuts** box and in **Keyboard shortcuts**."
        ]
      },
      {
        "title": "Earlier updates, also on 27 September 2026",
        "steps": [],
        "notes": [
          "The eraser takes tokens too (earlier that evening): drag the **Eraser** over tokens as well as drawings and notes. Locked tokens are never erased, and players can only erase their own drawings, notes and tokens. See **Drawing and notes**.",
          "This guide: step-by-step help for players and the GM. Open it from **How to use Tabletop** on the start page, or from **Read the full guide** in a room's **Help & shortcuts** box. When something goes wrong, look in **Troubleshooting**.",
          "The table display (GM): show the map on a second screen or a TV, exactly as players see it. Click the monitor button in the top bar, then **Open display window**. See **Showing the map on a second screen or a TV**.",
          "Google sign-in (GM): sign in with **Sign in with Google** on the start page instead of typing the GM password. See **Signing in as the GM**.",
          "Bringing in maps (GM): **New scene** takes Owlbear Rodeo backups (.ob2) with their fog and tokens, and Dungeondraft and other Universal VTT files with their exact grid. You can also drop or paste a map straight onto the board, and the grid can be read from a file name such as `Crypt 30x20.jpg`. See **Moving from Owlbear Rodeo** and **Adding maps**.",
          "Steadier connections (everyone): when a dropped connection comes back, the changes you made meanwhile now arrive exactly once. None go missing (as long as you don't reload the page), and none are applied twice.",
          "The first version of Tabletop: rooms players join with a link, tokens, drawing and notes, measuring, the pointer, dice and chat, initiative, scenes, fog of war, backups, and GM sign-in with a password. Players can start with **Joining a game**, and everyone with **Finding your way around a room**."
        ]
      }
    ]
  },
  {
    "id": "joining-a-game",
    "title": "Joining a game",
    "audience": "player",
    "intro": "Players don't need an account. All you need is the room link your GM sends you.",
    "parts": [
      {
        "title": "Join with the room link",
        "steps": [
          "Click the room link your GM sent you.",
          "On the **Join the game** screen, type your name in **Your name**.",
          "If you like, click a different colour under **Your colour**.",
          "Click **Join**, or press Enter.",
          "Wait a moment while it says \"Joining the room…\"."
        ],
        "notes": [
          "A colour is already picked for you at random.",
          "**Join** stays greyed out until you've typed a name. Names can be up to 32 characters.",
          "Your colour marks you in the chat and in the top bar. Your drawings start in your colour (you can pick another in **Draw**), and your pointer trail is always in your colour.",
          "This browser remembers your name and colour, so next time the link takes you straight in.",
          "In a private or incognito window, the browser can forget your name, colour and which tokens are yours when you close it. Use a normal window if you can.",
          "Use the same device and browser each session if you can. That's how the table knows which tokens and drawings are yours.",
          "On a different device or browser, the table treats you as someone new. You can't erase or move your old drawings, or delete your old tokens. You can still move and change unlocked tokens if the GM has **Move any unlocked token** turned on.",
          "The GM sees this same screen the first time they open a room in a new browser."
        ]
      },
      {
        "title": "Paste the link on the start page instead",
        "steps": [
          "Go to table.parhome.ca.",
          "Paste the room link into the box under **Join a game**.",
          "Click **Join**.",
          "Choose your name and colour as above."
        ],
        "notes": [
          "**Join** only becomes clickable once what you pasted contains a whole room link. Pasting just the 12-character code from the end of the link works too.",
          "You can ignore the **GM sign in** box. It's only for the GM."
        ]
      },
      {
        "title": "Change your name or colour later",
        "steps": [
          "Click the speech-bubble button in the top bar to open **Chat & dice**.",
          "At the top of the panel, next to the list of who's here, click the person-and-pencil button (**Change your name or colour**).",
          "Change your name, your colour, or both.",
          "Click **Save**."
        ],
        "notes": [
          "Everyone in the room sees the change straight away, and this browser remembers it for next time.",
          "Messages you already sent keep your old name.",
          "The GM changes their name and colour the same way."
        ]
      }
    ]
  },
  {
    "id": "finding-your-way-around",
    "title": "Finding your way around a room",
    "audience": "everyone",
    "intro": "A room has the map in the middle, a bar along the top, tools down the left side and zoom buttons in a corner. Hover over a button to see its name, and its keyboard shortcut if it has one.",
    "parts": [
      {
        "title": "The top bar",
        "steps": [
          "Look at the top left for the room's name. The name of the scene you're looking at is just underneath it, in smaller grey text.",
          "GM: click the house button (**All rooms**) at the far left to go back to your list of rooms.",
          "Hover over the coloured circles to see who's in the room.",
          "Click the link button (**Copy invite link**) to copy the room link. It says **Copied** for a moment.",
          "Click the question-mark button (**Help & shortcuts**) to see the keyboard shortcuts.",
          "Click one of the buttons at the right-hand end to open a panel."
        ],
        "notes": [
          "Each circle shows a person's first letter in their colour. After six people, the rest are shown as \"+\" and a number.",
          "The GM's circle has an orange ring around it, and in the list you see when hovering, the GM is marked \"(GM)\". In **Chat & dice**, the GM has a **GM** tag.",
          "Everyone is counted once for each tab or window they have the room open in. If a name shows up twice, that person has the room open twice.",
          "Players see the Tabletop logo where the GM has the house button.",
          "If your browser won't let the page copy, a message pops up showing the invite link so you can copy it yourself.",
          "The monitor button (GM only) opens **Table display**, for showing the map on a second screen (see \"Showing the map on a second screen or a TV\")."
        ]
      },
      {
        "title": "The panels",
        "steps": [
          "Click a panel button in the top bar to open that panel on the right.",
          "Click the same button again, or the **X** (**Close**) at the top of the panel, to close it."
        ],
        "notes": [
          "**Chat & dice**: messages, dice rolls and who's here. A number on the button counts messages you haven't seen.",
          "**Tokens & images**: quick coloured tokens and uploaded images to put on the map. If the GM has turned this off for players, the panel says \"The GM has turned off adding tokens for players.\"",
          "**Initiative**: the turn order for combat.",
          "**Scenes** (GM only): every scene in the room. Preview one privately, or show it to the players.",
          "**Room settings** (GM only): the room's name, the invite link, what players are allowed to do, backups, and deleting the room.",
          "Only one panel is open at a time. On a large screen, **Chat & dice** opens by itself when you enter a room."
        ]
      },
      {
        "title": "Help and keyboard shortcuts",
        "steps": [
          "Click the question-mark button in the top bar.",
          "Read the list in the **Help & shortcuts** box.",
          "Press Esc, click the **X**, or click outside the box to close it."
        ],
        "notes": [
          "The most useful ones: V, D, E, M and P pick the tools (F picks fog, GM only); + and − zoom in and out; 0 fits the whole scene on screen; Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes.",
          "On a Mac, use Cmd instead of Ctrl: Cmd+Z undoes, Cmd+Shift+Z or Cmd+Y redoes, and Cmd+D duplicates.",
          "Shortcuts don't work while you're typing in a box, or while a box like this one is open.",
          "There's no Help button on narrow screens such as phones."
        ]
      },
      {
        "title": "The toolbar on the left",
        "steps": [
          "Click a tool to pick it. The tool you're using is highlighted.",
          "Use the options that appear to the right of the toolbar for the tool you picked.",
          "Click **Undo** or **Redo** at the bottom of the toolbar to step back or forward."
        ],
        "notes": [
          "**Move & select (V)**: move tokens, select things, and drag empty space to move around the map.",
          "**Draw (D)**: freehand, lines, rectangles, ellipses and text notes. Players can only draw if the GM allows it. If the GM hasn't, you'll see \"The GM has turned drawing off.\" when you try.",
          "**Eraser (E)**: drag over drawings, notes or tokens to erase them. Locked tokens stay put. Players can only erase their own drawings and tokens. The tool's options also have **Clear my drawings** (for the GM, **Clear all drawings**), which asks you to confirm first. Undo brings them back.",
          "**Fog of war (F)**: GM only. Hide and reveal parts of the map.",
          "**Build the map (B)**: GM only. Paint rooms, walls, doors, terrain and objects onto the grid, with modes named after Dungeondraft's tools.",
          "**Measure (M)**: a ruler and spell areas.",
          "**Pointer (P)**: hold and drag to point. Everyone sees the trail.",
          "**Undo (Ctrl+Z)** and **Redo (Ctrl+Shift+Z)** only cover your own changes on the scene you're looking at. They're greyed out when there's nothing to undo or redo.",
          "Undo only remembers changes you've made since you opened the page. Reloading clears it."
        ]
      },
      {
        "title": "The selection bar",
        "steps": [
          "With **Move & select**, click a token, drawing or note on the map.",
          "Use the bar that appears along the bottom of the map to change it.",
          "Click an empty part of the map, or press Esc, when you're done."
        ],
        "notes": [
          "For one token you'll find its **Name**, its size in squares (from ½×½ up to 6×6), a colour for plain coloured tokens, status rings, **Rotate left ([)** and **Rotate right (])**, a button that makes it a prop that sits under characters, **Add to initiative**, **Duplicate (Ctrl+D)**, **Bring to front**, **Send to back** and **Delete (Del)**.",
          "To rename a token, type in the **Name** box, then press Enter or click somewhere else to save it. Press Esc to cancel what you typed.",
          "Each click of **Rotate left** or **Rotate right** turns the token 45°. On the keyboard, [ and ] do the same, and Shift+[ or Shift+] turns it 15°.",
          "Clicking **Add to initiative** for a token that's already in the turn order just opens the **Initiative** panel.",
          "GM only: the eye button hides a token from players or shows it again (H), and the padlock button locks it so players can't move it (L).",
          "For drawings and notes: a colour, **Edit note** for text notes, and (GM only) the eye button.",
          "Select several things and the bar shows how many, for example \"3 selected\" (or \"3 drawings\" when they're all drawings or notes), with the buttons that work on all of them.",
          "Shift+click adds something to the selection, or takes it out if it's already selected. Shift+drag on empty space draws a box to select everything inside it.",
          "The arrow keys move selected tokens one square. Delete or Backspace removes what's selected.",
          "You only see buttons for what you're allowed to change, and you can only delete things you're allowed to. Players only get **Duplicate** when the GM lets players add tokens."
        ]
      },
      {
        "title": "Moving around the map and zooming",
        "steps": [
          "With **Move & select**, drag an empty part of the map to move around.",
          "Scroll the mouse wheel to zoom in or out at the spot under your pointer.",
          "Use the zoom buttons in the bottom-right corner: **Zoom out (−)**, **Zoom in (+)** and **Fit the scene (0)**.",
          "Click the percentage between the zoom buttons to fit the whole scene on screen."
        ],
        "notes": [
          "With any tool, you can move around by dragging with the right (or middle) mouse button, or by holding Space and dragging.",
          "On a laptop trackpad, scroll with two fingers to move around and pinch to zoom.",
          "On the keyboard, + zooms in, − zooms out and 0 fits the scene.",
          "GM: in the Build tool's **Objects**, and in **Select** with objects selected, the wheel turns objects instead; zoom with **Ctrl** and the wheel."
        ]
      },
      {
        "title": "Pop-up messages",
        "steps": [
          "Read the message that pops up at the bottom left of the map.",
          "Click it to make it go away, or wait and it disappears by itself."
        ],
        "notes": [
          "Error messages stay up a little longer than other messages.",
          "New chat messages and dice rolls pop up here while the **Chat & dice** panel is closed."
        ]
      },
      {
        "title": "GM: \"Only you can see this scene\"",
        "steps": [
          "When you look at a scene the players aren't on, read the banner across the map. It says \"Only you can see this scene.\" and names the scene the players are on.",
          "Click **Show to players** to move everyone to the scene you're looking at.",
          "Or click **Back to live scene** to return to the scene the players can see."
        ],
        "notes": [
          "Players only ever get the scene you've shown them. A scene you're previewing is never sent to them.",
          "In the **Scenes** panel, the players' scene is tagged \"Players see this\" and the one you're looking at is marked \"Previewing\".",
          "The banner sits at the top of the map (just below a tool's options bar, when one is showing), and near the bottom on a phone."
        ]
      },
      {
        "title": "\"Connection lost. Reconnecting…\"",
        "steps": [
          "If you see \"Connection lost. Reconnecting…\" near the top of the map, wait. Tabletop keeps trying to reconnect by itself.",
          "Keep playing if you like. Changes you make meanwhile are sent as soon as the connection is back.",
          "If the message doesn't go away, check your Wi-Fi or mobile data.",
          "If it still won't reconnect, reload the page."
        ],
        "notes": [
          "It tries again quickly at first, then about every 10 seconds.",
          "Coming back to the tab, or your device getting its connection back, makes it try again straight away.",
          "Nothing gets applied twice when it reconnects.",
          "Changes waiting to be sent are only kept while the page stays open, so reloading throws them away. Reload only if waiting doesn't help.",
          "When you first open a room it says \"Joining the room…\" while the room loads. A big room on a slow connection can take a little while."
        ]
      }
    ]
  },
  {
    "id": "phone-and-tablet",
    "title": "Using a phone or tablet",
    "audience": "everyone",
    "intro": "Tabletop works in the web browser on phones and tablets too. The map works with touch, and the screen rearranges itself to fit.",
    "parts": [
      {
        "title": "Touch controls",
        "steps": [
          "Tap a token to select it.",
          "Drag a token to move it, if you're allowed to.",
          "With **Move & select**, drag an empty part of the map with one finger to move around.",
          "Pinch with two fingers to zoom in and out.",
          "Move two fingers together to slide the map, whatever tool you've picked.",
          "Tap an empty part of the map when you're done with a selection."
        ],
        "notes": [
          "With **Draw**, the **Eraser**, **Measure**, **Pointer**, or (GM) **Fog of war** or **Build the map** picked, one finger uses the tool. Use two fingers to move around, or switch back to **Move & select**.",
          "The zoom buttons work on touch screens too.",
          "Selecting several things at once needs Shift+click or Shift+drag, so it needs a keyboard."
        ]
      },
      {
        "title": "How the screen changes on a small screen",
        "steps": [
          "Tap a panel button in the top bar. The panel opens on top of the map.",
          "Tap the **X** (**Close**) at the top of the panel to see the map again."
        ],
        "notes": [
          "On narrow screens, the coloured circles showing who's here and the **Help & shortcuts** button are hidden to save space (for the GM, so is **Table display**). You can still see who's here at the top of the **Chat & dice** panel.",
          "The zoom buttons move to the top-right corner (or the bottom right while a tool's options are showing), and the percentage is hidden.",
          "The selection bar becomes a single row. Swipe it sideways to reach more buttons.",
          "With a phone held sideways, the toolbar scrolls if it doesn't fit.",
          "**Chat & dice** doesn't open by itself on smaller screens. Tap its button when you want it."
        ]
      }
    ]
  },
  {
    "id": "tokens",
    "title": "Tokens",
    "audience": "everyone",
    "intro": "Tokens are the markers for characters, monsters and objects on the map. A plain coloured token is a circle. A picture token shows the picture in its own shape. You can add either kind, then move them, name them, size them and mark them with status rings.",
    "parts": [
      {
        "title": "Add a quick coloured token",
        "steps": [
          "Click the **Tokens & images** button (the pictures icon) in the top bar.",
          "Under **Quick token**, type a name in the **Name (optional)** box, if you want one.",
          "Click one of the coloured circles."
        ],
        "notes": [
          "The token appears in the middle of your view, on the nearest square that doesn't already have a token on it. It starts one square in size.",
          "A coloured token shows the first letters of its name, with the full name underneath.",
          "The name box empties after each quick token, ready for the next name.",
          "The new token is selected straight away and the **Move & select** tool is switched on, so you can drag it at once.",
          "If the GM has turned off adding tokens for players, the panel only says **The GM has turned off adding tokens for players.**"
        ]
      },
      {
        "title": "Upload pictures for tokens",
        "steps": [
          "Click **Tokens & images** in the top bar.",
          "If you're the GM, make sure the **Tokens** tab is chosen. (Players see **Your images** here instead.)",
          "Click **Upload**.",
          "Choose one or more picture files.",
          "Click a picture in the list to place it in the middle of your view, or drag it onto the map and let go where you want it."
        ],
        "notes": [
          "Uploading only adds pictures to the list. Nothing appears on the map until you click or drag one.",
          "While files are uploading, the button shows how many are still going.",
          "If you've typed something in the **Name (optional)** box, a picture you click gets that name (a picture you drag in doesn't). The name stays in the box, so every picture you click gets it until you clear the box.",
          "The picture keeps its shape and is fitted inside the token's square. If it has a name, the name is shown underneath.",
          "Players only see the pictures they uploaded themselves, and can have up to 100. After that they see **You've uploaded as many images as a player can. Delete some of yours first.**",
          "GM: your **Tokens** tab also lists the pictures players have uploaded.",
          "The GM's **Maps** tab holds map pictures. You use those from the **Scenes** panel."
        ]
      },
      {
        "title": "Rename or delete a picture",
        "steps": [
          "In the **Tokens & images** list, point at the picture. Two small buttons appear in its top-right corner.",
          "Click **Rename** (the pencil).",
          "Type the new name in the **Rename image** window.",
          "Click **Rename**."
        ],
        "notes": [
          "On a phone or tablet, the two buttons are always showing.",
          "Each uploaded picture starts out named after its file.",
          "To delete a picture, click **Delete** (the bin). You're asked **Delete image?** first, and then it's removed for good.",
          "The warning says anything using the picture will show a blank. On the map, a token that used it turns into a plain coloured circle showing the first letters of its name. A scene that used it as its map shows just its background.",
          "GM: you can rename or delete any picture, including the ones players uploaded. Players can only rename or delete their own."
        ]
      },
      {
        "title": "Drop or paste picture files onto the map",
        "steps": [
          "Drag one or more picture files from your computer onto the map.",
          "Let go where you want them."
        ],
        "notes": [
          "Each picture is uploaded and becomes a token where you let go. If you drop several, they're laid out in a row, one square apart.",
          "You can also copy a picture and press **Ctrl+V** with the map in front of you. It becomes a token in the middle of your view.",
          "GM: a big picture (1600 pixels or more along its longest side), a Dungeondraft or other Universal VTT file, or an Owlbear Rodeo backup opens the **New scene** window instead of making a token. Pictures dropped together with a Dungeondraft project file (.dungeondraft_map) all go to the **New scene** window, whatever their size, and the project file's data is attached to the new scene for exact seasons. A project file dropped on its own onto a scene whose picture could be its export opens the **Dungeondraft data** window for that scene; otherwise it waits in the **New scene** window for its export.",
          "If a player drops a map file (a Dungeondraft or other Universal VTT file, a Dungeondraft project file, or an Owlbear Rodeo backup), they see **Only the GM can add maps.** A big picture that a player drops or pastes simply becomes a token."
        ]
      },
      {
        "title": "Move a token",
        "steps": [
          "Choose the **Move & select** tool (the arrow in the toolbar on the left), or press **V**.",
          "Drag the token to where you want it.",
          "Let go. The token snaps into the square.",
          "To place a token between squares, hold **Alt** as you let go."
        ],
        "notes": [
          "Tokens only snap when the scene's **Snap tokens** box is ticked. The GM sets this in the **Scenes** panel, under **Grid**, and it's on by default.",
          "Everyone else looking at the same scene sees the token move while you drag it.",
          "To nudge a token one square, select it and press an arrow key. On a hex grid it moves to the next hex.",
          "Dragging empty map moves your view instead of a token.",
          "If you're a player and aren't allowed to move a token, dragging it moves the map instead.",
          "Players can't pick up anything that's under fog."
        ]
      },
      {
        "title": "Select several things and move them together",
        "steps": [
          "With **Move & select** on, click the first token.",
          "Hold **Shift** and click more tokens, drawings or notes to add them. Shift+click one again to take it out.",
          "Or hold **Shift** and drag a box, starting on empty map, to select everything inside it.",
          "Drag any of the selected tokens to move the whole group."
        ],
        "notes": [
          "The box picks up tokens whose centre is inside it, and drawings and notes that are completely inside it. If you already had something selected, the box adds to it.",
          "Tokens, drawings and notes all move together. The token you're holding snaps to the grid and everything else keeps its place around it. Tokens that were on the grid stay on the grid.",
          "Selected tokens get a dashed light-blue circle, and selected drawings glow light blue.",
          "To clear the selection, click empty map or press **Escape**.",
          "Arrow keys, rotating and duplicating work on every selected token at once."
        ]
      },
      {
        "title": "Change a token with the bar that appears",
        "steps": [
          "Click a token to select it. A bar with its settings appears at the bottom of the map.",
          "Type a name in the **Name** box.",
          "Press **Enter**, or click somewhere else, to save the name.",
          "Choose a size from the **Size in squares** list: ½×½, 1×1, 2×2, 3×3, 4×4 or 6×6.",
          "For a plain coloured token, click a colour dot to change its colour.",
          "Click one of the six hollow coloured rings to put that ring around the token. Click it again to take it off.",
          "Click **Rotate left** or **Rotate right** to turn the token 45 degrees.",
          "Click the armchair button, **Make it a prop (sits under characters)**, to make the token a prop.",
          "Click the crossed-swords button, **Add to initiative**, to put the token in the initiative list."
        ],
        "notes": [
          "Press **Escape** in the **Name** box to cancel a name change.",
          "A ring brightens when it's on. Pointing at the rings shows **Status rings**. The six colours are red, orange, green, blue, purple and white, and a token can wear several at once.",
          "Props, such as doors, chests or furniture, always sit underneath characters. Click the armchair again to turn a prop back into a character.",
          "**Add to initiative** adds the token with its name and a score of 0, then opens the **Initiative** panel. If the token is already there, it just opens the panel.",
          "Tokens with a picture don't have colour dots.",
          "If you're a player and aren't allowed to move a token, you can still click it to select it. Its name and size are greyed out and most buttons don't appear, but you can still click **Add to initiative**, and **Duplicate (Ctrl+D)** if the GM lets players add tokens."
        ]
      },
      {
        "title": "Duplicate, stack and delete",
        "steps": [
          "Select one or more tokens.",
          "To copy them, click **Duplicate (Ctrl+D)** (the two-pages button) or press **Ctrl+D**.",
          "To change which token is drawn on top, click **Bring to front** or **Send to back**.",
          "To remove the selection, click **Delete (Del)** (the bin) or press **Delete**."
        ],
        "notes": [
          "You can also erase tokens with the **Eraser** (**E**): drag it over them.",
          "Copies appear one square to the right and get numbered names: \"Goblin\" becomes \"Goblin 2\", then \"Goblin 3\", always one higher than the highest number already on the scene. Unnamed tokens stay unnamed.",
          "The copies are selected afterwards, so you can drag them straight away.",
          "When a player copies a GM's token, the copy is never hidden or locked.",
          "Props stay underneath characters even if you bring a prop to the front.",
          "If you delete something by mistake, press **Ctrl+Z** to undo it."
        ]
      },
      {
        "title": "Undo and redo",
        "steps": [
          "To take back your last change, click **Undo (Ctrl+Z)** or press **Ctrl+Z**.",
          "To put it back again, click **Redo (Ctrl+Shift+Z)** or press **Ctrl+Shift+Z**."
        ],
        "notes": [
          "The two buttons are the curved arrows at the bottom of the toolbar on the left.",
          "Undo only takes back your own changes on the scene you're looking at. The buttons are greyed out when there's nothing of yours to undo or redo there.",
          "Undo remembers up to 200 of your changes, and only in the browser tab where you made them. If you reload the page or close the tab, you can't undo them any more."
        ]
      }
    ]
  },
  {
    "id": "hide-and-lock-tokens",
    "title": "Hiding and locking tokens",
    "audience": "gm",
    "intro": "As the GM, you can keep tokens secret until the players find them, and fix tokens in place so players can't move them.",
    "parts": [
      {
        "title": "Hide a token from players",
        "steps": [
          "Select the token, or several tokens.",
          "Click the eye button (**Visible to players (H)**) or press **H**.",
          "To show the token again, click the crossed-out eye (**Hidden from players (H)**) or press **H** again."
        ],
        "notes": [
          "You see hidden tokens as see-through, with a dashed white ring. Players' browsers never receive them at all.",
          "Players can't see a hidden token's initiative entry either.",
          "When several things are selected and at least one is a token, the button is called **Hide or show (H)**. If any of them are showing, it hides them all. If they're all hidden, it shows them all.",
          "If you've selected only drawings and notes, you get the drawing eye button instead (**Players can see this (H)** or **Only you can see this (H)**).",
          "When you switch on **Player view** in the fog tool, hidden tokens disappear, so you see exactly what the players see. **Player view** switches itself off when you choose another tool."
        ]
      },
      {
        "title": "Lock a token in place",
        "steps": [
          "Select the token.",
          "Click the open padlock (**Unlocked (L)**) or press **L**.",
          "To unlock it, click the closed padlock (**Locked: players can't move it (L)**) or press **L** again."
        ],
        "notes": [
          "Players can't move, change or delete a locked token, but you still can.",
          "With several tokens selected, the button is called **Lock or unlock (L)**.",
          "A player who's allowed to add tokens can still copy a locked token. The copy isn't locked and belongs to that player, so they can move and delete it."
        ]
      }
    ]
  },
  {
    "id": "player-permissions",
    "title": "What players are allowed to do",
    "audience": "everyone",
    "intro": "The GM decides whether players can add tokens, move other people's tokens and draw. The GM can always do everything.",
    "parts": [
      {
        "title": "Change what players can do (GM)",
        "steps": [
          "Click **Room settings** (the gear) in the top bar.",
          "Under **What players can do**, tick or untick **Add tokens and upload token images**.",
          "Tick or untick **Move any unlocked token (off: only the ones they placed)**.",
          "Tick or untick **Draw on the map**."
        ],
        "notes": [
          "All three are ticked in a new room."
        ]
      },
      {
        "title": "The rules for players",
        "steps": [],
        "notes": [
          "Adding tokens, uploading token pictures and duplicating tokens only work when **Add tokens and upload token images** is ticked.",
          "With it unticked, your **Tokens & images** panel only shows **The GM has turned off adding tokens for players.**, so you can't use pictures you uploaded before either. Dropping or pasting a picture shows an error instead of adding a token.",
          "With **Move any unlocked token** ticked, you can move and change any token that isn't locked or hidden. With it unticked, you can only move and change the tokens you placed.",
          "You can only delete tokens you placed yourself, and never locked ones.",
          "Only the GM can hide or lock things.",
          "Drawing, adding notes and pinning spell areas only work when **Draw on the map** is ticked. Otherwise you'll see **The GM has turned drawing off.** (or, when you pin a spell area, **The GM has turned drawing off, so templates can't be pinned.**).",
          "You can only move, recolour, edit or erase your own drawings and notes. You can still do this after the GM turns drawing off.",
          "Anyone can measure and use the pointer, whatever the settings.",
          "Your tokens, drawings, notes and uploaded pictures belong to the browser you joined from. If you join from a different device or browser, or clear this site's data, the app treats you as a new player. You can't move or delete your old things (though you can still move your old tokens if **Move any unlocked token** is ticked), and your old pictures won't show under **Your images**."
        ]
      }
    ]
  },
  {
    "id": "drawing-and-notes",
    "title": "Drawing and notes",
    "audience": "everyone",
    "intro": "Draw on the map to sketch a route, circle a trap or label a room. Everyone looking at that scene sees your drawings and notes as soon as you make them, except the GM's secret ones. Players only ever see the scene the GM is showing them.",
    "parts": [
      {
        "title": "Draw a shape",
        "steps": [
          "Click **Draw** (the pencil) in the toolbar, or press **D**.",
          "In the bar that appears, pick a shape: **Freehand**, **Line**, **Rectangle** or **Ellipse**.",
          "Click a colour, or click the last circle (**Pick any colour**) to choose any colour you like.",
          "Pick a line width: 2, 4, 8 or 16 px.",
          "For a rectangle or ellipse, tick **Fill** if you want it shaded inside.",
          "Drag on the map to draw."
        ],
        "notes": [
          "You start with **Freehand**, in your own colour, 4 px wide.",
          "The width is how thick the line looks at your current zoom. A line drawn while zoomed out is thicker on the map.",
          "**Fill** adds a see-through shade of the same colour.",
          "Tiny shapes you make by accident are ignored. A single click with **Freehand** leaves a dot.",
          "Drawings sit underneath tokens."
        ]
      },
      {
        "title": "Add a text note",
        "steps": [
          "Click **Draw**, or press **D**.",
          "Click the **T** button (**Text note: click where it goes**).",
          "Pick a colour.",
          "Pick a line width. A bigger width gives bigger text.",
          "Click the map where you want the note. That spot becomes the note's top-left corner.",
          "Type your note in the **Text** box.",
          "Press **Enter**, or click **Add note**."
        ],
        "notes": [
          "Press **Shift+Enter** to start a new line.",
          "A note can be up to 500 characters.",
          "The text is sized to look right at your current zoom.",
          "If you drag instead of clicking, the map moves and no note is added.",
          "To close the window without adding anything, click **Cancel** or press **Escape**. Clicking outside the window also closes it and throws away what you typed."
        ]
      },
      {
        "title": "Edit a note or change a drawing's colour",
        "steps": [
          "Choose **Move & select**, or press **V**.",
          "Click the note to select it.",
          "Click **Edit note** in the bar.",
          "Change the text.",
          "Click **Save**."
        ],
        "notes": [
          "To change the colour, select only drawings or notes (no tokens) and click one of the eight colours in the bar. The rainbow **Pick any colour** circle is only in the **Draw** bar, not here.",
          "The same bar has **Bring to front**, **Send to back** and **Delete (Del)**.",
          "Players can only edit their own notes. For anyone else's, the bar just says **Note**."
        ]
      },
      {
        "title": "Move drawings and notes",
        "steps": [
          "With **Move & select** on, click the drawing or note once to select it.",
          "Drag it to its new place."
        ],
        "notes": [
          "A drawing only moves once it's selected, so dragging across a big drawing moves the map instead of grabbing it.",
          "Shift+click tokens as well to move tokens and drawings together."
        ]
      },
      {
        "title": "Erase drawings and tokens",
        "steps": [
          "Click the **Eraser** in the toolbar, or press **E**.",
          "Drag over the drawings, notes or tokens you want to get rid of."
        ],
        "notes": [
          "The eraser removes whole drawings, notes, pinned spell areas and tokens. It never touches fog.",
          "Locked tokens aren't erased; you'll see a message saying so. Unlock one first (select it, then the lock button or **L**) if you really want it gone.",
          "Players can only erase their own drawings and their own unlocked tokens.",
          "Each drag is one step for **Undo**, which brings everything back.",
          "You can also select something and press **Delete**."
        ]
      },
      {
        "title": "Clear all drawings at once",
        "steps": [
          "Click the **Eraser**, or press **E**.",
          "In the eraser's bar, click **Clear all drawings** (GM) or **Clear my drawings** (player).",
          "Click **Clear** to confirm."
        ],
        "notes": [
          "It only clears the scene you're looking at.",
          "**Undo** brings the drawings back."
        ]
      }
    ]
  },
  {
    "id": "gm-only-notes",
    "title": "Notes and drawings only you can see",
    "audience": "gm",
    "intro": "As the GM, you can put private reminders on the map, such as a trap, a secret door or a monster's hit points, that players never see.",
    "parts": [
      {
        "title": "Add a secret note",
        "steps": [
          "Click **Draw**, then the **T** button.",
          "Click the map where you want the note.",
          "Type the note.",
          "Tick **Only I can see this note**.",
          "Press **Enter**, or click **Add note**."
        ],
        "notes": [
          "Players never receive the note.",
          "You see secret notes and drawings as see-through. They disappear when you switch on **Player view** in the fog tool.",
          "The tick box only appears when you add a new note."
        ]
      },
      {
        "title": "Hide or show a note or drawing later",
        "steps": [
          "Select the note or drawing.",
          "Click the eye button in the bar, or press **H**."
        ],
        "notes": [
          "The button shows how it's set now: **Players can see this (H)** or **Only you can see this (H)**.",
          "This works for any drawing or pinned spell area, not just notes."
        ]
      }
    ]
  },
  {
    "id": "measuring",
    "title": "Measuring distances and spell areas",
    "audience": "everyone",
    "intro": "Use the Measure tool to check how far something is, or to show exactly what a spell covers. Everyone looking at the same scene sees it as you drag.",
    "parts": [
      {
        "title": "Measure a distance",
        "steps": [
          "Click **Measure** (the ruler) in the toolbar, or press **M**.",
          "Choose **Ruler** in the bar that appears.",
          "Drag from the starting point to where you want to go.",
          "Read the distance on the label at the end, for example \"30 ft\".",
          "Let go to clear the ruler."
        ],
        "notes": [
          "When the scene's **Snap tokens** box is ticked (in the **Scenes** panel, under **Grid**), the ruler runs from the centre of one square to the centre of another. With it unticked, the ruler measures from exactly where you press.",
          "The bar tells you how distance is counted, for example: One square is 5 ft; diagonals count as one square.",
          "Depending on how the GM has set up the scene, diagonals count as one square, alternate one and two squares, or use straight-line distance. On hex grids, distance is always counted in hexes.",
          "GM: you set this in the **Scenes** panel, under **Distance**. Set **One square is** (5 to start with), **Unit** (ft) and **Diagonals**: **Count as one square (D&D 5e)**, **Alternate 1, 2, 1 (Pathfinder)** or **Straight-line distance**."
        ]
      },
      {
        "title": "Show a spell area",
        "steps": [
          "Click **Measure**, or press **M**.",
          "Pick a shape: **Circle (radius from a point)**, **Cone**, **Cube** or **Line (one square wide)**.",
          "Drag outwards from where the spell starts.",
          "Read the size on the label, for example \"20 ft radius\" or \"15 ft cone\".",
          "Let go to clear it."
        ],
        "notes": [
          "A circle is centred where you start dragging. A cone is as wide at its far end as it is long. A cube grows from the corner where you start. A line is one square wide.",
          "When **Snap tokens** is ticked, areas start on a grid corner and grow a whole square at a time. With it unticked, they start exactly where you press, and sizes aren't rounded to whole squares."
        ]
      },
      {
        "title": "Leave a spell area on the map",
        "steps": [
          "Pick one of the spell shapes.",
          "Tick **Pin to map**.",
          "Drag out the area.",
          "Let go. The area stays on the map."
        ],
        "notes": [
          "A pinned area becomes a shaded shape in your colour. You can select, move, recolour, erase or delete it like any drawing.",
          "**Pin to map** stays ticked until you untick it, and it isn't offered for the ruler.",
          "Players can only pin areas when drawing is allowed. Otherwise they see **The GM has turned drawing off, so templates can't be pinned.**"
        ]
      },
      {
        "title": "What everyone else sees",
        "steps": [],
        "notes": [
          "While you drag, everyone looking at the same scene sees your ruler or spell area in your colour, with its label.",
          "It disappears for everyone when you let go, unless you pinned it.",
          "If you hold a ruler or spell area still for more than about 8 seconds, it disappears for everyone else until you move it again.",
          "GM: if you're looking at a scene the players aren't on, they don't see your ruler, spell areas, pointer or token drags."
        ]
      }
    ]
  },
  {
    "id": "pointer",
    "title": "Pointing at things",
    "audience": "everyone",
    "intro": "The pointer works like a laser pointer. It draws a short glowing trail so you can show everyone where you mean.",
    "parts": [
      {
        "title": "Point at something",
        "steps": [
          "Click **Pointer** (the pointing hand) in the toolbar, or press **P**.",
          "Hold down the mouse button (or your finger) and drag over the map."
        ],
        "notes": [
          "The trail is in your colour and fades away in under a second. While you hold the button (or your finger) still, the pointer stays where it is.",
          "Everyone looking at the same scene sees it, including the table display, where it's drawn twice as big so the table can see it.",
          "The pointer doesn't leave anything behind on the map."
        ]
      },
      {
        "title": "Ping a spot",
        "steps": [
          "Click **Pointer** (the pointing hand) in the toolbar, or press **P**.",
          "Click (or tap) the spot, without dragging."
        ],
        "notes": [
          "Rings in your colour pulse there for a few seconds, on everyone's screen and on the table display, then fade.",
          "Each person has one ping at a time: a new one replaces your last."
        ]
      }
    ]
  },
  {
    "id": "dice-and-chat",
    "title": "Dice and chat",
    "audience": "everyone",
    "intro": "Everyone talks and rolls dice in the **Chat & dice** panel. The server makes every roll in the chat, not your browser, so nobody can fudge a result.",
    "parts": [
      {
        "title": "Open the chat",
        "steps": [
          "Click the speech-bubble button **Chat & dice** in the top bar.",
          "To close the panel, click **Chat & dice** again or click **Close** (the X) at the top of the panel."
        ],
        "notes": [
          "The row at the top of the panel shows who is in the room. The GM is marked **GM**.",
          "If the GM has a table display connected, it also shows up in that row as **Table display**.",
          "While the panel is closed, a number on the **Chat & dice** button counts new messages. Past 99 it shows 99+. Opening the panel clears the count."
        ]
      },
      {
        "title": "Send a message",
        "steps": [
          "Click the box that says **Message, or /r 2d6+3** at the bottom of the panel.",
          "Type your message.",
          "Press Enter or click **Send** (the paper-plane button)."
        ],
        "notes": [
          "A message can be up to 1000 characters long.",
          "Everyone sees plain messages. Only rolls can be private.",
          "When you join or reload, you see up to the last 150 messages you're allowed to see. The room keeps the latest 300."
        ]
      },
      {
        "title": "Quick rolls from the dice tray",
        "steps": [
          "If you have a bonus, type it in the small box that shows **+0**, for example `5` or `-1`.",
          "Click a die button: **d4**, **d6**, **d8**, **d10**, **d12**, **d20** or **d100**.",
          "Read the result in the chat."
        ],
        "notes": [
          "The bonus is added only to the quick rolls: the die buttons, **Advantage** and **Disadvantage**. It isn't added to rolls you type.",
          "Hover over a die button to see exactly what it will roll, for example \"Roll 1d20+5\".",
          "The box takes a whole number of up to four digits, with or without a + or - in front. If you type anything else, the app ignores it and rolls with no bonus.",
          "The bonus stays in the box while the **Chat & dice** panel is open. If you close the panel or open a different panel, the box empties, so type your bonus again next time."
        ]
      },
      {
        "title": "Advantage and disadvantage",
        "steps": [
          "If you have a bonus, type it in the **+0** box.",
          "Click **Advantage** to roll two d20s and keep the higher one, or click **Disadvantage** to keep the lower one."
        ],
        "notes": [
          "The d20 that didn't count is shown faded and crossed out."
        ]
      },
      {
        "title": "Private rolls",
        "steps": [
          "Tick **To GM** in the dice tray. If you're the GM, this box is called **Hidden** instead.",
          "Make your roll as usual: a die button, **Advantage**, **Disadvantage**, or a roll you type.",
          "When you want everyone to see your rolls again, untick the box."
        ],
        "notes": [
          "When a player rolls with **To GM** ticked, only that player and the GM see the roll. Other players never receive it.",
          "When the GM rolls with **Hidden** ticked, only the GM sees it. The box's tooltip says **Only you see the result**. Players never receive it.",
          "The chat marks private rolls **private** and shades them. They stay private after a reload, and people who join later don't see them either.",
          "The box only stays ticked while the **Chat & dice** panel stays open. If you close the panel or open a different panel, the box unticks itself and your next roll is public. Check the box every time you open the panel to make a private roll."
        ]
      },
      {
        "title": "Type a roll",
        "steps": [
          "Click the message box.",
          "Type `/r` (or `/roll`), a space, and the dice, for example `/r 2d6+3`.",
          "Press Enter."
        ],
        "notes": [
          "You can also type just the dice (for example `3d8+2`) and click the dice button next to the message box. Its tooltip says **Roll what's typed as dice (e.g. 3d8+2)**.",
          "Typed rolls follow the **To GM** or **Hidden** box, but the bonus in the **+0** box isn't added. Include your bonus in what you type.",
          "If the app can't read your roll, a pop-up tells you why (for example \"At most 100 dice at once\") and nothing is rolled.",
          "The message box empties as soon as you press Enter or click the dice button, even if the roll didn't work. Type the roll again after fixing it."
        ]
      },
      {
        "title": "Dice you can type",
        "steps": [],
        "notes": [
          "`d20`: one twenty-sided die. For a single die, you can leave out the number in front.",
          "`2d6+3`: two six-sided dice plus 3. You can join up to 20 parts with + and -, for example `1d8+1d6-2`.",
          "`4d6dl1`: roll four d6 and drop the lowest one. `dh` drops the highest instead. A plain `d` means `dl`, so `4d6d1` is the same as `4d6dl1`.",
          "`2d20kh1`: roll two d20 and keep the highest one (advantage). `kl` keeps the lowest (disadvantage). A plain `k` means `kh`.",
          "If you leave out the number after `kh`, `kl`, `dh` or `dl`, the app uses 1. So `2d20kh` is the same as `2d20kh1`.",
          "You can't keep or drop more dice than you roll. For example, `2d20kh3` gives \"Can't keep or drop 3 of 2 dice\".",
          "`d%`: a percentile die, the same as `d100`.",
          "`4dF`: four Fudge (Fate) dice. Each one comes up +, - or 0 and counts +1, -1 or 0.",
          "Spaces and capital letters don't matter, so `2D6 + 3` works too.",
          "Limits: 100 dice in one part, 200 dice in one roll, 20 parts, 1 to 1000 sides per die, plain numbers up to 100000, and 120 characters in total."
        ]
      },
      {
        "title": "Read a roll",
        "steps": [],
        "notes": [
          "The big number is the total. Next to it is the roll as the app read it, for example 1d20+5.",
          "Below the total, each die is shown. A die that rolled its highest face is green, and a 1 is red.",
          "Dropped dice, and dice that weren't kept, are faded and crossed out. They don't count toward the total.",
          "Hover over a die to see which part of the roll it belongs to, for example 4d6dl1."
        ]
      },
      {
        "title": "Pop-ups when the chat is closed",
        "steps": [
          "Close the **Chat & dice** panel or open a different panel.",
          "Watch the bottom left of the map. New rolls and messages pop up there.",
          "To dismiss a pop-up early, click it."
        ],
        "notes": [
          "A roll pop-up shows who rolled, the total and the roll. If the roll was private, it adds (private). It stays for about 6 seconds.",
          "A message pop-up shows the sender's name and the message for about 4 seconds.",
          "Up to five pop-ups show at once. When there are more, the oldest ones make way.",
          "Everything also goes into the chat, so you can open **Chat & dice** later to read it."
        ]
      },
      {
        "title": "Change your name or colour",
        "steps": [
          "Click **Change your name or colour** (the button with a person and a pen) at the top of the **Chat & dice** panel.",
          "Type a new name under **Your name**.",
          "Pick a colour under **Your colour**.",
          "Click **Save**."
        ],
        "notes": [
          "Names can be up to 32 characters.",
          "Everyone's player list updates straight away.",
          "This browser remembers your new name and colour for next time.",
          "Messages you've already sent keep your old name, and initiative entries keep the colour they had when they were added."
        ]
      }
    ]
  },
  {
    "id": "initiative",
    "title": "Initiative",
    "audience": "everyone",
    "intro": "The **Initiative** panel keeps track of turn order in a fight. Anyone at the table can add people, edit the list and move the turn along. Only the GM can end combat.",
    "parts": [
      {
        "title": "Open the initiative list",
        "steps": [
          "Click the crossed-swords button **Initiative** in the top bar."
        ],
        "notes": [
          "Everyone sees the same list, except for hidden creatures (explained below). The list is still there next session.",
          "If two people add someone at the same moment, both entries are kept."
        ]
      },
      {
        "title": "Add someone by name",
        "steps": [
          "Type the name in the **Name** box at the bottom of the panel.",
          "Type their initiative in the **#** box, or click the dice button (**Roll a d20**) to fill in a random number from 1 to 20.",
          "Click **Add** (the plus button) or press Enter."
        ],
        "notes": [
          "**Roll a d20** only fills in the box. It doesn't add a bonus and doesn't post anything in the chat, so add your bonus to the number yourself before you click **Add**.",
          "Unlike rolls in the chat, the **Roll a d20** number is picked in your own browser, not by the server.",
          "If you leave the **#** box empty, the entry gets 0.",
          "The entry takes your colour.",
          "The list sorts itself with the highest number first. Equal numbers stay in the order they were added.",
          "Names can be up to 40 characters.",
          "The list holds up to 100 entries. After that, adding someone shows \"That initiative change wasn't allowed.\""
        ]
      },
      {
        "title": "Add tokens from the map",
        "steps": [
          "Click a token on the map to select it. To select more than one, Shift+click the others.",
          "In the **Initiative** panel, click **Add selected token**. With several tokens selected, the button says, for example, **Add 3 selected tokens**.",
          "Click the new entry's number. It starts at 0.",
          "Type its initiative.",
          "Press Enter."
        ],
        "notes": [
          "The entry uses the token's name (or \"Token\" if the token has no name) and the token's colour.",
          "Tokens that are already in the list are skipped. The button only shows up when at least one selected token isn't in the list yet.",
          "A quicker way for one token: click the token, then click **Add to initiative** (the crossed-swords button) on the bar that appears at the bottom of the map. The token joins the list at 0 and the **Initiative** panel opens. If the token is already in the list, the button just opens the panel. Anyone can use it."
        ]
      },
      {
        "title": "Change or remove an entry",
        "steps": [
          "Click the name or the number on someone's row.",
          "Type the change.",
          "Press Enter or click somewhere else to save it. Press Escape to cancel instead.",
          "To take someone out of the list, click **Remove** (the X) on their row."
        ],
        "notes": [
          "When a number changes, the list sorts itself again and the turn stays with the same person.",
          "If you remove the person whose turn it is, the turn passes to the next person. If they were last in the list, a new round starts."
        ]
      },
      {
        "title": "Take turns",
        "steps": [
          "When someone finishes their turn, click **Next turn**. The row whose turn it is gets highlighted.",
          "If you went too far, click **Previous turn** (the left arrow) to step back."
        ],
        "notes": [
          "**Round** at the top counts the rounds. After the last person, the turn goes back to the top of the list and the round number goes up by one.",
          "If you step back from the first person, the turn goes to the last person of the previous round. The round never drops below 1.",
          "Anyone can use these buttons, players included. If two people click **Next turn** at the same moment, the turn only moves once.",
          "When you click **Next turn** or **Previous turn** and the turn lands on a token, the app selects that token and moves your map to it, as long as the token is on the scene you're looking at. This only happens on the screen of the person who clicked."
        ]
      },
      {
        "title": "End combat (GM only)",
        "steps": [
          "Click **End combat** at the bottom of the **Initiative** panel.",
          "In the **End combat?** box, click **End combat** to confirm, or click **Cancel** to keep the list."
        ],
        "notes": [
          "This clears the whole list and sets **Round** back to 1.",
          "Only the GM sees this button. Players can remove entries one at a time, but they can't end combat."
        ]
      },
      {
        "title": "Hidden creatures (GM)",
        "steps": [
          "Select the creature's token on the map.",
          "Press H to hide it.",
          "With the token still selected, click **Add selected token** in the **Initiative** panel.",
          "Click the new entry's number.",
          "Type the creature's initiative.",
          "Press Enter."
        ],
        "notes": [
          "Players don't see entries for tokens they can't see. That means hidden tokens, and tokens on a scene you haven't shown them.",
          "Your own list looks the same for hidden and visible entries. Nothing marks which ones players can't see, so keep track of which monsters you hid.",
          "Everyone sees an entry you add by typing a name, because it isn't linked to a token. To keep a monster secret, add it from its hidden token.",
          "When it's a hidden creature's turn, no row is highlighted for players. If they can see at least one entry, they also see the line \"It's the turn of someone you can't see.\"",
          "Players can still click **Next turn** to move past the hidden creature. They can't edit or remove entries they can't see.",
          "If every entry in the list is hidden from players, their list looks empty and their **Next turn** and **Previous turn** buttons are greyed out.",
          "Players aren't sent any change you make to a hidden entry, so nothing gives it away.",
          "When you reveal the token, its entry appears in the players' list.",
          "If you delete a token that's in the list, its entry stays in your list but players stop seeing it. To take it out, click **Remove** (the X) on its row."
        ]
      }
    ]
  },
  {
    "id": "undo-redo",
    "title": "Undo and redo",
    "audience": "everyone",
    "intro": "**Undo** and **Redo** take back your own changes on the scene you're looking at, not other people's. If someone else changed the same thing after you (say, moved the same token again), undoing your change still puts it back the way it was before your change.",
    "parts": [
      {
        "title": "Undo and redo",
        "steps": [
          "To undo, click **Undo** (the curved arrow pointing left, below the tool buttons in the toolbar at the top left of the map) or press Ctrl+Z.",
          "To redo, click **Redo** (the arrow pointing right) or press Ctrl+Shift+Z. Ctrl+Y also works."
        ],
        "notes": [
          "On a Mac, use Cmd instead of Ctrl.",
          "The buttons are greyed out when there's nothing on this scene to undo or redo.",
          "The keys don't work while you're typing in a box or while a dialog is open.",
          "The app remembers your last 200 changes, counting all scenes together. Anything older can't be undone.",
          "If you undo something and then make a new change, you can't redo the steps you undid."
        ]
      },
      {
        "title": "What undo covers",
        "steps": [],
        "notes": [
          "Undo covers your changes to tokens, drawings and notes on the map: adding, moving, changing, hiding, locking, duplicating and deleting them. Changes to a note's text count too.",
          "Spell templates you pin to the map can be undone.",
          "For fog, each brush stroke, rectangle, polygon and lasso shape is one undo step. **Cover all** and **Clear all** are one step each.",
          "**Clear all drawings** (GM) and **Clear my drawings** can be undone as well.",
          "GM: giving a scene a different map counts as one undo step. **Undo** brings back the old map and its fog. Other scene changes, such as its name or grid, can't be undone.",
          "Undo doesn't cover chat messages and rolls, the initiative list, room settings, or scenes brought in from a backup or an Owlbear Rodeo file.",
          "Each scene keeps its own undo history. If you switch to another scene, **Undo** works on that scene. When you come back, you can still undo your earlier changes there, as long as they're among your last 200.",
          "Deleting a scene throws away its undo history.",
          "Your undo history only lasts while the page is open. If you reload the page, it starts fresh."
        ]
      }
    ]
  },
  {
    "id": "gm-sign-in",
    "title": "Signing in as the GM",
    "audience": "gm",
    "intro": "Only the GM signs in. Signing in lets you create rooms and gives you the GM's controls inside them. Players never need an account.",
    "parts": [
      {
        "title": "Sign in with Google",
        "steps": [
          "Go to table.parhome.ca.",
          "In the **GM sign in** box, click **Sign in with Google**.",
          "On Google's page, choose the Google account the GM uses.",
          "If Google shows a page of its own before sending you back, such as a warning that it hasn't verified the app, follow Google's prompts to carry on (see the next part).",
          "You come back to Tabletop, which now shows **Your rooms** and \"Signed in as the GM.\""
        ],
        "notes": [
          "Google asks you to choose an account every time, so you can pick the right one if you have more than one.",
          "Only the Google accounts on this table's GM list can sign in. Any other account gets a message instead, and nothing changes.",
          "Finish signing in within 10 minutes of clicking **Sign in with Google**, or you'll be asked to try again.",
          "If you click **Sign in with Google** again elsewhere in the same browser (in another tab, say) before you finish, only the newest attempt works.",
          "You stay signed in on that browser for 30 days, or until you click **Sign out**.",
          "If an address is taken off the GM list, that account stops being the GM even if it was already signed in. The start page, and any room it opens after that, treat it as a player. A room it already has open keeps the GM's controls until that page is reloaded or reconnects.",
          "The **Sign in with Google** button only appears once Google sign-in has been set up for the table."
        ]
      },
      {
        "title": "If Google shows a page of its own",
        "steps": [
          "Check that the page appeared straight after you clicked **Sign in with Google** on Tabletop.",
          "Follow Google's prompts to carry on.",
          "Finish signing in as normal."
        ],
        "notes": [
          "A page like this, for example a warning that Google hasn't verified the app, belongs to Google, not Tabletop.",
          "Tabletop only asks Google for your email address, so it can check that you're on the GM list."
        ]
      },
      {
        "title": "Sign in with the GM password",
        "steps": [
          "Go to table.parhome.ca.",
          "In the **GM sign in** box, type the password into the **GM password** box.",
          "Click **Sign in**, or press Enter."
        ],
        "notes": [
          "This option only appears if the table has a GM password. When Google sign-in is also set up, the password box is under the words \"or with the GM password\".",
          "**Sign in** stays greyed out until you've typed a password.",
          "\"Wrong password.\" means just that. Check Caps Lock and try again.",
          "After 10 wrong guesses from your connection, you'll see \"Too many wrong passwords. Try again in 15 minutes.\" The 15 minutes count from your first wrong guess. Wait, then try again.",
          "A successful sign-in clears your wrong guesses.",
          "You can also see \"Too many wrong passwords. Try again in 15 minutes.\" without typing a wrong password yourself, if lots of wrong passwords have been tried from elsewhere in the last 15 minutes. A connection you've signed in from in the last 90 days isn't blocked by this. Wait it out, or use **Sign in with Google**.",
          "Being locked out of password sign-in doesn't affect **Sign in with Google**. If it's set up, you can use it straight away.",
          "A password sign-in also lasts 30 days on that browser. If the password is changed, everyone signed in with the old one is signed out."
        ]
      },
      {
        "title": "What the sign-in messages mean",
        "steps": [
          "Read the message that appears under the sign-in buttons.",
          "Find it in the list below and do what it says."
        ],
        "notes": [
          "\"That Google account isn't one of this table's GMs. Try again and pick the account the GM uses.\": you chose a Google account that isn't on the GM list. Click **Sign in with Google** again and choose the GM's account.",
          "\"Google sign-in was cancelled.\": you backed out on Google's page. Nothing is wrong; try again when you're ready.",
          "\"That sign-in took too long, or was started in another tab. Try again.\": you took more than 10 minutes, or you clicked **Sign in with Google** again elsewhere in this browser (in another tab, say) before finishing, so only the newest attempt works. Start again and finish within 10 minutes.",
          "\"That Google account's email address isn't verified with Google.\": Google hasn't confirmed that account's email address. Confirm it with Google, or use another GM account.",
          "\"Google sign-in didn't work. Try again in a moment.\": something went wrong while talking to Google. Wait a moment and try again.",
          "\"Google sign-in isn't set up on this server.\" or \"GM sign-in hasn't been set up on the server yet.\": sign-in isn't ready yet. Ask whoever runs the table.",
          "\"The GM password hasn't been set on the server yet.\": the password option isn't ready. Use **Sign in with Google**, or ask whoever runs the table.",
          "\"Couldn't reach the server. Check your connection.\": your device couldn't reach Tabletop. Check your internet, then try again. If this message fills the start page, click **Try again**."
        ]
      }
    ]
  },
  {
    "id": "gm-start-page",
    "title": "Your rooms: the GM's start page",
    "audience": "gm",
    "intro": "Once you're signed in, the start page lists your rooms. From here you make a new room, send its link to your players, delete old rooms and sign out.",
    "parts": [
      {
        "title": "Create a room",
        "steps": [
          "Type a name in the **New room** box, for example your campaign's name.",
          "Click **Create**. The new room opens straight away.",
          "If this is the first time you've opened a room in this browser, join it the same way players do (see \"Joining a game\")."
        ],
        "notes": [
          "If you leave the name empty, the room is called \"New room\". You can rename it later in **Room settings**.",
          "Room names can be up to 60 characters.",
          "A new room starts with one blank grid scene called \"Scene 1\", which players see as soon as they join.",
          "New rooms start with players allowed to add tokens, move any unlocked token, and draw on the map. To change that, open **Room settings** and untick the boxes under **What players can do**.",
          "Until you make your first room, the list says \"No rooms yet. Create one above.\""
        ]
      },
      {
        "title": "Open a room",
        "steps": [
          "Click the room's name in the list."
        ],
        "notes": [
          "Under each name you can see when you last opened it, for example \"Last opened 2 h ago\". Players joining don't change this.",
          "The room you opened most recently is at the top.",
          "Inside a room, click the house button at the top left (**All rooms**) to come back to this list."
        ]
      },
      {
        "title": "Send a room's link to your players",
        "steps": [
          "Find the room in the list.",
          "Click the copy button next to it (**Copy invite link**).",
          "Wait for the button to say **Copied**.",
          "Paste the link into your group chat, email or message."
        ],
        "notes": [
          "Anyone with the link can join as a player, so keep it within your group.",
          "A room link is the site's address, then /r/, then a 12-character code of letters and numbers.",
          "If **Copied** doesn't appear on the start page, your browser didn't allow the copy, and no message appears. Open the room, open **Room settings**, click in the **Invite link** box (it selects the whole link) and copy it yourself.",
          "You can also copy the link from inside the room: use the link button in the top bar, or **Invite link** and **Copy** in **Room settings**."
        ]
      },
      {
        "title": "Delete a room",
        "steps": [
          "Click the bin button next to the room (**Delete room**).",
          "Read the warning in the **Delete room?** box.",
          "Click **Delete room** to delete it, or **Cancel** to keep it."
        ],
        "notes": [
          "This can't be undone. The room's scenes, tokens, uploaded images and chat are deleted for good.",
          "Anyone still in the room is disconnected and sees **This room was deleted**.",
          "If you might want the maps and tokens again, open the room first and use **Download backup** in **Room settings**.",
          "You can also delete a room from inside it: open **Room settings**, click **Delete this room**, then click **Delete room**. You're taken back to the start page."
        ]
      },
      {
        "title": "Sign out",
        "steps": [
          "Click **Sign out** at the top right of the start page."
        ],
        "notes": [
          "You're back on the ordinary start page, the one players see.",
          "Signing out only affects the browser you're using. On a shared computer, always sign out: otherwise anyone using that browser has the GM's controls for up to 30 days.",
          "Signing out doesn't affect a room you already have open in another tab. That tab keeps the GM's controls until you reload it, so close or reload any room tabs too."
        ]
      }
    ]
  },
  {
    "id": "moving-from-owlbear-rodeo",
    "title": "Moving from Owlbear Rodeo",
    "audience": "gm",
    "intro": "You can bring your Owlbear Rodeo scenes over with their maps, grids, fog and tokens. First you export a backup file from Owlbear, then you add it here as new scenes.",
    "parts": [
      {
        "title": "Step 1: Export a backup from Owlbear Rodeo",
        "steps": [
          "Go to owlbear.rodeo and sign in.",
          "Open **Manage Storage**. Inside a room it's in the **Extras** menu at the bottom-left. You can also use the **Manage Storage** button on your **Profile** page.",
          "Click **Export Backup** (the cloud with a down arrow).",
          "Choose the collection your scenes are in.",
          "Tick every scene you want to bring over.",
          "Tick the map image each of those scenes uses.",
          "Tick any token images you want to bring along too.",
          "Click **Export**.",
          "Save the file it downloads. Its name ends in .ob2."
        ],
        "notes": [
          "Owlbear's screens change now and then; if a button looks different, look for **Manage Storage** and **Export Backup**.",
          "Ticking the scene isn't enough on its own. If you don't tick a scene's map image, that scene is skipped and the report asks you to export again with the map image ticked.",
          "Tokens whose pictures you didn't tick are left out. The report tells you how many were left out.",
          "If you tick a map image but not its scene, it still comes over as a scene of its own. It uses the grid size Owlbear saved for that map, always as squares. It has no fog and no tokens."
        ]
      },
      {
        "title": "Step 2: Add the backup to Tabletop",
        "steps": [
          "Open your room while signed in as the GM.",
          "Click the **Scenes** button in the top bar (the stack-of-layers icon).",
          "Click **New scene**.",
          "Make sure **Upload a map** is selected.",
          "Drag your .ob2 file onto the **Choose or drop maps** box, or click the box and pick the file.",
          "Wait while it reads the file and uploads the maps and token pictures. The box shows how far it has got.",
          "Read the **Maps brought in** report (see below).",
          "Click **Done**. The scene editor opens on the first new scene so you can check its grid."
        ],
        "notes": [
          "Anything you type in **Name** is ignored. Each scene keeps its name from Owlbear.",
          "**Start with the map covered in fog** makes no difference here, because each scene's fog comes from Owlbear.",
          "You can choose several .ob2 files at once.",
          "You can also drop the .ob2 file straight onto the map in your room. That opens the same **New scene** window and starts right away. In that case **Done** opens the **Scenes** list instead of the scene editor, so open the editor yourself with the pencil button.",
          "New scenes go to the bottom of the scene list. Players can't see them until you show them one (see Scenes below).",
          "Very large maps are shrunk to 6144 pixels on their longest side. Fog and tokens are scaled to match.",
          "Owlbear backups go in through **New scene**. The **Restore…** button in **Room settings** is only for Tabletop's own backups."
        ]
      },
      {
        "title": "What the \"Maps brought in\" report means",
        "steps": [
          "Read the first line. It names each new scene.",
          "Check what it says about the grid.",
          "If a grid was guessed, line it up with **Edit scene** (see The scene editor below).",
          "If there's a **Left out:** list, read it to see what didn't come over.",
          "Click **Done**."
        ],
        "notes": [
          "With one scene the report says **Its grid came from the file.** or **Its grid was guessed: check it with Edit scene.** With several it says **Their grids came from the files.** or how many of them **had their grid in the file**.",
          "For every Owlbear backup the report adds \"Fog and tokens from Owlbear came too.\"",
          "\"… has 2 map images; only the biggest was brought in.\" In Owlbear the scene had more than one map image. Only the largest one came over.",
          "\"… its map image isn't in the file.\" You didn't tick the scene's map image when you exported. Export again with it ticked.",
          "\"… has a video map, which can't be used here.\" Animated (video) maps are skipped.",
          "\"… has no map image, so it wasn't brought in.\" A scene with no map is skipped.",
          "\"… uses an isometric grid, which isn't supported: it has a square grid here for now.\" That scene gets a square grid, and its size is guessed. Line it up with **Edit scene**.",
          "\"… the map is rotated or stretched in Owlbear, so its grid was guessed.\" The scene gets a square grid, even if it had hexes in Owlbear. Line it up with **Edit scene**, and pick a hex grid there if you need one.",
          "\"… tokens left out because their images weren't in the file.\" Export again with those token images ticked, or add those tokens yourself.",
          "\"… drawings and text items weren't brought in.\" Owlbear drawings, text and notes stay behind.",
          "\"… has more fog shapes and tokens than a scene can hold; some were left out.\" A scene can hold 5,000 fog shapes and tokens in total.",
          "If nothing at all could be brought in, you get messages with a red border at the bottom-left of the map instead of the report, and the **New scene** window stays open. The messages disappear after a few seconds, or you can click one to close it."
        ]
      },
      {
        "title": "What comes over, and what doesn't",
        "steps": [],
        "notes": [
          "Comes over: the map image. If a scene has several, only the biggest comes over.",
          "Comes over: the grid, as squares or hexes, the same size and lined up the same way as in Owlbear. The exception is an isometric grid, or a map that was rotated or stretched in Owlbear. Those get a square grid with a guessed size, and the report tells you so. Line them up with **Edit scene**.",
          "Comes over: the fog. That includes whether the scene started fully covered, plus every fog shape you added and every cut you made.",
          "Comes over: tokens (characters, mounts and props) whose pictures were in the backup. They keep their place, size, turn and name.",
          "Tokens keep their layer order: props sit under characters, and mounts come over as ordinary tokens.",
          "Tokens that were hidden in Owlbear stay hidden from players. Locked tokens stay locked.",
          "The token pictures are also added to the **Tokens & images** panel.",
          "Doesn't come over: drawings, text and notes.",
          "Doesn't come over: walls and lights.",
          "Doesn't come over: tokens whose pictures you didn't tick when you exported.",
          "Doesn't come over: video maps.",
          "Distance settings aren't read from Owlbear. Every scene starts with one square being 5 ft and diagonals counted the D&D 5e way. You can change this in **Edit scene**.",
          "Grid display settings aren't read from Owlbear either. Every scene starts with the grid lines showing (faint black) and tokens snapping to the grid. Change these under **Grid** in **Edit scene**."
        ]
      },
      {
        "title": "Check each scene afterwards",
        "steps": [
          "In **Scenes**, click the pencil button on the scene (**Edit scene and grid**).",
          "Check that the grid lines sit on the map's printed squares. If they don't, fix them (see The scene editor below).",
          "Click **Done**.",
          "Pick the **Fog of war** tool on the toolbar, or press F.",
          "Click **Player view**.",
          "Check that the right areas are covered and uncovered, and that hidden tokens have disappeared.",
          "Click **Player view** again to go back to your normal view."
        ],
        "notes": [
          "As the GM you normally see fog half see-through, and hidden tokens half see-through with a dashed white ring around them. **Player view** shows you exactly what players see, so hidden tokens disappear.",
          "Switching to another tool also turns **Player view** off."
        ]
      },
      {
        "title": "Old Owlbear Rodeo 1 files (.owlbear)",
        "steps": [
          "Go to 1to2.owlbear.app, Owlbear's own converter.",
          "Convert your .owlbear file there.",
          "Add the .ob2 file it gives you, as in Step 2."
        ],
        "notes": [
          "Tabletop can't read an .owlbear file directly. If you pick one, a message tells you to convert it at 1to2.owlbear.app first."
        ]
      }
    ]
  },
  {
    "id": "adding-maps",
    "title": "Adding maps",
    "audience": "gm",
    "intro": "Every map lives in a scene. You can make a scene from an image, from a map maker's file, from a map you've already uploaded, or from a plain grid. Only the GM can add maps.",
    "parts": [
      {
        "title": "Upload map images",
        "steps": [
          "Click the **Scenes** button in the top bar (the stack-of-layers icon).",
          "Click **New scene**.",
          "Type a **Name**, or leave it empty to use the map's name.",
          "Choose **Upload a map**.",
          "Tick or untick **Start with the map covered in fog**.",
          "Click the **Choose or drop maps** box and pick one or more images, or drag them onto the box.",
          "Wait for the upload to finish. The scene editor then opens on the new scene so you can check the grid."
        ],
        "notes": [
          "Images can be PNG, JPEG or WebP. GIF and AVIF work too.",
          "If you add several images at once, each one gets its own scene named after its file. Underscores become spaces, and grid sizes and words like \"gridless\" are dropped. A name you type is only used when you add a single map.",
          "A message tells you how the grid was set, for example \"Grid guessed at 30 × 20 squares: check it with Edit scene.\" When you add several images, it says how many scenes were made and how many had their grid in the file, for example \"Created 3 scenes, one per map. 1 had their grid in the file.\"",
          "When nothing tells the app the grid size, it tries common map sizes (such as 70 or 140 pixels a square). If none fit, it guesses about 70 pixels a square.",
          "Big images are shrunk to 6144 pixels on their longest side, and the grid is scaled to match.",
          "If any file you chose can't be used (for example a file that isn't an image, or an old .owlbear file), the **Maps brought in** window appears. It lists the problems under **Left out:**. Click **Done** to carry on.",
          "If an upload fails, a message with a red border appears at the bottom-left of the map and tells you why. It disappears after a few seconds, or you can click it to close it.",
          "A room can hold up to 100 scenes."
        ]
      },
      {
        "title": "Put the grid size in the file name",
        "steps": [
          "Before you upload, rename the image so its name includes the number of squares across and down, like `Crypt 30x20.jpg` or `Crypt [22x30].png`, or the pixels per square, like `Cave 140ppi.png` or `Cave 70px.png`.",
          "Upload it as above. The grid is set from the name."
        ],
        "notes": [
          "Many map makers already name their files this way.",
          "The order doesn't matter. On a wide map, \"20x30\" is read as 30 across and 20 down.",
          "The numbers are only used if they give square squares on that image (to within about 3%). If they don't, the grid is guessed.",
          "Numbers over 200, like \"4096x2048\", are taken to be the picture's size and are ignored.",
          "\"dpi\" and \"ppg\" are recognised as well as \"ppi\" and \"px\"."
        ]
      },
      {
        "title": "Dungeondraft and other Universal VTT files",
        "steps": [
          "In Dungeondraft (or DungeonFog, Dungeon Alchemist, Arkenforge and similar programs), export your map as a Universal VTT file. Its name ends in .dd2vtt, .uvtt or .df2vtt.",
          "In Tabletop, click **Scenes**.",
          "Click **New scene**.",
          "Choose **Upload a map**.",
          "Drop the file onto **Choose or drop maps**, or click the box and pick it."
        ],
        "notes": [
          "You get the map picture and its exact grid, and the message says \"Grid set from the file\".",
          "Only the picture and the grid are used. Anything else saved in the file, such as walls, doors or lights, is not (with a Dungeondraft project file, they only help tell which level the picture shows).",
          "Universal VTT files saved with a .json ending work too.",
          "Dungeondraft's own project file (.dungeondraft_map) isn't a map picture, so on its own it can't make a scene, and Tabletop tells you so. Bring it in together with the export, though, and seasons use the map's own terrain, water, buildings and trees: see **Exact seasons for Dungeondraft maps** under **Seasons**."
        ]
      },
      {
        "title": "Drop or paste a map straight onto the board",
        "steps": [
          "Drag a map image, or a .dd2vtt, .uvtt, .df2vtt or .ob2 file, from your computer onto the map in your room.",
          "Wait while the **New scene** window opens and brings it in. It starts right away.",
          "If a **Maps brought in** report appears, click **Done**.",
          "Look at the new scene. The **Scenes** list opens with you looking at it.",
          "To paste instead, copy an image and press Ctrl+V while you're looking at the map."
        ],
        "notes": [
          "The scene editor doesn't open by itself here. To check the grid, click the pencil button on the new scene in the **Scenes** list.",
          "Big images (1600 pixels or more on the longest side) start a new scene. Smaller images become tokens: where you drop them, or in the middle of your view if you paste them.",
          "Maps you drop or paste start covered in fog. To uncover everything, use **Clear all** in **Edit scene**.",
          "Pasting only works when a scene is on screen, no window is open, and you're not typing in a box. Dropping works even when there's no scene yet.",
          "Only the GM can start scenes by dropping or pasting. If a player drops a map file, they see \"Only the GM can add maps.\" If a player drops a big picture, it becomes a token, not a scene."
        ]
      },
      {
        "title": "Use a map you've already uploaded",
        "steps": [
          "Click **Scenes**.",
          "Click **New scene**.",
          "Type a **Name**, or leave it empty to use the map's name.",
          "Choose **Uploaded maps**.",
          "Tick or untick **Start with the map covered in fog**.",
          "Click the map you want."
        ],
        "notes": [
          "This shows every map image uploaded to this room, newest first. That includes maps used by other scenes and maps uploaded in the **Maps** tab of the **Tokens & images** panel.",
          "If there are none, it says \"No maps uploaded yet.\"",
          "The grid is guessed, so check it in the scene editor that opens."
        ]
      },
      {
        "title": "Start from a blank grid",
        "steps": [
          "Click **Scenes**.",
          "Click **New scene**.",
          "Type a **Name**, or leave it empty to get \"Scene 2\", \"Scene 3\" and so on.",
          "Choose **Blank grid**.",
          "Set **Columns** and **Rows**.",
          "Click **Create**."
        ],
        "notes": [
          "**Columns** and **Rows** can each be 1 to 200. They start at 30 and 20.",
          "A blank grid has 70-pixel squares on a dark grey background. The Build tool is picked for you, to build a map on it (see **Building a map**).",
          "Tick **Start covered in fog** if players shouldn't see it until you reveal it. It starts unticked.",
          "You can change its size later in **Edit scene** (**Width (px)** and **Height (px)**), or give it a map there.",
          "Every new room starts with **Scene 1**, a blank 30 by 20 grid, and that's the scene players see at first."
        ]
      },
      {
        "title": "The \"Start with the map covered in fog\" option",
        "steps": [
          "In **New scene**, choose **Upload a map** or **Uploaded maps**.",
          "Leave **Start with the map covered in fog** ticked to hide the whole map from players, or untick it to let them see all of it."
        ],
        "notes": [
          "Its tooltip says: \"Players see nothing until you reveal it with the fog tool\".",
          "It's ticked unless you untick it.",
          "For **Blank grid** it's called **Start covered in fog**, and it starts unticked.",
          "It doesn't apply to Owlbear backups, because their fog comes from Owlbear.",
          "You can change your mind later with **Cover all** or **Clear all**, in **Edit scene** or on the fog tool."
        ]
      }
    ]
  },
  {
    "id": "building-maps",
    "title": "Building a map: floors, walls, doors and objects",
    "audience": "gm",
    "intro": "The Build tool lets you make a battle map right on the grid, or add to a map you uploaded. Its modes are named after Dungeondraft's tools: **Building** for rooms, **Walls**, **Doors** (Dungeondraft's portals), **Terrain** for grass, water and lava, and **Objects**, plus **Select** (**X**) to move, turn, size, copy or delete what you've placed. Players see what you build (under fog, like any map), and it's saved with the scene.",
    "parts": [
      {
        "title": "Coming from Dungeondraft",
        "steps": [
          "Keep making maps in Dungeondraft if you like. In Dungeondraft, choose **Export**, set the export mode to **Universal VTT**, and export each level as its own file.",
          "In Tabletop, click **Import Dungeondraft map** in the Build tool's bar, or drop the file on the map. The **New scene** window opens with it. For exact seasons, pick or drop the map's .dungeondraft_map file along with it."
        ],
        "notes": [
          "The picture and its grid come across exactly. The walls, doors and lights in the file aren't used: Tabletop has no lighting or line of sight.",
          "Keep the .dungeondraft_map file Dungeondraft saves: attached to its scene, it makes seasons exact (see **Exact seasons for Dungeondraft maps** under **Seasons**). On its own it has no picture in it, so it can't make a scene, and Tabletop tells you so if you try.",
          "About 100 to 150 pixels per square is plenty. Tabletop shrinks map pictures to 6,144 pixels on their long side, so a big map at Dungeondraft's usual 256 pixels per square is scaled down anyway, and a very big one can be too large for the browser to open.",
          "Tools: Dungeondraft's Building tool is **Building** here (its Cave brush is Building's brush with dirt), the Wall tool is **Walls**, the Portal tool is **Doors**, the Terrain and Water brushes are **Terrain**, the Object tool is **Objects**, and the Select tool is **Select** (press **X**, and **X** again to go back).",
          "The same as in Dungeondraft: Space and drag, or drag with the middle mouse button, moves the map; Ctrl and the mouse wheel zoom; Ctrl+Z undoes and Ctrl+Y redoes; **[** and **]** change the brush size; holding Alt takes away instead of adding. In **Objects**, the wheel turns the next object 15° (**Z**+wheel 5°), **Alt**+wheel sizes it and a right-click turns it 90°. In **Select**, click or drag a box, **Shift** adds, **Delete** deletes, and **Ctrl+C** and **Ctrl+V** copy and paste, even between rooms.",
          "Different: everything sits on the grid: walls follow grid lines, and objects stand on whole squares, turn in 5° steps and size from ½ to 3 squares. In **Select** the wheel turns 15° a notch (Dungeondraft: 30°) and **Z**+wheel 5° (Dungeondraft: 10°). Walls and floors can't be selected (floors can't in Dungeondraft either); doors can be selected only to delete them, and openings not at all. There's no mirror, layers, locking, lighting or levels (a scene is a level).",
          "A **Blank grid**'s **Columns** and **Rows** are Dungeondraft's new map size in squares."
        ]
      },
      {
        "title": "Start a map to build on",
        "steps": [
          "Click **Scenes**, then **New scene**.",
          "Choose **Blank grid**, set **Columns** and **Rows**, and click **Create**.",
          "The Build tool opens in **Building**: start painting rooms."
        ],
        "notes": [
          "Tick **Start covered in fog** to build in secret, then reveal it with the fog tool as the party explores.",
          "You can build on any scene with a square grid, including over an uploaded map, to patch it or add rooms to it."
        ]
      },
      {
        "title": "Open the Build tool",
        "steps": [
          "Click **Build the map** (the hammer) in the toolbar, or press **B**.",
          "In its bar, pick a mode: **Building** (the castle), **Walls** (the bricks), **Doors** (the door), **Terrain** (the trees), **Objects** (the armchair) or **Select** (the dashed box with a pointer, or press **X**). On a phone the names are hidden and only the pictures show."
        ],
        "notes": [
          "Only the GM has the Build tool.",
          "It needs a square grid. On a hex grid its bar says \"Building works on a square grid.\": change the grid to squares in **Edit scene** first.",
          "On a computer, the mouse and key controls for the mode you're in are listed along the bottom of the map.",
          "While you build on the scene players are on, the bar says \"Players see this scene as you build.\" To build unseen, cover the scene first (**Fog of war**, then **Cover all**), or build on another scene and show it when it's ready.",
          "While you're building, a table display that follows your view stays where it is, so the table doesn't jump around with you."
        ]
      },
      {
        "title": "Building: rooms",
        "steps": [
          "Pick **Building**.",
          "Pick a floor: stone, wood or dirt (the textured squares).",
          "Pick a shape: **Rectangle** (the square) or **Oval** (the circle), then drag from one corner of the room to the opposite corner.",
          "Or pick **Brush** (the paintbrush), pick its size (1 to 5 squares, or press **[** and **]**), and drag to paint square by square."
        ],
        "notes": [
          "Rooms get walls automatically wherever they meet empty space, grass, water or lava. Rooms painted next to each other join up with no wall between them.",
          "Pick **No wall** (the X) to paint rooms without walls from then on, for example to patch an uploaded map; **Wall** (the bricks) turns walls on again for rooms you paint after that. (Rooms already painted keep what they had: paint them again to change it.) On a scene with an uploaded map it starts on **No wall**. Your choice is kept for each scene until you reload the page.",
          "Dirt with the brush makes caves, like Dungeondraft's Cave brush.",
          "Paint one floor over another to change it."
        ]
      },
      {
        "title": "Cut out and erase",
        "steps": [
          "Hold **Alt** and drag over part of a room to cut it out, with the rectangle, the oval or the brush.",
          "Or pick **Erase** (the eraser after the floors) and drag."
        ],
        "notes": [
          "In **Building**, erasing takes rooms: their floor, and the walls, doors and objects on it. Terrain stays where it was. In **Terrain**, it takes only the grass, water and lava: walls, doors and objects stay.",
          "Unlike Dungeondraft, cutting out part of a room also takes the objects on those squares.",
          "**Clear build** removes everything built on the scene, after asking you. Undo brings it back."
        ]
      },
      {
        "title": "Terrain: grass, water and lava",
        "steps": [
          "Pick **Terrain**.",
          "Pick grass, water or lava, and a shape (it starts on **Brush**).",
          "Drag to paint."
        ],
        "notes": [
          "Terrain goes under buildings, as in Dungeondraft: painting it never covers a room's floor, so you can paint the outdoors right up to your rooms. Each square holds one floor, though: painting a room over terrain replaces the terrain there, and cutting the room out later leaves empty squares, which you can paint with terrain again.",
          "Terrain never gets walls of its own, but rooms get walls where they meet it.",
          "Hold **Alt** while you drag to take terrain away."
        ]
      },
      {
        "title": "Walls",
        "steps": [
          "Pick **Walls**, then **Add** or **Remove**.",
          "Drag along the grid lines where the wall goes.",
          "Or click grid corners one after another: each click adds a wall from the last corner, straight across or straight down.",
          "Finish with a double-click, a right-click or **Enter**. Clicking the first corner again closes the loop and finishes too."
        ],
        "notes": [
          "While you're placing corners, **Backspace** takes the last one back and **Escape** cancels.",
          "Hold **Alt** to remove walls instead of adding them.",
          "**Remove** also opens up a wall that was drawn automatically: an archway, or an opening into a cave.",
          "On a touch screen, drag along the lines, or tap a single grid line."
        ]
      },
      {
        "title": "Doors, secret doors and openings",
        "steps": [
          "Pick **Doors**.",
          "Pick a style: **Door**, **Secret** (a secret door) or **Opening** (the X: a gap in the wall).",
          "Click a wall. The wall nearest your click is used, so you don't need to hit the line exactly."
        ],
        "notes": [
          "To take a door, secret door or opening away again, click it with the same style, or hold **Alt** and click it. It goes back to exactly what was there: the wall it was cut into, or a bare grid line. A secret door just stops being secret, leaving the wall players have seen all along. Alt+click where there's no door or opening does nothing.",
          "Players see a secret door as an ordinary wall; you see it marked with a purple **S**. Their browsers are never even told it's there.",
          "An opening only goes where there's a wall to open.",
          "To see the map as players do, pick **Fog of war** and click **Player view**: the secret doors' marks disappear."
        ]
      },
      {
        "title": "Place objects",
        "steps": [
          "Pick **Objects**.",
          "Pick an object from the row of pictures: table, chair, bed, chest, barrel, crate, bookshelf, stairs, pillar, statue, well, tree, bush, rock, campfire or rubble.",
          "Set its **Size** (½ to 3 squares) and **Turn** in the bar. With a mouse you can instead scroll the wheel to turn it 15° a notch (hold **Z** for 5°), hold **Alt** and scroll to change its size, or right-click to turn it 90°, as in Dungeondraft.",
          "Click the map where it goes. With a mouse, a faded copy shows exactly where it will land and how it's turned."
        ],
        "notes": [
          "A click always places a new object, even on top of another (a chair at a table), but never an exact copy on top of the same object. To move, turn or delete objects already placed, use **Select**. With a mouse you can also drag one to move it without switching.",
          "While you place objects, the mouse wheel turns them: zoom with **Ctrl** and the wheel, or pinch on a trackpad. Two fingers on a trackpad still move the map.",
          "If your mouse wheel moves the map instead of turning (smooth-scrolling mice, and most mice on a Mac), or you use a trackpad, hold **Z** while you scroll to turn the object 5° at a time, or press **[** and **]** to turn it 15° (**Shift**: 5°). To make the wheel, and two fingers up and down a trackpad, turn objects 15° at a time, pick **Always turns them (smooth-scrolling mice, Mac mice)** for **Mouse wheel over objects (Build tool)**, under **Change your name or colour** in **Chat & dice**. Holding **Alt** while you scroll changes an object's size, not its turn. All of this works the same for the selected objects in **Select**.",
          "An object stands on whole squares: one bigger than 1¼ squares stands on 2×2, one bigger than 2¼ on 3×3. Turned or sized, it's drawn centred on them.",
          "Hold **Alt** and click an object to remove it, or pick **Remove** and click it.",
          "Objects are part of the map, under tokens and drawings, so nobody picks one up by accident. For something players should move or find (a chest to reveal later), use a token instead."
        ]
      },
      {
        "title": "Select: move, turn, size, copy and delete",
        "steps": [
          "Press **X**, or pick **Select** in the Build tool's bar. **X** again, or **Back** in the bar, goes back to what you were using.",
          "Click an object to select it. **Shift**+click adds another, or takes it out again. Where objects overlap, click again to pick the one underneath.",
          "To select several, drag a box over them, starting on empty floor, or hold **Shift** to start anywhere and add to what's selected. Every object whose middle is in the box is selected.",
          "Drag a selected object to move everything selected, a square at a time, or press the arrow keys (**Shift**: five squares).",
          "Turn them with the mouse wheel (15° a notch; hold **Z** for 5°), **[** and **]**, or a right-click (90°). Hold **Alt** and scroll to make them bigger or smaller.",
          "**Delete** removes them. **Ctrl+D** duplicates them next to themselves. **Ctrl+C** copies them and **Ctrl+V** pastes them under the pointer, in any scene or room. **Escape** deselects."
        ],
        "notes": [
          "Selected objects have a blue outline, and the one under the pointer a yellow one, as in Dungeondraft. The bar has the same actions as buttons.",
          "Several objects turn together, round the middle of the squares they stand on: a quarter turn keeps a table and its chairs exactly as they were. Turned by less, they keep to the grid, so they can shift a little; turn on and they fall back into place. Sizing sizes each object where it stands.",
          "Doors and secret doors can be clicked to select them, and **Delete** takes them away, leaving what was there before (a wall, or nothing). They can't be moved or copied: use **Doors**. Openings, walls and floors can't be selected.",
          "Each move, delete, duplicate or paste is one step for **Undo**, and so is each burst of turning, sizing or nudging. Undo also clears the selection.",
          "With nothing selected, the mouse wheel zooms as usual. With objects selected it turns them; **Ctrl** and the wheel always zoom. If your wheel or trackpad moves the map instead, hold **Z** while you scroll, or see **Place objects**.",
          "In a season, moving, turning or sizing a tree can change which kind of tree it is, because that depends on where it stands.",
          "On a phone or tablet: tap an object to select it (tap again for the one underneath), drag it to move it, or drag across the map to select several with a box; two fingers move the map. The bar at the bottom turns, sizes, duplicates and deletes. **Copy** (two overlapping squares) and **Paste** (a clipboard) are in the Build tool's bar at the top; on a phone, swipe that bar sideways to reach them. **Paste** puts the copies in the middle of the screen, so move the map to where they go first."
        ]
      },
      {
        "title": "Undo, saving and touch screens",
        "steps": [
          "Press **Ctrl+Z** (or click **Undo**) to take back your last drag or click, and **Ctrl+Y** or **Ctrl+Shift+Z** to redo it."
        ],
        "notes": [
          "Each drag or click is one step for undo, and so is a wall placed corner by corner. In **Select**, a burst of turning, sizing or nudging is one step.",
          "Undo only takes back what that step changed. If you build in two tabs at once (a laptop and a tablet, say), undoing in one never wipes what you built in the other.",
          "What you build is saved with the scene straight away, and it's included in the room's backups.",
          "Changing the grid's size or offset in **Edit scene** moves the build along with it.",
          "On a phone or tablet, one finger paints floors and draws walls. In **Doors** and **Objects**, tap; dragging moves the map instead. In **Select**, a drag selects with a box or moves what's selected, and two fingers move the map. Alt, right-clicks and the mouse wheel need a mouse; the bars have buttons for turning and sizing."
        ]
      }
    ]
  },
  {
    "id": "scenes",
    "title": "Scenes: preview, show, rename, delete",
    "audience": "gm",
    "intro": "The Scenes panel lists every scene in the room. You can look at any scene on your own, then choose which one players see. Only the GM has this panel.",
    "parts": [
      {
        "title": "Look at a scene on your own",
        "steps": [
          "Click the **Scenes** button in the top bar.",
          "Click a scene in the list. It opens for you only, and its row says **Previewing**.",
          "Read the banner on the map. It says **Only you can see this scene.** and names the scene players are on.",
          "When you're done, click **Back to live scene** in that bar to return to the scene players see."
        ],
        "notes": [
          "The **Scenes** button is an icon, a stack of layers. Hover over it to see the name **Scenes**. Only the GM has it, and the **Room settings** button.",
          "The scene players are on says **Players see this** in the list.",
          "Players' browsers only ever get the scene they're on, so nobody can peek at a scene you're previewing.",
          "You can set up fog, tokens and the grid while you preview, then show the scene when you're ready."
        ]
      },
      {
        "title": "Show a scene to players",
        "steps": [
          "Open **Scenes**.",
          "On the scene's row, click the play button (**Show to players**)."
        ],
        "notes": [
          "While you're previewing a scene you can also click **Show to players** in that banner.",
          "Everyone moves to that scene at once, and its row now says **Players see this**.",
          "The scene players are already on has no play button."
        ]
      },
      {
        "title": "Rename a scene",
        "steps": [
          "Open **Scenes**.",
          "Click the pencil button on the scene's row (**Edit scene and grid**).",
          "Change the **Name**.",
          "Press Enter or click somewhere else.",
          "Click **Done**."
        ],
        "notes": [
          "Press Escape instead of Enter to cancel.",
          "An empty name isn't saved. Names can be up to 60 characters."
        ]
      },
      {
        "title": "The order of scenes",
        "steps": [],
        "notes": [
          "Scenes are listed in the order you made them, and each new one goes to the bottom. You can't move them around in the list."
        ]
      },
      {
        "title": "Delete a scene",
        "steps": [
          "Open **Scenes**.",
          "Click the bin button on the scene's row (**Delete scene**).",
          "Read the warning.",
          "Click **Delete scene**."
        ],
        "notes": [
          "Every token, drawing and fog shape on the scene is deleted too. You can't undo this.",
          "If players were on that scene, they move to the first scene in the list. If it was the only scene, players have no scene.",
          "The map image stays in the room, so you can use it again from **Uploaded maps**."
        ]
      },
      {
        "title": "Delete a map image for good",
        "steps": [
          "Open the **Tokens & images** panel.",
          "Click **Maps**.",
          "Click the bin button (**Delete**) on the image."
        ],
        "notes": [
          "Any scene still using that image shows a blank instead."
        ]
      }
    ]
  },
  {
    "id": "scene-editor",
    "title": "The scene editor: grid and map",
    "audience": "gm",
    "intro": "**Edit scene** is where you line the grid up with the map's printed squares, set distances and swap the map. Changes save as you make them, and players on that scene see them straight away.",
    "parts": [
      {
        "title": "Open the scene editor",
        "steps": [
          "Open **Scenes**.",
          "Click the pencil button on the scene (**Edit scene and grid**).",
          "When you've finished, click **Done** at the bottom."
        ],
        "notes": [
          "Opening the editor also shows you that scene. If players are on a different scene, they can't see it.",
          "The editor also opens by itself after you make a new scene with **New scene** in the **Scenes** panel. When you drop or paste a map onto the map, the **Scenes** list opens instead.",
          "Changes in the number boxes take effect when you press Enter or click somewhere else.",
          "Undo doesn't cover the grid settings, the **Name** or the map's **Remove** button. Only a map change (**Choose uploaded** or **Upload new**), attaching or removing **Dungeondraft data**, and **Cover all** / **Clear all** can be undone. If you change a grid setting by mistake, set it back by hand."
        ]
      },
      {
        "title": "Choose squares or hexes",
        "steps": [
          "Under **Grid**, click **Squares**, **Hex (rows)** or **Hex (columns)**, whichever matches the map."
        ],
        "notes": [
          "With hexes, the boxes become **Hexes across**, **Hexes down** and **Hex width (px)**.",
          "While a hex grid is picked, the box-drawing tool and **Diagonals** are hidden. Click **Squares** to get them back."
        ]
      },
      {
        "title": "Line up the grid by drawing a box (quickest)",
        "steps": [
          "Under **Grid**, pick how many squares your box will cover, from **1×1 squares** to **5×5 squares**.",
          "Click **Draw it on the map**.",
          "Zoom in on the map until you can see its printed squares clearly.",
          "Drag a box exactly over that many squares, from one corner to the opposite corner.",
          "Let go. The grid is resized to fit, and a message shows the new square size, for example \"Grid set: 70 px squares.\""
        ],
        "notes": [
          "Covering more squares gives a more accurate result.",
          "The box stays square while you drag it.",
          "A box that's too small does nothing and the bar stays up, so zoom in and try again.",
          "While the bar across the top is showing, you can still move around with a right-drag or Space + drag, and zoom with the mouse wheel.",
          "To stop, click **Cancel** in the bar or press Escape. If you press Escape while you're still dragging, only that box is cancelled; press Escape again, or click **Cancel**, to stop.",
          "This tool always sets a square grid and turns **Show grid** on."
        ]
      },
      {
        "title": "Set squares across and down",
        "steps": [
          "Count how many squares the map has from side to side.",
          "Type that number in **Squares across**.",
          "Press Enter.",
          "Change **Offset X** and **Offset Y** until the lines sit on the map's own lines."
        ],
        "notes": [
          "You can type in **Squares down** instead. Both set the same square size, so changing one updates the other.",
          "Half squares are allowed."
        ]
      },
      {
        "title": "Square size, fine tune and offset",
        "steps": [
          "Type the size of one square, in pixels, in **Square size (px)**. For hexes the box is **Hex width (px)**.",
          "Under **Fine tune**, click **−** for smaller squares or **+** for bigger ones. Each click changes the size by half a pixel.",
          "Type in **Offset X** to slide the grid sideways.",
          "Type in **Offset Y** to slide the grid up or down."
        ],
        "notes": [
          "The smallest square size is 4 pixels."
        ]
      },
      {
        "title": "Show grid, snap, colour and opacity",
        "steps": [
          "Tick **Show grid** to draw the grid lines, or untick it to hide them.",
          "Tick **Snap tokens** to make tokens land on squares.",
          "Click **Colour** and choose a colour for the lines.",
          "Drag **Line opacity** to make the lines fainter or stronger."
        ],
        "notes": [
          "When snapping is on, you can hold Alt as you let go of a token you're moving on the map, to place it anywhere. New tokens dragged in from the **Tokens & images** panel still snap."
        ]
      },
      {
        "title": "Units and diagonals",
        "steps": [
          "Under **Distance**, set **One square is**, for example 5.",
          "Set **Unit**, for example ft.",
          "For square grids, choose how **Diagonals** count: **Count as one square (D&D 5e)**, **Alternate 1, 2, 1 (Pathfinder)** or **Straight-line distance**."
        ],
        "notes": [
          "New scenes start with one square being 5 ft and diagonals counted the D&D 5e way.",
          "The ruler uses these settings."
        ]
      },
      {
        "title": "Change the map",
        "steps": [
          "Under **Map**, click **Choose uploaded**.",
          "In **Choose a map**, click the map you want."
        ],
        "notes": [
          "To use an image from your computer instead, click **Upload new** and pick it. It takes one image and doesn't read a grid size from the file name.",
          "If the new map is the same size as the old one (a night version of the same map, say), the grid and fog stay exactly as they were.",
          "If it's a different size, the grid is guessed again, all fog shapes are removed and the whole map starts covered. A message says \"The map starts covered in fog. Reveal areas with the fog tool.\"",
          "The same happens when you give a map to a scene that had none, such as a blank grid: the whole scene starts covered in fog and the grid size is guessed.",
          "Undo (Ctrl+Z) puts the old map and its fog back.",
          "**Dungeondraft data** under **Map** shows whether the scene has its Dungeondraft project file's data for exact seasons: **Attach…**, or the data's name and how many things it holds, with **Change…** and **Remove**. Changing the picture keeps the data but pauses it until you click **Use it with this picture** in the season box. See **Exact seasons for Dungeondraft maps** under **Seasons**.",
          "**Remove** takes the map off and leaves the plain background. **Width (px)** and **Height (px)** boxes then appear so you can set the scene's size.",
          "**Background** sets the colour behind the map."
        ]
      },
      {
        "title": "Cover or clear the whole scene",
        "steps": [
          "Under **Fog**, click **Cover all** to hide the whole scene from players, or **Clear all** to show them all of it.",
          "Click the button of the same name in the window that opens to confirm."
        ],
        "notes": [
          "Both buttons remove the fog shapes you've drawn so far. **Undo** brings them back."
        ]
      }
    ]
  },
  {
    "id": "seasons",
    "title": "Seasons: snow, autumn leaves, blossom and drought",
    "audience": "gm",
    "intro": "One click puts a scene's map in season: Winter snow, Autumn leaves, Spring blossom or a Summer drought, each at three strengths. It works on uploaded maps and on maps you build. Tokens, drawings, notes, fog and the grid stay exactly as they are.",
    "parts": [
      {
        "title": "Put a scene in season",
        "steps": [
          "Go to the scene: the live one, or one you're previewing.",
          "In the top bar, click the season button (a sun behind a cloud, left of the monitor button).",
          "Pick **Spring**, **Summer**, **Autumn** or **Winter**.",
          "Pick how drastic, gentlest first: **Frost**, **Snow** or **Deep snow** for Winter; **Turning**, **Autumn** or **Late autumn**; **Budding**, **Blossom** or **Full bloom**; **Lush**, **Dry** or **Drought**.",
          "To go back to the map as it was drawn, pick **As drawn**."
        ],
        "notes": [
          "On a phone, or if you prefer, the same buttons are under **Season** in the scene editor (**Edit scene and grid**).",
          "On the live scene, players see the change straight away. On a scene you're previewing, they see it when you show it to them.",
          "Each click is one step for **Undo** (Ctrl+Z).",
          "The shuffle button next to the strengths keeps the season but moves the snow drifts, fallen leaves or flowers to other places.",
          "Picking a season starts at the strength you last used for it on this device (the middle one the first time).",
          "The season button in the top bar shows the scene's season: a snowflake for Winter, a leaf for Autumn, a flower for Spring and a sun for Summer.",
          "The first time a screen shows a season, it redraws the map: a rough version appears first, then the sharp one a moment later. Going back to a season used a moment ago is instant."
        ]
      },
      {
        "title": "What each season does",
        "steps": [],
        "notes": [
          "Winter: **Frost** frosts the grass and cools the colours. **Snow** covers most open ground in drifts, with snow on the trees and ice along the shores. **Deep snow** turns open ground white and freezes ponds and rivers; big lakes and the sea keep open water in the middle.",
          "Autumn: trees turn a mix of red, orange, yellow and some green, different on every tree, and grass goes towards straw, with fallen leaves on the ground. The stronger it is, the more trees turn and the thinner their leaves get: **Late autumn** has bare branches showing and leaves everywhere.",
          "Spring: greens get fresher, with blossom on the trees and wildflowers in the grass. **Full bloom** has the most.",
          "Summer: **Lush** makes greens deeper. **Dry** browns the grass in patches. **Drought** leaves straw-coloured grass, cracked bare earth and murky water."
        ]
      },
      {
        "title": "What changes, and what doesn't",
        "steps": [],
        "notes": [
          "On an uploaded map, mainly plants, water and the open ground between them change, and only out in the open, where there are plenty of plants around. Dungeons, caves and sewers keep their water and floors, so an indoor map barely changes. The season box says so when the map looks like an indoor one.",
          "Ink lines, walls, lava, fires, red roofs, rugs and labels never change. Small roofs and props on grass get snow on top; wide roofs, streets and paved squares keep their colour.",
          "Snow drifts and leaves are sized by the grid, so line the grid up with the map first (see **The scene editor: grid and map**). With Dungeondraft data, sizes come from the map itself.",
          "On a map you built: grass, trees, bushes, and ponds, lakes and rivers that touch grass change, and paths near grass get snow or leaves. In winter, rocks, rubble and wells near grass get frost or snow on top (a well freezes over in **Deep snow**), and the snow melts round a campfire. Rooms with walls stay as they are inside, and walls, doors and lava never change.",
          "The table display always shows the season, like any player's screen, even when it's opened on a computer where seasons are turned off."
        ]
      },
      {
        "title": "Exact seasons for Dungeondraft maps",
        "steps": [
          "In Dungeondraft, save the map (the .dungeondraft_map file) and export it (**Universal VTT** or PNG).",
          "Bring both into Tabletop: drop them together, or use **Import Dungeondraft map**. If they're in different folders, bring one and then the other: the **New scene** window waits for the second. For a scene you already have: **Edit scene**, then under **Map**, **Dungeondraft data**, **Attach…**; or the **Attach its project file** link in the season box.",
          "Pick the level if asked, check that the preview lines up (try **Compare**), and click **Attach**."
        ],
        "notes": [
          "With the project file, seasons know exactly what's in the map: snow melts only where it's painted, leaves grow only on the trees you placed and by their kind (pines stay green in autumn), and water, buildings and caves are exact. Without it, seasons are guessed from the picture, as on any other map.",
          "The project file must be the one the picture was exported from. If you change the map in Dungeondraft, export it again and attach it again. The window checks that the file lines up with the picture, and says so when it can't be sure or when the map seems to have grown since the export.",
          "Things placed from asset packs stay as drawn in every season, because Tabletop can't tell what they are. If you'd rather the trees and snow the picture shows on them changed with the season, judged by their colours, pick **Guess from the picture** under **Asset-pack items** in the season box (it's shown when the map has any). **Leave as drawn** is the default. Paths, ground and roofs from asset packs stay as drawn either way.",
          "A bare tree comes into leaf on a snowy map and stays dead on a green one: change it under **Bare trees**. If Tabletop mistakes which season your map shows, change **This map is drawn in**.",
          "Exact seasons work on winter maps now; green maps follow in a later update. A green map's data is kept, and its seasons are guessed from the picture until then.",
          "The project file itself is never uploaded, only what seasons need from the one level: players can't see other levels, secret doors, notes or the file's name.",
          "Changing the scene's picture keeps the data but pauses it, since it was lined up with the old picture: the season box offers **Use it with this picture** (for a day and night version of the same map, say) or **Remove**. **Remove** (there, or under **Map** in the scene editor) takes the data off and seasons go back to guessing; Undo puts it back.",
          "A project file brought in on its own, with no picture, can't make a scene: Tabletop says so, and tells you to bring the export in with it, or to attach it to a scene."
        ]
      },
      {
        "title": "If maps are slow to appear on a device",
        "steps": [
          "Open **Chat & dice**.",
          "Click the person-and-pencil button (**Change your name or colour**).",
          "Under **This device**, untick **Show seasons (snow, autumn leaves) on maps**."
        ],
        "notes": [
          "That device then shows every map as drawn. Everyone else still sees the season, and so does a table display, even one you open on this device. Tick it again to see seasons.",
          "Players can do this too, on their own devices."
        ]
      }
    ]
  },
  {
    "id": "fog-tool",
    "title": "Fog of war: the fog tool",
    "audience": "gm",
    "intro": "Fog of war hides parts of the map from your players, and you uncover them as the party explores. Only the GM has the fog tool.",
    "parts": [
      {
        "title": "Open the fog tool",
        "steps": [
          "Click the **Fog of war** button (the cloud) in the toolbar down the left side of the map, or press **F**.",
          "Use the row of fog options that appears to choose what to do."
        ],
        "notes": [
          "Players don't have this button, and pressing **F** does nothing for them.",
          "While the fog tool is on, the pointer turns into a crosshair.",
          "To move around the map while the fog tool is on, hold **Space** and drag, or drag with the right or middle mouse button. The mouse wheel still zooms.",
          "On a touch screen, one finger draws fog and two fingers move and zoom the map. Putting a second finger down throws away the stroke the first finger started.",
          "Fog always goes on the scene you're looking at, even if players are on a different scene.",
          "The fog tool keeps your choices (**Reveal** or **Hide**, the shape, the brush size and **Snap**) while the room is open, even when you switch to another tool and back. Reloading the page resets them to **Reveal**, **Brush**, 2 squares and **Snap** ticked.",
          "Fog keys don't work while you're typing in a box, while a dialog is open, or while a slider or tick box still has the keyboard.",
          "The main fog keys (**F**, **[** and **]**, the polygon keys, Undo and Redo) are also listed under **Help & shortcuts**, the question-mark button in the top bar. **Esc** isn't on that list. On a narrow screen, such as a phone, the question-mark button is hidden."
        ]
      },
      {
        "title": "Reveal or Hide",
        "steps": [
          "Click **Reveal** to uncover areas so players can see them.",
          "Click **Hide** to cover areas with fog again."
        ],
        "notes": [
          "While you draw, the shape shows in green for Reveal and orange for Hide.",
          "Players see nothing change until you let go (or finish a polygon), so they never catch a half-drawn shape.",
          "Each new shape goes on top of the ones before, so you can hide part of an area you revealed, then reveal it again later."
        ]
      },
      {
        "title": "Brush",
        "steps": [
          "Click the **Brush** button (the paintbrush).",
          "Set the size with the slider that appears next to the shape buttons, or press **[** for smaller and **]** for bigger.",
          "Drag over the map to paint.",
          "Let go to finish the stroke."
        ],
        "notes": [
          "The slider has no label. Hover over it and it says \"Brush size in squares ([ and ] change it)\".",
          "The size is in grid squares, from 0.5 to 20. The number next to the slider shows it (for example **2 sq**).",
          "**[** and **]** change the size by half a square. Hold **Shift** to change it by 2 squares.",
          "**[** and **]** only resize the brush while the fog tool and the Brush are chosen. The rest of the time they rotate the selected token.",
          "If **[** or **]** does nothing right after you've used the slider, click the **Brush** button and try again.",
          "With a mouse, a dashed circle follows your pointer and shows exactly how wide the brush paints: green for Reveal, orange for Hide.",
          "Click without moving to make a single round dab.",
          "Press **Esc** before you let go to throw the stroke away."
        ]
      },
      {
        "title": "Rectangle",
        "steps": [
          "Click the **Rectangle** button (the square).",
          "Press where one corner of the area should be.",
          "Drag to the opposite corner.",
          "Let go."
        ],
        "notes": [
          "With **Snap** ticked, the corners jump to the grid, so a room lines up with its squares.",
          "A click without dragging does nothing.",
          "Press **Esc** before you let go to cancel."
        ]
      },
      {
        "title": "Polygon",
        "steps": [
          "Click the **Polygon** button (the five-sided shape).",
          "Click each corner of the area in turn.",
          "Finish by clicking the first corner again, by right-clicking, or by pressing **Enter**."
        ],
        "notes": [
          "You need at least three corners. If you press **Enter** or right-click with only one or two, the polygon is thrown away.",
          "Clicking the last corner a second time (a double-click) also finishes the shape.",
          "The first corner shows as a dot, and a dashed line follows your mouse to show the next edge.",
          "While you're placing corners, press **Backspace** or **Delete** to take away the last corner. If only one corner is left, this throws the polygon away.",
          "Press **Esc** to throw the whole polygon away.",
          "Careful: when no polygon is in progress, **Backspace** and **Delete** delete whatever is selected, such as a token. **Undo** brings it back.",
          "Dragging while the polygon tool is on moves the map instead of adding a corner, so you can pan between clicks.",
          "Switching between Reveal and Hide, or choosing another shape or tool, throws away an unfinished polygon."
        ]
      },
      {
        "title": "Lasso",
        "steps": [
          "Click the **Lasso** button (the loop).",
          "Press and trace around the area you want.",
          "Let go. The shape closes itself between where you started and where you let go."
        ],
        "notes": [
          "The lasso follows your hand and doesn't snap to the grid. It suits caves and odd shapes.",
          "Press **Esc** before you let go to cancel."
        ]
      },
      {
        "title": "Snap",
        "steps": [
          "Choose **Rectangle** or **Polygon**.",
          "Tick or untick **Snap**."
        ],
        "notes": [
          "The **Snap** box only shows for Rectangle and Polygon.",
          "When it's ticked, corners jump to where the grid lines cross (its tooltip says \"Snap corners to the grid\"). On a hex grid, they jump to the nearest corner of a hex.",
          "Untick it to put corners anywhere."
        ]
      },
      {
        "title": "Player view",
        "steps": [
          "Click **Player view** in the fog options.",
          "Look over the map: the fog is now solid, just as players see it.",
          "Click **Player view** again to go back to dimmed fog."
        ],
        "notes": [
          "In Player view, hidden tokens, drawings and notes disappear, as they do for players.",
          "You can keep revealing and hiding while Player view is on.",
          "Choosing another tool turns Player view off.",
          "The eye on the button is crossed out while Player view is on."
        ]
      },
      {
        "title": "Cover all and Clear all",
        "steps": [
          "Click **Cover all** to put the whole map under fog, or **Clear all** to remove all fog.",
          "Read the box that asks you to confirm: **Cover the whole map?** or **Remove all fog?**",
          "Click **Cover all** (or **Clear all**) in the box to go ahead, or **Cancel** to leave things as they are."
        ],
        "notes": [
          "Both buttons remove every fog shape drawn on this scene so far, then start fresh: all covered, or all clear.",
          "After **Cover all**, the tool switches to **Reveal**, ready for you to open up areas.",
          "One **Undo** puts the fog back exactly as it was.",
          "The same two buttons are in the scene's settings, under **Fog**.",
          "A scene holds up to 5000 things in total: fog shapes, tokens, drawings and notes. One very long brush stroke can count as several.",
          "If a fog shape you draw disappears again and you see \"Some of that wasn't allowed, so it was undone.\", the scene may be full. **Cover all** or **Clear all** removes its fog shapes and makes room.",
          "If you see \"This room is full. Delete some drawings or fog shapes (or old scenes) to make room.\", **Cover all** or **Clear all** removes all of a scene's fog shapes at once."
        ]
      },
      {
        "title": "Undo and redo fog",
        "steps": [
          "Click **Undo** in the toolbar, or press **Ctrl+Z**, to take back your last change.",
          "Click **Redo**, or press **Ctrl+Shift+Z** (or **Ctrl+Y**), to put it back."
        ],
        "notes": [
          "Each brush stroke (however long), rectangle, polygon or lasso is one step. So is **Cover all** or **Clear all**.",
          "Undo only takes back your own changes, and only on the scene you're looking at. **Undo** is greyed out when there's nothing of yours left to undo on this scene.",
          "Undo remembers your last 200 changes of every kind (fog, tokens, drawings and notes together).",
          "It only covers changes made in this browser tab since you opened the room. Reloading the page starts a fresh history.",
          "If you undo something and then draw something new, you can't redo what you undid.",
          "On a Mac, **Cmd** works as well as Ctrl."
        ]
      }
    ]
  },
  {
    "id": "fog-recipes",
    "title": "Fog of war: step by step",
    "audience": "gm",
    "intro": "Quick recipes for the things you'll do most often with fog during a game.",
    "parts": [
      {
        "title": "Reveal a room as the party walks in",
        "steps": [
          "Press **F** (or click **Fog of war**).",
          "Click **Reveal**.",
          "Click **Rectangle**.",
          "Check that **Snap** is ticked.",
          "Drag from one corner of the room to the opposite corner.",
          "Let go. The room opens up for your players straight away."
        ],
        "notes": [
          "For an odd-shaped room, use **Polygon**: click around its corners, then press **Enter**.",
          "For a winding corridor or cave, use the **Brush** and paint along it. Press **]** to widen the brush."
        ]
      },
      {
        "title": "Hide something again",
        "steps": [
          "With the fog tool on, click **Hide**.",
          "Choose a shape, for example **Rectangle** or **Brush**.",
          "Draw over the area. It goes dark for players when you let go.",
          "Click **Reveal** again before you carry on uncovering."
        ],
        "notes": [
          "In Hide, the shape and the brush circle show in orange.",
          "Hide lays fog over exactly the area you draw, including any part you'd revealed before. If you cover too much, press **Ctrl+Z**."
        ]
      },
      {
        "title": "Check what players see",
        "steps": [
          "With the fog tool on, click **Player view**.",
          "Look over the map. The fog is solid, and hidden tokens, drawings and notes are gone.",
          "Click **Player view** again, or choose another tool, to go back to your normal view."
        ],
        "notes": [
          "Don't click on the map to test this. The fog tool is still on, so a click draws fog. With the Brush on Reveal, one click uncovers a spot for your players.",
          "If a banner says **Only you can see this scene.**, your players are on a different scene. Click **Show to players** when you're ready for them to see this one."
        ]
      },
      {
        "title": "Start over with the whole map covered",
        "steps": [
          "Press **F** for the fog tool.",
          "Click **Cover all**.",
          "In the **Cover the whole map?** box, click **Cover all**.",
          "Uncover the first area the party can see. The tool is already on **Reveal**."
        ],
        "notes": [
          "Changed your mind? Press **Ctrl+Z** and the old fog comes back.",
          "To show the whole map instead, use **Clear all**."
        ]
      },
      {
        "title": "Undo an accidental reveal",
        "steps": [
          "Make sure you're still looking at the same scene.",
          "Press **Ctrl+Z**, or click **Undo** in the toolbar. The whole last stroke or shape turns back into fog at once.",
          "If you undid one step too many, press **Ctrl+Shift+Z** or click **Redo**."
        ],
        "notes": [
          "Undo takes back your newest change of any kind on this scene. If you've moved a token or drawn something since the reveal, keep pressing it until the reveal is gone.",
          "If Undo can't reach it (for example after you've reloaded the page), click **Hide** and paint the fog back over that spot."
        ]
      }
    ]
  },
  {
    "id": "fog-scenes",
    "title": "How scenes start: covered or clear",
    "audience": "gm",
    "intro": "Each scene has a starting fog setting. Covered means players see nothing until you reveal it. Uncovered means players see everything until you hide it.",
    "parts": [
      {
        "title": "New scenes from a map",
        "steps": [
          "Open **Scenes** in the top bar.",
          "Click **New scene**.",
          "Choose **Upload a map** or **Uploaded maps**.",
          "Leave **Start with the map covered in fog** ticked so players see nothing until you reveal it, or untick it to show the whole map.",
          "Add the map. In **Upload a map**, click the box that says **Choose or drop maps** and pick your map file, or drop the file onto that box. In **Uploaded maps**, click the map."
        ],
        "notes": [
          "The scene is made as soon as you add the map, so set the tick box first. It starts ticked.",
          "An image you drop or paste straight onto the map only counts as a map if its longer side is at least 1600 pixels. Then it starts a new scene, covered in fog. A smaller image becomes a token instead. Pasting only works while a scene is showing.",
          "For **Blank grid** the box is called **Start covered in fog**, and it starts unticked. Use **Hide** or **Cover all** later if you want fog after all.",
          "An Owlbear Rodeo backup brings its own fog: the cover and every area you'd revealed or hidden in Owlbear, whatever the tick box says.",
          "Afterwards, a box called **Maps brought in** lists the new scenes and says \"Fog and tokens from Owlbear came too.\" Anything that didn't come over is listed under **Left out:**, for example fog shapes and tokens beyond what one scene can hold. Click **Done** to close it.",
          "Fog that came in from Owlbear isn't in your Undo history. Use **Clear all** or **Cover all** if you want to start fresh."
        ]
      },
      {
        "title": "The Fog section in a scene's settings",
        "steps": [
          "Open **Scenes** in the top bar.",
          "Click the pencil button (**Edit scene and grid**) on the scene.",
          "Scroll down to **Fog**. The line there tells you whether the scene starts covered or uncovered.",
          "Click **Cover all** or **Clear all**.",
          "Confirm in the box (**Cover the whole scene?** or **Remove all fog?**).",
          "Click **Done**."
        ],
        "notes": [
          "Clicking the pencil button also switches your own view to that scene. Players stay where they are.",
          "Both buttons remove the fog shapes drawn so far. **Undo** brings them back."
        ]
      },
      {
        "title": "Changing a scene's map",
        "steps": [
          "In the scene's settings, under **Map**, click **Choose uploaded** or **Upload new**.",
          "Pick the new map."
        ],
        "notes": [
          "A map of a different size starts fully covered again, and the old fog shapes are removed, because they wouldn't line up. The same happens when the scene had no map before (a **Blank grid** scene), whatever the size.",
          "When that happens you'll see \"The map starts covered in fog. Reveal areas with the fog tool.\" The grid size is also guessed again, so check the grid.",
          "A map of exactly the same size (a night version of the same map, say) keeps the fog as it is.",
          "**Undo** puts back the old map together with its fog."
        ]
      },
      {
        "title": "Set up the fog before players see a scene",
        "steps": [
          "In **Scenes**, click a scene to look at it on your own.",
          "Set up the fog with the fog tool.",
          "Click **Show to players** when you're ready."
        ],
        "notes": [
          "While you're looking at a scene your players aren't on, a banner says **Only you can see this scene.** and names the scene players are on (or says **Players have no scene.**). It has a **Show to players** button. When players are on a scene, it also has **Back to live scene** to take you back to it.",
          "You can also click the play button (**Show to players**) next to a scene in the list."
        ]
      }
    ]
  },
  {
    "id": "fog-what-players-see",
    "title": "What fog looks like for players and the GM",
    "audience": "everyone",
    "intro": "Fog is drawn over the map and everything on it. Players see it as solid darkness. The GM sees through it.",
    "parts": [
      {
        "title": "For players",
        "steps": [],
        "notes": [
          "Fog is solid and dark. It covers the map, tokens, drawings and notes underneath.",
          "You can't select, move or erase anything under the fog. With **Move & select**, dragging on fog just moves your view of the map.",
          "Selecting with a box (**Shift** and drag) skips anything under the fog.",
          "Rulers, spell areas while they're being dragged, and pointer trails show on top of the fog.",
          "Anything you draw or write on top of the fog ends up underneath it, so you won't see it, but the GM will. This includes a spell area you keep with **Pin to map**.",
          "Only the GM can change the fog."
        ]
      },
      {
        "title": "For the GM",
        "steps": [],
        "notes": [
          "You see the fog dimmed, at half strength, so you can still see the map and tokens under it.",
          "You can select and move things under the fog as usual.",
          "Use **Player view** in the fog options to see the fog exactly as your players do. It belongs to the fog tool and turns off as soon as you choose another tool.",
          "A table display (the screen button in the top bar) shows the fog solid, exactly as players see it.",
          "Fog only covers things up on screen. For a monster that must stay secret, also hide its token (select it and press **H**). Hidden tokens are never sent to players at all.",
          "The same goes for notes: a note under the fog still reaches players' browsers. For a note players must never read, tick **Only I can see this note** when you add it, or select it and press **H**."
        ]
      },
      {
        "title": "Fog is saved with the scene",
        "steps": [],
        "notes": [
          "Each scene has its own fog, stored with the scene, so it's still there next session and whenever you go back to that scene.",
          "**Download backup** in **Room settings** saves the fog along with everything else.",
          "Deleting a scene deletes its fog too, and this can't be undone."
        ]
      }
    ]
  },
  {
    "id": "second-screen",
    "title": "Showing the map on a second screen or a TV",
    "audience": "gm",
    "intro": "The table display shows the map on another screen at the table, exactly as players see it: no hidden tokens, no GM-only notes, and solid fog. Nothing can be changed from it.",
    "parts": [
      {
        "title": "Open the display",
        "steps": [
          "In your room, click the **monitor** button in the top bar (next to the **?** button). The **Table display** box opens.",
          "Click **Open display window**. A new window opens with just the map.",
          "Drag that window onto your second monitor.",
          "Double-click the map for full screen. Double-click again to leave full screen."
        ],
        "notes": [
          "For a TV, click **Copy display link** and open the link in the TV's browser, or cast the display window from Chrome (the **⋮** menu, then **Cast**).",
          "Keep the display link to yourself. Anyone with it sees the map as players do, and where you're looking.",
          "The monitor button shows a green dot while a display is connected."
        ]
      },
      {
        "title": "Choose what the display shows",
        "steps": [
          "Open **Table display** again from the monitor button.",
          "Under **The display shows**, pick **The whole live scene** to fit the whole map to the screen.",
          "Or pick **What I'm looking at, while I'm on the live scene**: the display then zooms and pans along with you."
        ],
        "notes": [
          "The display always shows the scene players are on. Previewing another scene yourself never moves it.",
          "When you show players a new scene, the display switches to it and shows all of it until you point it somewhere.",
          "During combat, the display shows the round and whose turn it is in the bottom corner.",
          "The display always shows the scene's season, if it has one, even on a computer where seasons are turned off (see **Seasons: snow, autumn leaves, blossom and drought**).",
          "The mouse pointer on the display hides itself after a few seconds. You can still drag and scroll on the display to move it yourself.",
          "While you use the Build tool, the display stays where it is rather than following you."
        ]
      }
    ]
  },
  {
    "id": "room-settings",
    "title": "Room settings and backups",
    "audience": "gm",
    "intro": "Only the GM has the **Room settings** panel. It holds the room's name, the invite link, what players are allowed to do, backups, and the option to delete the room.",
    "parts": [
      {
        "title": "Open Room settings",
        "steps": [
          "Click the gear button **Room settings** in the top bar."
        ],
        "notes": [
          "Players don't have this button."
        ]
      },
      {
        "title": "Rename the room",
        "steps": [
          "Click the **Room name** box.",
          "Type the new name.",
          "Press Enter or click somewhere else. Press Escape to cancel instead."
        ],
        "notes": [
          "Room names can be up to 60 characters.",
          "Everyone in the room sees the new name straight away. The name also changes in your list of rooms."
        ]
      },
      {
        "title": "Share the invite link",
        "steps": [
          "Click **Copy** next to **Invite link**. The button says **Copied** for a moment.",
          "Paste the link wherever your group talks, for example your group chat."
        ],
        "notes": [
          "Anyone with this link can join as a player, so only share it with your group.",
          "The **Copy invite link** button in the top bar copies the same link. Players have that button too.",
          "If your browser won't copy, the **Copy invite link** button in the top bar shows the link in a pop-up instead, so you can copy it yourself."
        ]
      },
      {
        "title": "Choose what players can do",
        "steps": [
          "Under **What players can do**, tick or untick a box."
        ],
        "notes": [
          "**Add tokens and upload token images**: when this is ticked, players can put tokens on the map, upload token images and duplicate tokens. When it's unticked, a player's **Tokens & images** panel only says \"The GM has turned off adding tokens for players.\", the **Duplicate** button is gone, and a player who drops or pastes an image onto the map gets a message ending \"You can't upload that kind of image to this room.\"",
          "**Move any unlocked token (off: only the ones they placed)**: when this is ticked, players can move and change any token that isn't locked or hidden. Changing means renaming, resizing, rotating, recolouring and setting status rings. When it's unticked, they can only move and change the tokens they placed themselves. Either way, players can only delete tokens they placed themselves.",
          "**Draw on the map**: when this is ticked, players can draw, add notes and pin spell templates to the map. When it's unticked, a player who tries to draw sees \"The GM has turned drawing off.\" They can still move and erase the drawings they made before.",
          "In a new room, all three boxes are ticked. Changes take effect for everyone straight away.",
          "Players can never move a hidden or locked token, whatever these boxes say. As the GM, you can always do everything."
        ]
      },
      {
        "title": "Download a backup",
        "steps": [
          "Click **Download backup**.",
          "Wait while it counts through the images (for example \"Fetching images 3 of 12…\") and then shows \"Packing…\".",
          "Keep the file your browser saves. Its name is the room's name and the date, and it ends in .tabletop.zip."
        ],
        "notes": [
          "The file holds every scene, token, drawing and note, the fog, and all uploaded images.",
          "It doesn't hold the chat or the initiative list.",
          "Download a backup before big changes, and before you delete a room."
        ]
      },
      {
        "title": "Restore a backup",
        "steps": [
          "Go into the room you want the scenes in. It can be a brand-new room.",
          "Open **Room settings**.",
          "Click **Restore…**.",
          "Choose a backup file made with **Download backup**.",
          "Wait while it uploads the images and adds the scenes."
        ],
        "notes": [
          "The backup's scenes are added as new scenes, after the scenes already in the room. Nothing already in the room changes, including its name and what players can do.",
          "Restored scenes don't change what players see. To show one, open **Scenes** and click **Show to players** on it.",
          "When the restore is done, a message tells you how much came back, for example \"Restored 3 scenes and 12 images from “Room name”.\"",
          "If you restore the same backup twice, you get two copies of each scene. The images are uploaded again too, so it uses twice as much of the room's image space.",
          "**Undo** can't take back a restore.",
          "A room can hold at most 100 scenes. Once it's full, any more scenes from the backup are refused with \"A room can hold at most 100 scenes.\"",
          "If the room runs out of space for images, the restore stops with \"This room has as many images as it can hold. Delete some first.\"",
          "If the file isn't a Tabletop backup, you see a message such as \"That isn't a Tabletop backup (no room.json).\"",
          "**Restore…** only takes backups made by Tabletop. To bring in an Owlbear Rodeo backup (.ob2), use **New scene** in the **Scenes** panel instead."
        ]
      },
      {
        "title": "Delete the room",
        "steps": [
          "Under **Danger zone**, click **Delete this room**.",
          "Click **Delete room** to confirm, or click **Cancel**."
        ],
        "notes": [
          "This deletes the room and everything in it (scenes, tokens, uploaded images and chat) for good.",
          "When it's done, you go back to the start page. Everyone still in the room is disconnected and sees \"This room was deleted\".",
          "If you might want any of it again, download a backup first."
        ]
      }
    ]
  },
  {
    "id": "shortcuts",
    "title": "Keyboard shortcuts",
    "audience": "everyone",
    "intro": "Shortcuts work anywhere in the room, except while you're typing in a box, while a drop-down list (such as a token's size) is still selected, or while a window is open. If a shortcut doesn't respond, click the map first. On a Mac, use Cmd wherever it says Ctrl.",
    "parts": [
      {
        "title": "See the list in the app",
        "steps": [
          "Click the **Help & shortcuts** button (the question mark) in the top bar."
        ],
        "notes": [
          "On narrow screens such as phones, this button is hidden."
        ]
      },
      {
        "title": "Tools",
        "steps": [],
        "notes": [
          "**V**: Move & select",
          "**D**: Draw",
          "**E**: Eraser (drawings, notes and tokens)",
          "**M**: Measure",
          "**P**: Pointer",
          "**F**: Fog of war (GM)",
          "**B**: Build the map (GM)",
          "**X**: **Select** in Build the map, and back again (GM)"
        ]
      },
      {
        "title": "Moving around the map",
        "steps": [],
        "notes": [
          "**Drag empty map**: move your view, while **Move & select** is on",
          "**Right- or middle-button drag**: move your view, with any tool",
          "**Space+drag**: move your view, with any tool",
          "**Mouse wheel**: zoom in and out around the pointer (GM: in the Build tool's **Objects**, and in **Select** with objects selected, it turns objects instead)",
          "**Ctrl+mouse wheel**: zoom, always, even where the wheel turns objects or moves the map (small, smooth wheel steps are treated like a trackpad scroll)",
          "**Pinch** on a trackpad: zoom",
          "**Two-finger scroll** on a trackpad: move your view",
          "**Two-finger pinch** on a phone or tablet: zoom",
          "**Two-finger drag** on a phone or tablet: move your view, with any tool. With **Move & select** on, one finger on empty map also moves it.",
          "**+** (or **=**): zoom in",
          "**−** (or **_**): zoom out",
          "**0**: fit the whole scene on screen",
          "At the bottom right of the map are **Zoom out (−)**, the zoom percentage (click it to fit the scene), **Zoom in (+)** and **Fit the scene (0)**. On narrow screens the percentage is hidden."
        ]
      },
      {
        "title": "Selecting and changing things",
        "steps": [],
        "notes": [
          "**Shift+click**: add something to the selection, or take it out",
          "**Shift+drag** on empty map: select everything inside a box (in the Build tool's **Select**, a plain drag on empty floor does it)",
          "**Right-click** a token or drawing: select it (except while you're drawing a fog polygon or placing wall corners, where a right-click finishes, and in the Build tool, where it never selects tokens and in **Objects** and **Select** turns objects 90°)",
          "**Escape**: stop what you're in the middle of (a drag, a drawing, a measurement), or clear the selection",
          "**Arrow keys**: move the selected tokens one square (or one hex)",
          "**[** and **]**: rotate the selected tokens 45 degrees (hold **Shift** for 15 degrees)",
          "**Alt** while letting go of a token you're dragging: don't snap to the grid",
          "**H**: hide or show the selected tokens, drawings and notes (GM)",
          "**L**: lock or unlock the selected tokens (GM)",
          "**Delete** or **Backspace**: delete the selection",
          "**Ctrl+D**: duplicate the selected tokens (copies are numbered)"
        ]
      },
      {
        "title": "Undo and paste",
        "steps": [],
        "notes": [
          "**Ctrl+Z**: undo your own last change on this scene",
          "**Ctrl+Shift+Z** or **Ctrl+Y**: redo",
          "**Ctrl+V**: paste a picture as a token. For the GM, a big picture opens the **New scene** window instead. In the Build tool's **Select**, it pastes objects you copied (GM)",
          "**Ctrl+C** in the Build tool's **Select**: copy the selected objects (GM)"
        ]
      },
      {
        "title": "Fog of war (GM)",
        "steps": [],
        "notes": [
          "**[** and **]** with the fog brush: make the brush half a square smaller or bigger, or two squares with **Shift** held (GM)",
          "**Enter** or a right-click while drawing a fog polygon: close it, same as clicking the first point (GM)",
          "**Backspace** while drawing a fog polygon: remove the last corner (GM)",
          "**Escape** while drawing a fog polygon: cancel it (GM)"
        ]
      },
      {
        "title": "Building a map (GM)",
        "steps": [],
        "notes": [
          "**[** and **]** with the brush in **Building** or **Terrain**: make the brush a square smaller or bigger (GM)",
          "**[** and **]** with **Objects**: turn the next object 15° (**Shift**: 5°); in **Select**, the selected objects (GM)",
          "**Mouse wheel** with **Objects**: turn the next object 15°; **Z**+wheel 5°; **Alt**+wheel: bigger or smaller. In **Select**, the same for the selected objects (GM)",
          "**Right-click** with **Objects**: turn the next object 90°; in **Select**, the selected objects (or the one under the pointer); with **Walls**, finish the walls you're placing corner by corner (GM)",
          "**X**: **Select**, and back (GM)",
          "In **Select**: **Delete** removes, **Ctrl+D** duplicates, **Ctrl+C** and **Ctrl+V** copy and paste, the arrow keys move (**Shift**: five squares), **Escape** deselects (GM)",
          "**Alt** while you drag or click: take away instead of adding (cut out a room, erase terrain, remove walls, doors or objects) (GM)",
          "**Enter** or a double-click: finish walls placed corner by corner; **Backspace** takes the last corner back (GM)",
          "**Escape** while dragging or placing corners: stop without changing anything (GM)",
          "**Ctrl+mouse wheel**: zoom, as in Dungeondraft"
        ]
      },
      {
        "title": "In boxes and windows",
        "steps": [],
        "notes": [
          "**Enter** in the note window: add the note",
          "**Shift+Enter** in the note window: start a new line",
          "**Enter** in a token's **Name** box: save the name",
          "**Escape** in a token's **Name** box: cancel the change",
          "**Escape**: close any open window. Clicking outside a window also closes it."
        ]
      }
    ]
  },
  {
    "id": "troubleshooting",
    "title": "Troubleshooting",
    "audience": "everyone",
    "intro": "Quick fixes for the problems people run into most often.",
    "parts": [
      {
        "title": "The GM can't sign in",
        "steps": [
          "Read the message under the sign-in buttons and look it up in \"What the sign-in messages mean\".",
          "If it says the Google account isn't one of this table's GMs, click **Sign in with Google** again and choose the account the GM uses.",
          "If it says the sign-in took too long, click **Sign in with Google** again and finish within 10 minutes, without starting another sign-in in this browser meanwhile.",
          "If there's no **Sign in with Google** button, use the GM password, or ask whoever runs the table to finish setting up sign-in."
        ],
        "notes": [
          "\"Too many wrong passwords. Try again in 15 minutes.\" means password sign-in is paused for your connection. Wait it out, or use **Sign in with Google** if it's set up.",
          "If the start page says \"Couldn't reach the server. Check your connection.\", check your internet, then click **Try again**.",
          "A page from Google during sign-in, such as a warning that it hasn't verified the app, isn't a Tabletop error. Follow Google's prompts to carry on."
        ]
      },
      {
        "title": "I'm the GM, but the room treats me as a player",
        "steps": [
          "Go to table.parhome.ca in the same browser.",
          "Sign in.",
          "Open the room again from **Your rooms**."
        ],
        "notes": [
          "Whether you're the GM is decided when the room opens, by whether that browser is signed in. On a new device or a different browser, sign in there first.",
          "Signs that you're in as a player: no **Scenes** or **Room settings** buttons, no **Fog of war** tool, and the logo instead of the house button at the top left."
        ]
      },
      {
        "title": "The room link doesn't work",
        "steps": [
          "If you see **That room link isn't complete**, the link was cut short. A room link ends in a 12-character code.",
          "Copy the whole link again, or ask the GM to send it again.",
          "Once you have the whole link, you can also click **Go to the start page** and paste it into the **Join a game** box."
        ],
        "notes": [
          "Pasting the cut-short link on the start page won't help: **Join** stays greyed out until what you pasted contains a whole room link or code.",
          "Copy and paste links rather than typing them. The code mixes capital and small letters, and the difference matters.",
          "**Nothing here** (\"That page doesn't exist.\") means the address isn't a Tabletop page at all. Check the start of the link."
        ]
      },
      {
        "title": "\"Room not found\" or \"This room was deleted\"",
        "steps": [
          "If you see **Room not found**, check the link with your GM.",
          "Ask the GM for the link again. The room may have been deleted.",
          "Click **Go to the start page** to leave the message."
        ],
        "notes": [
          "**This room was deleted** means the GM deleted the room and everything in it. It's gone for good.",
          "If an image upload fails with \"This room doesn't exist.\", the room has been deleted too."
        ]
      },
      {
        "title": "Lost connection",
        "steps": [
          "Wait while \"Connection lost. Reconnecting…\" is showing. It reconnects by itself.",
          "Check your Wi-Fi or mobile data if it doesn't clear.",
          "Reload the page if it still won't reconnect."
        ],
        "notes": [
          "Changes you made while disconnected are sent once the connection is back, as long as you haven't reloaded.",
          "On a phone, switching back to the browser makes it try again straight away."
        ]
      },
      {
        "title": "A player can't see something the GM can",
        "steps": [
          "GM: select the token, drawing or note and look at the eye button in the selection bar.",
          "If it says **Hidden from players (H)**, click it (or press H) so it says **Visible to players (H)**.",
          "Look for the \"Only you can see this scene.\" banner. If it's there, you're previewing a scene the players can't see.",
          "Click **Show to players** to bring everyone to this scene, or **Back to live scene** to see theirs.",
          "For fog, pick **Fog of war** and click **Player view** to see the fog exactly as players do."
        ],
        "notes": [
          "For a drawing or note, the eye button says **Only you can see this (H)** while it's hidden.",
          "Hidden tokens, drawings and notes look faded to the GM. Players' browsers never receive them at all.",
          "The GM sees fog dimmed, so the map shows through it. Players see it solid and can't select anything under it.",
          "While **Player view** is on, hidden tokens and GM-only drawings and notes disappear from your map as well, so you see exactly what players see. **Player view** turns off when you pick another tool.",
          "Initiative entries for hidden tokens aren't shown to players. When it's that token's turn, players see \"It's the turn of someone you can't see.\"",
          "A GM roll with **Hidden** ticked is seen only by the GM. A player's roll with **To GM** ticked is seen only by that player and the GM.",
          "Players never get the **Scenes** or **Room settings** panels, or the **Fog of war** and **Build the map** tools."
        ]
      },
      {
        "title": "\"Tabletop has been updated. Reload this page to get the new version.\"",
        "steps": [
          "Click **Update: Reload** in the top bar, or reload the page yourself (F5, or Cmd+R on a Mac)."
        ],
        "notes": [
          "It shows on a page that was already open when Tabletop was updated. That page is still running the old version: it doesn't have the new tools, and it can't show everything on a newer map (a built map, say) until it's reloaded.",
          "A table display reloads itself when Tabletop is updated. A display opened before this reload notice existed can't, and can't show messages either, so the GM is told instead: \"A table display is running an older version of Tabletop. Reload the display's page.\" Reload the page on the display's screen.",
          "If a GM tool you've read about isn't in your toolbar (the hammer for **Build the map**, say), reload first. If it's still missing, check you're signed in as the GM: see \"I'm the GM, but the room treats me as a player\"."
        ]
      }
    ]
  }
];
