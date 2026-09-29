param(
    [Parameter(Position = 0)]
    [ValidateSet('compile', 'upload', 'monitor', 'list')]
    [string]$Action = 'compile',

    [string]$Port = 'COM3',

    [string]$SketchName = 'clap'
)

$ErrorActionPreference = 'Stop'
$env:LANG = 'C'
$env:LC_ALL = 'C'

$cli = @(
    (Join-Path $env:LOCALAPPDATA 'Arduino15\cli\arduino-cli.exe'),
    (Join-Path $env:ProgramFiles 'Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\arduino-ide\resources\app\lib\backend\resources\arduino-cli.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $cli) {
    throw 'Arduino CLI was not found (Arduino15\cli or Arduino IDE)'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$sketch = Join-Path $projectRoot $SketchName
$buildDirectory = Join-Path $env:LOCALAPPDATA "Arduino15\build\$SketchName"
$fqbn = 'realtek:AmebaPro2:Ameba_AMB82-MINI'

if (-not (Test-Path -LiteralPath $sketch -PathType Container)) {
    throw "Sketch directory was not found at $sketch"
}

function Invoke-ArduinoCli {
    & $cli @args
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

switch ($Action) {
    'compile' {
        Invoke-ArduinoCli compile --fqbn $fqbn --build-path $buildDirectory $sketch
    }
    'upload' {
        Write-Host 'Before upload: hold UART_DOWNLOAD, tap RESET, then release UART_DOWNLOAD.'
        Invoke-ArduinoCli compile --fqbn $fqbn --build-path $buildDirectory $sketch

        $toolsRoot = Join-Path $env:LOCALAPPDATA 'Arduino15\packages\realtek\tools\ameba_pro2_tools'
        $toolsPath = Get-ChildItem -LiteralPath $toolsRoot -Directory |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1 -ExpandProperty FullName
        $uploader = Join-Path $toolsPath 'image_windows.exe'
        $firmware = Join-Path $toolsPath 'flash_ntz.bin'

        if (-not (Test-Path -LiteralPath $uploader)) {
            throw "Realtek uploader was not found at $uploader"
        }
        if (-not (Test-Path -LiteralPath $firmware)) {
            throw "Compiled firmware was not found at $firmware"
        }

        & $uploader $toolsPath $Port '{board}' 'Disable' 'Disable' '2000000' `
            'uartfwburn.exe' 'Auto_Flash_Pro2_V3.3_win.exe' `
            '0x60000' '0x460000' '0x530000'
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }
    'monitor' {
        Invoke-ArduinoCli monitor --port $Port --fqbn $fqbn --config baudrate=115200
    }
    'list' {
        Invoke-ArduinoCli board list
    }
}
