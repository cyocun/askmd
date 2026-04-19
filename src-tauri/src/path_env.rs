// Finder/Spotlight から GUI アプリとして起動された場合、macOS は launchd 経由で
// 最小 PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) だけを渡す。シェルの rc は読まれない。
// そのため Homebrew (`/opt/homebrew/bin`) / npm global (`~/.npm-global/bin`) /
// Volta / Fnm / asdf などの配下にインストールされた CLI (claude, gh, chatgpt)
// が `which` でヒットせず LLM 機能が無効化されてしまう。
//
// ここではユーザーのログインシェルを interactive login mode で叩き、
// 実際の PATH を取得してプロセス環境に書き戻す。ターミナル経由ですでに
// 継承されている場合は結果が同じになるだけで害はない。

#[cfg(target_os = "macos")]
pub fn fix() {
    use std::process::Command;

    // GUI 起動の判定: TERM が空 かつ minimal PATH のとき
    let path = std::env::var("PATH").unwrap_or_default();
    let is_minimal = !path.contains("/opt/homebrew/bin")
        && !path.contains("/usr/local/bin")
        && !path.contains(".npm-global")
        && !path.contains(".volta");
    if !is_minimal {
        return;
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    // `-i -l -c 'echo -n $PATH'` でユーザーの rc/profile を読んだ状態の PATH を取得
    let output = Command::new(&shell)
        .args(["-ilc", "echo -n \"$PATH\""])
        .output();
    let Ok(out) = output else { return };
    if !out.status.success() {
        return;
    }
    let Ok(new_path) = String::from_utf8(out.stdout) else {
        return;
    };
    let new_path = new_path.trim();
    if new_path.is_empty() {
        return;
    }
    std::env::set_var("PATH", new_path);
}

#[cfg(not(target_os = "macos"))]
pub fn fix() {}
