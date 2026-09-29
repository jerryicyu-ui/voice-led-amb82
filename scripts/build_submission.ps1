# Build the submission package:
#   submission/VoiceLED_Report.pdf   <- docs/REPORT.md rendered with Chrome or Edge (needs internet for marked/mermaid CDN)
#   submission/VoiceLED_Source.zip   <- source code + environment setup, ready to upload to GitHub
#   submission/*.csv, DEMO_SCRIPT.md <- acceptance log and demo script
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'submission'
New-Item -ItemType Directory -Force $out | Out-Null

# ---------- PDF ----------
$utf8 = New-Object System.Text.UTF8Encoding($false)
$markdown = [IO.File]::ReadAllText((Join-Path $root 'docs\REPORT.md'), $utf8)
$template = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'report_template.html'), $utf8)
$markdown = $markdown.Replace('</script', '<\/script')
# Images in REPORT.md are relative to docs/, but the HTML is rendered from TEMP
$docsUrl = ([Uri]((Join-Path $root 'docs') + '\')).AbsoluteUri
$html = $template.Replace('__BASE__', $docsUrl).Replace('__MARKDOWN__', $markdown)

$tempDir = Join-Path $env:TEMP 'voiceled_report'
New-Item -ItemType Directory -Force $tempDir | Out-Null
$tempHtml = Join-Path $tempDir 'report.html'
$tempPdf = Join-Path $tempDir 'report.pdf'
[IO.File]::WriteAllText($tempHtml, $html, $utf8)
if (Test-Path $tempPdf) { Remove-Item $tempPdf }

$browser = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) { throw 'Chrome or Edge is required to build the PDF.' }

$url = ([Uri]$tempHtml).AbsoluteUri
$chromeArgs = @('--headless=new', '--disable-gpu', '--no-pdf-header-footer', "--user-data-dir=$tempDir\profile",
    '--virtual-time-budget=20000', "--print-to-pdf=$tempPdf", $url)
Start-Process $browser -ArgumentList $chromeArgs -Wait -NoNewWindow
if (-not (Test-Path $tempPdf)) { throw 'PDF was not generated.' }
Copy-Item $tempPdf (Join-Path $out 'VoiceLED_Report.pdf') -Force
Write-Host "PDF  -> submission\VoiceLED_Report.pdf"

# ---------- Source zip ----------
$stage = Join-Path $tempDir 'VoiceLED_Source'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

$items = @('voice_led', 'web', 'scripts', 'docs', 'clap', 'alarm', 'amb82_control', 'README.md', '.gitignore')
foreach ($item in $items) {
    $path = Join-Path $root $item
    if (Test-Path $path) { Copy-Item $path (Join-Path $stage $item) -Recurse -Force }
}
$vscode = Join-Path $stage '.vscode'
New-Item -ItemType Directory -Force $vscode | Out-Null
foreach ($file in @('tasks.json', 'arduino.json', 'settings.json', 'extensions.json')) {
    Copy-Item (Join-Path $root ".vscode\$file") $vscode
}

$zip = Join-Path $out 'VoiceLED_Source.zip'
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
# Compress-Archive skips dot-folders when using a wildcard, so add .vscode and .gitignore explicitly
Compress-Archive -Path (Join-Path $stage '.vscode'), (Join-Path $stage '.gitignore') -DestinationPath $zip -Update
Write-Host "ZIP  -> submission\VoiceLED_Source.zip"

# ---------- Evidence ----------
Get-ChildItem (Join-Path $root 'docs') -Filter *.csv | Copy-Item -Destination $out -Force
Copy-Item (Join-Path $root 'docs\DEMO_SCRIPT.md') $out -Force
Write-Host "Done: $out"
