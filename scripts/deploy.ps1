# berkeleyenglish.co.kr 배포 — 먼저 고정 기능 검사(scripts/check-features.mjs)를 하고, 하나라도 ❌이면 배포하지 않아요.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1
$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:Path"
$site = "0821ecb8-b3ff-4411-88fb-116112a4625e"   # berkeleyenglish.co.kr (.netlify/state.json)
Set-Location (Split-Path $PSScriptRoot -Parent)

node scripts/check-features.mjs
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n배포를 멈췄어요: 고정 기능 검사에서 문제가 나왔어요. 위의 ❌ 항목을 고친 뒤 다시 배포하세요." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path "node_modules\@netlify\blobs")) {
  Write-Host "Installing function dependencies..."
  npm install --no-fund --no-audit
}
$msg = "berkeley: " + (git log -1 --format=%h)
& "$env:APPDATA\npm\netlify.cmd" deploy --prod --site $site --dir . --functions netlify/functions --message $msg
