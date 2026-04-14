/**
 * mcp-xcode.ts — foreman-xcode toolbelt
 *
 * Mobile platform tools: iOS simulator + Android emulator app launch.
 * Kept separate because these are Xcode/Android-specific concerns.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { getState } from "./session.js";

export interface XcodeMcpContext {
  channelId: string;
}

export function createXcodeTools(ctx: XcodeMcpContext) {
  const { channelId } = ctx;

  return [
    tool(
      "LaunchApp",
      "Launch the mobile app on the connected simulator or emulator. " +
      "Auto-detects the platform: if the cwd contains a .xcworkspace it runs the iOS launch flow; " +
      "if it contains a gradlew file it runs the Android launch flow. " +
      "Use this instead of Bash when asked to launch, run, or start the app.",
      {},
      async () => {
        const cwd = getState(channelId).cwd;

        // Detect platform
        const hasXcworkspace = (() => {
          try { return execSync("find . -maxdepth 1 -name '*.xcworkspace' | head -1", { cwd, encoding: "utf8" }).trim() !== ""; } catch { return false; }
        })();
        const hasGradlew = existsSync(join(cwd, "gradlew"));

        if (hasXcworkspace) {
          // iOS launch flow
          try {
            const workspace = execSync("find . -maxdepth 1 -name '*.xcworkspace' | head -1", { cwd, encoding: "utf8" }).trim().replace(/^\.\//, "");
            const scheme = workspace.replace(/\.xcworkspace$/, "");

            // Find booted simulator
            const simList = execSync("xcrun simctl list devices --json", { encoding: "utf8" });
            const json = JSON.parse(simList) as { devices: Record<string, { udid: string; name: string; state: string }[]> };
            const booted = Object.values(json.devices).flat().find(d => d.state === "Booted");
            if (!booted) return { content: [{ type: "text" as const, text: ":x: No booted simulator found. Boot one in Xcode first." }] };

            // Find last built .app in DerivedData
            const derivedDataRoot = join(homedir(), "Library/Developer/Xcode/DerivedData");
            const workspacePath = join(cwd, workspace);
            let appPath = "";
            const ddEntries = execSync(`ls "${derivedDataRoot}"`, { encoding: "utf8" }).trim().split("\n");
            for (const entry of ddEntries) {
              const infoPlist = join(derivedDataRoot, entry, "info.plist");
              if (!existsSync(infoPlist)) continue;
              try {
                const wsPath = execSync(`plutil -extract WorkspacePath raw "${infoPlist}" 2>/dev/null`, { encoding: "utf8" }).trim();
                if (wsPath === workspacePath) {
                  const productsDir = join(derivedDataRoot, entry, "Build/Products/Debug-iphonesimulator");
                  try {
                    const apps = execSync(`ls -d "${productsDir}"/*.app 2>/dev/null`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
                    if (apps.length > 0) { appPath = apps[0]; break; }
                  } catch { /* no .app */ }
                }
              } catch { /* skip */ }
            }
            if (!appPath) return { content: [{ type: "text" as const, text: ":x: No built app found. Run `/f build` first." }] };

            execSync(`xcrun simctl install "${booted.udid}" "${appPath}"`, { encoding: "utf8" });
            const bundleId = execSync(
              `plutil -extract CFBundleIdentifier raw "${appPath}/Info.plist" 2>/dev/null`,
              { encoding: "utf8" }
            ).trim();
            if (bundleId) {
              execSync(`xcrun simctl launch "${booted.udid}" "${bundleId}"`, { encoding: "utf8" });
              return { content: [{ type: "text" as const, text: `:white_check_mark: Launched \`${scheme}\` on \`${booted.name}\`` }] };
            }
            return { content: [{ type: "text" as const, text: `:white_check_mark: Installed on \`${booted.name}\` — launch manually (couldn't detect bundle ID).` }] };
          } catch (err) {
            return { content: [{ type: "text" as const, text: `:x: iOS launch failed: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        } else if (hasGradlew) {
          // Android launch flow
          try {
            const adbCandidates = [
              `${homedir()}/Library/Android/sdk/platform-tools/adb`,
              "adb", "/usr/local/bin/adb", "/opt/homebrew/bin/adb",
            ];
            let adbPath = "adb";
            for (const candidate of adbCandidates) {
              try { execSync(`test -x "${candidate}"`, { encoding: "utf8" }); adbPath = candidate; break; } catch { /* try next */ }
            }

            const devices = execSync(`"${adbPath}" devices`, { encoding: "utf8" });
            const emulatorLine = devices.split("\n").find(l => l.includes("emulator") && l.includes("device"));
            if (!emulatorLine) return { content: [{ type: "text" as const, text: ":x: No running Android emulator found." }] };
            const emulatorId = emulatorLine.split("\t")[0].trim();

            const javaHomeCandidates = [
              process.env.JAVA_HOME,
              "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
              "/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home",
              "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home",
              "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
              "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
            ].filter(Boolean) as string[];
            let javaHome = "";
            for (const candidate of javaHomeCandidates) {
              try { execSync(`test -d "${candidate}"`, { encoding: "utf8" }); javaHome = candidate; break; } catch { /* try next */ }
            }
            const gradleEnv = {
              ...process.env,
              PATH: `/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:${process.env.PATH || "/usr/bin:/bin"}`,
              ...(javaHome ? { JAVA_HOME: javaHome } : {}),
            };

            execSync(`./gradlew installBetaDebug`, { cwd, env: gradleEnv, encoding: "utf8", timeout: 5 * 60 * 1000 });

            // Auto-detect launch activity
            try {
              const pkg = execSync(`"${adbPath}" shell pm list packages | grep myfitnesspal | head -1 | sed 's/package://'`, { encoding: "utf8" }).trim();
              const act = execSync(`"${adbPath}" shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${pkg} 2>/dev/null | tail -1`, { encoding: "utf8" }).trim();
              if (act) {
                execSync(`"${adbPath}" -s "${emulatorId}" shell am start -n "${act}"`, { encoding: "utf8" });
                return { content: [{ type: "text" as const, text: `:white_check_mark: Launched \`${act}\` on \`${emulatorId}\`` }] };
              }
            } catch { /* couldn't detect activity */ }
            return { content: [{ type: "text" as const, text: `:white_check_mark: Installed on \`${emulatorId}\` — launch manually.` }] };
          } catch (err) {
            return { content: [{ type: "text" as const, text: `:x: Android launch failed: ${err instanceof Error ? err.message : String(err)}` }] };
          }
        } else {
          return { content: [{ type: "text" as const, text: `:x: Could not detect platform in \`${cwd}\`. No \`.xcworkspace\` or \`gradlew\` found.` }] };
        }
      }
    ),
  ];
}
