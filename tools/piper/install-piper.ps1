# Ставит Piper TTS (rhasspy/piper, последний релиз до архивации проекта — 2023.11.14-2,
# см. https://github.com/rhasspy/piper) + голоса RU/EN в tools/piper/{bin,voices}/.
# Не коммитится (см. .gitignore) — опционально, один раз на машине, для голоса заметно
# естественнее, чем Windows System.Speech. Подключение скриптами озвучивания — автоматическое,
# если файлы на месте (см. docs/SPEECH_SETUP.md).
#
# Итоговый вес: exe ~21 МБ + по ~60 МБ на голос — нужен интернет и место на диске.

$ErrorActionPreference = 'Stop'

$piperDir = Join-Path $PSScriptRoot 'bin'
$voicesDir = Join-Path $PSScriptRoot 'voices'
New-Item -ItemType Directory -Force -Path $piperDir, $voicesDir | Out-Null

if (-not (Test-Path (Join-Path $piperDir 'piper.exe'))) {
    Write-Host 'Downloading Piper (piper_windows_amd64.zip, ~21 MB)...'
    $zipPath = Join-Path $env:TEMP 'piper_windows_amd64.zip'
    Invoke-WebRequest -Uri 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip' -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $piperDir -Force
    Remove-Item $zipPath
    # В архиве всё лежит в подпапке piper/ — поднять содержимое на уровень выше, в bin/.
    $nested = Join-Path $piperDir 'piper'
    if (Test-Path $nested) {
        Get-ChildItem $nested | Move-Item -Destination $piperDir -Force
        Remove-Item $nested -Recurse -Force
    }
}

# Голоса — rhasspy/piper-voices на Hugging Face, все ru_RU только в качестве "medium" (~60 МБ):
#   ru_RU: denis, dmitri, irina (текущий выбор), ruslan
# У en_US голосов намного больше и есть уровни low/medium/high — см. список и сэмплы на
# https://rhasspy.github.io/piper-samples/. Чтобы сменить голос — поменять Name/Path в списке
# ниже (то же имя должно совпадать с тем, что ищут on-stop.ps1 и .vscode/speak-clipboard.ps1).
$voices = @(
    @{ Name = 'ru_RU-irina-medium'; Path = 'ru/ru_RU/irina/medium' }
    @{ Name = 'en_US-lessac-medium'; Path = 'en/en_US/lessac/medium' }
)
foreach ($v in $voices) {
    $onnx = Join-Path $voicesDir "$($v.Name).onnx"
    $json = Join-Path $voicesDir "$($v.Name).onnx.json"
    if (-not (Test-Path $onnx)) {
        Write-Host "Downloading voice $($v.Name) (~60 MB)..."
        Invoke-WebRequest -Uri "https://huggingface.co/rhasspy/piper-voices/resolve/main/$($v.Path)/$($v.Name).onnx" -OutFile $onnx
    }
    if (-not (Test-Path $json)) {
        Invoke-WebRequest -Uri "https://huggingface.co/rhasspy/piper-voices/resolve/main/$($v.Path)/$($v.Name).onnx.json" -OutFile $json
    }
}

Write-Host 'Done. Piper + RU/EN voices are in tools/piper/ -- the speak scripts will pick them up automatically.'
