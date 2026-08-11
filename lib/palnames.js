// lib/palnames.js
// Map Palworld INTERNAL codenames (what the game's Blueprint classes are named, e.g.
// "WoolFox", "NegativeKoala") to their friendly display names ("Cremis", "Depresso").
//
// The PSMDeathRelay UE4SS mod reports a killer by its internal class name because that's
// what's cheaply and reliably readable at the death site. This turns it into a name a
// player recognises. Anything not listed falls back to a prettified codename
// ("SomeNewPal" -> "Some New Pal"), which is always readable.
//
// Pal mapping source: community "Code Name -> Pal Name" dataset
// (github.com/SoTMaulder/SoTMaulder-Palworld, cross-checked against palworld.wiki.gg).
// Isomorphic (no node builtins) so the UI can reuse it.

const PAL_NAMES = {
  Alpaca: "Melpaca", AmaterasuWolf: "Kitsun", Anubis: "Anubis", Baphomet: "Incineram",
  Baphomet_Dark: "Incineram Noct", Bastet: "Mau", Bastet_Ice: "Mau Cryst",
  BerryGoat: "Caprity", BirdDragon: "Vanwyrm", BirdDragon_Ice: "Vanwyrm Cryst",
  BlackCentaur: "Necromus", BlackFurDragon: "Dragostrophe", BlackGriffon: "Shadowbeak",
  BlackMetalDragon: "Astegon", BlueDragon: "Azurobe", BluePlatypus: "Fuack",
  Boar: "Rushoar", CaptainPenguin: "Penking", Carbunclo: "Lifmunk", CatBat: "Tombat",
  CatMage: "Katress", CatVampire: "Felbat", ChickenPal: "Chikipi", ColorfulBird: "Tocotoco",
  CowPal: "Mozzarina", CuteButterfly: "Cinnamoth", CuteFox: "Vixy", CuteMole: "Fuddler",
  DarkCrow: "Cawgnito", DarkScorpion: "Menasting", Deer: "Eikthyrdeer",
  Deer_Ground: "Eikthyrdeer Terra", DreamDemon: "Daedream", DrillGame: "Digtoise",
  Eagle: "Galeclaw", ElecCat: "Sparkit", ElecLion: "Boltmane", ElecPanda: "Grizzbolt",
  FairyDragon: "Elphidran", FairyDragon_Water: "Elphidran Aqua", FengyunDeeper: "Fenglope",
  FireKirin: "Pyrin", FireKirin_Dark: "Pyrin Noct", FlameBambi: "Rooby",
  FlameBuffalo: "Arsox", FlowerDinosaur: "Dinossom", FlowerDinosaur_Electric: "Dinossom Lux",
  FlowerDoll: "Petallia", FlowerRabbit: "Flopie", FlyingManta: "Celaray", FoxMage: "Wixen",
  Ganesha: "Teafant", Garm: "Direhowl", GhostBeast: "Maraith", Gorilla: "Gorirat",
  GrassMammoth: "Mammorest", GrassMammoth_Ice: "Mammorest Cryst", GrassPanda: "Mossanda",
  GrassPanda_Electric: "Mossanda Lux", GrassRabbitMan: "Verdash", HadesBird: "Helzephyr",
  HawkBird: "Nitewing", Hedgehog: "Jolthog", Hedgehog_Ice: "Jolthog Cryst",
  HerculesBeetle: "Warsect", Horus: "Faleris", IceDeer: "Reindrix", IceFox: "Foxcicle",
  IceHorse: "Frostallion", IceHorse_Dark: "Frostallion Noct", JetDragon: "Jetragon",
  Kelpie: "Kelpsea", Kelpie_Fire: "Kelpsea Ignis", KingAlpaca: "Kingpaca",
  KingAlpaca_Ice: "Ice Kingpaca", KingBahamut: "Blazamut", Kirin: "Univolt",
  Kitsunebi: "Foxparks", LavaGirl: "Flambelle", LazyCatfish: "Dumud",
  LazyDragon: "Relaxaurus", LazyDragon_Electric: "Relaxaurus Lux", LilyQueen: "Lyleen",
  LilyQueen_Dark: "Lyleen Noct", LittleBriarRose: "Bristla", LizardMan: "Leezpunk",
  LizardMan_Fire: "Leezpunk Ignis", Manticore: "Blazehowl", Manticore_Dark: "Blazehowl Noct",
  Monkey: "Tanzee", MopBaby: "Swee", MopKing: "Sweepa", Mutant: "Lunaris",
  NaughtyCat: "Grintale", NegativeKoala: "Depresso", NegativeOctopus: "Killamari",
  NightFox: "Nox", Penguin: "Pengullet", PinkCat: "Cattiva", PinkLizard: "Lovander",
  PinkRabbit: "Ribbuny", PlantSlime: "Gumoss", QueenBee: "Elizabee", RaijinDaughter: "Dazzi",
  RedArmorBird: "Ragnahawk", RobinHood: "Robinquill", RobinHood_Ground: "Robinquill Terra",
  Ronin: "Bushi", SaintCentaur: "Paladius", SakuraSaurus: "Broncherry",
  SakuraSaurus_Water: "Broncherry Aqua", Serpent: "Surfent", Serpent_Ground: "Surfent Terra",
  SharkKid: "Gobfin", SharkKid_Fire: "Gobfin Ignis", SheepBall: "Lamball",
  SkyDragon: "Quivern", SoldierBee: "Beegarde", Suzaku: "Suzaku", Suzaku_Water: "Suzaku Aqua",
  SweetsSheep: "Woolipop", ThunderBird: "Beakon", ThunderDog: "Rayhound",
  ThunderDragonMan: "Orserk", Umihebi: "Jormuntide", Umihebi_Fire: "Jormuntide Ignis",
  VioletFairy: "Vaelet", VolcanicMonster: "Reptyro", VolcanicMonster_Ice: "Ice Reptyro",
  WeaselDragon: "Chillet", Werewolf: "Loupmoon", WhiteMoth: "Sibelyx", WhiteTiger: "Cryolinx",
  Windchimes: "Hangyu", Windchimes_Ice: "Hangyu Cryst", WizardOwl: "Hoocrates",
  WoolFox: "Cremis", Yeti: "Wumpo", Yeti_Grass: "Wumpo Botan",
  // Tower bosses (human + partner Pal duos)
  GrassBoss: "Zoe & Grizzbolt", ForestBoss: "Lily & Lyleen", DessertBoss: "Marcus & Faleris",
  VolcanoBoss: "Axel & Orserk", SnowBoss: "Victor & Shadowbeak",
};

