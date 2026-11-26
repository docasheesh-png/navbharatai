# NavBharatAI — Native Cloud Build worker (Capacitor → genuine Android .apk / .aab)   2026-11-25
# ---------------------------------------------------------------------------------------------------
# ONE disposable machine per build, created by src/server/lib/mobileBuild/workerSandbox.ts from this
# template (env MOBILE_NATIVE_BUILD_TEMPLATE = this template's alias). It is NOT the Bubblewrap/TWA
# template next to it (e2b-android.Dockerfile): that one wraps a hosted URL; this one compiles the app's
# own Capacitor project with Gradle, exactly as the GitHub provider's runner does — the build script it
# runs is the app's own GitHub workflow, translated step by step (workflowScript.ts).
#
# The same image also serves the SIGNING machine (created with no network): it carries jarsigner,
# apksigner, aapt2 and bundletool, and the server writes only its fixed signing script into it.
#
# 🔒 What this image must NEVER contain: a credential, a platform env var, a signing key. The server
# passes no env to these machines at all.
#
# PINNING (no implicit "latest"): Node is pinned to the same release the workflows use; Android
# cmdline-tools and bundletool are pinned by version AND sha256; SDK packages by exact version. The JDKs
# come from the official Eclipse Temurin images — pin TEMURIN_17 / TEMURIN_21 to an `@sha256:` digest
# before publishing a production template (the tag form below is what was verifiable when this was
# written). Every published image records its exact toolchain in /opt/nbai-android/VERSIONS, and every
# build records the template it ran on.
#
# Verified end-to-end on 2026-11-25 with the same toolchain (JDK 21, AGP 8.7.2, Gradle 8.11.1, SDK 35):
# a NavBharatAI-assembled app compiled to a debug APK (apksigner-verified) and to a release AAB that was
# signed with an upload key, jarsigner-verified and accepted by `bundletool validate`.
# ---------------------------------------------------------------------------------------------------

ARG TEMURIN_17=eclipse-temurin:17-jdk-jammy
ARG TEMURIN_21=eclipse-temurin:21-jdk-jammy
FROM ${TEMURIN_17} AS jdk17
FROM ${TEMURIN_21} AS jdk21

FROM node:22.23.4-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl unzip zip ca-certificates perl \
  && rm -rf /var/lib/apt/lists/*

# --- JDKs: 21 for Capacitor 7/8, 17 for Capacitor 5/6 (capacitorToolchain.ts is the one table) -----
COPY --from=jdk17 /opt/java/openjdk /opt/java/jdk17
COPY --from=jdk21 /opt/java/openjdk /opt/java/jdk21
ENV JAVA_HOME=/opt/java/jdk21
ENV PATH="/opt/java/jdk21/bin:${PATH}"

# --- Android SDK -----------------------------------------------------------------------------------
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=/opt/android-sdk
ARG CMDLINE_TOOLS_VERSION=11076708
ARG CMDLINE_TOOLS_SHA256=2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258
RUN mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools \
  && curl -fsSL -o /tmp/cmdline-tools.zip \
       "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" \
  && echo "${CMDLINE_TOOLS_SHA256}  /tmp/cmdline-tools.zip" | sha256sum -c - \
  && unzip -q /tmp/cmdline-tools.zip -d ${ANDROID_SDK_ROOT}/cmdline-tools \
  && mv ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools ${ANDROID_SDK_ROOT}/cmdline-tools/latest \
  && rm /tmp/cmdline-tools.zip
ENV PATH="${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${PATH}"

# Exact package versions. build-tools 34.0.0 is what AGP 8.7 asks for by default; 35/36 serve newer
# Capacitor lines and provide the apksigner/aapt2 the signing stage uses.
RUN yes | sdkmanager --licenses > /dev/null \
  && sdkmanager --install \
       "platform-tools" \
       "platforms;android-35" \
       "platforms;android-36" \
       "build-tools;34.0.0" \
       "build-tools;35.0.0" \
       "build-tools;36.0.0" \
  && rm -rf ${ANDROID_SDK_ROOT}/.temp

# --- bundletool (validates and reads the .aab in the signing stage) — the runnable "all" jar --------
ARG BUNDLETOOL_VERSION=1.17.2
ARG BUNDLETOOL_SHA256=2d4ad908faea64047c1cc9cb747e6aa667c6ab192e09607bd16b67246a8cd6ae
RUN mkdir -p /opt/nbai-android \
  && curl -fsSL -o /opt/nbai-android/bundletool.jar \
       "https://github.com/google/bundletool/releases/download/${BUNDLETOOL_VERSION}/bundletool-all-${BUNDLETOOL_VERSION}.jar" \
  && echo "${BUNDLETOOL_SHA256}  /opt/nbai-android/bundletool.jar" | sha256sum -c -

# --- Shared caches, writable by the unprivileged sandbox user ---------------------------------------
# Builds run as E2B's non-root `user`. Gradle and npm caches live outside its home so the prewarm below
# (run at image build) is reused by every build, which then downloads far less over its restricted network.
ENV GRADLE_USER_HOME=/opt/nbai-cache/gradle
ENV npm_config_cache=/opt/nbai-cache/npm
RUN mkdir -p /opt/nbai-cache/gradle /opt/nbai-cache/npm

# --- Prewarm: build one real Capacitor app (debug APK + release AAB) so Gradle, AGP and AndroidX are cached
RUN set -eux; \
    mkdir -p /tmp/prewarm/www && cd /tmp/prewarm; \
    echo '<!doctype html><title>prewarm</title>' > www/index.html; \
    npm init -y > /dev/null; \
    npm install --no-audit --no-fund @capacitor/core@8 @capacitor/cli@8 @capacitor/android@8; \
    npx cap init Prewarm com.navbharatai.prewarm --web-dir www; \
    npx cap add android; \
    cd android && chmod +x gradlew && ./gradlew assembleDebug bundleRelease --no-daemon; \
    cd / && rm -rf /tmp/prewarm; \
    chmod -R a+rwX /opt/nbai-cache

# --- Record the exact toolchain this image carries ----------------------------------------------------
RUN { \
      echo "node $(node --version)"; \
      echo "jdk17 $(/opt/java/jdk17/bin/java -version 2>&1 | head -1)"; \
      echo "jdk21 $(/opt/java/jdk21/bin/java -version 2>&1 | head -1)"; \
      sdkmanager --list_installed 2>/dev/null | sed -n 's/^ *\(build-tools;[0-9.]*\|platforms;android-[0-9]*\|platform-tools\) *|.*| *\([0-9.]*\).*/\1 \2/p'; \
      echo "bundletool $(java -jar /opt/nbai-android/bundletool.jar version)"; \
    } > /opt/nbai-android/VERSIONS && cat /opt/nbai-android/VERSIONS

# --- Build-time sanity gate: a published template can always run a real build and a real signing -----
RUN /opt/java/jdk21/bin/java -version 2>&1 | grep -q '"21\.' || (echo "FATAL: JDK 21 missing" && exit 1)
RUN /opt/java/jdk17/bin/java -version 2>&1 | grep -q '"17\.' || (echo "FATAL: JDK 17 missing" && exit 1)
RUN test -x ${ANDROID_SDK_ROOT}/build-tools/35.0.0/apksigner || (echo "FATAL: apksigner missing" && exit 1)
RUN java -jar /opt/nbai-android/bundletool.jar version || (echo "FATAL: bundletool not runnable" && exit 1)
RUN command -v jarsigner && command -v keytool || (echo "FATAL: jarsigner/keytool missing" && exit 1)

WORKDIR /home/user
