cask "blackfin" do
  arch arm: "arm64", intel: "x64"

  version "[[VERSION]]"
  sha256 arm:   "[[SHA256_ARM64]]",
         intel: "[[SHA256_X64]]"

  url "https://github.com/matbrgz/blackfin/releases/download/v#{version}/Blackfin-v#{version}-macOS-#{arch}.zip"
  name "Blackfin"
  desc "Agentic control center for developers, built on a GitHub Desktop fork"
  homepage "https://github.com/matbrgz/blackfin"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :monterey

  app "Blackfin.app"
  binary "#{appdir}/Blackfin.app/Contents/Resources/app/static/blackfin-cli.sh",
         target: "blackfin-cli"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Blackfin.app"]
  end

  zap trash: [
    "~/Library/Application Support/Blackfin",
    "~/Library/Logs/Blackfin",
  ]
end
