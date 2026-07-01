# NavBharatAI Pro v3.0 — Android APK builder sandbox (TWA / Bubblewrap)
# ---------------------------------------------------------------------------
# WHY A SEPARATE TEMPLATE (not added to e2b.Dockerfile)
#   The default builder template (e2b.Dockerfile) is used for EVERY v3.0 build —
#   bloating it with a JDK + Android SDK + Gradle would slow every normal build's
#   cold-start and increase E2B cost for the common case, for a feature only a
#   fraction of builds ever use. This is a SEPARATE, on-demand template: a
#   sandbox is only created from it when the user explicitly requests an APK
#   download, via a dedicated ANDROID_E2B_TEMPLATE_ID (see README.md).
#
# WHAT THIS BUILDS TOWARD (real, not fake — see PROGRESS.md 2026-07-01)
#   The lightest REAL path to an installable Android APK from a hosted web app
#   is a TWA (Trusted Web Activity) via Google's own "Bubblewrap" CLI — it wraps
#   a real, publicly-reachable HTTPS URL (which NavBharatAI's existing Firebase
#   Hosting per-workspace deploy already provides — DeploymentService.ts) in a
#   thin native Android shell, backed by a real Gradle build + a real signing
#   keystore. This image is JUST the build environment; the orchestration code
#   that actually invokes bubblewrap + gradle + signs the APK is separate,
#   deliberately-deferred follow-up work (like e2b.Dockerfile's own "Code wiring
#   — NEXT PR" pattern) — this template must be built, published, and verified
#   BEFORE that wiring lands, so the feature is never pointed at a half-built
#   image.
#
# COST (honest — see README.md "Cost note"): this image is substantially larger
# than the default builder template (JDK + Android SDK + Gradle caches run into
# several GB) and an on-demand Android/Gradle build takes real minutes, not
# seconds. This is an infra cost decision for the account owner, same as the
# default template's own cost note.
# ---------------------------------------------------------------------------

FROM node:22-bookworm

# --- OS tooling + OpenJDK 17 (required by Android Gradle Plugin 8.x) --------
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      curl \
      unzip \
      ca-certificates \
      openjdk-17-jdk-headless \
  && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# --- Android SDK cmdline-tools ----------------------------------------------
# Pinned to a specific, known-good cmdline-tools release (Google does not keep
# old "latest" zips reachable at a stable URL — if this version is ever pulled,
# replace the URL + checksum with the current one from
# https://developer.android.com/studio#command-line-tools-only).
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_HOME=${ANDROID_SDK_ROOT}
ARG CMDLINE_TOOLS_VERSION=11076708
RUN mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools \
  && curl -fsSL -o /tmp/cmdline-tools.zip \
       "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" \
  && unzip -q /tmp/cmdline-tools.zip -d ${ANDROID_SDK_ROOT}/cmdline-tools \
  && mv ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools ${ANDROID_SDK_ROOT}/cmdline-tools/latest \
  && rm /tmp/cmdline-tools.zip

ENV PATH="${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${PATH}"

# --- Android SDK components (accept licenses non-interactively) ------------
# platform-tools (adb), a recent stable platform + build-tools — matches what
# Bubblewrap's generated Gradle project targets by default.
RUN yes | sdkmanager --licenses > /dev/null \
  && sdkmanager --install \
       "platform-tools" \
       "platforms;android-34" \
       "build-tools;34.0.0" \
  && rm -rf ${ANDROID_SDK_ROOT}/.temp

# --- Bubblewrap CLI (Google's official TWA generator) -----------------------
RUN npm install -g @bubblewrap/cli@latest \
  && npm cache verify

# Workspace root the actuator writes to — must match WORKSPACE_ROOT in
# E2BActuator.ts ('/home/user/workspace'), same convention as e2b.Dockerfile.
WORKDIR /home/user/workspace

# --- Build-time sanity gate --------------------------------------------------
# Fail the IMAGE build (not a user build) if the toolchain isn't actually usable —
# guarantees a published template can always run a real Gradle/Bubblewrap build.
RUN java -version 2>&1 | grep -q "17\." || (echo "FATAL: JDK 17 not active" && exit 1)
RUN sdkmanager --list_installed | grep -q "platform-tools" || (echo "FATAL: Android platform-tools missing" && exit 1)
RUN bubblewrap --version || (echo "FATAL: Bubblewrap CLI not installed" && exit 1)
