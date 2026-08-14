import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

/**
 * ANDROID NATIVE POLISH (admin 2026-08-13: "capacitor ko aur jyada polish karo, jisse yeh native app
 * lage, capacitor nahi").
 *
 * WHY THESE TESTS EXIST — corrected after actually checking, because the first version of this
 * header gave a reason that turned out to be false.
 *
 * It claimed `npx cap sync` rewrites these files. It does not: running it against this project
 * regenerates `capacitor.build.gradle` and `capacitor.settings.gradle` and leaves `res/` completely
 * untouched. A wrong reason in a comment is worse than no comment, because the next session inherits
 * it and reasons from it.
 *
 * The real reason is that NOTHING ELSE CHECKS THIS. These are XML resources: a wrong one does not
 * fail a build, does not fail a typecheck, and does not throw at runtime — it just renders slightly
 * wrong, on some devices, in some themes. The night-mode shadowing case below is the proof: two
 * folders, both individually correct, and the fix silently inert in dark mode with nothing anywhere
 * reporting a problem. That class of defect is invisible until someone looks at a phone and says
 * "the app looks a bit off again" — which is precisely how the splash white-flash recorded in
 * capacitor.config.ts came back the first time.
 *
 * WHAT WAS ALREADY DONE, and is deliberately NOT re-litigated here: keyboard native resize, splash
 * background, status-bar theming, safe areas, haptics, the back-button handler, overscroll, tap
 * highlight, long-press selection and text-size-adjust. That work is real and this file adds to it.
 */

const RES = join(process.cwd(), 'android/app/src/main/res');
const read = (p: string) => readFileSync(join(RES, p), 'utf8');

/**
 * The file with its XML COMMENTS removed.
 *
 * Every one of these files opens with a comment explaining which launch frame it fixes, and those
 * explanations necessarily quote the colour literal. A blunt search reads that prose as a violation.
 * The rule being enforced is about what the RESOURCES declare, so the assertions have to run against
 * the markup alone — the alternative is deleting the explanation to make a test pass, which trades
 * away the only record of why the file exists.
 */
const markup = (p: string) => read(p).replace(/<!--[\s\S]*?-->/g, '');

/** The app's own surface colour — one definition, referenced by everything native. */
const SURFACE = '#0d1117';

describe('themed icon — the app stops standing out when the launcher recolours everything else', () => {
  /**
   * On Android 13+, turning on themed icons tints every app icon to the wallpaper. An app with no
   * <monochrome> layer keeps its own colours and sits there conspicuously — a small thing that reads
   * immediately as "not a real app".
   */
  it('both adaptive icons declare a monochrome layer', () => {
    for (const f of ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml']) {
      expect(read(f), f).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>');
    }
  });

  it('the monochrome drawable exists at every density', () => {
    // A referenced-but-missing drawable is a BUILD failure, not a cosmetic one — the whole release
    // stops. Every density the foreground ships at must have a twin.
    for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      const p = join(RES, `mipmap-${d}/ic_launcher_monochrome.png`);
      expect(existsSync(p), `mipmap-${d}`).toBe(true);
      expect(statSync(p).size, `mipmap-${d} must not be an empty file`).toBeGreaterThan(500);
    }
  });

  it('the background and foreground layers are untouched', () => {
    // The themed layer is ADDITIVE. If adding it had changed the ordinary icon, every existing user
    // would see their home screen change for no reason they asked for.
    const xml = read('mipmap-anydpi-v26/ic_launcher.xml');
    expect(xml).toContain('<background android:drawable="@color/ic_launcher_background"/>');
    expect(xml).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"/>');
  });
});

