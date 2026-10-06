# Biomes on the character sheets: plan

Status: designed, not applied yet. The session that designed this had Google Drive (read only) but no
Google Sheets connector, so it couldn't edit the sheets. Apply it from a session with the Google Sheets
connector turned on.

The sheets are Google Sheets in the owner's Drive, built from the group's homebrew Player's Handbook
(27-09-26). Find them with Drive search by title. Apply to every sheet built from the template:

- PHB Character Sheet (Tablet): the blank template
- PHB Character Sheet (Tablet, DM)
- Grimmdark, Nancael (Tablet), Utsukushi Shi, Baldr, Malspar, Aldora Windbrine

Leave the old pre-template sheets alone ("Shi character sheet", "Copy of Shi character sheet",
"Nancael_Revised_Rules.xlsx").

Before editing each sheet, check it has the same layout as the one this plan was designed on
(Grimmdark and Nancael, 6 October 2026):

- Skills: skills in A6:A35, with Rank in column D, and columns I onward empty.
- Ref Skills: a single "Wilderness Acumen" row at row 45, the last row.
- Ref Features: the "Wilderness Acumen and biome adjacency" row at row 18.
- Character: row 67 empty, between "Next unlock" (66) and "PRAYED FOR TODAY" (68).

If a sheet differs, adapt the row numbers and say so in the report.

## The rules the sheet implements (handbook: Ranger section, and the Wilderness Acumen skill)

There are eight biomes. Wilderness Acumen (WA) is a separate skill for each one.

| Biome | Adjacent biomes |
|---|---|
| Northern | Temperate Forest |
| Temperate Forest | Northern, Temperate Rainforest, Plains |
| Temperate Rainforest | Temperate Forest, Warm Rainforest |
| Warm Forest | Plains, Warm Rainforest |
| Plains | Temperate Forest, Warm Forest, Desert |
| Warm Rainforest | Temperate Rainforest, Warm Forest, Jungle |
| Jungle | Warm Rainforest |
| Desert | Plains |

- **Familiar biome:** one where the character has WA of 1 or more.
- **Adjacent biome:** the character counts as having half their WA, rounded down, in each biome next to
  one where they have WA. The WA must be at least 2 for this to count. It applies to anyone with WA,
  not only rangers.
- Adjacency comes only from a biome's own WA score. It doesn't chain: an adjacent score doesn't make
  the next biome along adjacent.
- If a biome has both its own WA and an adjacent score, the higher one counts. They don't add up.

## Changes

### 1. New hidden tab "Ref Biomes"

| | A | B | C | D |
|---|---|---|---|---|
| 1 | Biome | Adjacent 1 | Adjacent 2 | Adjacent 3 |
| 2 | Northern | Temperate Forest | | |
| 3 | Temperate Forest | Northern | Temperate Rainforest | Plains |
| 4 | Temperate Rainforest | Temperate Forest | Warm Rainforest | |
| 5 | Warm Forest | Plains | Warm Rainforest | |
| 6 | Plains | Temperate Forest | Warm Forest | Desert |
| 7 | Warm Rainforest | Temperate Rainforest | Warm Forest | Jungle |
| 8 | Jungle | Warm Rainforest | | |
| 9 | Desert | Plains | | |

Hide the tab like the other Ref tabs. Add a named range `biome_adjacency` = `'Ref Biomes'!A1:D9`,
because the Ranger feature text says "See biome_adjacency".

### 2. One Wilderness Acumen skill per biome (Ref Skills)

Insert 8 rows above the "Wilderness Acumen" row (row 45), so they land in rows 45 to 52 and the
generic row moves to 53. Inserting inside the range makes every `'Ref Skills'!$X$2:$X$45` reference
grow to `$53`. That includes the Skills tab's E to H formulas, the skill dropdown on Skills!A6:A35 and
the Character tab's skill list. Check afterwards that all of them did.

- In column A, put "Wilderness Acumen (Northern)", "Wilderness Acumen (Temperate Forest)" and so on,
  for all 8 biomes.
- For columns B to L, copy the generic Wilderness Acumen row's values (copyPaste, values and formats).

This makes per-biome names the book skill names. The skill picker offers them, the "Benefit at this
rank" text fills in, and the Character tab stops flagging them as "not a book skill name". Keep the
generic row for sheets that haven't named a biome yet.

### 3. Biomes block on the Skills tab, J4:O14

- J4: `BIOMES (Wilderness Acumen, p79)`. Style it like A4 ("SKILLS").
- J5:O5 headers, styled like row 5: `Biome | Your WA | Best adjacent WA | Adjacent to | Counts as | Status`

For row 6, then fill down to row 13 (J6 to J13 point at 'Ref Biomes' rows 2 to 9):

