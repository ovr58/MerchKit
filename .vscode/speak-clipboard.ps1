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
$synth.Rate = 0 # Скорость речи: от -10 (медленнее) до 10 (быстрее), 0 — обычная.
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled }

# Голос — по языку текста (кириллица vs латиница), внутри языка приоритет "Natural" (Параметры →
# Время и язык → Речь → Управление голосами), если такой когда-нибудь появится в системе.
$cyrillicCount = ([regex]::Matches($text, '\p{IsCyrillic}')).Count
$latinCount = ([regex]::Matches($text, '[A-Za-z]')).Count
$targetCulture = if ($latinCount -gt $cyrillicCount) { 'en-US' } else { 'ru-RU' }
$inCulture = $voices | Where-Object { $_.VoiceInfo.Culture.Name -eq $targetCulture }
$chosen = @(
    $inCulture | Where-Object { $_.VoiceInfo.Name -match 'Natural' } | Select-Object -First 1
    $inCulture | Select-Object -First 1
    $voices | Where-Object { $_.VoiceInfo.Name -match 'Natural' } | Select-Object -First 1
    $voices | Select-Object -First 1
) | Where-Object { $_ } | Select-Object -First 1
if ($chosen) { $synth.SelectVoice($chosen.VoiceInfo.Name) }
$synth.Speak($text)
