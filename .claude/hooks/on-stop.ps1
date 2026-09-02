# Озвучивает последний ответ Claude Code через System.Speech при завершении хода (Stop-хук).
# Управление: /speech on|off|status (создаёт/удаляет .claude/tts-enabled рядом с этим скриптом).
# Регистрация хука — в .claude/settings.local.json (машинно-зависимо, см. settings.local.json.example).

$ErrorActionPreference = 'Stop'

$hooksDir = $PSScriptRoot
$flagPath = Join-Path $hooksDir '..\tts-enabled'
if (-not (Test-Path -LiteralPath $flagPath)) {
    exit 0
}

$stdin = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($stdin)) {
    exit 0
}

try {
    $payload = $stdin | ConvertFrom-Json
} catch {
    exit 0
}

$text = $payload.last_assistant_message
if ([string]::IsNullOrWhiteSpace($text)) {
    exit 0
}

# Минимальная чистка markdown — не разбор, а грубое отсечение символов, мешающих TTS.
$text = $text -replace '```[\s\S]*?```', ' код опущен. '
$text = $text -replace '\[([^\]]+)\]\([^)]+\)', '$1'
$text = $text -replace '[`*_#>|]', ''
$text = $text.Trim()

if ($text.Length -eq 0) {
    exit 0
}
if ($text.Length -gt 2000) {
    $text = $text.Substring(0, 2000)
}

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled }
# Предпочесть голос "Natural" (Параметры → Время и язык → Речь → Управление голосами), если
# такой когда-нибудь появится в системе — иначе штатный ru-RU, иначе голос по умолчанию.
$chosen = @(
    $voices | Where-Object { $_.VoiceInfo.Name -match 'Natural' } | Select-Object -First 1
    $voices | Where-Object { $_.VoiceInfo.Culture.Name -eq 'ru-RU' } | Select-Object -First 1
) | Where-Object { $_ } | Select-Object -First 1
if ($chosen) { $synth.SelectVoice($chosen.VoiceInfo.Name) }
$synth.Speak($text)