| Cell | Formula |
|---|---|
| J6 | `='Ref Biomes'!A2` |
| K6 | `=MAXIFS($D$6:$D$35,$A$6:$A$35,"Wilderness Acumen ("&$J6&")")` |
| L6 | `=MAX(0,ARRAYFORMULA(COUNTIF(INDEX('Ref Biomes'!$B$2:$D$9,MATCH($J6,'Ref Biomes'!$A$2:$A$9,0),0),$J$6:$J$13)*$K$6:$K$13))` |
| M6 | `=IF(L6=0,"",INDEX($J$6:$J$13,MATCH(L6,ARRAYFORMULA(COUNTIF(INDEX('Ref Biomes'!$B$2:$D$9,MATCH($J6,'Ref Biomes'!$A$2:$A$9,0),0),$J$6:$J$13)*$K$6:$K$13),0)))` |
| N6 | `=MAX(K6,IF(L6>=2,INT(L6/2),0))` |
| O6 | `=IF(K6>0,"Familiar",IF(N6>0,"Adjacent: half of "&M6&" "&L6,"—"))` |

J14 shows a warning when a Wilderness Acumen skill has no biome, or has a misspelt one:

```
=IF(COUNTIF($A$6:$A$35,"Wilderness Acumen*")-SUMPRODUCT(COUNTIF($A$6:$A$35,"Wilderness Acumen ("&$J$6:$J$13&")"))>0,"A Wilderness Acumen skill has no biome: pick ""Wilderness Acumen (biome)"" in column A.","")
```

Number format K6:N13 as whole numbers. Use conditional formatting to dim rows whose Status is "—".

### 4. Biomes line on the Character tab, row 67

- A67: `Biomes`. Style it like A64 to A66.
- Merge B67:H67, like B64:H64 to B66:H66.
- B67:

```
=IFERROR(TEXTJOIN(", ",TRUE,ARRAYFORMULA(FILTER(Skills!$J$6:$J$13&" "&Skills!$N$6:$N$13&IF(Skills!$K$6:$K$13>0,""," (adjacent)"),Skills!$N$6:$N$13>0))),"—")&IF(Skills!$J$14<>"","  ⚠ "&Skills!$J$14,"")
```

### 5. Feature text (Ref Features, row 18, column D)

Replace "See biome_adjacency." with "See Biomes on the Skills tab."

### 6. Data fixes

- **Grimmdark, Skills tab:**
  - Rename A21 "Wilderness Acumen (Northern/Arctic)" to "Wilderness Acumen (Northern)".
  - Rename A23 "Wilderness Acumen (Wam Rainforest)" to "Wilderness Acumen (Warm Rainforest)".
- **Nancael:** don't guess her two Wilderness Acumen skills (ranks 4 and 3, no biome named). The J14
  warning will show until the biomes are picked. See question 5.

## Check after applying

Read Skills!J4:O14 and Character!A67:H67 back.

Grimmdark should come out as follows (Temperate Forest 4, Plains 3 and Warm Forest 1 of its own):

| Biome | Counts as | Why |
|---|---|---|
| Temperate Forest | 4 | Familiar |
| Plains | 3 | Familiar |
| Northern | 2 | Adjacent: half of Temperate Forest 4 |
| Temperate Rainforest | 2 | Adjacent: half of Temperate Forest 4 |
| Warm Forest | 1 | Familiar (its own 1 equals half of Plains 3) |
| Desert | 1 | Adjacent: half of Plains 3 |
| Warm Rainforest | 0 | Its best neighbour, Warm Forest, is only 1 |
| Jungle | 0 | Nothing adjacent |

Also check that no formula on Skills E6:H35 or Character rows 84 onward has turned into an error, and
that the Skills!A6:A35 dropdown lists the 8 new names.

## Open questions for the DM (not built until answered)

1. **Terrain that isn't a biome.** Mountains, hills, swamps and bogs, tundra and coast are in the
   terrain difficulty table (and the Bushmaster example uses "heavy mountains"), but no WA covers them.
   Should they map onto existing biomes or become new ones? This matters for Dwerv and for Hill Urk
   country.
2. **How adjacency works.** The handbook gives three versions:
   - The Ranger section gives half your score automatically, if your WA is at least 2.
   - The WA skill table says you "will adapt to adjacent terrain" only at rank 3.
   - The WA skill text says you can *learn* WA in a neighbouring biome at a cheaper aptitude.

   The sheet uses the first version, rounded down. Which one is right?
3. **Movement.** The general rule lowers a terrain's class by your full WA, or by half for a
   "non-applicable" WA (any biome, not just adjacent ones). Bushmaster 3rd level lowers it by 1 or your
   WIS bonus. Do they stack, and does the half rule need adjacency? Movement isn't built into the sheet
   until this is settled.
4. **"Hardy Traveller".** Grimmdark's Notes tab says the rank-0 biomes are usable through the Survivor
   path's "Hardy Traveller". No such feature exists in the handbook or the sheet. What did it mean?
5. **Nancael's biomes.** Her old sheet had Wilderness Acumen "(F)" at 4 and "(H)" at 3, perhaps Forest
   and Hills. Hills isn't a biome (see question 1). Which two biomes are they now?
6. **Small things:**
   - The handbook's worked example leaves Temperate Rainforest out of Temperate Forest's neighbours,
     but the chart includes it. The sheet follows the chart.
   - WA ranks 5 and 6 have identical text.
   - Is "own WA or adjacent, whichever is higher" right?
