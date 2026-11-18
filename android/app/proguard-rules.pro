# NavBharatAI release shrinking and obfuscation (owner 2026-11-18, D-7 opt-in requested; Play Console:
# "DEX code optimisation is below our threshold — Obfuscation (2%)", fix by Feb 2027).
#
# The app is a Capacitor shell: most of it is JavaScript, and the Java side is found BY NAME at run time —
# plugins are loaded from capacitor.plugins.json with Class.forName, their @PluginMethod methods are called by
# name from JavaScript, and the WebView bridge exposes @JavascriptInterface methods by name. Obfuscation breaks
# exactly those, in the release build only. So the shell, every plugin and our own code keep their names; the
# large libraries (Firebase, Play services, Facebook, androidx) are obfuscated under the rules they ship.
# proguard-android.txt (not -optimize) is used on purpose: Play flagged obfuscation only, and leaving code
# optimisation off keeps the change to renaming and dead-code removal.

# Readable crash reports: Play and Crashlytics map names back with mapping.txt, line numbers need these.
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod,Exceptions
-renamesourcefileattribute SourceFile

# Our own native code: MainActivity and the PlayBilling, DeviceIntegrity and MetaConsent plugins.
-keep class com.navbharatai.app.** { *; }

# Capacitor itself: the bridge, PluginManager (loads plugins by class name) and classes looked up by name
# (the Keyboard plugin asks for com.getcapacitor.plugin.SystemBars). Capacitor's own consumer rules keep every
# Plugin subclass; this keeps the rest of the runtime as well.
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-keep class io.capawesome.** { *; }
-keep class org.apache.cordova.** { *; }

# MetaConsentPlugin calls these by name through reflection (Class.forName + getMethod), so they must not be renamed.
-keep class com.facebook.FacebookSdk { public static *; }

# The JavaScript bridge: any method the WebView may call by name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
