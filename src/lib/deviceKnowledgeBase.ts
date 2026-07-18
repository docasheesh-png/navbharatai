/**
 * Phone / Device Help — a bundled, 100%-offline troubleshooting knowledge base for common phone-settings
 * problems (admin ask 2026-07-18: "user ko phone settings me problem hai, offline AI sab bata de").
 *
 * HONEST SCOPE (absolute rules 2 & 3): these are REAL, generic Android how-to steps the Offline AI can
 * show with no internet — it GUIDES the user. It does NOT read or change the phone's actual settings
 * (a web/Capacitor app cannot toggle system settings for the user), and it never fakes a device state.
 * Exact menu names differ by phone brand (Samsung / Xiaomi / OnePlus / stock Android), so paths are given
 * as the typical Android path plus an honest "may differ by brand" note where it matters. This is pure
 * data (no imports), bundled client-side like APP_KNOWLEDGE_BASE, so it stays unit-testable and instant.
 */

export type DeviceHelpCategory =
  | 'Connectivity' | 'Location' | 'Notifications' | 'Battery' | 'Storage'
  | 'Permissions' | 'Display' | 'Sound' | 'Apps' | 'System' | 'Security' | 'Account';

export interface DeviceHelp {
  /** Stable id (snake_case). */
  id: string;
  /** Problem title, e.g. "Wi-Fi won't connect". */
  title: string;
  category: DeviceHelpCategory;
  /** One-line description of the symptom. */
  problem: string;
  /** Generic step-by-step fix (typical Android path). */
  steps: string[];
  /** Words a user would actually type (English + Hinglish). */
  keywords: string[];
  /** Honest caveat when the path/behaviour varies by phone brand or is destructive. */
  note?: string;
}

/** The typical brand-varies caveat, reused across entries. */
const BRAND_NOTE = 'Exact menu names can differ by phone brand (Samsung, Xiaomi/Redmi, OnePlus, Vivo, etc.) — look for the closest matching option in Settings.';

