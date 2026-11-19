/**
 * The recorded sounds NavBharatAI games use (admin request 2026-11-19: best game experience at the lowest cost).
 * [name, Oculus Audio Pack id, loops, bus, core, prompt words]. A name that matches a built-in synth voice
 * (step, click, hit, rain…) REPLACES that voice; a core sound goes into every new game with audio; the rest
 * only when the prompt names one of its words. Changing a row changes the catalogue: rebuild with
 * scripts/library/buildSoundLibrary.mts.
 */
export type SoundBus = 'sfx' | 'music' | 'ui';
export type SoundPick = [name: string, id: string, loop: boolean, bus: SoundBus, core: boolean, words: string[]];
export const SOUND_PICKS: SoundPick[] = [
  ["step", "FEETHmn_ShoeGrassWalk_OS_01", false, "sfx", true, []],
  ["land", "FEETHmn_ShoeGrassLand_OS_01", false, "sfx", true, []],
  ["click", "UIClick_CasualPopsConfirm_OS_01", false, "ui", true, []],
  ["error", "UIAlert_CasualPopsError_OS_01", false, "ui", true, []],
  ["hit", "FGHTImpt_PunchRegular_OS_01", false, "sfx", true, []],
  ["impact", "FGHTImpt_PunchHarder_OS_01", false, "sfx", true, []],
  ["swing", "WHSH_WhooshMedium_OS_01", false, "sfx", true, []],
  ["powerup", "UIMisc_Powerup_OS_01", false, "sfx", true, []],
  ["laser", "LASRGun_LaserShootUI_OS_01", false, "sfx", true, []],
  ["step_concrete", "FEETHmn_ShoeConcreteWalk_OS_01", false, "sfx", false, ["city", "street", "road", "urban", "town", "building"]],
  ["step_wood", "FEETHmn_ShoeWoodWalk_OS_01", false, "sfx", false, ["house", "cabin", "wooden", "interior", "room"]],
  ["step_snow", "FEETHmn_ShoeSnowWalk_OS_01", false, "sfx", false, ["snow", "winter", "ice", "barf"]],
  ["step_metal", "FEETHmn_ShoeMetalWalk_OS_01", false, "sfx", false, ["ship", "factory", "space", "spaceship", "metal", "sci-fi", "scifi"]],
  ["step_dirt", "FEETHmn_ShoeDirtWalk_OS_01", false, "sfx", false, ["village", "dirt", "desert", "farm", "gaon", "kaccha"]],
  ["rain", "RAINVege_ForestRain_LOOP_01", true, "sfx", false, ["rain", "monsoon", "storm", "baarish", "barish", "weather"]],
  ["wind", "WINDVege_LightWindTreesBirds_LOOP_01", true, "sfx", false, ["wind", "breeze", "weather", "hawa"]],
  ["amb_forest", "AMBForst_Forest_LOOP_01", true, "music", false, ["forest", "jungle", "woods", "jangal", "survival"]],
  ["amb_night", "AMBForst_Night_LOOP_01", true, "music", false, ["night", "raat", "dark", "horror"]],
  ["amb_farm", "AMBFarm_FarmGeneric_LOOP_01", true, "music", false, ["farm", "village", "gaon", "kheti", "farming"]],
  ["amb_city", "AMBUrbn_CityAmerican_LOOP_01", true, "music", false, ["city", "traffic", "street", "urban", "shehar"]],
  ["amb_sea", "WATRWave_OceanWaves_LOOP_01", true, "music", false, ["sea", "ocean", "beach", "samundar", "island", "coast"]],
  ["amb_river", "WATRFlow_River_LOOP_01", true, "music", false, ["river", "nadi", "stream", "waterfall", "fishing"]],
  ["amb_underwater", "AMBUndwtr_Underwater_LOOP_01", true, "music", false, ["underwater", "submarine", "diving", "ocean floor"]],
  ["amb_horror", "DSGNDron_DroneCreepy_OS_01", true, "music", false, ["horror", "scary", "haunted", "zombie", "graveyard", "bhoot"]],
  ["car_engine", "VEHCar_CarEngineSlow_LOOP_01", true, "sfx", false, ["car", "driving", "racing", "race", "gaadi", "truck", "bus", "traffic"]],
  ["car_engine_fast", "VEHCar_CarEngineHigh_LOOP_01", true, "sfx", false, ["racing", "race", "speed", "drift"]],
  ["car_door", "VEHDoor_CarDoorClose_OS_01", false, "sfx", false, ["car", "driving", "gta", "open world", "open-world"]],
  ["train", "TRNElec_TrainPassby_OS_01", false, "sfx", false, ["train", "railway", "rail", "metro", "subway"]],
  ["rowing", "BOATRow_RowboatOarRowing_OS_01", false, "sfx", false, ["boat", "canoe", "rowing", "naav", "river"]],
  ["dog_bark", "ANMLDog_DogBark_OS_01", false, "sfx", false, ["dog", "kutta", "village", "farm"]],
  ["horse", "ANMLHors_HorseNeigh_OS_01", false, "sfx", false, ["horse", "ghoda", "western", "medieval", "cowboy"]],
  ["sheep", "ANMLFarm_Sheep_OS_01", false, "sfx", false, ["sheep", "farm", "bhed"]],
  ["pig", "ANMLFarm_PigSqueal_OS_01", false, "sfx", false, ["pig", "farm"]],
  ["chicken", "BIRDFowl_Chicken_OS_01", false, "sfx", false, ["chicken", "hen", "murgi", "farm", "village"]],
  ["duck", "BIRDFowl_Duck_OS_01", false, "sfx", false, ["duck", "pond", "batakh"]],
  ["door_open", "DOORWood_FrontDoorOpen_OS_01", false, "sfx", false, ["door", "house", "room", "escape", "horror"]],
  ["door_close", "DOORWood_FrontDoorClose_OS_01", false, "sfx", false, ["door", "house", "room", "escape", "horror"]],
  ["sword_clash", "WEAPSwrd_SwordClash_OS_01", false, "sfx", false, ["sword", "talwar", "knight", "medieval", "fight", "samurai"]],
  ["sword", "WEAPSwrd_Sword_OS_01", false, "sfx", false, ["sword", "talwar", "knight", "medieval", "samurai"]],
  ["axe_chop", "WEAPAxe_WoodCutAxe_OS_01", false, "sfx", false, ["axe", "lumber", "wood", "survival", "kulhadi"]],
  ["magic", "MAGSpel_MagicSpell_OS_01", false, "sfx", false, ["magic", "wizard", "spell", "mage", "jadoo"]],
  ["shell_casing", "BLLTShel_ShellCasingConcrete_OS_01", false, "sfx", false, ["gun", "shooter", "shooting", "pubg", "battle royale", "free fire", "fps"]],
  ["kick", "FGHTImpt_Kick_OS_01", false, "sfx", false, ["fight", "fighting", "kick", "boxing", "karate", "martial"]],
  ["punch_heavy", "FGHTImpt_PunchHardest_OS_01", false, "sfx", false, ["fight", "fighting", "boxing", "punch", "knockout"]],
  ["notification", "UIAlert_Notification_OS_01", false, "ui", false, ["message", "notification", "quest", "mission"]],
  ["countup", "UIData_CasualCountup_OS_01", false, "ui", false, ["score", "coins", "results", "leaderboard"]],
  ["sparkle", "UIMisc_BelltreeUp_OS_01", false, "ui", false, ["reward", "treasure", "chest", "magic", "level"]],
];
