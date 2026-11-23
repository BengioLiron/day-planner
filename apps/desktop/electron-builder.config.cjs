// Installer settings. Automatic updates are switched on only for builds made
// by GitHub Actions, where GITHUB_REPOSITORY ("owner/repo") says where the
// releases live. Local builds have no update source and never update themselves.
const [owner, repo] = (process.env.GITHUB_REPOSITORY || "").split("/");

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "com.dayplanner.app",
  productName: "Day Planner",
  directories: { output: "release", buildResources: "build" },
  files: ["dist/**/*", "package.json"],
  extraResources: [
    { from: "../web/dist", to: "web" },
    { from: "build/icon.png", to: "icons/icon.png" },
    { from: "build/tray.png", to: "icons/tray.png" },
    { from: "build/tray@2x.png", to: "icons/tray@2x.png" },
  ],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "build/icon.ico",
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    artifactName: "Day-Planner-Setup-${version}.${ext}",
    deleteAppDataOnUninstall: false,
  },
  publish: owner && repo ? [{ provider: "github", owner, repo, releaseType: "release" }] : null,
};
