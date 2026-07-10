// afterPack: exe本体にアイコンを焼く。
// package.json の signAndEditExecutable:false（winCodeSign の mac用 dylib symlink 展開で
// 「特権を保有していません」エラーになるのを回避するため必須）は exe編集も止めるため、
// electron-builder 自身はアイコンを焼けない。unpacked 完成後・Setup 化の前にここで rcedit で焼く。
//
// exe名を productFilename から推測すると外すことがあったため（本体exeが青のまま残った）、
// appOutDir 直下の *.exe を実走査して全て焼く。Uninstall*.exe は NSIS 側が別途アイコンを持つので除外。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'win32') return;

  const outDir = context.appOutDir;
  const rcedit = path.join(__dirname, '..', 'tools', 'rcedit-x64.exe');
  const icon = path.join(__dirname, '..', 'resources', 'icon.ico');

  const exes = fs.readdirSync(outDir)
    .filter(f => f.toLowerCase().endsWith('.exe') && !/^uninstall/i.test(f));

  console.log(`[afterPack] outDir=${outDir}`);
  console.log(`[afterPack] target exes: ${exes.join(', ') || '(none)'}`);

  for (const exe of exes) {
    const exePath = path.join(outDir, exe);
    try {
      execFileSync(rcedit, [exePath, '--set-icon', icon], { stdio: 'inherit' });
      console.log(`[afterPack] icon burned into ${exe}`);
    } catch (e) {
      console.warn(`[afterPack] icon burn failed for ${exe}: ${e.message}`);
    }
  }
};
