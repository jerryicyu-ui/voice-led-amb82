# Serve the web/ folder at http://localhost (no Python / Node needed).
# Browsers only reliably allow the microphone and Web Serial on secure origins (https or localhost),
# so open the page through localhost instead of double-clicking index.html.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([int]$Port = 8000)

$root = Join-Path (Split-Path -Parent $PSScriptRoot) 'web'
$types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8' }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/  (Ctrl+C to stop)"

# Web Speech API and Web Serial need Chrome or Edge, so prefer them over the default browser
$candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($browser) { Start-Process $browser "http://localhost:$Port/" } else { Start-Process "http://localhost:$Port/" }

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
        if ($relative -eq '') { $relative = 'index.html' }
        $file = [IO.Path]::GetFullPath((Join-Path $root $relative))
        $response = $context.Response

        if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
            $bytes = [IO.File]::ReadAllBytes($file)
            $ext = [IO.Path]::GetExtension($file)
            $response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
            $response.Headers.Add('Cache-Control', 'no-store')
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.Close()
        Write-Host "$($context.Request.HttpMethod) /$relative -> $($response.StatusCode)"
    }
} finally {
    $listener.Stop()
}
