# Озвучивает текущее содержимое буфера обмена через Piper (если установлен, см. tools/piper/)
# или, если нет, через System.Speech. Используется задачей "Speak Clipboard".

$ErrorActionPreference = 'Stop'
# Без этого PowerShell кодирует текст, который пайпится во внешний exe (Piper), в US-ASCII по
# умолчанию — кириллица превращается в мусор ещё до того, как Piper её увидит.
$OutputEncoding = [System.Text.Encoding]::UTF8

$text = Get-Clipboard -Raw
if ([string]::IsNullOrWhiteSpace($text)) {
    exit 0
}

# Язык текста (кириллица vs латиница) определяет и модель Piper, и голос System.Speech ниже.
$cyrillicCount = ([regex]::Matches($text, '\p{IsCyrillic}')).Count
$latinCount = ([regex]::Matches($text, '[A-Za-z]')).Count
$targetCulture = if ($latinCount -gt $cyrillicCount) { 'en-US' } else { 'ru-RU' }

# --- Новое чтение прерывает предыдущее, а не звучит поверх него ---
# Убиваем только процессы озвучки, стартовавшие РАНЬШЕ нас: так два почти одновременных запуска
# не уничтожат друг друга взаимно — побеждает последний, как и ожидает пользователь.
try {
    $meStarted = (Get-CimInstance Win32_Process -Filter "ProcessId = $PID").CreationDate
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.ProcessId -ne $PID -and $_.CreationDate -lt $meStarted -and $_.CommandLine -match 'on-stop\.ps1|speak-clipboard\.ps1' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process -Filter "Name = 'piper.exe'" |
        Where-Object { $_.CreationDate -lt $meStarted } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {
    # Не смогли прибрать за предыдущим — не повод молчать самим.
}

# --- Piper (натуральный локальный голос), если установлен tools/piper/install-piper.ps1 ---
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$piperExe = Join-Path $repoRoot 'tools\piper\bin\piper.exe'
# Имя модели должно совпадать с тем, что скачивает tools/piper/install-piper.ps1 (там же —
# список альтернативных голосов и как его сменить).
$piperModelName = if ($targetCulture -eq 'en-US') { 'en_US-lessac-medium' } else { 'ru_RU-irina-medium' }
$piperModel = Join-Path $repoRoot "tools\piper\voices\$piperModelName.onnx"

$spokenViaPiper = $false
if ((Test-Path $piperExe) -and (Test-Path $piperModel)) {
    $wavPath = Join-Path $env:TEMP ("piper-" + [guid]::NewGuid().ToString('N') + '.wav')
    # Скорость речи Piper: множитель длины фонемы, 1.0 — обычная, МЕНЬШЕ значит БЫСТРЕЕ (обратно
    # System.Speech.Rate ниже). См. `piper.exe --help` → --length_scale.
    $piperLengthScale = 0.5
    try {
        $text | & $piperExe --model $piperModel --length_scale $piperLengthScale --output_file $wavPath | Out-Null
        if ((Test-Path $wavPath) -and (Get-Item $wavPath).Length -gt 0) {
            (New-Object System.Media.SoundPlayer $wavPath).PlaySync()
            $spokenViaPiper = $true
        }
    } catch {
        $spokenViaPiper = $false
    } finally {
        Remove-Item $wavPath -ErrorAction SilentlyContinue
    }
}

# --- Фолбэк на System.Speech, если Piper не установлен или синтез не удался ---
if (-not $spokenViaPiper) {
    Add-Type -AssemblyName System.Speech
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.Rate = 5 # Скорость речи: от -10 (медленнее) до 10 (быстрее), 0 — обычная.
    $voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled }
    # Внутри языка приоритет "Natural" (Параметры → Время и язык → Речь → Управление голосами),
    # если такой когда-нибудь появится в системе.
    $inCulture = $voices | Where-Object { $_.VoiceInfo.Culture.Name -eq $targetCulture }
    $chosen = @(
        $inCulture | Where-Object { $_.VoiceInfo.Name -match 'Natural' } | Select-Object -First 1
        $inCulture | Select-Object -First 1
        $voices | Where-Object { $_.VoiceInfo.Name -match 'Natural' } | Select-Object -First 1
        $voices | Select-Object -First 1
    ) | Where-Object { $_ } | Select-Object -First 1
    if ($chosen) { $synth.SelectVoice($chosen.VoiceInfo.Name) }
    $synth.Speak($text)
}