describe('the launch frame is dark in every theme', () => {
  it('the Android 12+ SYSTEM splash has an explicit background colour', () => {
    /**
     * From Android 12 the system draws the first frame before any app code runs, reading
     * `windowSplashScreenBackground` from the launch theme. Unset, it fell back to the
     * AppCompat.Light window background — white. capacitor.config.ts already fought this exact flash
     * one layer down, but that config governs the Capacitor splash, which comes AFTER this one.
     */
    const v31 = read('values-v31/styles.xml');
    expect(v31).toContain('android:windowSplashScreenBackground');
    expect(v31).toContain('@color/nbaiSurfaceDark');
  });

  it('it is scoped to v31, so older devices keep today\'s launch exactly', () => {
    // The attribute does not exist before API 31. Putting it in values/ would be a lint error and a
    // behaviour change for devices that never had the problem.
    expect(existsSync(join(RES, 'values-v31/styles.xml'))).toBe(true);
    expect(markup('values/styles.xml')).not.toContain('windowSplashScreenBackground');
  });

  it('a dark-mode window background exists, for the gap before React paints', () => {
    // The app's own UI already follows the theme and the Capacitor splash is already dark. What had
    // no dark variant was the Activity WINDOW underneath — a fraction of a second, and exactly the
    // fraction that reads as "a web page is loading".
    const night = read('values-night/styles.xml');
    expect(night).toContain('android:windowBackground">@color/nbaiSurfaceDark');
    expect(night).toContain('Theme.AppCompat.DayNight');
  });

  it('the night folder does NOT shadow the v31 splash — the trap this pass nearly shipped', () => {
    /**
     * ANDROID RESOURCE RESOLUTION, and the reason this test is worth more than the code it guards.
     *
     * Android picks a resource by eliminating candidate folders qualifier by qualifier, and NIGHT
     * MODE ranks ABOVE API VERSION in that order. The first version of this change declared
     * `AppTheme.NoActionBarLaunch` in values-night/ as well. On an Android 12+ phone in DARK MODE
     * that copy matched the night qualifier, which eliminated values-v31/ entirely — so the splash
     * background that folder exists to set never applied, in the exact theme where a white flash is
     * most visible. Both folders were present, both looked right, and the bug was invisible.
     *
     * The fix is an ABSENCE, which is precisely the kind of thing a later edit restores while
     * "tidying up" — nothing about the file suggests the omission is load-bearing except this test.
     */
    expect(markup('values-night/styles.xml')).not.toContain('AppTheme.NoActionBarLaunch');
    // …and the two styles it DOES override must stay, or dark mode loses its window background.
    expect(markup('values-night/styles.xml')).toContain('name="AppTheme.NoActionBar"');
  });

  it('the surface colour is ONE definition, not a literal repeated per file', () => {
    /**
     * The splash colour lives in capacitor.config.ts too. Repeating the literal is how the native
     * window and the splash drift apart later — and that drift shows up as a flash of the wrong
     * colour at launch, the very thing this was added to prevent.
     */
    expect(markup('values/nbai_colors.xml')).toContain(`<color name="nbaiSurfaceDark">${SURFACE}</color>`);
    const capConfig = readFileSync(join(process.cwd(), 'capacitor.config.ts'), 'utf8');
    expect(capConfig, 'capacitor.config.ts splash must use the same surface').toContain(SURFACE);
    // Only the named resource may carry the literal on the native side.
    expect(markup('values-v31/styles.xml')).not.toContain(SURFACE);
    expect(markup('values-night/styles.xml')).not.toContain(SURFACE);
  });
});

