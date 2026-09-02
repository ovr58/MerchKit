# Озвучивает текущее содержимое буфера обмена (System.Speech). Используется задачей "Speak Clipboard".
# Голос выбирается по тому же правилу, что в .claude/hooks/on-stop.ps1: Natural, если есть,
# иначе ru-RU, иначе голос по умолчанию — см. docs/SPEECH_SETUP.md.

$ErrorActionPreference = 'Stop'

$text = Get-Clipboard -Raw
if ([string]::IsNullOrWhiteSpace($text)) {
    exit 0
}

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled }
$chosen = @(
    $voices | Where-Object { $_.VoiceInfo.Name -match 'Natural' } | Select-Object -First 1
    $voices | Where-Object { $_.VoiceInfo.Culture.Name -eq 'ru-RU' } | Select-Object -First 1
) | Where-Object { $_ } | Select-Object -First 1
if ($chosen) { $synth.SelectVoice($chosen.VoiceInfo.Name) }
$synth.Speak($text)