export const DEVICE_KNOWLEDGE_BASE: DeviceHelp[] = [
  // ─── Connectivity ────────────────────────────────────────────────────────
  {
    id: 'wifi_not_connecting',
    title: "Wi-Fi won't connect",
    category: 'Connectivity',
    problem: 'Phone shows Wi-Fi but does not connect, keeps saying "saved" or "authenticating", or has no internet.',
    steps: [
      'Open Settings → Network & internet → Wi-Fi (or Connections → Wi-Fi) and make sure Wi-Fi is ON.',
      'Tap your network; if it fails, tap it again → "Forget", then re-select it and re-enter the password (check upper/lower case).',
      'Toggle Airplane mode ON for 5 seconds, then OFF, to reset the radios.',
      'Restart the phone and the Wi-Fi router (unplug the router for 30 seconds).',
      'Still failing? Settings → System → Reset options → Reset Wi-Fi, mobile & Bluetooth.',
    ],
    keywords: ['wifi', 'wi-fi', 'wifi not working', 'wifi not connecting', 'no internet', 'wifi problem', 'internet nahi chal raha', 'wifi connect nahi ho raha', 'wireless', 'network', 'wifi off'],
    note: BRAND_NOTE,
  },
  {
    id: 'mobile_data_not_working',
    title: 'Mobile data / internet not working',
    category: 'Connectivity',
    problem: 'No internet on mobile data even with signal, or the data icon is missing.',
    steps: [
      'Settings → Network & internet → SIMs (or Mobile network) → turn Mobile data ON.',
      'Check you have balance/an active data pack, and that "Data roaming" is on if you are travelling.',
      'Toggle Airplane mode ON then OFF, or restart the phone.',
      'Settings → Network & internet → Mobile network → Access Point Names (APN) → reset to default.',
      'Make sure the correct SIM is set for data if you have two SIMs.',
    ],
    keywords: ['mobile data', 'data not working', 'internet not working', 'net nahi chal raha', 'data on nahi ho raha', 'cellular', 'sim data', 'apn', '4g', '5g', 'data pack'],
    note: BRAND_NOTE,
  },
  {
    id: 'bluetooth_not_pairing',
    title: "Bluetooth won't pair",
    category: 'Connectivity',
    problem: 'Bluetooth device (earbuds, speaker, car) will not pair or keeps disconnecting.',
    steps: [
      'Settings → Connected devices → Bluetooth (or Connections → Bluetooth) → turn it ON.',
      'Put the accessory in pairing mode (usually hold its button until the light blinks).',
      'Tap "Pair new device" and select it; if it was paired before, tap the gear → "Forget", then pair again.',
      'Keep the devices within 1 metre and away from other electronics while pairing.',
      'Restart both the phone and the accessory if it still fails.',
    ],
    keywords: ['bluetooth', 'bluetooth not working', 'bluetooth not pairing', 'earbuds', 'headphones', 'speaker', 'pair', 'bluetooth connect nahi ho raha', 'blutooth'],
    note: BRAND_NOTE,
  },
  {
    id: 'hotspot_setup',
    title: 'Set up / fix Wi-Fi hotspot',
    category: 'Connectivity',
    problem: 'Want to share internet from the phone, or the hotspot turns on but others cannot connect.',
    steps: [
      'Settings → Network & internet → Hotspot & tethering → Wi-Fi hotspot.',
      'Set a hotspot name and password (WPA2), then turn the hotspot ON.',
      'On the other device, pick this hotspot name and enter the same password.',
      'If others cannot connect, make sure your Mobile data is ON (a hotspot shares mobile data, not Wi-Fi).',
      'Check the "AP band" (2.4GHz is more compatible than 5GHz for older devices).',
    ],
    keywords: ['hotspot', 'tethering', 'share internet', 'wifi hotspot', 'personal hotspot', 'hotspot on', 'net share', 'internet share'],
    note: BRAND_NOTE,
  },
  {
    id: 'airplane_mode',
    title: 'Airplane mode is stuck on / off',
    category: 'Connectivity',
    problem: 'No calls, SMS or data because Airplane mode is on, or it will not turn off.',
    steps: [
      'Swipe down from the top to open Quick Settings and tap the Airplane (✈) tile to toggle it.',
      'Or Settings → Network & internet → Airplane mode → turn it OFF.',
      'If the icon is stuck, restart the phone.',
      'Remember: Airplane mode turns off Wi-Fi, mobile data and Bluetooth together.',
    ],
    keywords: ['airplane mode', 'flight mode', 'aeroplane mode', 'no signal', 'no network', 'flight mode off', 'airplane mode stuck'],
  },

  // ─── Location ────────────────────────────────────────────────────────────
  {
    id: 'location_not_working',
    title: 'Location / GPS not working',
    category: 'Location',
    problem: 'Maps or apps cannot find your location, or location is very inaccurate.',
    steps: [
      'Settings → Location → turn Location ON.',
      'Set "Location accuracy" / "Google Location Accuracy" to ON (uses Wi-Fi & networks for a better fix).',
      'Settings → Location → App permissions → allow location for the app that needs it (choose "While using the app").',
      'Go outside or near a window for a clear GPS signal, then reopen the map app.',
      'Toggle Location OFF and ON, or restart the phone.',
    ],
    keywords: ['location', 'gps', 'location not working', 'gps not working', 'location off', 'maps not working', 'location nahi mil raha', 'gps problem', 'wrong location'],
    note: BRAND_NOTE,
  },

  // ─── Notifications / Sound ─────────────────────────────────────────────────
  {
    id: 'notifications_not_showing',
    title: 'Notifications not showing',
    category: 'Notifications',
    problem: 'Not getting notifications from an app, or they arrive late.',
    steps: [
      'Settings → Notifications → make sure notifications are ON for the app (Settings → Apps → [app] → Notifications).',
      'Turn OFF Do Not Disturb (Quick Settings → the moon/DND tile).',
      'Settings → Apps → [app] → Battery → allow background activity / "Unrestricted" (battery saving often blocks notifications).',
      'For messaging apps, disable "Battery optimization" for that app.',
      'Restart the phone after changing these.',
    ],
    keywords: ['notification', 'notifications', 'notifications not showing', 'no notification', 'notification nahi aa raha', 'alerts', 'notification problem', 'message notification'],
    note: BRAND_NOTE,
  },
  {
    id: 'dnd_silent',
    title: 'Phone is silent / on Do Not Disturb',
    category: 'Sound',
    problem: 'No ringtone or notification sounds; calls come silently.',
    steps: [
      'Swipe down to Quick Settings and turn OFF Do Not Disturb (moon icon) and Silent mode.',
      'Press the Volume Up button and raise "Ring" and "Notification" volume in the pop-up slider.',
      'Settings → Sound & vibration → check Ring volume and Notification volume are up.',
      'Settings → Sound & vibration → Do Not Disturb → check the schedule is off.',
    ],
    keywords: ['silent', 'dnd', 'do not disturb', 'no sound', 'ringtone not working', 'phone silent', 'awaaz nahi aa rahi', 'no ringtone', 'mute', 'volume'],
    note: BRAND_NOTE,
  },
  {
    id: 'ringtone_volume',
    title: 'Change ringtone or volume',
    category: 'Sound',
    problem: 'Want to change the ringtone, notification sound, or fix volume levels.',
    steps: [
      'Settings → Sound & vibration → Phone ringtone (and Notification sound) → pick one.',
      'Use the Volume buttons, then tap the arrow/gear in the pop-up to set Ring, Media, Alarm and Notification separately.',
      'For vibration, Settings → Sound & vibration → Vibration & haptics.',
    ],
    keywords: ['ringtone', 'volume', 'change ringtone', 'notification sound', 'sound settings', 'ringtone change', 'volume kaise badle', 'media volume'],
    note: BRAND_NOTE,
  },

  // ─── Battery ───────────────────────────────────────────────────────────────
  {
    id: 'battery_draining',
    title: 'Battery draining too fast',
    category: 'Battery',
    problem: 'Battery drops quickly or the phone gets hot.',
    steps: [
      'Settings → Battery → Battery usage — see which app uses the most and restrict or uninstall it.',
      'Lower screen brightness and turn on Adaptive/Auto brightness; reduce screen timeout (Settings → Display).',
      'Turn off Wi-Fi, Bluetooth, GPS and Hotspot when not in use.',
      'Settings → Battery → turn ON Battery Saver / Power saving mode.',
      'Update apps and the system; a rogue app or old software often drains battery.',
    ],
    keywords: ['battery', 'battery draining', 'battery drain', 'battery fast', 'phone hot', 'charge nahi tikta', 'battery jaldi khatam', 'battery problem', 'heating', 'battery low'],
    note: BRAND_NOTE,
  },
  {
    id: 'battery_saver',
    title: 'Turn on Battery Saver / power saving',
    category: 'Battery',
    problem: 'Want to make the battery last longer.',
    steps: [
      'Swipe down to Quick Settings and tap the Battery Saver tile,',
      'or Settings → Battery → Battery Saver → turn it ON (optionally set it to turn on automatically at a % level).',
      'Use "Extreme" / "Super" power saving for maximum life when very low.',
    ],
    keywords: ['battery saver', 'power saving', 'save battery', 'low power mode', 'battery bachao', 'power save mode', 'saving mode'],
    note: BRAND_NOTE,
  },

  // ─── Storage ───────────────────────────────────────────────────────────────
  {
    id: 'storage_full',
    title: 'Storage is full / "insufficient storage"',
    category: 'Storage',
    problem: 'Cannot install apps, take photos, or update because storage is full.',
    steps: [
      'Settings → Storage → see what is using space (Apps, Photos, Downloads, Other).',
      'Delete unused apps, old downloads, and duplicate photos/videos (back them up to Google Photos first).',
      'Clear cache: Settings → Storage → Cached data / or per-app cache (see "Clear an app\'s cache").',
      'Move photos/videos to an SD card or the cloud, then delete the local copies.',
      'Uninstall or disable large apps you do not use.',
    ],
    keywords: ['storage full', 'storage', 'memory full', 'insufficient storage', 'space full', 'storage khatam', 'no space', 'phone full', 'jagah nahi', 'clean storage'],
    note: BRAND_NOTE,
  },
  {
    id: 'clear_app_cache',
    title: "Clear an app's cache / data (fix a misbehaving app)",
    category: 'Storage',
    problem: 'An app is slow, stuck, or showing old data.',
    steps: [
      'Settings → Apps → [the app] → Storage & cache.',
      'Tap "Clear cache" first (this is safe — it keeps your login and data).',
      'If still broken, tap "Clear storage / Clear data" (this logs you out and resets the app — you may lose in-app data).',
      'Reopen the app.',
    ],
    keywords: ['clear cache', 'clear data', 'app cache', 'app slow', 'app stuck', 'cache clear', 'app not working', 'reset app', 'app hang'],
    note: 'Clear cache is safe; Clear data/storage resets the app and can log you out — use it only if clearing cache did not help. ' + BRAND_NOTE,
  },

  // ─── Permissions ───────────────────────────────────────────────────────────
  {
    id: 'app_permissions',
    title: 'Fix app permissions (camera, mic, location, storage)',
    category: 'Permissions',
    problem: 'An app cannot use the camera, microphone, location, contacts or files.',
    steps: [
      'Settings → Apps → [the app] → Permissions.',
      'Tap the permission you need (e.g. Camera, Microphone, Location, Files) and choose "Allow" (or "While using the app").',
      'For location, pick "Allow all the time" only if the app truly needs background location.',
      'Or manage by type: Settings → Privacy → Permission manager → pick a permission → set per app.',
    ],
    keywords: ['permission', 'permissions', 'camera not working', 'mic not working', 'microphone', 'allow camera', 'app permission', 'permission denied', 'access', 'contacts permission', 'file access'],
    note: BRAND_NOTE,
  },

  // ─── Apps ──────────────────────────────────────────────────────────────────
  {
    id: 'app_crashing',
    title: 'App keeps crashing / closing / not opening',
    category: 'Apps',
    problem: 'An app closes by itself, freezes, or will not open.',
    steps: [
      'Force stop it: Settings → Apps → [the app] → Force stop, then reopen.',
      'Clear its cache: Settings → Apps → [the app] → Storage & cache → Clear cache.',
      'Update the app in the Play Store (an old version often crashes).',
      'Restart the phone.',
      'If it still crashes, uninstall and reinstall the app.',
    ],
    keywords: ['app crash', 'app crashing', 'app closing', 'app not opening', 'app band ho raha', 'app freeze', 'app hang', 'force close', 'application error', 'app khul nahi raha'],
    note: BRAND_NOTE,
  },
  {
    id: 'app_not_installing',
    title: "App won't install / update from Play Store",
    category: 'Apps',
    problem: 'Play Store download is stuck, "pending", or shows an error code.',
    steps: [
      'Check you have internet and enough free storage.',
      'Play Store → profile → Settings → clear the Play Store cache: Settings → Apps → Google Play Store → Storage & cache → Clear cache.',
      'Settings → Apps → Google Play Store → and also "Google Play Services" → Clear cache.',
      'Make sure the date & time are correct (Settings → System → Date & time → Automatic).',
      'Cancel the download and retry, or restart the phone.',
    ],
    keywords: ['app not installing', 'play store error', 'download pending', 'cant install', 'install nahi ho raha', 'play store not working', 'update not working', 'download stuck', 'app install problem'],
    note: BRAND_NOTE,
  },
  {
    id: 'update_apps',
    title: 'Update your apps',
    category: 'Apps',
    problem: 'Want to update apps to the latest version.',
    steps: [
      'Open the Google Play Store → tap your profile picture (top-right).',
      'Tap "Manage apps & device".',
      'Tap "Update all", or update a single app from its Play Store page.',
      'Turn on auto-update: Play Store → profile → Settings → Network preferences → Auto-update apps.',
    ],
    keywords: ['update app', 'update apps', 'app update', 'latest version', 'update karo', 'play store update', 'auto update'],
  },
  {
    id: 'uninstall_app',
    title: 'Uninstall or disable an app',
    category: 'Apps',
    problem: 'Want to remove an app or free up space.',
    steps: [
      'Long-press the app icon → tap "Uninstall" (or "App info" → Uninstall).',
      'Or Settings → Apps → [the app] → Uninstall.',
      'System apps that cannot be removed can often be "Disabled" from the same screen.',
    ],
    keywords: ['uninstall', 'remove app', 'delete app', 'disable app', 'app hatao', 'app delete', 'uninstall app'],
    note: BRAND_NOTE,
  },

  // ─── Display ───────────────────────────────────────────────────────────────
  {
    id: 'brightness_display',
    title: 'Screen too dark / bright (brightness)',
    category: 'Display',
    problem: 'Screen is too dim or too bright, or brightness keeps changing on its own.',
    steps: [
      'Swipe down and drag the brightness slider in Quick Settings.',
      'Settings → Display → Brightness level to set it, and "Adaptive brightness" ON/OFF (ON lets the phone auto-adjust).',
      'If the screen dims outdoors, that is auto-brightness reacting to light — turn Adaptive brightness off to keep it fixed.',
    ],
    keywords: ['brightness', 'screen dark', 'screen bright', 'display brightness', 'screen dim', 'auto brightness', 'brightness kam', 'brightness zyada', 'screen light'],
    note: BRAND_NOTE,
  },
  {
    id: 'auto_rotate',
    title: 'Screen rotation not working',
    category: 'Display',
    problem: 'The screen does not rotate when you turn the phone (or rotates when you do not want it to).',
    steps: [
      'Swipe down to Quick Settings and tap the "Auto-rotate" tile to enable it.',
      'Or Settings → Display → Auto-rotate screen → turn ON.',
      'Some apps only work in one orientation — that is normal.',
    ],
    keywords: ['rotate', 'auto rotate', 'screen rotation', 'rotation not working', 'screen ghum nahi raha', 'landscape', 'portrait lock', 'rotation lock'],
    note: BRAND_NOTE,
  },
  {
    id: 'dark_mode',
    title: 'Turn Dark mode on or off',
    category: 'Display',
    problem: 'Want a dark theme (or switch back to light).',
    steps: [
      'Settings → Display → Dark theme / Dark mode → toggle ON or OFF.',
      'Or use the "Dark mode" tile in Quick Settings.',
      'You can schedule it to turn on at night (Settings → Display → Dark theme → Schedule).',
    ],
    keywords: ['dark mode', 'dark theme', 'night mode', 'light mode', 'dark mode on', 'theme change', 'kala theme'],
    note: BRAND_NOTE,
  },
  {
    id: 'screen_timeout',
    title: 'Screen turns off too fast (screen timeout)',
    category: 'Display',
    problem: 'The display sleeps too quickly or stays on too long.',
    steps: [
      'Settings → Display → Screen timeout (or "Sleep") → pick a longer/shorter time.',
      'Some phones have "Screen attention" that keeps the screen on while you look at it — toggle as you prefer.',
    ],
    keywords: ['screen timeout', 'screen off', 'display sleep', 'screen jaldi band', 'sleep time', 'screen on time', 'display timeout'],
    note: BRAND_NOTE,
  },

  // ─── System ────────────────────────────────────────────────────────────────
  {
    id: 'software_update',
    title: 'Update the phone software (Android)',
    category: 'System',
    problem: 'Want the latest Android/security update, or a feature needs a newer version.',
    steps: [
      'Connect to Wi-Fi and charge above 50%.',
      'Settings → System → System update (or Settings → Software update) → "Check for updates".',
      'Download and install if one is available; the phone will restart.',
      'Nothing shown? Your phone may already be up to date, or the update has not rolled out to your model yet.',
    ],
    keywords: ['software update', 'system update', 'android update', 'update phone', 'phone update', 'os update', 'security update', 'firmware', 'update nahi aa raha'],
    note: BRAND_NOTE,
  },
  {
    id: 'date_time_auto',
    title: 'Wrong date, time or timezone',
    category: 'System',
    problem: 'Clock is wrong, which can break apps, logins, or OTPs.',
    steps: [
      'Settings → System → Date & time.',
      'Turn ON "Set time automatically" (Use network-provided time) and "Set time zone automatically".',
      'If still wrong, turn automatic OFF and set the date, time and time zone manually, then turn automatic back ON.',
    ],
    keywords: ['date time', 'wrong time', 'clock wrong', 'timezone', 'time galat', 'date wrong', 'set time', 'automatic time', 'time zone'],
    note: BRAND_NOTE,
  },
  {
    id: 'restart_phone',
    title: 'Restart / force-restart the phone',
    category: 'System',
    problem: 'Phone is slow, frozen, or acting strange — a restart fixes many glitches.',
    steps: [
      'Normal restart: hold the Power button (or Power + Volume Up on some phones) → tap "Restart".',
      'If the screen is frozen: hold Power + Volume Down together for ~10 seconds to force a restart.',
      'This does NOT delete any of your data.',
    ],
    keywords: ['restart', 'reboot', 'restart phone', 'phone frozen', 'phone hang', 'force restart', 'phone restart', 'switch off on', 'phone stuck'],
    note: BRAND_NOTE,
  },
  {
    id: 'safe_mode',
    title: 'Start in Safe Mode (find a bad app)',
    category: 'System',
    problem: 'Phone crashes or misbehaves and you suspect an installed app.',
    steps: [
      'Hold the Power button → then press and hold "Power off" on screen → tap "OK" to reboot into Safe Mode.',
      'In Safe Mode only built-in apps run; if the problem disappears, a downloaded app is the cause.',
      'Uninstall recently added apps one by one.',
      'Restart normally to leave Safe Mode.',
    ],
    keywords: ['safe mode', 'bad app', 'phone misbehaving', 'safe mode kaise', 'boot safe mode', 'troubleshoot app'],
    note: BRAND_NOTE,
  },
  {
    id: 'factory_reset',
    title: 'Factory reset (erase everything — last resort)',
    category: 'System',
    problem: 'Persistent problems that nothing else fixes, or preparing to sell the phone.',
    steps: [
      'BACK UP FIRST: photos to Google Photos, and Settings → Google → Backup → back up now.',
      'Know your Google account email & password — you will need them to unlock the phone after reset (FRP).',
      'Settings → System → Reset options → "Erase all data (factory reset)".',
      'Confirm; the phone wipes everything and restarts as new.',
    ],
    keywords: ['factory reset', 'reset phone', 'erase phone', 'format phone', 'hard reset', 'phone reset', 'wipe phone', 'reset everything', 'phone format'],
    note: '⚠️ This ERASES everything on the phone and cannot be undone — back up first and keep your Google account details, or you may be locked out.',
  },

  // ─── Security / Account ────────────────────────────────────────────────────
  {
    id: 'screen_lock',
    title: 'Set or change screen lock (PIN, pattern, fingerprint)',
    category: 'Security',
    problem: 'Want to add or change the lock screen security.',
    steps: [
      'Settings → Security (or Security & privacy) → Screen lock → choose PIN, Pattern or Password.',
      'For fingerprint/face: Settings → Security → Fingerprint / Face unlock → add one (you must set a PIN/pattern as backup first).',
      'Keep a backup unlock method in case a fingerprint fails.',
    ],
    keywords: ['screen lock', 'lock screen', 'pin', 'pattern', 'fingerprint', 'face unlock', 'password lock', 'phone lock', 'lock kaise lagaye', 'security lock'],
    note: BRAND_NOTE,
  },
  {
    id: 'google_account_sync',
    title: 'Google account not syncing / add-remove account',
    category: 'Account',
    problem: 'Contacts, mail or photos not syncing, or you need to add/remove a Google account.',
    steps: [
      'Settings → Passwords & accounts (or Accounts) → tap your Google account.',
      'Tap "Account sync" and make sure the items you want (Contacts, Gmail, Drive, Photos) are ON; tap the 3-dot menu → "Sync now".',
      'Add an account: Accounts → "Add account" → Google.',
      'Remove an account from the same screen (this does not delete the account, only removes it from this phone).',
    ],
    keywords: ['google account', 'account sync', 'sync not working', 'add account', 'remove account', 'gmail sync', 'contacts sync', 'account add karo', 'sync problem'],
    note: BRAND_NOTE,
  },
];