describe('the checked-in android project lists the plugins the app actually uses', () => {
  /**
   * FOUND BY RUNNING `npx cap sync android` TO TEST THIS FILE'S OWN CLAIM, which is the only reason
   * it was found at all.
   *
   * The committed `capacitor.build.gradle` was missing SIX plugins — app, browser, haptics, keyboard,
   * splash-screen, status-bar — which is to say every one of the native-polish plugins this whole
   * effort is about. It was not a shipping bug: the release workflow runs `cap sync` before
   * `bundleRelease`, so the real .aab always had them. But the checked-in project described an app
   * that does not exist, and anyone reading it to answer "is the keyboard plugin wired in?" would
   * have got the wrong answer from the file that looks authoritative.
   *
   * Regenerating it makes the repo agree with what actually builds. This test keeps them in
   * agreement, driven off package.json so a NEWLY added plugin is covered without editing a list
   * here — a hardcoded list would go stale in exactly the way this is fixing.
   */
  const gradle = readFileSync(join(process.cwd(), 'android/app/capacitor.build.gradle'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };

  /** `@capacitor/status-bar` → `capacitor-status-bar`, the gradle project name cap sync emits. */
  const gradleProject = (dep: string) => dep.replace(/^@/, '').replace(/\//g, '-');

  it('every installed Capacitor plugin is declared', () => {
    const plugins = Object.keys(pkg.dependencies ?? {}).filter(
      (d) =>
        /^@(capacitor|capacitor-community|capacitor-firebase|capawesome)\//.test(d) &&
        // The core runtime and the PLATFORM packages are not plugins and have no gradle project.
        // `@capacitor/ios` belongs here for the same reason `@capacitor/android` does, and leaving
        // it out is how the first run of this test failed — on itself, not on the project.
        !['@capacitor/core', '@capacitor/android', '@capacitor/ios', '@capacitor/cli'].includes(d),
    );
    // A guard on the guard: if the filter ever matches nothing, this test would pass vacuously and
    // protect nothing at all.
    expect(plugins.length, 'no plugins detected — the filter is wrong, not the project').toBeGreaterThan(5);
    for (const p of plugins) {
      expect(gradle, `${p} is installed but missing from capacitor.build.gradle`).toContain(
        `implementation project(':${gradleProject(p)}')`,
      );
    }
  });
});

describe('predictive back stays OPT-OUT — an admin decision, recorded so it survives a session', () => {
  /**
   * ADMIN 2026-08-14, unambiguous: **"predictive back = no ❌ karna hi nahi hai!!!!"**
   *
   * It is the single most native-feeling Android gesture and it is genuinely tempting to add later.
   * It is also the one item on the polish list with real breakage risk, because this app's back
   * button is not the system's — `installBackButtonHandler` (src/lib/nativeShell.ts) forwards Back
   * into React Router and exits ONLY when the navigation stack is genuinely empty. Opting into the
   * predictive APIs changes who owns that decision.
   *
   * WHAT IS ACTUALLY TRUE TODAY, verified by reading the path rather than assumed:
   *   - targetSdkVersion is 36, and from SDK 35 the platform enables the OnBackInvoked path by
   *     default, so this app is NOT on the legacy-only path any more.
   *   - Capacitor's App plugin registers an *enabled* androidx `OnBackPressedCallback` on the
   *     activity's OnBackPressedDispatcher (AppPlugin.java), and androidx.activity 1.11.0 bridges
   *     that dispatcher to the platform dispatcher itself.
   *   - So Back still reaches the JS `backButton` listener, and the app's own navigation still wins.
   *
   * The conclusion is therefore "leave it exactly as it is", NOT "add a flag to be safe". Forcing
   * `enableOnBackInvokedCallback="false"` would push the app back onto the legacy path — a real
   * behaviour change, untested on device, to fix nothing. This test exists so the DECISION is
   * enforceable: a later session that opts in fails CI and has to ask the admin first.
   */
  const manifest = () =>
    readFileSync(join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '');

  it('nothing opts the app INTO the predictive back APIs', () => {
    expect(manifest()).not.toMatch(/enableOnBackInvokedCallback\s*=\s*"true"/);
  });

  it('the app still owns Back — the handler predictive back would take over from', () => {
    // If this disappears, Back exits the app from any screen instead of navigating, and the
    // predictive question becomes moot because there is nothing left to protect.
    const shell = readFileSync(join(process.cwd(), 'src/lib/nativeShell.ts'), 'utf8');
    expect(shell).toContain("addListener('backButton'");
    expect(shell).toMatch(/canGoBack === false/);
  });
});

describe('the settings this file protects are ones cap sync can erase', () => {
  it('the splash safety that once froze the app is still in place', () => {
    /**
     * capacitor.config.ts records that `launchAutoHide: false` left the app permanently stuck on its
     * launch screen in TestFlight. Nothing in this polish pass may reintroduce that, so the guard is
     * asserted here rather than trusted to a comment.
     */
    const cap = readFileSync(join(process.cwd(), 'capacitor.config.ts'), 'utf8');
    expect(cap).toMatch(/launchAutoHide:\s*true/);
  });

  it('the keyboard still resizes natively — the loudest giveaway in a chat app', () => {
    const cap = readFileSync(join(process.cwd(), 'capacitor.config.ts'), 'utf8');
    expect(cap).toMatch(/resize:\s*'native'/);
  });
});