// Human/faction NPCs (killerKind "npc"). The internal is BP_NPC_<X>_C -> "NPC_<X>".
const NPC_NAMES = {
  NPC_Police: "PIDF",
};

// Insert spaces at lowerUpper / letterDigit boundaries so an unlisted codename still
// reads cleanly.
function prettify(internal) {
  return String(internal || "")
    .replace(/_+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .trim();
}

// Resolve an internal codename to a display name: exact Pal, exact NPC, then a
// prefix/affix-stripped retry, then a prettified fallback.
function displayName(internal) {
  const raw = String(internal || "").trim();
  if (!raw) return "";
  if (PAL_NAMES[raw]) return PAL_NAMES[raw];
  if (NPC_NAMES[raw]) return NPC_NAMES[raw];
  const stripped = raw
    .replace(/^(BOSS_|Boss_|GYM_|RAID_|NPC_)/i, "")
    .replace(/_(Boss|Flower|2|3)$/i, "");
  if (PAL_NAMES[stripped]) return PAL_NAMES[stripped];
  if (NPC_NAMES["NPC_" + stripped]) return NPC_NAMES["NPC_" + stripped];
  return prettify(stripped);
}

// Resolve a codename to a display name honouring user overrides, most specific
// first: a WORLD-level override wins, then a GLOBAL override, then the built-in
// default map (displayName). Both maps are plain { codename: "Display" } objects;
// either may be null/absent. This is the single source of truth for the priority
// chain — the supervisor uses it when recording a death, and the API reuses it to
// re-render past deaths after an override changes.
function resolve(internal, worldMap, globalMap) {
  const raw = String(internal || "").trim();
  if (!raw) return "";
  if (worldMap && typeof worldMap[raw] === "string" && worldMap[raw].trim()) return worldMap[raw].trim();
  if (globalMap && typeof globalMap[raw] === "string" && globalMap[raw].trim()) return globalMap[raw].trim();
  return displayName(raw);
}

// Whether a codename is one the built-in map knows (exactly). Used to flag Pals
// seen in-game that aren't mapped yet ("new Pal" detection) so they surface in the
// editor for the user to name.
function isKnown(internal) {
  const raw = String(internal || "").trim();
  return !!(raw && (PAL_NAMES[raw] || NPC_NAMES[raw]));
}

// The full built-in catalog as a sorted list, so the UI can show every Pal/NPC the
// app ships a name for (searchable, each editable). kind is "npc" for faction NPCs
// (Chikipi et al. are "pal"). Names come from the defaults; overrides layer on top
// in the editor.
function catalog() {
  const out = [];
  for (const [codename, name] of Object.entries(PAL_NAMES)) out.push({ codename, name, kind: "pal" });
  for (const [codename, name] of Object.entries(NPC_NAMES)) out.push({ codename, name, kind: "npc" });
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Normalise a { codename: "Display" } override map from the client into something safe
// to persist: string keys/values, trimmed, empties dropped (an empty value means "revert
// to inherited"), with sane length + count caps. Isomorphic — the API validates with it.
function sanitizeOverrides(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (n >= 5000) break;
    const key = String(k == null ? "" : k).trim();
    const val = String(v == null ? "" : v).trim();
    if (!key || !val || key.length > 100 || val.length > 80) continue;
    out[key] = val;
    n++;
  }
  return out;
}

// From codenames seen in deaths, the ones with no name yet: not in the built-in map and
// not covered by the given override map (pass world+global merged, or just global). Each
// carries a prettified fallback so the editor can show what it currently displays as.
function unmapped(seenRows, overrides) {
  const ov = overrides || {};
  const out = [];
  for (const r of seenRows || []) {
    const code = r && r.codename;
    if (!code || isKnown(code) || ov[code]) continue;
    out.push({ codename: code, kind: r.kind || "pal", fallback: displayName(code), n: r.n || 0, last_at: r.last_at || 0 });
  }
  return out;
}

module.exports = { PAL_NAMES, NPC_NAMES, displayName, prettify, resolve, isKnown, catalog, sanitizeOverrides, unmapped };
